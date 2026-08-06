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
