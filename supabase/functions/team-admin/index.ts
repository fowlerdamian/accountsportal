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

    const body = await req.json();
    const { action } = body;

    // ── invite ────────────────────────────────────────────────────────────────
    if (action === "invite") {
      const { name, email, role } = body;
      if (!name || !email || !role) {
        return json({ error: "name, email and role are required" }, 400);
      }

      // Create/invite via Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: { full_name: name },
      });
      if (authErr) return json({ error: authErr.message }, 400);

      // Upsert team_members row
      const { error: tmErr } = await supabase.from("team_members").upsert(
        { id: authData.user.id, name, email, role, active: true },
        { onConflict: "email" }
      );
      if (tmErr) return json({ error: tmErr.message }, 500);

      return json({ ok: true, message: `Invite sent to ${email}` });
    }

    // ── resend_invite ─────────────────────────────────────────────────────────
    if (action === "resend_invite") {
      const { email } = body;
      if (!email) return json({ error: "email is required" }, 400);

      const { error } = await supabase.auth.admin.inviteUserByEmail(email);
      if (error) return json({ error: error.message }, 400);

      return json({ ok: true });
    }

    // ── deactivate ────────────────────────────────────────────────────────────
    if (action === "deactivate") {
      const { memberId } = body;
      if (!memberId) return json({ error: "memberId is required" }, 400);

      const { error } = await supabase
        .from("team_members")
        .update({ active: false })
        .eq("id", memberId);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    // ── reactivate ────────────────────────────────────────────────────────────
    if (action === "reactivate") {
      const { memberId, email } = body;
      if (!memberId) return json({ error: "memberId is required" }, 400);

      const { error } = await supabase
        .from("team_members")
        .update({ active: true })
        .eq("id", memberId);
      if (error) return json({ error: error.message }, 500);

      // Re-send invite so they can set a password if needed
      if (email) {
        await supabase.auth.admin.inviteUserByEmail(email).catch(() => {});
      }

      return json({ ok: true });
    }

    // ── change_role ───────────────────────────────────────────────────────────
    if (action === "change_role") {
      const { memberId, newRole } = body;
      if (!memberId || !newRole) return json({ error: "memberId and newRole are required" }, 400);

      const { error } = await supabase
        .from("team_members")
        .update({ role: newRole })
        .eq("id", memberId);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    console.error("team-admin error:", err);
    return json({ error: "Internal error" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
