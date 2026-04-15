import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Statuses that warrant an attachment check (one extra API call per PO).
// Received/Cancelled/Voided are excluded — not worth the API cost.
const ATTACHMENT_CHECK_STATUSES = new Set([
  "DRAFT", "AUTHORISED", "BACKORDER", "ORDERED", "INVOICED", "RECEIVING",
]);

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

    // Fetch ALL purchase orders from Cin7 with no status filter.
    // This avoids guessing what Cin7 calls each status — the frontend filter
    // controls what's shown. Paginate until the API returns a partial page.
    const limit = 100;
    const allPOs: any[] = [];
    let page = 1;
    while (true) {
      const url = `${CIN7_BASE}/purchaseList?Limit=${limit}&Page=${page}`;
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

      const list: any[] = json.PurchaseList ?? [];
      allPOs.push(...list);
      if (list.length < limit) break;
      page++;
    }

    const errors: string[] = [];
    let synced = 0;

    if (allPOs.length > 0) {
      // Check attachments only for active/relevant POs to avoid unnecessary API calls
      const BATCH = 10;
      const rows: any[] = [];
      for (let i = 0; i < allPOs.length; i += BATCH) {
        const batch = allPOs.slice(i, i + BATCH);
        const batchRows = await Promise.all(batch.map(async (po) => {
          const upperStatus = (po.Status ?? "").toUpperCase();
          const checkAtt    = ATTACHMENT_CHECK_STATUSES.has(upperStatus);
          const hasAttachment = checkAtt ? await checkAttachment(po.ID, cin7Headers) : false;
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
        rows.push(...batchRows);
      }

      const { error } = await supabase
        .from("purchase_orders")
        .upsert(rows, { onConflict: "cin7_id" });

      if (error) errors.push(error.message);
      else synced += rows.length;
    }

    // Remove DB rows for POs that no longer exist in Cin7 at all (truly deleted).
    // Safe to do now that we fetched everything — anything missing is genuinely gone.
    if (allPOs.length > 0) {
      const allCin7Ids = new Set(allPOs.map((po) => String(po.ID)));
      const staleIds   = Object.keys(existingDueDates).filter((id) => !allCin7Ids.has(id));
      if (staleIds.length > 0) {
        const { error: delError } = await supabase
          .from("purchase_orders")
          .delete()
          .in("cin7_id", staleIds);
        if (delError) errors.push(`cleanup: ${delError.message}`);
      }
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
    BACKORDER:  "Authorised",   // Cin7 may use BACKORDER for authorised-not-yet-ordered
    ORDERED:    "Ordered",
    INVOICED:   "Invoiced",
    RECEIVING:  "Receiving",
    RECEIVED:   "Received",
    COMPLETED:  "Received",
    CANCELLED:  "Cancelled",
    VOIDED:     "Cancelled",    // Voided maps to Cancelled so it's excluded by frontend filter
  };
  // Unknown statuses → Cancelled so they never appear in the active filter
  return map[(s ?? "").toUpperCase()] ?? "Cancelled";
}
