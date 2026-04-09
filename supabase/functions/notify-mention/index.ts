import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      caseNumber,
      caseTitle,
      message,
      authorName,
      taggedEmails,
      taggedNames,
    }: {
      caseNumber:    string;
      caseTitle?:    string;
      message:       string;
      authorName:    string;
      taggedEmails:  string[];
      taggedNames:   string[];
    } = await req.json();

    if (!taggedEmails?.length) {
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subject = `[${caseNumber}] You were mentioned by ${authorName}`;
    const title   = caseTitle ? `<b>${caseTitle}</b>` : `Case <b>${caseNumber}</b>`;

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#222">
        <h2 style="font-size:16px;margin-bottom:8px">You were mentioned in ${title}</h2>
        <p style="font-size:14px;color:#555;margin-bottom:16px">
          <b>${authorName}</b> mentioned you:
        </p>
        <blockquote style="border-left:3px solid #ddd;padding:8px 16px;color:#444;margin:0 0 20px">
          ${message.replace(/\n/g, "<br/>")}
        </blockquote>
        <p style="font-size:12px;color:#999">Case ${caseNumber}</p>
      </div>
    `;

    // Send to all tagged recipients
    await Promise.all(
      taggedEmails.map((email, i) =>
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from:    "Support <noreply@automotivegroup.com.au>",
            to:      [email],
            subject,
            html,
          }),
        })
      )
    );

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("notify-mention error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to send notification" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
