import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { email, full_name, role } = await req.json();

    if (!email) {
      return json({ error: "email is required" }, 400);
    }

    // Invite user via Supabase Auth
    const { data, error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name ?? "" },
    });
    if (authErr) return json({ error: authErr.message }, 400);

    // Upsert profile with role
    const { error: profileErr } = await supabase.from("profiles").upsert(
      { id: data.user.id, full_name: full_name ?? "", role: role ?? "user" },
      { onConflict: "id" }
    );
    if (profileErr) {
      console.warn("Profile upsert failed:", profileErr.message);
    }

    return json({ ok: true, message: `Invite sent to ${email}` });

  } catch (err) {
    console.error("invite-user error:", err);
    return json({ error: "Internal error" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
