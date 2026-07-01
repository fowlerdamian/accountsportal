// logistics-match-invoice — the freight audit engine.
//
// Baseline: ShipStation booked cost. For lines with a con-note / tracking
// number, look up the shipment in ShipStation. The cost quoted at booking is
// based on the weight/dims WE entered, so expected = booked cost catches both
// wrong rates and re-rated weights in a single comparison.
//
// Weight evidence runs alongside for the dispute letter:
//     chargeable = max(dead weight, cubic (L×W×H) × carrier cubic factor)
//     billed > chargeable (beyond rounding tolerance) → 'overbilled'
//
// Fuel-levy lines are priced from carriers.fuel_levy_pct × the booked freight
// subtotal. GST lines are skipped. Lines with no ShipStation booking get
// match_status 'no_rate' (no baseline). Auto-flags the invoice when total
// overcharge exceeds tolerance or any weight is overbilled.
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

// Look up a shipment by tracking number; returns booked cost + dead weight (kg) + cubic (m³)
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

  const cost = sh.shipmentCost != null && Number(sh.shipmentCost) > 0 ? Number(sh.shipmentCost) : null;
  const weightKg = sh.weight?.value != null ? toKg(Number(sh.weight.value), sh.weight.units) : null;
  let cubicM3: number | null = null;
  const d = sh.dimensions;
  if (d?.length != null && d?.width != null && d?.height != null) {
    cubicM3 = toMetres(Number(d.length)) * toMetres(Number(d.width)) * toMetres(Number(d.height));
  }
  return { cost, weightKg, cubicM3 };
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

    const lines = [...(invoice.freight_invoice_lines ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order);

    // ── ShipStation lookups ──────────────────────────────────────────────────
    const ssKey    = Deno.env.get("SHIPSTATION_API_KEY");
    const ssSecret = Deno.env.get("SHIPSTATION_API_SECRET");
    const ssAuth   = ssKey && ssSecret ? btoa(`${ssKey}:${ssSecret}`) : null;
    const cubicFactor = Number(invoice.carriers?.cubic_factor_kg_m3 ?? 250);

    const ssData = new Map<string, { cost: number | null; actual: number | null; cubic: number | null; chargeable: number | null; check: string | null }>();
    let lookups = 0;
    for (const line of lines) {
      if (!line.tracking_ref) continue;
      if (!ssAuth || lookups >= MAX_SHIPSTATION_LOOKUPS) {
        ssData.set(line.id, { cost: null, actual: null, cubic: null, chargeable: null, check: "unmatched" });
        continue;
      }
      lookups++;
      let found = null;
      try { found = await shipstationLookup(line.tracking_ref, ssAuth); } catch { /* network — treat as unmatched */ }
      if (!found || (found.cost == null && found.weightKg == null && found.cubicM3 == null)) {
        ssData.set(line.id, { cost: null, actual: null, cubic: null, chargeable: null, check: "unmatched" });
        continue;
      }
      const dead  = found.weightKg;
      const cubic = found.cubicM3;
      const cubicWeight = cubic != null ? cubic * cubicFactor : null;
      const chargeable  = Math.max(dead ?? 0, cubicWeight ?? 0) || null;
      // Weight verdict only when both sides of the comparison exist
      let check: string | null = null;
      if (line.weight_kg != null && chargeable != null) {
        // Tolerance: carriers round up to the next kg — allow ceil(chargeable) + 1kg or 5%
        const tolerance = Math.max(1, chargeable * 0.05);
        check = Number(line.weight_kg) > Math.ceil(chargeable) + tolerance ? "overbilled" : "ok";
      }
      ssData.set(line.id, {
        cost: found.cost,
        actual: dead != null ? Math.round(dead * 100) / 100 : null,
        cubic:  cubic != null ? Math.round(cubic * 10000) / 10000 : null,
        chargeable: chargeable != null ? Math.round(chargeable * 100) / 100 : null,
        check,
      });
    }

    // ── Expected-cost passes ─────────────────────────────────────────────────
    type Result = { id: string; expected_total: number | null; match_status: string; source: string | null };
    const results: Result[] = [];
    const levyLines: Record<string, unknown>[] = [];
    let freightExpectedSubtotal = 0;

    // Pass 1 — freight lines priced from ShipStation bookings
    for (const line of lines) {
      const isGst  = norm(line.description).includes("gst") || norm(line.service) === "gst";
      const isLevy = norm(line.service).includes("fuel") || norm(line.description).includes("fuel");
      if (isGst) {
        results.push({ id: line.id, expected_total: null, match_status: "skipped", source: null });
        continue;
      }
      if (isLevy) { levyLines.push(line); continue; }

      const ss = ssData.get(line.id);
      if (ss?.cost != null) {
        const expected = Math.round(ss.cost * 100) / 100;
        freightExpectedSubtotal += expected;
        results.push({ id: line.id, expected_total: expected, match_status: "matched", source: "shipstation" });
      } else {
        results.push({ id: line.id, expected_total: null, match_status: "no_rate", source: null });
      }
    }

    // Pass 2 — fuel levy lines from carriers.fuel_levy_pct × booked freight subtotal.
    // Note: ShipStation booked costs are typically levy-inclusive, so a separate
    // levy line priced on top errs in the carrier's favour (never a false-positive).
    for (const line of levyLines) {
      const pct = invoice.carriers?.fuel_levy_pct != null ? Number(invoice.carriers.fuel_levy_pct) : null;
      if (pct == null || freightExpectedSubtotal <= 0) {
        results.push({ id: line.id, expected_total: null, match_status: "no_rate", source: null });
        continue;
      }
      const expected = Math.round(freightExpectedSubtotal * pct) / 100;
      results.push({ id: line.id, expected_total: expected, match_status: "matched", source: "carrier_levy" });
    }

    // Write results back (baseline + weight evidence together)
    for (const r of results) {
      const wd = ssData.get(r.id);
      const { error } = await supabase
        .from("freight_invoice_lines")
        .update({
          expected_total:       r.expected_total,
          expected_source:      r.source,
          booked_cost:          wd?.cost ?? null,
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
      ss_booked:         results.filter(r => r.source === "shipstation").length,
      weights_checked:   [...ssData.values()].filter(w => w.check === "ok" || w.check === "overbilled").length,
      weights_unmatched: [...ssData.values()].filter(w => w.check === "unmatched").length,
      overbilled:        [...ssData.values()].filter(w => w.check === "overbilled").length,
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
