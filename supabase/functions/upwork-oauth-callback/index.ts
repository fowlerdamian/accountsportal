/**
 * upwork-oauth-callback
 *
 * Handles the OAuth 2.0 callback from Upwork after admin authorises the app.
 * Exchanges the auth code for access + refresh tokens and stores them.
 *
 * STUB — see upwork-sync-inbound for setup instructions.
 *
 * Setup flow:
 * 1. Register app at https://www.upwork.com/developer/keys/apply
 * 2. Set callback URL to: {SUPABASE_URL}/functions/v1/upwork-oauth-callback
 * 3. supabase secrets set UPWORK_CLIENT_ID=... UPWORK_CLIENT_SECRET=...
 * 4. Direct admin to the auth URL:
 *    https://www.upwork.com/ab/account-security/oauth2/authorize
 *      ?response_type=code
 *      &client_id={UPWORK_CLIENT_ID}
 *      &redirect_uri={SUPABASE_URL}/functions/v1/upwork-oauth-callback
 * 5. After callback, tokens are stored — sync functions become active.
 *
 * NOTE: Upwork tokens expire. The UPWORK_ACCESS_TOKEN secret must be updated
 * programmatically on refresh. Until Supabase exposes a secrets-write API,
 * store tokens in a secure DB table (e.g., encrypted column) instead of secrets,
 * and update upwork-sync-inbound to read from there.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const url    = new URL(req.url);
  const code   = url.searchParams.get("code");
  const error  = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response("Missing authorisation code", { status: 400 });
  }

  const clientId     = Deno.env.get("UPWORK_CLIENT_ID");
  const clientSecret = Deno.env.get("UPWORK_CLIENT_SECRET");
  const supabaseUrl  = Deno.env.get("SUPABASE_URL");

  if (!clientId || !clientSecret) {
    return new Response("UPWORK_CLIENT_ID / UPWORK_CLIENT_SECRET not set", { status: 500 });
  }

  try {
    // Exchange code for tokens
    const params = new URLSearchParams({
      grant_type:   "authorization_code",
      code,
      redirect_uri: `${supabaseUrl}/functions/v1/upwork-oauth-callback`,
      client_id:    clientId,
      client_secret: clientSecret,
    });

    const res = await fetch("https://www.upwork.com/api/v3/oauth2/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${errText}`);
    }

    const tokens = await res.json();

    // TODO: Store tokens securely.
    // Currently Supabase does not expose an API to update secrets programmatically.
    // Options:
    //   a) Store in a DB table with an encrypted column (pgcrypto)
    //   b) Store in Supabase Vault (KV)
    //   c) Manually set via: supabase secrets set UPWORK_ACCESS_TOKEN=... UPWORK_REFRESH_TOKEN=...
    //
    // For the stub, log to console so the admin can copy and set manually:
    console.log("=== UPWORK TOKENS ===");
    console.log("Access token:", tokens.access_token);
    console.log("Refresh token:", tokens.refresh_token);
    console.log("Expires in:", tokens.expires_in, "seconds");
    console.log("Run: supabase secrets set UPWORK_ACCESS_TOKEN=<above> UPWORK_REFRESH_TOKEN=<above>");

    return new Response(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2>Upwork Connected</h2>
        <p>OAuth tokens received. Check the Edge Function logs and run the supabase secrets set commands shown there.</p>
        <p>Once secrets are set, the sync functions will activate on the next cron run.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (err) {
    console.error("[upwork-oauth-callback]", err);
    return new Response(`Error: ${(err as Error).message}`, { status: 500 });
  }
});
