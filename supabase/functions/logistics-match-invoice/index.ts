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
// Above this many unique con notes, switch from per-tracking lookups to
// paged date-range fetches (ShipStation v1 is rate-limited to 40 req/min —
// a TNT weekly invoice has ~50+ con notes and would blow straight through it).
const RANGE_FETCH_THRESHOLD = 8;
const RANGE_DAYS_BACK = 75;
const MAX_RANGE_PAGES = 12;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Individual-lookup fallback cap for con notes the date-range fetch missed
// (kept under ShipStation's 40 req/min alongside the paged calls).
const STRAGGLER_LOOKUPS = 25;

type Line = Record<string, any>;
const lineText = (l: Line) => `${norm(l.service)} ${norm(l.description)}`;
const isGstLine  = (l: Line) => norm(l.description).includes("gst") || norm(l.service) === "gst";
const isLevyLine = (l: Line) => norm(l.service).includes("fuel") || norm(l.description).includes("fuel");
const isMhpLine  = (l: Line) => norm(l.service).includes("manual") || norm(l.service) === "mhp" ||
  norm(l.description).includes("manual handling") || norm(l.detail) === "mhp";
// Accessorial charges billed on a con note alongside (or after) the freight
// leg. These must never carry the ShipStation booked cost — that is the price
// of the freight itself.
const SURCHARGE_RE = /\bfee\b|surcharge|levy|redeliver|futile|residential|oversize|exceeds dimensions|non-conveyable|manual handling|tail[- ]?lift|storage|book-?in|adjustment|credit|payment|\b(rsd|rsp|mhp|red|fut|res|ret|os\d|rd\d|rp\d|td\d|tp\d)\b/i;
const isSurchargeLine = (l: Line) => isMhpLine(l) || SURCHARGE_RE.test(lineText(l));
const isFreightLine   = (l: Line) => !isGstLine(l) && !isLevyLine(l) && !isSurchargeLine(l);

class ShipStationError extends Error {}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// GET with one retry when rate-limited; throws on any other failure so an
// outage can never masquerade as "no overcharge found".
async function ssGet(url: string, auth: string): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (res.ok) return await res.json();
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get("X-Rate-Limit-Reset") ?? 20) || 20, 45);
      await sleep((wait + 1) * 1000);
      continue;
    }
    throw new ShipStationError(`ShipStation API error ${res.status}`);
  }
  throw new ShipStationError("ShipStation API error");
}

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

type ShipInfo = { cost: number | null; weightKg: number | null; cubicM3: number | null; dimsMm: number[] | null };

function shipmentToInfo(sh: Record<string, any>): ShipInfo {
  const cost = sh.shipmentCost != null && Number(sh.shipmentCost) > 0 ? Number(sh.shipmentCost) : null;
  const weightKg = sh.weight?.value != null ? toKg(Number(sh.weight.value), sh.weight.units) : null;
  let cubicM3: number | null = null;
  let dimsMm: number[] | null = null;
  const d = sh.dimensions;
  if (d?.length != null && d?.width != null && d?.height != null) {
    cubicM3 = toMetres(Number(d.length)) * toMetres(Number(d.width)) * toMetres(Number(d.height));
    // dims are cm (see toMetres note) — convert to mm, longest first
    dimsMm = [Number(d.length) * 10, Number(d.width) * 10, Number(d.height) * 10].sort((a, b) => b - a);
  }
  return { cost, weightKg, cubicM3, dimsMm };
}

// ── MHP (Manual Handling Process) fee verification ──────────────────────────
// TNT's published criteria: MHP applies to items NOT compatible with the
// sortation system. A package IS sortation-compatible when ALL hold:
//   length 200–1200mm, width 100–600mm, height 15–800mm,
//   diagonal ≤ 1200mm, weight 250g–30kg.
// If our ShipStation dims/weight show the package is compatible, the fee is
// unjustified and gets challenged (expected = $0).
function mhpSortationCompatible(dimsMm: number[] | null, weightKg: number | null): boolean | null {
  if (!dimsMm || dimsMm.length !== 3 || weightKg == null) return null; // can't judge
  const [l, w, h] = dimsMm; // sorted longest → shortest
  const diagonal = Math.sqrt(l * l + w * w + h * h);
  return (
    l >= 200 && l <= 1200 &&
    w >= 100 && w <= 600 &&
    h >= 15  && h <= 800 &&
    diagonal <= 1200 &&
    weightKg >= 0.25 && weightKg <= 30
  );
}

// Look up one shipment by tracking number
async function shipstationLookup(tracking: string, auth: string): Promise<ShipInfo | null> {
  const data = await ssGet(
    `https://ssapi.shipstation.com/shipments?trackingNumber=${encodeURIComponent(tracking)}&pageSize=1`,
    auth
  );
  const sh = data?.shipments?.[0];
  if (!sh) return null;
  // Guard: only trust an exact tracking-number match — never a "closest" result
  if ((sh.trackingNumber ?? "").trim().toLowerCase() !== tracking.trim().toLowerCase()) return null;
  return shipmentToInfo(sh);
}

// Fetch every shipment shipped in the window before the invoice date, in a
// handful of paged calls, and index by tracking number. Stops early once all
// wanted con notes are found.
async function shipstationRangeFetch(wanted: Set<string>, invoiceDate: string, auth: string): Promise<Map<string, ShipInfo>> {
  const found = new Map<string, ShipInfo>();
  const end = new Date(invoiceDate + "T00:00:00");
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - RANGE_DAYS_BACK);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  for (let page = 1; page <= MAX_RANGE_PAGES; page++) {
    const data = await ssGet(
      `https://ssapi.shipstation.com/shipments?shipDateStart=${fmt(start)}&shipDateEnd=${fmt(end)}&pageSize=500&page=${page}`,
      auth
    );
    for (const sh of data?.shipments ?? []) {
      const tn = (sh.trackingNumber ?? "").trim().toLowerCase();
      if (tn && wanted.has(tn) && !found.has(tn)) found.set(tn, shipmentToInfo(sh));
    }
    if (found.size >= wanted.size) break;
    if (!data?.pages || page >= data.pages) break;
  }
  return found;
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
    // An invoice with no lines has not been audited — never mark it processed.
    if (lines.length === 0) throw new Error("Invoice has no line items — drop the PDF again to re-extract them");

    // ── ShipStation lookups ──────────────────────────────────────────────────
    const ssKey    = Deno.env.get("SHIPSTATION_API_KEY");
    const ssSecret = Deno.env.get("SHIPSTATION_API_SECRET");
    const ssAuth   = ssKey && ssSecret ? btoa(`${ssKey}:${ssSecret}`) : null;
    const cubicFactor = Number(invoice.carriers?.cubic_factor_kg_m3 ?? 250);

    // One lookup per UNIQUE con note. Small invoices: individual lookups.
    // Big invoices (TNT weekly ≈ 50+ con notes): paged date-range fetch —
    // a few API calls instead of one per con note.
    const uniqueRefs = new Set<string>(
      lines.filter(l => l.tracking_ref).map(l => norm(l.tracking_ref))
    );
    const shipByRef = new Map<string, ShipInfo>();
    if (uniqueRefs.size > 0) {
      // No baseline at all is a failure, not a clean result — leave the
      // invoice unprocessed so it cannot show as "Processed" with $0 found.
      if (!ssAuth) throw new Error("ShipStation credentials are not configured — rate check not run");
      let lookupErrors = 0;
      const lookupEach = async (refs: string[]) => {
        for (const ref of refs) {
          try {
            const one = await shipstationLookup(ref, ssAuth);
            if (one) shipByRef.set(ref, one);
          } catch { lookupErrors++; }
        }
      };
      if (uniqueRefs.size > RANGE_FETCH_THRESHOLD) {
        const found = await shipstationRangeFetch(uniqueRefs, invoice.invoice_date, ssAuth);
        found.forEach((v, k) => shipByRef.set(k, v));
        // Individual fallback for stragglers outside the date window (capped)
        await lookupEach([...uniqueRefs].filter(r => !shipByRef.has(r)).slice(0, STRAGGLER_LOOKUPS));
      } else {
        await lookupEach([...uniqueRefs]);
      }
      if (lookupErrors > 0 && shipByRef.size === 0) {
        throw new Error("ShipStation is unavailable — rate check not run, try again shortly");
      }
    }

    // The booked cost covers the freight leg of the consignment, but carriers
    // bill it as a freight line plus surcharge lines on the same con note.
    // Assign the cost to the PRIMARY freight line per con note only — never to
    // MHP, redelivery, residential, oversize or other accessorial lines, even
    // when one of those is the largest charge on the con note.
    const primaryByRef = new Map<string, string>(); // ref → line.id
    for (const line of lines) {
      if (!line.tracking_ref || !isFreightLine(line)) continue;
      const ref = norm(line.tracking_ref);
      const current = primaryByRef.get(ref);
      if (!current || Number(line.charged_total) > Number(lines.find(l => l.id === current)!.charged_total)) {
        primaryByRef.set(ref, line.id);
      }
    }

    // ── Duplicate billing: the same con note's freight on another invoice ───
    const dupByRef = new Map<string, string>(); // ref → other invoice_ref
    {
      const rawRefs = [...new Set(lines.filter(l => l.tracking_ref && isFreightLine(l)).map(l => String(l.tracking_ref)))];
      for (let i = 0; i < rawRefs.length; i += 100) {
        const { data: others, error: dupErr } = await supabase
          .from("freight_invoice_lines")
          .select("tracking_ref, service, description, detail, freight_invoices(invoice_ref)")
          .in("tracking_ref", rawRefs.slice(i, i + 100))
          .neq("invoice_id", invoice_id);
        if (dupErr) throw dupErr;
        for (const o of others ?? []) {
          if (!isFreightLine(o)) continue;
          const otherRef = (o as any).freight_invoices?.invoice_ref;
          if (otherRef && !dupByRef.has(norm(o.tracking_ref))) dupByRef.set(norm(o.tracking_ref), otherRef);
        }
      }
    }

    const ssData = new Map<string, { cost: number | null; actual: number | null; cubic: number | null; chargeable: number | null; check: string | null }>();
    for (const line of lines) {
      if (!line.tracking_ref) continue;
      const ref = norm(line.tracking_ref);
      const found = shipByRef.get(ref);
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
        cost: primaryByRef.get(ref) === line.id ? found.cost : null,
        actual: dead != null ? Math.round(dead * 100) / 100 : null,
        cubic:  cubic != null ? Math.round(cubic * 10000) / 10000 : null,
        chargeable: chargeable != null ? Math.round(chargeable * 100) / 100 : null,
        check,
      });
    }

    // ── Expected-cost passes ─────────────────────────────────────────────────
    type Result = { id: string; expected_total: number | null; match_status: string; source: string | null; fee_check: string | null };
    const results: Result[] = [];
    const levyLines: Record<string, unknown>[] = [];
    let freightExpectedSubtotal = 0;

    // Pass 1 — freight lines priced from ShipStation bookings
    for (const line of lines) {
      const isGst  = isGstLine(line);
      const isLevy = isLevyLine(line);
      const isMhp  = isMhpLine(line);
      if (isGst) {
        results.push({ id: line.id, expected_total: null, match_status: "skipped", source: null, fee_check: null });
        continue;
      }
      if (isLevy) { levyLines.push(line); continue; }

      // MHP fee rule: challenge the fee when OUR package data shows the item
      // is sortation-compatible (fee does not meet TNT's published criteria).
      if (isMhp) {
        const ref = line.tracking_ref ? norm(line.tracking_ref) : null;
        const ship = ref ? shipByRef.get(ref) : null;
        const compatible = ship ? mhpSortationCompatible(ship.dimsMm, ship.weightKg) : null;
        if (compatible === true) {
          results.push({ id: line.id, expected_total: 0, match_status: "matched", source: "shipstation", fee_check: "mhp_unjustified" });
        } else if (compatible === false) {
          // Fee legitimately applies — accept the charged amount
          results.push({ id: line.id, expected_total: Number(line.charged_total), match_status: "matched", source: "shipstation", fee_check: "mhp_ok" });
        } else {
          results.push({ id: line.id, expected_total: null, match_status: "no_rate", source: null, fee_check: null });
        }
        continue;
      }

      const ss = ssData.get(line.id);
      if (ss?.cost != null) {
        const expected = Math.round(ss.cost * 100) / 100;
        freightExpectedSubtotal += expected;
        results.push({ id: line.id, expected_total: expected, match_status: "matched", source: "shipstation", fee_check: null });
      } else {
        results.push({ id: line.id, expected_total: null, match_status: "no_rate", source: null, fee_check: null });
      }
    }

    // Pass 2 — fuel levy lines from carriers.fuel_levy_pct × booked freight subtotal.
    // Note: ShipStation booked costs are typically levy-inclusive, so a separate
    // levy line priced on top errs in the carrier's favour (never a false-positive).
    for (const line of levyLines) {
      const pct = invoice.carriers?.fuel_levy_pct != null ? Number(invoice.carriers.fuel_levy_pct) : null;
      if (pct == null || freightExpectedSubtotal <= 0) {
        results.push({ id: line.id, expected_total: null, match_status: "no_rate", source: null, fee_check: null });
        continue;
      }
      const expected = Math.round(freightExpectedSubtotal * pct) / 100;
      results.push({ id: line.id, expected_total: expected, match_status: "matched", source: "carrier_levy", fee_check: null });
    }

    // Write results back (baseline + weight/fee evidence together)
    const byLineId = new Map(lines.map(l => [l.id, l]));
    for (const r of results) {
      const wd = ssData.get(r.id);
      const lineRef = byLineId.get(r.id)?.tracking_ref;
      const ship = lineRef ? shipByRef.get(norm(lineRef)) : null;
      const { error } = await supabase
        .from("freight_invoice_lines")
        .update({
          expected_total:       r.expected_total,
          expected_source:      r.source,
          booked_cost:          wd?.cost ?? null,
          match_status:         r.match_status,
          fee_check:            r.fee_check,
          actual_weight_kg:     wd?.actual ?? null,
          actual_cubic_m3:      wd?.cubic ?? null,
          actual_dims:          ship?.dimsMm ? ship.dimsMm.map(d => Math.round(d)).join("×") + "mm" : null,
          chargeable_weight_kg: wd?.chargeable ?? null,
          weight_check:         wd?.check ?? null,
          duplicate_invoice_ref: lineRef && isFreightLine(byLineId.get(r.id)!) ? (dupByRef.get(norm(lineRef)) ?? null) : null,
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
      mhp_challenged:    results.filter(r => r.fee_check === "mhp_unjustified").length,
      duplicates:        dupByRef.size,
    };

    // Only advance status from pending/matched/flagged — never clobber a
    // dispute. matched_at is always stamped so the UI shows the last check.
    let status = invoice.status;
    if (["pending", "matched", "flagged"].includes(invoice.status)) {
      status = (overcharge > OVERCHARGE_TOLERANCE_AUD || counts.overbilled > 0 || counts.duplicates > 0) ? "flagged" : "matched";
    }
    {
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
