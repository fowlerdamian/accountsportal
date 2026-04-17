import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Only check attachments for POs that are still active — saves API calls.
const ATTACHMENT_CHECK_STATUSES = new Set([
  "DRAFT", "AUTHORISED", "BACKORDER", "ORDERED", "INVOICED", "RECEIVING",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Diagnostic route — call with ?debug=1 to see raw Cin7 status values
  const url = new URL(req.url);
  if (url.searchParams.get("debug") === "1") {
    const cin7AccountId = Deno.env.get("CIN7_ACCOUNT_ID");
    const cin7ApiKey    = Deno.env.get("CIN7_API_KEY");
    const cin7Headers   = { "api-auth-accountid": cin7AccountId!, "api-auth-applicationkey": cin7ApiKey!, "Content-Type": "application/json" };
    const sixMonthsAgo = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const [r1, r2, r3] = await Promise.all([
      fetch(`${CIN7_BASE}/purchaseList?Limit=50&Page=1`, { headers: cin7Headers }).then(r => r.json()),
      fetch(`${CIN7_BASE}/purchaseList?Limit=10&Page=1&Status=DRAFT`, { headers: cin7Headers }).then(r => r.json()),
      fetch(`${CIN7_BASE}/purchaseList?Limit=10&Page=1&Status=DRAFT&CreatedSince=${sixMonthsAgo}`, { headers: cin7Headers }).then(r => r.json()),
    ]);
    const statuses = [...new Set((r1.PurchaseList ?? []).map((p: any) => p.Status))];
    return new Response(JSON.stringify({
      unfiltered_statuses: statuses,
      status_draft_count: (r2.PurchaseList ?? []).length,
      status_draft_with_date_count: (r3.PurchaseList ?? []).length,
      status_draft_sample: (r2.PurchaseList ?? []).slice(0, 2).map((p: any) => ({ ID: p.ID, OrderNumber: p.OrderNumber, Status: p.Status, OrderStatus: p.OrderStatus })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Load existing rows: preserve manually-set due dates and skip attachment
    // re-checks for POs already known to have an attachment (once attached, always attached).
    // Use a high limit — PostgREST defaults to 1000 rows which would silently truncate.
    const { data: existing } = await supabase
      .from("purchase_orders")
      .select("cin7_id, due_date, has_attachment, status")
      .limit(50000);

    const existingByKey: Record<string, { due_date: string | null; has_attachment: boolean; status: string }> = {};
    for (const row of existing ?? []) {
      existingByKey[row.cin7_id] = { due_date: row.due_date, has_attachment: row.has_attachment, status: row.status };
    }

    // Paginate through all pages of a Cin7 purchaseList query.
    async function fetchPages(params: string): Promise<any[]> {
      const results: any[] = [];
      let page = 1;
      while (true) {
        const url = `${CIN7_BASE}/purchaseList?Limit=100&Page=${page}${params}`;
        const res = await fetch(url, { headers: cin7Headers });
        const rawText = await res.text();
        if (!res.ok) throw new Error(`Cin7 ${res.status}: ${rawText.slice(0, 300)}`);
        const json = JSON.parse(rawText);
        const list: any[] = json.PurchaseList ?? [];
        results.push(...list);
        if (list.length < 100) break;
        page++;
      }
      return results;
    }

    // Two passes:
    // 1. Unfiltered with a 6-month window — gets all authorized/active history.
    //    Cin7 excludes Draft POs from unfiltered results by default.
    // 2. Explicit Status=DRAFT with the same 6-month window — catches POs not yet
    //    authorized. Using the same date window prevents fetching all historical drafts.
    const sixMonthsAgo = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];

    const [activePOs, draftPOs] = await Promise.all([
      fetchPages(`&CreatedSince=${sixMonthsAgo}`).catch(() => [] as any[]),
      fetchPages(`&Status=DRAFT&CreatedSince=${sixMonthsAgo}`).catch(() => [] as any[]),
    ]);

    // Merge and deduplicate by ID.
    const seen  = new Set<string>();
    const allPOs: any[] = [];
    for (const po of [...draftPOs, ...activePOs]) {
      const id = String(po.ID);
      if (!seen.has(id)) { seen.add(id); allPOs.push(po); }
    }

    const errors: string[] = [];
    let synced = 0;

    if (allPOs.length > 0) {
      const BATCH = 10;
      const rows: any[] = [];
      for (let i = 0; i < allPOs.length; i += BATCH) {
        const batch = allPOs.slice(i, i + BATCH);
        const batchRows = await Promise.all(batch.map(async (po) => {
          // Use the combined Status field — it reflects the full PO lifecycle
          // (Draft → Authorised → Ordered → Invoiced → Receiving → Received).
          // OrderStatus is only DRAFT or AUTHORISED and must NOT override Status.
          const effectiveStatus = po.Status ?? po.OrderStatus ?? "";
          const upperStatus     = effectiveStatus.toUpperCase();
          const poId            = String(po.ID);
          const existingRow     = existingByKey[poId];

          // Skip the Cin7 attachment API call if we already know this PO has one.
          // Once a PO has an attachment it stays — this avoids N+1 calls on every sync.
          const hasAttachment = existingRow?.has_attachment === true
            ? true
            : ATTACHMENT_CHECK_STATUSES.has(upperStatus)
              ? await checkAttachment(poId, cin7Headers)
              : false;

          return {
            cin7_id:        poId,
            po_number:      po.OrderNumber,
            supplier_name:  po.Supplier ?? "Unknown",
            status:         toDbStatus(effectiveStatus, errors),
            order_date:     po.OrderDate ? po.OrderDate.substring(0, 10) : null,
            due_date:       existingRow ? existingRow.due_date : null,
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

    // Remove DB rows for POs that no longer appear in Cin7 AND have a terminal status.
    // We only fetch the last 6 months of active POs, so we must not delete active POs
    // that are just older than the window — only remove Received/Cancelled ones that
    // have fallen out of Cin7's results (truly gone or archived).
    if (allPOs.length > 0) {
      const TERMINAL = new Set(["Received", "Cancelled"]);
      const allCin7Ids = new Set(allPOs.map((po) => String(po.ID)));
      const staleIds   = Object.keys(existingByKey).filter((id) => {
        if (allCin7Ids.has(id)) return false;
        return TERMINAL.has(existingByKey[id].status);
      });
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
    return Array.isArray(json.Attachments) && json.Attachments.length > 0;
  } catch {
    return false;
  }
}

function toDbStatus(s: string, errors: string[]): string {
  const map: Record<string, string> = {
    DRAFT:      "Draft",
    AUTHORISED: "Authorised",
    BACKORDER:  "Authorised",
    ORDERED:    "Ordered",
    INVOICED:   "Received",
    RECEIVING:  "Receiving",
    RECEIVED:   "Received",
    COMPLETED:  "Received",
    CANCELLED:  "Cancelled",
    VOIDED:     "Cancelled",
  };
  const mapped = map[(s ?? "").toUpperCase()];
  if (!mapped) errors.push(`unknown Cin7 status: "${s}" — stored as Draft`);
  return mapped ?? "Draft";
}
