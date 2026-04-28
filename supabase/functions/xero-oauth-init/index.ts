import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Must be authenticated portal user
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const clientId = Deno.env.get("XERO_CLIENT_ID");
  if (!clientId) {
    return new Response(JSON.stringify({ error: "XERO_CLIENT_ID not configured" }), { status: 500, headers: corsHeaders });
  }

  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-oauth-callback`;

  const scopes = [
    "offline_access",
    "accounting.invoices",
    "accounting.invoices.read",
    "accounting.contacts.read",
    "accounting.settings.read",
    "accounting.payments.read",
    "accounting.banktransactions.read",
    "accounting.manualjournals.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
    "accounting.reports.aged.read",
  ].join(" ");

  const state = crypto.randomUUID();

  const authUrl = new URL("https://login.xero.com/identity/connect/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);

  return new Response(JSON.stringify({ url: authUrl.toString(), state }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
