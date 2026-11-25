// logistics-parse-invoice v2 — extract STRUCTURED line data for the audit
// engine (logistics-match-invoice).
// Speed: real carrier invoices are big (TNT weekly ≈ 5 pages / 110 charge
// lines ≈ 8k+ output tokens), so this uses Haiku (fast) with a 32k output
// budget, streamed so nothing times out or truncates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveModel } from "../_shared/model.ts";

// Haiku on purpose: 3-5x faster than Sonnet for structured extraction —
// resolved via the shared model helper (haiku tier).

// mode:"header" — fast first stage: only the invoice header fields, from the
// start of the document. Lets the upload window close in seconds while the
// full line extraction runs as a second background call.
const HEADER_PROMPT = `You are an expert at reading freight carrier invoices.
Extract ONLY the invoice header and return ONLY valid JSON — no markdown, no preamble:
{
  "invoice_ref": "string — invoice/reference number (Invoice No, Tax Invoice Number, Ref)",
  "carrier_name": "string — the company that ISSUED the invoice (not the recipient)",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null"
}
Return ONLY the raw JSON object.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert at parsing freight carrier invoices.
Extract the following and return ONLY valid JSON — no markdown, no preamble, no backticks:
{
  "invoice_ref": "string — invoice/reference number",
  "carrier_name": "string — carrier or company name that issued this invoice",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "totals": {
    "net_ex_gst": number or null — total charges of THIS invoice excluding GST (consignment note billing plus debits/adjustments). NEVER include balance brought forward, payments or total outstanding,
    "gst": number or null — GST of THIS invoice,
    "total_inc_gst": number or null — total of THIS invoice including GST
  },
  "lines": [
    [description, detail, tracking, service, origin, destination, weight_kg, qty, charged_total]
  ]
}
Each line is a JSON ARRAY of exactly 9 values in that fixed order (NOT an object):
  1 description — string, charge description as printed
  2 detail — string or null, shipment ref / zone / extra detail (keep it short)
  3 tracking — string or null, con note / consignment / tracking number for this shipment line
  4 service — string or null, normalised service name (e.g. "Road Express", "Overnight", "Fuel Levy", "GST")
  5 origin — string or null, origin city/zone code (e.g. "SYD")
  6 destination — string or null, destination city/zone code (e.g. "MEL")
  7 weight_kg — number or null
  8 qty — number or null
  9 charged_total — number
Example line: ["Road Express","ARMIDALE/J SMITH","UAR267481566","Road Express","ARM","BNE",7,1,22.89]
Output MINIFIED JSON: no indentation, no spaces after commas — large invoices have 150+ rows and must fit in the output.
Rules:
- invoice_ref: look for Invoice No, Invoice Number, Ref, Reference, Tax Invoice #
- carrier_name: the company that ISSUED the invoice (not the recipient)
- lines: one per distinct charge row — freight legs, fuel levy, surcharges, handling, GST. Skip payment/credit/balance rows (negative "Payment, Thank You" style entries) and "Credit Adjustment" rows (negative amounts credited against EARLIER invoices).
- Statement-only documents: when the document bills no charges of its own (Consignment Note Billing 0.00 / Total of this Invoice 0.00, only credit adjustments or payments listed), return "lines": [] with the totals as 0.
- charged_total: the line total EXCLUDING GST. When the invoice shows both GST-inclusive and GST-exclusive totals per line (TNT style), ALWAYS use the "Total excluding GST" figure (it already includes any per-line fuel/security surcharge). Never use the GST-inclusive figure.
- TNT / FedEx row layout (text is extracted in this order): "<S|R|T> <service code> <items> <cubic m3> <weight kg> <V|W> <Freight/Other Charges> <Warranty> <GST> <Total including GST> <sender/receiver> <origin/destination OR rating code> <consignment number> <date> <Fuel/Security Surcharge> <Total excluding GST>". charged_total is the LAST number of the row (Total excluding GST) — NOT the first dollar figure (Freight/Other Charges, which excludes the fuel surcharge). Example: "S 76 1 0.0183 7.000 W 17.95 0.00 2.29 25.18 ARMIDALE/J SMITH ARM/BNE/// UAR267481566 10/08/26 4.94 22.89" → charged_total 22.89, weight_kg 7, tracking "UAR267481566", service "Road Express".
- A row whose origin/destination slot holds a rating code instead (RSD, RSP, MHP, RED, RES, OS1…, FUT etc.) is a SURCHARGE row for that consignment: set description AND service to the surcharge's name from the invoice's code legend (e.g. MHP → "Manual Handling", RSD → "Residential Pickup / Delivery Fee", RED → "Redelivery / Futile Delivery"), never the freight service name, and set weight_kg to null.
- Debit/adjustment rows (e.g. "2.99 0.30 3.29 Consignment UAR736250317 RSD 75571204 15/08/26 2.99") are charge lines too: the LAST number is the amount excluding GST and the consignment number is the tracking.
- Fee rows without a consignment (e.g. "20.00 0.00 0.00 20.00 Late Payment Fee Inv: 75666114 LPF 75827819 22/09/26 0.00 20.00") are charge lines too: description and service "Late Payment Fee", detail "Inv: 75666114", tracking null, charged_total 20.00.
- Self-check before answering: the sum of every non-GST line's charged_total must equal totals.net_ex_gst. If it does not, you have used the wrong column or missed rows — fix the lines.
- service: normalise to the carrier's service name; use 'Fuel Levy' for standalone fuel surcharge lines, 'Manual Handling' for MHP / manual handling process fees, and 'GST' for tax lines
- origin/destination: use 3-letter city codes where identifiable (SYD, MEL, BNE, ADL, PER, HBA, DRW, CBR); otherwise the name as printed; null if not applicable (e.g. levy lines)
- tracking: the con note / consignment / article / tracking number tied to the shipment — critical for weight verification; null for levy/tax lines
- weight_kg: chargeable/billed weight if shown, else actual weight; null if none
- qty: item/consignment count if shown
- charged_total: numeric dollars, no $ or commas, always positive
- If a value cannot be found, use null
- Return ONLY the raw JSON object`;

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

  let body: { text?: string; mode?: string; strategy?: string };
  try { body = await req.json(); } catch { body = {}; }
  const { text, mode, strategy } = body;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  if (!text) return json({ error: "No text provided" }, 500);

  if (mode === "header") {
    try {
      const { parsed } = await askClaude(apiKey, HEADER_PROMPT, text.slice(0, 6000), { maxTokens: 1000, thinking: "off" });
      return json(parsed);
    } catch (err) {
      console.error("[logistics-parse-invoice] header:", (err as Error).message);
      return json({ error: (err as Error).message }, 500);
    }
  }

  // Full extraction can run past the platform's 150s time-to-first-byte limit,
  // so the response is streamed: whitespace keepalives, then the JSON document
  // (leading whitespace is valid JSON). Failures therefore arrive as
  // 200 + {"error": "..."} — callers must check `error` in the body.
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => { try { controller.enqueue(enc.encode(" ")); } catch { /* closed */ } }, 10_000);
      let out: unknown;
      try { out = await extractLines(apiKey, text, strategy); }
      catch (err) {
        console.error("[logistics-parse-invoice]", (err as Error).message);
        out = { error: (err as Error).message };
      }
      clearInterval(beat);
      controller.enqueue(enc.encode(JSON.stringify(out)));
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

// ─── Claude call ──────────────────────────────────────────────────────────────

type AskOpts = { maxTokens: number; thinking: "off" | "on"; effort?: string };

// Haiku 5.5 thinks by default and thinking tokens count toward max_tokens: on
// big invoices the hidden reasoning used the whole 32k budget (stop_reason
// max_tokens, no JSON → the old 500s). So thinking is always set explicitly.
async function askClaude(apiKey: string, system: string, userText: string, opts: AskOpts) {
  const model = await resolveModel(apiKey, "haiku");
  const call = (plain: boolean) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: plain ? Math.min(opts.maxTokens, 64000) : opts.maxTokens,
      stream: true,        // required for large max_tokens; also avoids idle timeouts
      ...(plain ? {} : opts.thinking === "off"
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "adaptive" }, ...(opts.effort ? { output_config: { effort: opts.effort } } : {}) }),
      system,
      messages: [{ role: "user", content: `Parse this freight invoice:\n\n${userText}` }],
    }),
  });

  let res = await call(false);
  if (res.status === 400) {
    // A model that rejects these thinking/effort settings — retry on its defaults
    const detail = await res.text();
    console.warn("[logistics-parse-invoice] 400 with thinking config, retrying plain:", detail.slice(0, 200));
    res = await call(true);
  }
  if (!res.ok) {
    const errText = await res.text();
    let errDetail = errText.substring(0, 300);
    try { errDetail = JSON.parse(errText)?.error?.message ?? errDetail; } catch { /* raw */ }
    throw new Error(`Claude API error: ${res.status} — ${errDetail}`);
  }

  // Accumulate the SSE stream into the full response text
  let responseText = "";
  let stopReason = "";
  let outTokens = 0;
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n");
    buf = events.pop() ?? "";
    for (const line of events) {
      if (!line.startsWith("data: ")) continue;
      let ev;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; } // keepalives/partials
      if (ev.type === "content_block_delta" && ev.delta?.text) responseText += ev.delta.text;
      if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage?.output_tokens) outTokens = ev.usage.output_tokens;
      }
      if (ev.type === "error") throw new Error(ev.error?.message ?? "stream error");
    }
  }
  if (stopReason === "max_tokens") {
    throw new Error("Invoice too large — extraction output was cut off before the last row");
  }
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude did not return valid JSON (stop: ${stopReason || "unknown"})`);
  try { return { parsed: JSON.parse(jsonMatch[0]), outTokens }; }
  catch (e) { throw new Error(`Extraction returned malformed JSON: ${(e as Error).message}`); }
}

// ─── Printed control totals ───────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

// TNT / FedEx statement header, read straight from the text (no model):
// "… Total Outstanding (Does not include …) $BBF $payments $consignment-billing
//  $debits/adjustments $GST $total-of-this-invoice $total-outstanding".
// Only trusted when billing + adjustments + GST = total of this invoice.
function printedTotals(text: string) {
  const m = text.match(/Total Outstanding \(Does not include[^)]*\)\s*((?:-?\$[\d,]+\.\d\d\s+){6}-?\$[\d,]+\.\d\d)/);
  if (!m) return null;
  const v = m[1].trim().split(/\s+/).map((s) => Number(s.replace(/[$,]/g, "")));
  const [, , billing, adjustments, gst, total] = v;
  if (v.some(Number.isNaN) || Math.abs(billing + adjustments + gst - total) > 0.05) return null;
  return { net_ex_gst: r2(billing + adjustments), gst, total_inc_gst: total };
}

// ─── Line extraction ──────────────────────────────────────────────────────────

type Line = { description: string; service: string | null; charged_total: number; [k: string]: unknown };
const isGstLine = (l: Line) =>
  (l.service ?? "").trim().toLowerCase() === "gst" || String(l.description ?? "").toLowerCase().includes("gst");

function cleanLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) throw new Error("No line items found in the document");
  // Rows arrive as compact positional arrays (keeps 150+ row invoices small
  // and fast); objects are still accepted.
  const KEYS = ["description", "detail", "tracking", "service", "origin", "destination", "weight_kg", "qty", "charged_total"];
  const blank = (v: unknown) => (v === "" || v === undefined ? null : v);
  return raw
    .map((l: unknown) => (Array.isArray(l) ? Object.fromEntries(KEYS.map((k, i) => [k, blank(l[i])])) : l) as Record<string, unknown>)
    // Defensive numeric coercion — drop unusable rows rather than fail the import
    .filter((l) => l && l.description && l.charged_total != null)
    .map((l) => ({
      ...l,
      charged_total: Number(l.charged_total),
      weight_kg: l.weight_kg != null ? Number(l.weight_kg) : null,
      qty: l.qty != null ? Number(l.qty) : null,
    } as Line))
    .filter((l) => !Number.isNaN(l.charged_total))
    // Statement rows are not charges of this invoice — importing them
    // corrupts the invoice total (seen: "Payment, Thank You" −$1,564.89).
    // ("Late Payment Fee" IS a charge — only drop payments received.)
    .filter((l) => !/thank you|^\s*payments?\b|payment received|balance brought forward|total outstanding/i.test(String(l.description)));
}

async function extractLines(apiKey: string, text: string, strategy?: string) {
  const printed = printedTotals(text);

  // Statement that bills nothing itself (credits / payments only): a valid
  // result, not a failure — the client records it as "no charges".
  if (printed && printed.net_ex_gst === 0 && printed.total_inc_gst === 0) {
    return { lines: [], totals: printed, no_charges: true, reconciled: true, passes: [] };
  }

  // Pass 1 is fast (no thinking). When the invoice prints a control total and
  // the rows don't add up to it, pass 2 re-extracts with thinking on, which is
  // slower but has been exact on real TNT invoices. Best result wins.
  const plan: AskOpts[] =
    strategy === "fast" ? [{ maxTokens: 64000, thinking: "off" }]
    : strategy === "think-low" ? [{ maxTokens: 100000, thinking: "on", effort: "low" }]
    : strategy === "think" ? [{ maxTokens: 100000, thinking: "on" }]
    : [{ maxTokens: 64000, thinking: "off" }, { maxTokens: 100000, thinking: "on" }];

  const passes: Record<string, unknown>[] = [];
  let best: { parsed: Record<string, unknown>; lines: Line[]; diff: number | null } | null = null;
  let lastErr: Error | null = null;
  for (const opts of plan) {
    const t0 = Date.now();
    try {
      const { parsed, outTokens } = await askClaude(apiKey, SYSTEM_PROMPT, text, opts);
      const lines = cleanLines(parsed.lines);
      const sum = r2(lines.filter((l) => !isGstLine(l)).reduce((s, l) => s + l.charged_total, 0));
      const diff = printed ? r2(sum - printed.net_ex_gst) : null;
      passes.push({ thinking: opts.thinking, effort: opts.effort ?? null, secs: Math.round((Date.now() - t0) / 1000), out_tokens: outTokens, lines: lines.length, sum, diff });
      if (!best || (diff != null && best.diff != null && Math.abs(diff) < Math.abs(best.diff)) || (best.lines.length === 0 && lines.length > 0)) {
        best = { parsed, lines, diff };
      }
      if (diff == null || Math.abs(diff) <= 0.05) break;   // reconciled, or nothing to check against
    } catch (err) {
      lastErr = err as Error;
      passes.push({ thinking: opts.thinking, effort: opts.effort ?? null, secs: Math.round((Date.now() - t0) / 1000), error: lastErr.message });
    }
  }
  console.log("[logistics-parse-invoice] passes:", JSON.stringify(passes));
  if (!best) throw lastErr ?? new Error("Extraction failed");

  // Control total: printed figures when the header could be read, else the model's
  const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const mt = (best.parsed.totals ?? {}) as Record<string, unknown>;
  const totals = printed ?? {
    net_ex_gst: num(mt.net_ex_gst), gst: num(mt.gst), total_inc_gst: num(mt.total_inc_gst),
  };
  if (totals.net_ex_gst == null && totals.total_inc_gst != null && totals.gst != null) {
    totals.net_ex_gst = r2(totals.total_inc_gst - totals.gst);
  }
  return {
    ...best.parsed,
    lines: best.lines,
    totals,
    no_charges: best.lines.length === 0,
    reconciled: best.diff == null ? null : Math.abs(best.diff) <= 0.05,
    passes,
  };
}
