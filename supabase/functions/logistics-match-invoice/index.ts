// logistics-match-invoice — the rate engine.
// Two independent checks per invoice line:
//
// 1. WEIGHT CHECK (the big one): carriers mis-key shipment size and bill as a
//    larger shipment. For lines with a con-note/tracking number, look up the
//    shipment in ShipStation and compare the BILLED weight against the
//    chargeable weight from what we physically entered:
//        chargeable = max(dead weight, cubic (L×W×H) × carrier cubic factor)
//    If billed > chargeable (beyond rounding tolerance), the line is
//    'overbilled' and the expected cost is computed from OUR weight.
//
// 2. RATE CHECK: match each line against the carrier's ACTIVE rate card
//    entries and compute the expected charge.
//      • service: case-insensitive exact match
//      • origin/destination: entry NULL = wildcard; most specific wins
//      • per_kg → base + rate × weight   • per_item → base + rate × qty
//      • flat → rate                     • percent → rate% × freight subtotal
//      • min_charge floors the result    • GST lines skipped
//
// Auto-flags the invoice when total overcharge exceeds tolerance.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OVERCHARGE_TOLERANCE_AUD = 1.0;
const MAX_SHIPSTATION_LOOKUPS = 60;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// ─── ShipStation ────────────────────────────────────────────────────────────

function toKg(value: number, units: string | null | undefined): number {
  switch ((units ?? "").toLowerCase()) {
    case "grams":  return value / 1000;
    case "ounces": return value * 0.0283495;
    case "pounds": return value * 0.453592;
    default:       return value; // assume kg
  }
}

// NOTE: verified 2026-07-02 against shipment 276112793 (DHI143383462): the AGA
// ShipStation account is metric — the UI shows "16.5l x 20w x 2h (cm)" but the
// v1 API reports the SAME numbers with units:"inches". The unit label is the
// account display default, not the entered unit, so treat values as cm always.
function toMetres(value: number): number {
  return value / 100;
}

// Look up a shipment by tracking number; returns dead weight (kg) + cubic (m³)
async function shipstationLookup(tracking: string, auth: string) {
  const res = await fetch(
    `https://ssapi.shipstation.com/shipments?trackingNumber=${encodeURIComponent(tracking)}&pageSize=1`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const sh = data?.shipments?.[0];
  if (!sh) return null;
  // Guard: only trust an exact tracking-number match — never a "closest" result
  if ((sh.trackingNumber ?? "").trim().toLowerCase() !== tracking.trim().toLowerCase()) return null;

  const weightKg = sh.weight?.value != null ? toKg(Number(sh.weight.value), sh.weight.units) : null;
  let cubicM3: number | null = null;
  const d = sh.dimensions;
  if (d?.length != null && d?.width != null && d?.height != null) {
    cubicM3 = toMetres(Number(d.length)) * toMetres(Number(d.width)) * toMetres(Number(d.height));
  }
  return { weightKg, cubicM3 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify Supabase JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { invoice_id } = await req.json();
    if (!invoice_id) throw new Error("invoice_id is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: invoice, error: invErr } = await supabase
      .from("freight_invoices")
      .select("*, carriers(*), freight_invoice_lines(*)")
      .eq("id", invoice_id)
      .single();
    if (invErr || !invoice) throw new Error("Invoice not found");

    // Active rate card entries for this carrier, valid on the invoice date
    const { data: cards, error: rcErr } = await supabase
      .from("rate_cards")
      .select("id, effective_from, effective_to, rate_card_entries(*)")
      .eq("carrier_id", invoice.carrier_id)
      .eq("status", "active");
    if (rcErr) throw rcErr;

    const invDate = invoice.invoice_date;
    const entries = (cards ?? [])
      .filter(c =>
        (!c.effective_from || c.effective_from <= invDate) &&
        (!c.effective_to   || c.effective_to   >= invDate))
      .flatMap(c => c.rate_card_entries ?? []);

    const lines = [...(invoice.freight_invoice_lines ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order);

    // ── Weight check pass — ShipStation cross-reference ─────────────────────
    const ssKey    = Deno.env.get("SHIPSTATION_API_KEY");
    const ssSecret = Deno.env.get("SHIPSTATION_API_SECRET");
    const ssAuth   = ssKey && ssSecret ? btoa(`${ssKey}:${ssSecret}`) : null;
    const cubicFactor = Number(invoice.carriers?.cubic_factor_kg_m3 ?? 250);

    // weightData: line.id → { actual, cubic, chargeable, check }
    const weightData = new Map<string, { actual: number | null; cubic: number | null; chargeable: number | null; check: string }>();
    let lookups = 0;
    for (const line of lines) {
      if (!line.tracking_ref || line.weight_kg == null) continue;
      if (!ssAuth || lookups >= MAX_SHIPSTATION_LOOKUPS) {
        weightData.set(line.id, { actual: null, cubic: null, chargeable: null, check: "unmatched" });
        continue;
      }
      lookups++;
      let found = null;
      try { found = await shipstationLookup(line.tracking_ref, ssAuth); } catch { /* network — treat as unmatched */ }
      if (!found || (found.weightKg == null && found.cubicM3 == null)) {
        weightData.set(line.id, { actual: null, cubic: null, chargeable: null, check: "unmatched" });
        continue;
      }
      const dead  = found.weightKg;
      const cubic = found.cubicM3;
      const cubicWeight = cubic != null ? cubic * cubicFactor : null;
      const chargeable  = Math.max(dead ?? 0, cubicWeight ?? 0) || null;
      if (chargeable == null) {
        weightData.set(line.id, { actual: dead, cubic, chargeable: null, check: "unmatched" });
        continue;
      }
      // Tolerance: carriers round up to the next kg — allow ceil(chargeable) + 1kg or 5%
      const tolerance = Math.max(1, chargeable * 0.05);
      const overbilled = Number(line.weight_kg) > Math.ceil(chargeable) + tolerance;
      weightData.set(line.id, {
        actual: dead != null ? Math.round(dead * 100) / 100 : null,
        cubic:  cubic != null ? Math.round(cubic * 10000) / 10000 : null,
        chargeable: Math.round(chargeable * 100) / 100,
        check: overbilled ? "overbilled" : "ok",
      });
    }

    // ── Rate check ───────────────────────────────────────────────────────────
    const findEntry = (line: Record<string, unknown>, pool: Record<string, unknown>[]) => {
      let best: Record<string, unknown> | null = null;
      let bestScore = -1;
      for (const e of pool) {
        if (norm(e.service as string) !== norm(line.service as string)) continue;
        const oOk = e.origin      == null || norm(e.origin as string)      === norm(line.origin as string);
        const dOk = e.destination == null || norm(e.destination as string) === norm(line.destination as string);
        if (!oOk || !dOk) continue;
        const score = (e.origin != null ? 1 : 0) + (e.destination != null ? 1 : 0);
        if (score > bestScore) { best = e; bestScore = score; }
      }
      return best;
    };

    type Result = { id: string; expected_total: number | null; matched_entry_id: string | null; match_status: string };
    const results: Result[] = [];
    const percentLines: Record<string, unknown>[] = [];
    let freightExpectedSubtotal = 0;

    // Billing weight for expected-cost calc: our chargeable weight when the
    // carrier overbilled, otherwise the carrier's billed weight.
    const billingWeight = (line: Record<string, unknown>) => {
      const wd = weightData.get(line.id as string);
      return wd?.check === "overbilled" ? wd.chargeable : (line.weight_kg != null ? Number(line.weight_kg) : null);
    };

    // Pass 1 — non-percent lines
    for (const line of lines) {
      const isGst = norm(line.description).includes("gst") || norm(line.service) === "gst";
      if (isGst) {
        results.push({ id: line.id, expected_total: null, matched_entry_id: null, match_status: "skipped" });
        continue;
      }
      if (!line.service) {
        results.push({ id: line.id, expected_total: null, matched_entry_id: null, match_status: "no_rate" });
        continue;
      }
      const entry = findEntry(line, entries.filter(e => e.rate_type !== "percent"));
      if (!entry) {
        const pctEntry = findEntry(line, entries.filter(e => e.rate_type === "percent"));
        const looksLikeLevy = norm(line.service).includes("fuel") || norm(line.description).includes("fuel");
        if (pctEntry || looksLikeLevy) { percentLines.push(line); continue; }
        results.push({ id: line.id, expected_total: null, matched_entry_id: null, match_status: "no_rate" });
        continue;
      }
      const rate = Number(entry.rate);
      const base = Number(entry.base_charge ?? 0);
      let expected: number | null = null;
      if (entry.rate_type === "per_kg") {
        const w = billingWeight(line);
        expected = w != null ? base + rate * w : null;
      }
      if (entry.rate_type === "per_item") expected = line.qty != null ? base + rate * Number(line.qty) : null;
      if (entry.rate_type === "flat")     expected = rate;
      if (expected == null) {
        results.push({ id: line.id, expected_total: null, matched_entry_id: entry.id as string, match_status: "no_rate" });
        continue;
      }
      if (entry.min_charge != null && expected < Number(entry.min_charge)) expected = Number(entry.min_charge);
      expected = Math.round(expected * 100) / 100;
      freightExpectedSubtotal += expected;
      results.push({ id: line.id, expected_total: expected, matched_entry_id: entry.id as string, match_status: "matched" });
    }

    // Pass 2 — percent lines (fuel levy) against the matched freight subtotal
    for (const line of percentLines) {
      const entry = findEntry(line, entries.filter(e => e.rate_type === "percent"));
      const pct = entry ? Number(entry.rate) : (invoice.carriers?.fuel_levy_pct != null ? Number(invoice.carriers.fuel_levy_pct) : null);
      if (pct == null || freightExpectedSubtotal <= 0) {
        results.push({ id: line.id, expected_total: null, matched_entry_id: entry?.id as string ?? null, match_status: "no_rate" });
        continue;
      }
      const expected = Math.round(freightExpectedSubtotal * pct) / 100;
      results.push({ id: line.id, expected_total: expected, matched_entry_id: entry?.id as string ?? null, match_status: "matched" });
    }

    // Write results back (rate + weight data together)
    for (const r of results) {
      const wd = weightData.get(r.id);
      const { error } = await supabase
        .from("freight_invoice_lines")
        .update({
          expected_total:       r.expected_total,
          matched_entry_id:     r.matched_entry_id,
          match_status:         r.match_status,
          actual_weight_kg:     wd?.actual ?? null,
          actual_cubic_m3:      wd?.cubic ?? null,
          chargeable_weight_kg: wd?.chargeable ?? null,
          weight_check:         wd?.check ?? null,
        })
        .eq("id", r.id);
      if (error) throw error;
    }

    // Totals + status
    const byId = new Map(lines.map(l => [l.id, l]));
    let overcharge = 0;
    for (const r of results) {
      if (r.expected_total == null) continue;
      const v = Number(byId.get(r.id)!.charged_total) - r.expected_total;
      if (v > 0) overcharge += v;
    }
    overcharge = Math.round(overcharge * 100) / 100;

    const counts = {
      matched: results.filter(r => r.match_status === "matched").length,
      no_rate: results.filter(r => r.match_status === "no_rate").length,
      skipped: results.filter(r => r.match_status === "skipped").length,
      weights_checked:   [...weightData.values()].filter(w => w.check !== "unmatched").length,
      weights_unmatched: [...weightData.values()].filter(w => w.check === "unmatched").length,
      overbilled:        [...weightData.values()].filter(w => w.check === "overbilled").length,
    };

    // Only advance status from pending/matched/flagged — never clobber a dispute
    let status = invoice.status;
    if (["pending", "matched", "flagged"].includes(invoice.status)) {
      status = (overcharge > OVERCHARGE_TOLERANCE_AUD || counts.overbilled > 0) ? "flagged" : "matched";
      const { error } = await supabase
        .from("freight_invoices")
        .update({ status, matched_at: new Date().toISOString() })
        .eq("id", invoice_id);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ ...counts, overcharge_aud: overcharge, status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
