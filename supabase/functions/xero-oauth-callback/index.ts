import { createClient } from "npm:@supabase/supabase-js@2";

const PORTAL_URL = "https://app.automotivegroup.com.au";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.redirect(`${PORTAL_URL}/accounts/xero?xero_error=${encodeURIComponent(error)}`, 302);
  }

  if (!code) {
    return Response.redirect(`${PORTAL_URL}/accounts/xero?xero_error=missing_code`, 302);
  }

  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-oauth-callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[xero-oauth-callback] Token exchange failed:", err);
    return Response.redirect(`${PORTAL_URL}/accounts/xero?xero_error=${encodeURIComponent("Token exchange failed")}`, 302);
  }

  const tokens = await tokenRes.json();

  // Fetch connected tenant
  const connectionsRes = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  let tenantId: string | null = null;
  let tenantName: string | null = null;

  if (connectionsRes.ok) {
    const connections = await connectionsRes.json();
    if (connections.length > 0) {
      tenantId = connections[0].tenantId;
      tenantName = connections[0].tenantName;
    }
  }

  // Persist tokens via service_role client
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: upsertError } = await serviceClient
    .from("xero_tokens")
    .upsert({
      id: 1,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_at: expiresAt,
      scope: tokens.scope,
      tenant_id: tenantId,
      tenant_name: tenantName,
      updated_at: new Date().toISOString(),
    });

  if (upsertError) {
    console.error("[xero-oauth-callback] DB upsert failed:", upsertError);
    return Response.redirect(`${PORTAL_URL}/accounts/xero?xero_error=${encodeURIComponent("Failed to save tokens")}`, 302);
  }

  return Response.redirect(`${PORTAL_URL}/accounts/xero?xero_connected=1`, 302);
});
