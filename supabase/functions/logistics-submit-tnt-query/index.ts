// logistics-submit-tnt-query — lodges ONE invoice query with TNT via their
// public invoice-query form (https://www.tnt.com/express/en_au/site/support/invoice-query.html).
// TNT requires one submission per query (per con note), not per invoice.
// Server-side POST (the form has no CORS for browsers). On success the line is
// stamped query_submitted_at and a dispute event is logged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TNT_FORM_URL = "https://www.tnt.com/express/en_au/site/support/invoice-query.html";
const TEST_ECHO_URL = "https://httpbin.org/post"; // _test mode: verify encoding without contacting TNT

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
    const {
      name, company, phone, email, account_number,
      invoice_number, con_note, query_type, info,
      line_id, dispute_id, _test,
    } = await req.json();

    for (const [k, v] of Object.entries({ name, company, phone, email, account_number, invoice_number, query_type, info })) {
      if (!v || !String(v).trim()) throw new Error(`Missing required field: ${k}`);
    }

    const form = new URLSearchParams({
      ":formid": "InvoiceQuery",
      ":formstart": "/content/express/en_au/site/support/invoice-query/jcr:content/parFullWidth/pages",
      "_charset_": "UTF-8",
      LNAME: name,
      COMPANYNAME: company,
      PHONENUMBER: phone,
      Address: email,               // TNT's field name for the email address
      ACCOUNTNUMBER: account_number,
      INVOICENUMBER: invoice_number,
      SHIPMENTNUMBER: con_note ?? "",
      SUBJECT: query_type,
      ADDITIONALINFO: info,
    });

    const res = await fetch(_test ? TEST_ECHO_URL : TNT_FORM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": TNT_FORM_URL,
        "Origin": "https://www.tnt.com",
      },
      body: form.toString(),
      redirect: "follow",
    });

    if (res.status >= 400) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`TNT form returned ${res.status}: ${text}`);
    }

    if (_test) {
      const echoed = await res.json();
      return new Response(JSON.stringify({ ok: true, test: true, echoed: echoed.form }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record the submission
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    if (line_id) {
      await supabase.from("freight_invoice_lines").update({ query_submitted_at: new Date().toISOString() }).eq("id", line_id);
    }
    if (dispute_id) {
      await supabase.from("dispute_events").insert({
        dispute_id,
        event_type: "query_submitted",
        detail: `TNT invoice query lodged — ${query_type}${con_note ? ` — con note ${con_note}` : ""}`,
        created_by: user.id,
      });
    }

    return new Response(JSON.stringify({ ok: true, status: res.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
