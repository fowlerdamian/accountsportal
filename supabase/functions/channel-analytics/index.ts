/**
 * channel-analytics — per-channel HubSpot deal aggregates for the Marketing
 * (and later Finance) Channel Analytics tab.
 *
 * Isolated to the new tab. Reuses the EXISTING HubSpot wiring:
 *   • HUBSPOT_ACCESS_TOKEN secret (same as sales-hubspot-sync)
 *   • the channel→dealtype convention from sales-hubspot-sync (CHANNEL_DEAL_TYPE)
 * It does NOT touch the lead/Postgres side — that stays on usePipelineMetrics.
 *
 * Classification is server-side single-source-of-truth: every deal is bucketed
 * by `dealtype` into a canonical channel or the surfaced "unassigned" bucket.
 *
 * Request:  POST { startDate?, endDate? }   (period bounds, ISO yyyy-mm-dd)
 * Response: { ok, generatedAt, range, stages[], buckets{channel|unassigned} }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const HS_BASE = "https://api.hubapi.com";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── canonical channel → HubSpot dealtype (mirrors sales-hubspot-sync) ─────────
type Channel = "trailbait" | "fleetcraft" | "aga";
type Bucket = Channel | "unassigned";

const CHANNEL_DEAL_TYPE: Record<Channel, string> = {
  trailbait: "Distributor",
  fleetcraft: "Fleet & Commercial",
  aga: "Bespoke Manufacturer",
};
const DEALTYPE_TO_CHANNEL = new Map<string, Channel>(
  (Object.entries(CHANNEL_DEAL_TYPE) as [Channel, string][]).map(([k, v]) => [v.toLowerCase(), k]),
);

function classify(dealType: string | null | undefined): Bucket {
  if (!dealType) return "unassigned";
  const t = dealType.toLowerCase().trim();
  if (DEALTYPE_TO_CHANNEL.has(t)) return DEALTYPE_TO_CHANNEL.get(t)!;
  for (const [needle, ch] of DEALTYPE_TO_CHANNEL) if (t.includes(needle)) return ch;
  return "unassigned";
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const dayOf = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);

function hsHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

interface HsDeal {
  id: string;
  properties: Record<string, string | null>;
}

// ── fetch ALL deals (paginated) with the properties we aggregate on ───────────
async function fetchAllDeals(token: string): Promise<HsDeal[]> {
  const out: HsDeal[] = [];
  let after: string | undefined;
  const properties = [
    "dealname", "dealtype", "dealstage", "pipeline", "amount",
    "closedate", "createdate", "hs_is_closed", "hs_is_closed_won",
  ];
  // Guard the loop so a huge portal can't run the function past its budget.
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: "POST",
      headers: hsHeaders(token),
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        filterGroups: [],          // all deals; we bucket client-side by dealtype
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
        properties,
        limit: 100,
        ...(after ? { after } : {}),
      }),
    });
    if (!res.ok) {
      if (page === 0) throw new Error(`HubSpot deals search ${res.status}: ${await res.text()}`);
      break; // partial page failure — return what we have
    }
    const data = await res.json();
    out.push(...((data.results ?? []) as HsDeal[]));
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

// ── stage metadata: stageId → readable label, in pipeline display order ───────
async function fetchStageLabels(token: string): Promise<Map<string, { label: string; order: number }>> {
  const map = new Map<string, { label: string; order: number }>();
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, {
      headers: hsHeaders(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return map;
    const data = await res.json();
    for (const pipe of data.results ?? []) {
      for (const stage of pipe.stages ?? []) {
        map.set(stage.id, { label: stage.label, order: num(stage.displayOrder) });
      }
    }
  } catch { /* labels are best-effort; fall back to raw ids */ }
  return map;
}

// ── per-bucket aggregator ─────────────────────────────────────────────────────
interface StageStat { stageId: string; label: string; count: number; value: number; order: number }
interface TopAccount { account: string; amount: number; stage: string; isOpen: boolean }

function emptyBucket() {
  return {
    deals: [] as { id: string; name: string; amount: number; stageId: string; isOpen: boolean; isWon: boolean; closeDay: string | null }[],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = Deno.env.get("HUBSPOT_ACCESS_TOKEN") ?? "";
  if (!token) return json({ ok: false, error: "HUBSPOT_ACCESS_TOKEN not configured" }, 500);

  let body: { startDate?: string; endDate?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const range = body.startDate && body.endDate
    ? { startDate: body.startDate, endDate: body.endDate }
    : null;
  const inPeriod = (iso: string | null) => {
    const d = dayOf(iso);
    if (!range) return true;
    if (!d) return false;
    return d >= range.startDate && d <= range.endDate;
  };

  let deals: HsDeal[];
  let stageLabels: Map<string, { label: string; order: number }>;
  try {
    [deals, stageLabels] = await Promise.all([fetchAllDeals(token), fetchStageLabels(token)]);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }

  // Bucket every deal by dealtype → channel | unassigned.
  const buckets: Record<Bucket, ReturnType<typeof emptyBucket>> = {
    trailbait: emptyBucket(), fleetcraft: emptyBucket(), aga: emptyBucket(), unassigned: emptyBucket(),
  };
  for (const d of deals) {
    const p = d.properties ?? {};
    const bucket = classify(p.dealtype);
    buckets[bucket].deals.push({
      id: d.id,
      name: (p.dealname ?? "").split(" - ")[0] || p.dealname || "Unnamed deal",
      amount: num(p.amount),
      stageId: p.dealstage ?? "",
      isOpen: p.hs_is_closed !== "true",
      isWon: p.hs_is_closed_won === "true",
      closeDay: dayOf(p.closedate),
    });
  }

  // Active-customers proxy: distinct companies among won deals (all-time), per
  // channel. One batch-read covers all won deals across channels.
  const wonByBucket: Record<Bucket, string[]> = { trailbait: [], fleetcraft: [], aga: [], unassigned: [] };
  for (const b of Object.keys(buckets) as Bucket[]) {
    wonByBucket[b] = buckets[b].deals.filter((d) => d.isWon).map((d) => d.id);
  }
  const allWonIds = ([] as string[]).concat(...Object.values(wonByBucket));
  const dealToCompanies = await dealCompanyMap(allWonIds, token);

  // collect the stage list actually in use (open deals), ordered.
  const stageSeen = new Map<string, { label: string; order: number }>();

  function summarise(bucket: Bucket) {
    const ds = buckets[bucket].deals;
    const open = ds.filter((d) => d.isOpen);
    const wonInPeriod = ds.filter((d) => d.isWon && inPeriod(d.closeDay));
    const lostInPeriod = ds.filter((d) => !d.isOpen && !d.isWon && inPeriod(d.closeDay));

    const byStageMap = new Map<string, StageStat>();
    for (const d of open) {
      const meta = stageLabels.get(d.stageId);
      const label = meta?.label ?? (d.stageId || "Unknown");
      const order = meta?.order ?? 99;
      stageSeen.set(d.stageId, { label, order });
      const cur = byStageMap.get(d.stageId) ?? { stageId: d.stageId, label, count: 0, value: 0, order };
      cur.count += 1;
      cur.value += d.amount;
      byStageMap.set(d.stageId, cur);
    }
    const byStage = [...byStageMap.values()].sort((a, b) => a.order - b.order);

    const topAccounts: TopAccount[] = [...ds]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((d) => ({
        account: d.name,
        amount: d.amount,
        stage: stageLabels.get(d.stageId)?.label ?? d.stageId,
        isOpen: d.isOpen,
      }));

    const companies = new Set<string>();
    for (const id of wonByBucket[bucket]) {
      for (const c of dealToCompanies.get(id) ?? []) companies.add(c);
    }

    const wonCount = wonInPeriod.length;
    const lostCount = lostInPeriod.length;
    const decided = wonCount + lostCount;

    return {
      openValue: open.reduce((s, d) => s + d.amount, 0),
      openCount: open.length,
      wonValue: wonInPeriod.reduce((s, d) => s + d.amount, 0),
      wonCount,
      lostCount,
      winRate: decided ? Math.round((wonCount / decided) * 100) : null,
      activeCustomers: companies.size,
      byStage,
      topAccounts,
      totalDeals: ds.length,
    };
  }

  const result = {
    trailbait: summarise("trailbait"),
    fleetcraft: summarise("fleetcraft"),
    aga: summarise("aga"),
    unassigned: summarise("unassigned"),
  };

  const stages = [...stageSeen.entries()]
    .map(([stageId, m]) => ({ stageId, label: m.label, order: m.order }))
    .sort((a, b) => a.order - b.order);

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    range,
    stages,
    buckets: result,
    totalDeals: deals.length,
  });
});

// Map each won deal id → its associated company ids (one batched pass).
async function dealCompanyMap(dealIds: string[], token: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const batch = dealIds.slice(i, i + 100);
    try {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/batch/read`, {
        method: "POST",
        headers: hsHeaders(token),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          properties: ["dealname"],
          associations: ["companies"],
          inputs: batch.map((id) => ({ id })),
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const d of data.results ?? []) {
        const ids = (d.associations?.companies?.results ?? []).map((a: any) => String(a.id));
        map.set(String(d.id), ids);
      }
    } catch { /* skip batch */ }
  }
  return map;
}
