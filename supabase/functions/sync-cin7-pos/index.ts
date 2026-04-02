import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Cin7PO {
  ID: string;
  OrderNumber: string;
  SupplierName: string;
  Status: string;
  RequiredBy: string | null;
  TotalBeforeTax: number;
  BaseCurrency: string;
  Lines: unknown[];
}

interface Cin7Response {
  PurchaseOrderList: Cin7PO[];
  Total: number;
}

const STATUS_MAP: Record<string, string> = {
  Draft:      "Draft",
  Authorised: "Authorised",
  Ordered:    "Ordered",
  Receiving:  "Receiving",
  Received:   "Received",
  Cancelled:  "Cancelled",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  const cin7AccountId = Deno.env.get("CIN7_ACCOUNT_ID");
  const cin7ApiKey    = Deno.env.get("CIN7_API_KEY");

  if (!cin7AccountId || !cin7ApiKey) {
    return new Response(
      JSON.stringify({ error: "CIN7_ACCOUNT_ID and CIN7_API_KEY secrets are not set" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cin7Headers = {
    "api-AuthorizationToken": cin7ApiKey,
    "api-Integration-Id":     cin7AccountId,
    "Content-Type":           "application/json",
  };

  let page  = 1;
  const limit = 100;
  let total   = Infinity;
  let synced  = 0;
  const errors: string[] = [];

  while ((page - 1) * limit < total) {
    const url = `${CIN7_BASE}/purchaseorder?Limit=${limit}&Page=${page}&Status=Authorised,Ordered,Receiving`;
    const res = await fetch(url, { headers: cin7Headers });

    if (!res.ok) {
      const body = await res.text();
      return new Response(
        JSON.stringify({ error: `Cin7 API error ${res.status}`, detail: body }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const json: Cin7Response = await res.json();
    total = json.Total;

    const rows = json.PurchaseOrderList.map((po) => ({
      cin7_id:       po.ID,
      po_number:     po.OrderNumber,
      supplier_name: po.SupplierName,
      status:        STATUS_MAP[po.Status] ?? "Draft",
      due_date:      po.RequiredBy ? po.RequiredBy.substring(0, 10) : null,
      total_amount:  po.TotalBeforeTax ?? 0,
      currency:      po.BaseCurrency ?? "AUD",
      line_items:    po.Lines ?? [],
      synced_at:     new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("purchase_orders")
        .upsert(rows, { onConflict: "cin7_id" });

      if (error) errors.push(error.message);
      else synced += rows.length;
    }

    page++;
    if (json.PurchaseOrderList.length < limit) break;
  }

  return new Response(
    JSON.stringify({ synced, errors }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
