/**
 * Cin7 — Diagnostic
 *
 * Tests each Cin7 API endpoint used by the alert functions and returns
 * sample data so you can verify field names and connectivity.
 *
 * Self-gates on chat_function_settings.enabled. Writes last-run telemetry.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CIN7_BASE       = "https://inventory.dearsystems.com/ExternalApi/v2";
const CIN7_ACCOUNT_ID = Deno.env.get("CIN7_ACCOUNT_ID") ?? "";
const CIN7_API_KEY    = Deno.env.get("CIN7_API_KEY") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SLUG            = "cin7-diagnostic";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function loadEnabled(): Promise<boolean> {
  const { data } = await sb
    .from("chat_function_settings")
    .select("enabled")
    .eq("slug", SLUG)
    .maybeSingle();
  return !!data?.enabled;
}

async function recordRun(status: string, summary: Record<string, unknown>) {
  await sb.rpc("record_chat_function_run", {
    p_slug: SLUG,
    p_status: status,
    p_summary: summary,
  });
}

async function cin7Fetch(endpoint: string, params: Record<string, string> = {}, attempt = 1): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const url = `${CIN7_BASE}/${endpoint}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    headers: {
      "api-auth-accountid":      CIN7_ACCOUNT_ID,
      "api-auth-applicationkey": CIN7_API_KEY,
      "Content-Type":            "application/json",
    },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 750 * attempt));
      return cin7Fetch(endpoint, params, attempt + 1);
    }
  }
  if (!res.ok) {
    const body = await res.text();
    return { error: `${res.status}: ${body.slice(0, 400)}` };
  }
  return res.json();
}

serve(async (req) => {
  const reqUrl = new URL(req.url);
  const enabled = await loadEnabled();
  if (!enabled) {
    return new Response(JSON.stringify({ status: "skipped", reason: "disabled" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!CIN7_ACCOUNT_ID || !CIN7_API_KEY) {
    await recordRun("error", { error: "credentials_missing" });
    return new Response(JSON.stringify({ error: "CIN7 credentials not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const results: Record<string, any> = {};

  // 1. Order counts by status
  const statusCounts: Record<string, number> = {};
  for (const status of ["DRAFT", "AUTHORISED", "PICKING", "PACKING", "SHIPPED", "INVOICED"]) {
    try {
      const data = await cin7Fetch("saleList", { Status: status, Page: "1", Limit: "1" });
      statusCounts[status] = data.Total ?? data.SaleList?.length ?? 0;
    } catch {
      statusCounts[status] = -1;
    }
  }
  results["1_order_counts_by_status"] = statusCounts;

  // 2. Sample DRAFT
  try {
    const data = await cin7Fetch("saleList", { Status: "DRAFT", Page: "1", Limit: "3" });
    results["2_sample_draft_orders"] = (data.SaleList ?? []).map((o: any) => ({
      OrderNumber: o.OrderNumber, Customer: o.Customer, CustomerID: o.CustomerID,
      Total: o.Total, Status: o.Status,
      OrderDate: o.OrderDate, LastModifiedOn: o.LastModifiedOn,
      _allFields: Object.keys(o),
    }));
  } catch (err) {
    results["2_sample_draft_orders"] = { error: String(err) };
  }

  // 3. Sample SHIPPED
  try {
    const data = await cin7Fetch("saleList", { Status: "SHIPPED", Page: "1", Limit: "3" });
    results["3_sample_shipped_orders"] = (data.SaleList ?? []).map((o: any) => ({
      OrderNumber: o.OrderNumber, Customer: o.Customer,
      Total: o.Total, Status: o.Status,
      OrderDate: o.OrderDate, LastModifiedOn: o.LastModifiedOn,
    }));
  } catch (err) {
    results["3_sample_shipped_orders"] = { error: String(err) };
  }

  // 4. Stock — productavailability endpoint
  try {
    const data = await cin7Fetch("ref/productavailability", { Page: "1", Limit: "100" });
    const items = data.ProductAvailabilityList ?? [];
    const allFieldNames = new Set<string>();
    for (const i of items) for (const k of Object.keys(i)) allFieldNames.add(k);
    const hasField = (name: string) => items.filter((i: any) => i[name] !== undefined && i[name] !== null).length;
    results["4a_productavailability"] = {
      totalReturned: items.length,
      _allFieldsAcrossPage: Array.from(allFieldNames),
      _candidateReorderFields: {
        ReorderLevel:         hasField("ReorderLevel"),
        MinimumBeforeReorder: hasField("MinimumBeforeReorder"),
        ReorderQuantity:      hasField("ReorderQuantity"),
        StockMin:             hasField("StockMin"),
      },
      sampleItem: items[0] ?? null,
    };
  } catch (err) {
    results["4a_productavailability"] = { error: String(err) };
  }

  // 4c. SKU multi-location probe: scan all pages, find rows for the SKU passed
  // in ?sku=XYZ (default BGLBDM.1) and report per-location + aggregate.
  try {
    const targetSku = reqUrl.searchParams.get("sku") ?? "BGLBDM.1";
    const rows: any[] = [];
    let p = 1;
    while (p <= 50) {
      const data = await cin7Fetch("ref/productavailability", { Page: String(p), Limit: "100" });
      const items = data.ProductAvailabilityList ?? [];
      for (const i of items) {
        const sku = String(i.SKU ?? i.ProductCode ?? "");
        if (sku === targetSku) rows.push(i);
      }
      if (items.length < 100) break;
      p++;
    }
    const totalAvailable = rows.reduce((s, r) => s + (r.Available ?? 0), 0);
    const totalOnHand    = rows.reduce((s, r) => s + (r.OnHand ?? 0), 0);
    results["4c_sku_locations"] = {
      sku: targetSku,
      rowCount: rows.length,
      totalAvailable,
      totalOnHand,
      rows: rows.map((r) => ({
        Location: r.Location, Bin: r.Bin, Batch: r.Batch,
        Available: r.Available, OnHand: r.OnHand, Allocated: r.Allocated, OnOrder: r.OnOrder, InTransit: r.InTransit,
      })),
    };
  } catch (err) {
    results["4c_sku_locations"] = { error: String(err) };
  }

  // 4b. Stock — product endpoint (where ReorderLevel actually lives, per Cin7 docs)
  try {
    const data = await cin7Fetch("product", { Page: "1", Limit: "5" });
    const items = data.ProductList ?? data.Products ?? [];
    const fieldNames = items.length > 0 ? Object.keys(items[0]) : [];
    results["4b_product"] = {
      totalReturned: items.length,
      _fieldNames: fieldNames,
      _candidateReorderFields: {
        ReorderLevel:         items.filter((i: any) => i.ReorderLevel !== undefined).length,
        MinimumBeforeReorder: items.filter((i: any) => i.MinimumBeforeReorder !== undefined).length,
        ReorderQuantity:      items.filter((i: any) => i.ReorderQuantity !== undefined).length,
      },
      sampleItem: items[0] ?? null,
    };
  } catch (err) {
    results["4b_product"] = { error: String(err) };
  }

  // 5. Customer tag
  try {
    const orderData = await cin7Fetch("saleList", { Page: "1", Limit: "1" });
    const sampleOrder = (orderData.SaleList ?? [])[0];
    if (sampleOrder?.CustomerID) {
      const custData = await cin7Fetch("customer", { ID: sampleOrder.CustomerID });
      const customer = custData.CustomerList?.[0] ?? custData;
      results["5_customer_tag_check"] = {
        customerName: customer.Name ?? customer.CustomerName ?? sampleOrder.Customer,
        Tags:     customer.Tags     ?? "(not found)",
        Tag:      customer.Tag      ?? "(not found)",
        Category: customer.Category ?? "(not found)",
        _allCustomerFields: Object.keys(customer),
      };
    } else {
      results["5_customer_tag_check"] = { note: "No orders found to test customer lookup" };
    }
  } catch (err) {
    results["5_customer_tag_check"] = { error: String(err) };
  }

  // 6. Margin
  try {
    const orderData = await cin7Fetch("saleList", { Page: "1", Limit: "1" });
    const sampleOrder = (orderData.SaleList ?? [])[0];
    if (sampleOrder) {
      const saleId = sampleOrder.SaleID ?? sampleOrder.ID;
      const saleData = await cin7Fetch("sale", { ID: saleId });
      const sale = saleData.SaleList?.[0] ?? saleData;
      const lines = sale.Lines ?? sale.Order?.Lines ?? [];

      let totalRev = 0;
      let totalCost = 0;
      for (const l of lines) {
        totalRev  += (l.Quantity ?? 0) * (l.Price ?? 0);
        totalCost += (l.Quantity ?? 0) * (l.AverageCost ?? l.Cost ?? 0);
      }

      results["6_margin_check"] = {
        orderNumber: sampleOrder.OrderNumber,
        orderTotal:  sampleOrder.Total,
        _saleTopLevelFields: Object.keys(sale),
        _lineFieldsAvailable: lines.length > 0 ? Object.keys(lines[0]) : [],
        sampleLines: lines.slice(0, 3).map((l: any) => ({
          ProductName: l.Name ?? l.ProductName,
          SKU: l.SKU ?? l.ProductCode,
          Quantity: l.Quantity, Price: l.Price,
          AverageCost: l.AverageCost ?? "(not found)",
          Cost:        l.Cost        ?? "(not found)",
          Total:       l.Total,
          _hasCostData: (l.AverageCost !== undefined || l.Cost !== undefined),
        })),
        calculatedMargin: totalRev > 0
          ? `${(((totalRev - totalCost) / totalRev) * 100).toFixed(1)}%`
          : "Cannot calculate — no revenue",
        totalRevenue: totalRev,
        totalCost:    totalCost,
      };
    }
  } catch (err) {
    results["6_margin_check"] = { error: String(err) };
  }

  await recordRun("ok", { ran_at: new Date().toISOString() });

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
