// send-dispute-email v2 — operates on the disputes entity.
// Input: { dispute_id, letter_text }. Sends the letter to the carrier's claims
// email via Resend, marks the dispute 'sent', and logs a dispute_event.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { dispute_id, letter_text } = await req.json();
    if (!dispute_id || !letter_text) throw new Error("dispute_id and letter_text are required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: dispute, error: dispErr } = await supabase
      .from("disputes")
      .select("*, freight_invoices(*, carriers(*))")
      .eq("id", dispute_id)
      .single();
    if (dispErr || !dispute) throw new Error("Dispute not found");

    const invoice = dispute.freight_invoices;
    const claimsEmail = invoice?.carriers?.claims_email;
    if (!claimsEmail) throw new Error("Carrier has no claims email configured");

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "disputes@automotivegroup.com.au",
        to: claimsEmail,
        subject: `Freight Invoice Dispute — ${invoice.invoice_ref}`,
        text: letter_text,
      }),
    });
    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend API error: ${emailRes.status} ${errText}`);
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("disputes")
      .update({ status: "sent", sent_to: claimsEmail, sent_at: now, letter_text })
      .eq("id", dispute_id);
    if (updErr) throw updErr;

    await supabase.from("dispute_events").insert({
      dispute_id,
      event_type: "email_sent",
      detail: `Dispute letter emailed to ${claimsEmail}`,
      created_by: user.id,
    });

    // Keep the invoice status in sync
    await supabase.from("freight_invoices").update({ status: "disputed" }).eq("id", invoice.id);

    return new Response(JSON.stringify({ success: true, sent_to: claimsEmail }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
