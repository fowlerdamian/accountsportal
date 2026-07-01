// logistics-match-invoice — the rate engine.
// Given an invoice, match each line against the carrier's ACTIVE rate card
// entries, compute the expected charge, write variance data back to the lines,
// and auto-flag the invoice when the total overcharge exceeds tolerance.
//
// Matching rules:
//   • service: case-insensitive exact match
//   • origin/destination: entry NULL = wildcard ("all lanes"); most specific wins
//   • per_kg   → base_charge + rate × weight_kg
//   • per_item → base_charge + rate × qty
//   • flat     → rate
//   • percent  → rate% × Σ expected of matched non-percent lines (fuel levy etc.)
//   • min_charge floors the result
//   • GST lines are excluded from matching (match_status = 'skipped')
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OVERCHARGE_TOLERANCE_AUD = 1.0;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

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

    // Find best entry for a line: service must match; lane specificity wins.
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
        // percent-type services (fuel levy) resolved in pass 2
        const pctEntry = findEntry(line, entries.filter(e => e.rate_type === "percent"));
        const looksLikeLevy = norm(line.service).includes("fuel") || norm(line.description).includes("fuel");
        if (pctEntry || looksLikeLevy) { percentLines.push(line); continue; }
        results.push({ id: line.id, expected_total: null, matched_entry_id: null, match_status: "no_rate" });
        continue;
      }
      const rate = Number(entry.rate);
      const base = Number(entry.base_charge ?? 0);
      let expected: number | null = null;
      if (entry.rate_type === "per_kg")   expected = line.weight_kg != null ? base + rate * Number(line.weight_kg) : null;
      if (entry.rate_type === "per_item") expected = line.qty       != null ? base + rate * Number(line.qty)       : null;
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

    // Write results back
    for (const r of results) {
      const { error } = await supabase
        .from("freight_invoice_lines")
        .update({ expected_total: r.expected_total, matched_entry_id: r.matched_entry_id, match_status: r.match_status })
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
    };

    // Only advance status from pending/matched/flagged — never clobber a dispute
    let status = invoice.status;
    if (["pending", "matched", "flagged"].includes(invoice.status)) {
      status = overcharge > OVERCHARGE_TOLERANCE_AUD ? "flagged" : "matched";
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
