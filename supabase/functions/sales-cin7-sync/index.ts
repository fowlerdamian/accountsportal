import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function cin7Headers(accountId: string, apiKey: string) {
  return {
    "api-auth-accountid":      accountId,
    "api-auth-applicationkey": apiKey,
    "Content-Type":            "application/json",
  };
}

// ─── Fetch all customers for a given tag ─────────────────────────────────────

async function fetchCustomersByTag(tag: string, accountId: string, apiKey: string): Promise<any[]> {
  const customers: any[] = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `${CIN7_BASE}/customer?Tags=${encodeURIComponent(tag)}&Limit=${limit}&Page=${page}`,
      { headers: cin7Headers(accountId, apiKey) }
    );
    if (!res.ok) break;

    const data = await res.json();
    const list = data?.CustomerList ?? [];
    customers.push(...list);

    if (list.length < limit) break;
    page++;
    await sleep(300);
  }

  return customers;
}

// ─── Fetch sales orders for a customer in last N days ────────────────────────

async function fetchOrdersForCustomer(
  customerId: string,
  daysBack: number,
  accountId: string,
  apiKey: string
): Promise<any[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split("T")[0];

  const res = await fetch(
    `${CIN7_BASE}/saleList?CustomerID=${customerId}&SaleDateFrom=${sinceStr}&Limit=200`,
    { headers: cin7Headers(accountId, apiKey) }
  );
  if (!res.ok) return [];

  const data = await res.json();
  return data?.SaleList ?? [];
}

// ─── Fetch line items for a single sale ──────────────────────────────────────

async function fetchSaleLines(saleId: string, accountId: string, apiKey: string): Promise<any[]> {
  const res = await fetch(
    `${CIN7_BASE}/sale?ID=${saleId}`,
    { headers: cin7Headers(accountId, apiKey) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  // DEAR returns SaleOrderLines on the order object
  const order = data?.SaleOrderList?.[0] ?? data?.Sale ?? data;
  return order?.SaleOrderLines ?? order?.Lines ?? [];
}

// ─── TrailBait: full order history analysis ───────────────────────────────────

async function syncTrailBaitCustomer(
  customer: any,
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  apiKey: string,
  recentlySyncedIds: Set<string>
): Promise<void> {
  const customerId = customer.ID ?? customer.CustomerID;
  if (!customerId) return;

  // Skip if synced in the last 6 hours — reduces API calls on re-runs
  if (recentlySyncedIds.has(String(customerId))) return;

  const orders90 = await fetchOrdersForCustomer(customerId, 90, accountId, apiKey);
  await sleep(150);

  const now      = new Date();
  const cutoff30 = new Date(now);
  cutoff30.setDate(now.getDate() - 30);

  // DEAR Systems saleList uses "SaleDate" as the date field
  const saleDate = (o: any): Date =>
    new Date(o.SaleDate ?? o.SaleOrderDate ?? o.OrderDate ?? o.CreatedDate ?? "");

  const orders30 = orders90.filter((o: any) => saleDate(o) >= cutoff30);

  // Last order date
  let lastOrderDate: Date | null = null;
  for (const o of orders90) {
    const d = saleDate(o);
    if (!isNaN(d.getTime()) && (!lastOrderDate || d > lastOrderDate)) lastOrderDate = d;
  }

  const daysSinceLast = lastOrderDate
    ? Math.floor((now.getTime() - lastOrderDate.getTime()) / 86400000)
    : 999;

  // Revenue last 90 days
  const totalRevenue90 = orders90.reduce((sum: number, o: any) => sum + (Number(o.Total) || 0), 0);
  const avgOrderValue  = orders90.length ? totalRevenue90 / orders90.length : 0;

  // Top products — fetch line items for the most recent 5 orders
  const productQty: Record<string, { name: string; qty: number; sku: string }> = {};
  const recentOrders = orders90
    .slice()
    .sort((a: any, b: any) => saleDate(b).getTime() - saleDate(a).getTime())
    .slice(0, 5);

  for (const o of recentOrders) {
    const saleId = o.SaleID ?? o.ID ?? o.SaleOrderID;
    if (!saleId) continue;
    await sleep(200);
    const lines = await fetchSaleLines(String(saleId), accountId, apiKey);
    for (const line of lines) {
      const sku  = line.ProductCode ?? line.SKU ?? line.Code ?? "";
      const name = line.ProductDescription ?? line.Name ?? line.ProductName ?? sku;
      const qty  = Number(line.Quantity) || 0;
      if (!sku) continue;
      if (!productQty[sku]) productQty[sku] = { name, qty: 0, sku };
      productQty[sku].qty += qty;
    }
  }

  const topProducts = Object.values(productQty)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Win-back: no order in 30+ days but had orders in last 90
  const isWinback = orders90.length > 0 && daysSinceLast > 30;

  // Find matching lead
  const companyName = customer.Name ?? "";
  const { data: matchedLeads } = await supabase
    .from("sales_leads")
    .select("id")
    .eq("channel", "trailbait")
    .ilike("company_name", `%${companyName.split(" ")[0]}%`)
    .limit(1);

  const leadId = matchedLeads?.[0]?.id ?? null;

  // Upsert order history
  await supabase.from("trailbait_order_history").upsert({
    cin7_customer_id:     customerId,
    lead_id:              leadId,
    last_order_date:      lastOrderDate?.toISOString() ?? null,
    order_count_30d:      orders30.length,
    order_count_90d:      orders90.length,
    total_revenue_90d:    totalRevenue90,
    average_order_value:  avgOrderValue,
    top_products:         topProducts,
    days_since_last_order: daysSinceLast,
    is_winback_candidate: isWinback,
    last_synced:          now.toISOString(),
  }, { onConflict: "cin7_customer_id" });

  // If we found a matching lead, update its existing customer flag
  if (leadId) {
    await supabase.from("sales_leads").update({
      cin7_customer_id:    customerId,
      cin7_customer_tag:   "D",
      is_existing_customer: true,
    }).eq("id", leadId);
  }
}

// ─── FleetCraft / AGA: existing customer check only ──────────────────────────

async function syncExistingCustomerCheck(
  customer: any,
  tag: "F" | "A",
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  const customerId  = customer.ID ?? customer.CustomerID;
  const companyName = customer.Name ?? "";
  if (!customerId || !companyName) return;

  const channel = tag === "F" ? "fleetcraft" : "aga";

  // Find matching lead by name
  const { data: leads } = await supabase
    .from("sales_leads")
    .select("id, company_name")
    .eq("channel", channel)
    .ilike("company_name", `%${companyName.split(" ")[0]}%`)
    .limit(3);

  for (const lead of leads ?? []) {
    await supabase.from("sales_leads").update({
      cin7_customer_id:    customerId,
      cin7_customer_tag:   tag,
      is_existing_customer: true,
    }).eq("id", lead.id);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase    = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const accountId   = Deno.env.get("CIN7_ACCOUNT_ID") ?? "";
  const apiKey      = Deno.env.get("CIN7_API_KEY") ?? "";

  if (!accountId || !apiKey) {
    return new Response(
      JSON.stringify({ error: "Cin7 credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create job records
  const channels: Array<"trailbait" | "fleetcraft" | "aga"> = ["trailbait", "fleetcraft", "aga"];
  const jobIds: Record<string, string> = {};

  for (const ch of channels) {
    const { data: job } = await supabase
      .from("research_jobs")
      .insert({ channel: ch, job_type: "cin7_sync", status: "running", started_at: new Date().toISOString() })
      .select("id").single();
    jobIds[ch] = job?.id;
  }

  const summary = { trailbait: 0, fleetcraft: 0, aga: 0 };

  try {
    // Load recently synced TrailBait customers (last 6 hours) to skip them
    const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: recentRows } = await supabase
      .from("trailbait_order_history")
      .select("cin7_customer_id")
      .gte("last_synced", sixHoursAgo);
    const recentlySyncedIds = new Set<string>((recentRows ?? []).map((r: any) => String(r.cin7_customer_id)));

    // ── TrailBait (tag D) ─────────────────────────────────────────────────────
    const trailbaitCustomers = await fetchCustomersByTag("D", accountId, apiKey);
    for (const c of trailbaitCustomers) {
      await sleep(200);
      try {
        await syncTrailBaitCustomer(c, supabase, accountId, apiKey, recentlySyncedIds);
        summary.trailbait++;
      } catch (err) {
        console.error("TrailBait sync error:", err);
      }
    }

    // ── FleetCraft (tag F) ────────────────────────────────────────────────────
    const fleetcraftCustomers = await fetchCustomersByTag("F", accountId, apiKey);
    for (const c of fleetcraftCustomers) {
      await sleep(100);
      try {
        await syncExistingCustomerCheck(c, "F", supabase);
        summary.fleetcraft++;
      } catch (err) {
        console.error("FleetCraft sync error:", err);
      }
    }

    // ── AGA (tag A) ───────────────────────────────────────────────────────────
    const agaCustomers = await fetchCustomersByTag("A", accountId, apiKey);
    for (const c of agaCustomers) {
      await sleep(100);
      try {
        await syncExistingCustomerCheck(c, "A", supabase);
        summary.aga++;
      } catch (err) {
        console.error("AGA sync error:", err);
      }
    }

    // Update job statuses
    await supabase.from("research_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", jobIds.trailbait);
    await supabase.from("research_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", jobIds.fleetcraft);
    await supabase.from("research_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", jobIds.aga);

    return new Response(
      JSON.stringify({ ok: true, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    for (const jobId of Object.values(jobIds)) {
      await supabase.from("research_jobs").update({ status: "failed", error_log: String(err), completed_at: new Date().toISOString() }).eq("id", jobId);
    }
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
