// Shared staff-auth guard for edge functions.
//
// Accepts either:
//   • the service-role key as the bearer token (service/cron callers), or
//   • a valid Supabase user JWT (staff signed in to the portal).
// Anything else gets a 401 using the calling function's CORS headers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type RequireStaffResult =
  | { ok: true; userId?: string; email?: string }
  | { ok: false; response: Response };

function isServiceRoleJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role" && payload?.iss === "supabase";
  } catch { return false; }
}

async function postgrestAccepts(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/`, {
      method: "HEAD",
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    });
    return res.ok; // 401 on a bad/forged signature
  } catch { return false; }
}

/**
 * True when the auth user holds a staff role (user_roles admin/editor) — the same
 * predicate as public.is_staff(). requireStaff() only proves the JWT is valid;
 * functions that must be staff-only call this as a second step for user callers
 * (service-role callers have no userId and are trusted).
 */
export async function isStaffUser(userId: string | undefined): Promise<boolean> {
  if (!userId) return true; // service-role / cron caller
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data } = await admin.from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "editor"]).limit(1);
    return !!data?.length;
  } catch { return false; }
}

export const forbidden = (corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ error: "Forbidden — staff only" }), {
    status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export async function requireStaff(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<RequireStaffResult> {
  const unauthorized = (): RequireStaffResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorized();

  // Service-role key → trusted service/cron caller.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return { ok: true };

  // Legacy service-role JWT (what pg_cron jobs send). The runtime may inject the
  // new sb_secret_* key instead, so equality fails — validate the JWT's signature
  // by presenting it to PostgREST and trust it only if the role claim is service_role.
  if (isServiceRoleJwt(token) && (await postgrestAccepts(token))) return { ok: true };

  // Otherwise the token must be a valid user JWT.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return unauthorized();

  return { ok: true, userId: user.id, email: user.email ?? undefined };
}
