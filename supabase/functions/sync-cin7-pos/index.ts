import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTIVE_STATUSES = ["DRAFT", "ORDERED", "INVOICED"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cin7AccountId = Deno.env.get("CIN7_ACCOUNT_ID");
    const cin7ApiKey    = Deno.env.get("CIN7_API_KEY");

    if (!cin7AccountId || !cin7ApiKey) {
      return new Response(
        JSON.stringify({ error: "CIN7_ACCOUNT_ID and CIN7_API_KEY secrets are not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const cin7Headers = {
      "api-auth-accountid":      cin7AccountId,
      "api-auth-applicationkey": cin7ApiKey,
      "Content-Type":            "application/json",
    };

    // Fetch existing due_dates so manual entries are not overwritten on sync
    const { data: existing } = await supabase
      .from("purchase_orders")
      .select("cin7_id, due_date");
    const existingDueDates: Record<string, string | null> = {};
    for (const row of existing ?? []) {
      existingDueDates[row.cin7_id] = row.due_date;
    }

    const limit = 100;
    let synced  = 0;
    const errors: string[] = [];

    // Fetch each active status separately so we never page through all POs
    const allActivePOs: any[] = [];
    for (const status of ACTIVE_STATUSES) {
      let statusPage = 1;
      let statusTotal = Infinity;
      while ((statusPage - 1) * limit < statusTotal) {
        const url = `${CIN7_BASE}/purchaseList?Limit=${limit}&Page=${statusPage}&Status=${status}`;
        const res = await fetch(url, { headers: cin7Headers });
        const rawText = await res.text();

        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: `Cin7 API error ${res.status}`, detail: rawText.substring(0, 500) }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        let json: any;
        try {
          json = JSON.parse(rawText);
        } catch {
          return new Response(
            JSON.stringify({ error: "Cin7 returned non-JSON", detail: rawText.substring(0, 200) }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        statusTotal = json.Total ?? 0;
        const list: any[] = json.PurchaseList ?? [];
        allActivePOs.push(...list);
        statusPage++;
        if (list.length < limit) break;
      }
    }

    if (allActivePOs.length > 0) {
      const rows = await Promise.all(allActivePOs.map(async (po) => {
        const hasAttachment = await checkAttachment(po.ID, cin7Headers);
        return {
          cin7_id:        po.ID,
          po_number:      po.OrderNumber,
          supplier_name:  po.Supplier ?? "Unknown",
          status:         toDbStatus(po.Status),
          order_date:     po.OrderDate ? po.OrderDate.substring(0, 10) : null,
          due_date:       po.ID in existingDueDates ? existingDueDates[po.ID] : null,
          total_amount:   po.InvoiceAmount ?? 0,
          currency:       po.BaseCurrency ?? "AUD",
          line_items:     [],
          has_attachment: hasAttachment,
          synced_at:      new Date().toISOString(),
        };
      }));

      const { error } = await supabase
        .from("purchase_orders")
        .upsert(rows, { onConflict: "cin7_id" });

      if (error) errors.push(error.message);
      else synced += rows.length;
    }

    return new Response(
      JSON.stringify({ synced, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function checkAttachment(poId: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(`${CIN7_BASE}/purchase?ID=${poId}`, { headers });
    if (!res.ok) return false;
    const json = await res.json();
    const attachments = json.Attachments ?? [];
    return Array.isArray(attachments) && attachments.length > 0;
  } catch {
    return false;
  }
}

function toDbStatus(s: string): string {
  const map: Record<string, string> = {
    DRAFT:      "Draft",
    AUTHORISED: "Authorised",
    ORDERED:    "Ordered",
    INVOICED:   "Invoiced",
    RECEIVING:  "Receiving",
    RECEIVED:   "Received",
    COMPLETED:  "Received",
    CANCELLED:  "Cancelled",
  };
  return map[s] ?? "Draft";
}
