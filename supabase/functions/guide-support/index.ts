// guide-support — the support loop behind the customer "Need help?" sheet.
//
//   { action: "submitted", id }                 — anonymous (called by the viewer right after
//                                                 inserting the question): ping Google Chat with a
//                                                 deep link. Only for rows < 10 min old, once.
//   { action: "draft", id }                     — staff: AI-draft an answer from the guide's steps
//   { action: "reply", id, answer, resolve? }   — staff: save the answer; email it to the customer
//                                                 via Resend when they left an address
//   { action: "resolve", id, resolved }         — staff: toggle resolved
//
// Deployed with verify_jwt = false so the viewer can call "submitted" with the
// publishable key; every staff action re-checks the JWT + staff role itself.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff, isStaffUser, forbidden } from "../_shared/auth.ts";
import { resolveModel } from "../_shared/model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PORTAL_URL = "https://app.automotivegroup.com.au";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

async function loadQuestion(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("support_questions")
    .select("*, instruction_sets(id,title,product_code,slug), brands(id,key,name,domain,support_email,support_phone,logo_url,primary_colour)")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  return data as any | null;
}

async function notifyChat(text: string) {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-google-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (e) {
    console.error("notify-google-chat failed:", e);
    return false;
  }
}

// ── Anonymous: question submitted ────────────────────────────────────────────
async function onSubmitted(db: SupabaseClient, id: string) {
  const q = await loadQuestion(db, id);
  if (!q) return json({ error: "not found" }, 404);
  if (q.notified_at) return json({ ok: true, already: true });
  if (Date.now() - new Date(q.created_at).getTime() > 10 * 60_000) return json({ error: "too old" }, 403);

  const guide = q.instruction_sets;
  const step = q.step_number ? ` · Step ${q.step_number}${q.step_title ? ` — ${q.step_title}` : ""}` : "";
  const who = [q.customer_name, q.customer_email, q.customer_phone].filter(Boolean).join(" · ") || "no contact details left";
  const text =
    `🙋 *${guide?.title ?? "Guide"}*${step} — Support question (${q.brands?.name ?? "brand?"})\n` +
    `"${truncate(String(q.question).trim(), 300)}"\n` +
    `${who}\n<${PORTAL_URL}/guide/support?q=${q.id}|Reply in portal>`;
  const ok = await notifyChat(text);
  await db.from("support_questions").update({ notified_at: new Date().toISOString() }).eq("id", id);
  return json({ ok, notified: ok });
}

// ── Staff: AI draft ──────────────────────────────────────────────────────────
async function draft(db: SupabaseClient, id: string) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  const q = await loadQuestion(db, id);
  if (!q) return json({ error: "not found" }, 404);
  const { data: steps } = await db.from("instruction_steps")
    .select("step_number,subtitle,description,is_divider,variant_id,order_index")
    .eq("instruction_set_id", q.instruction_set_id).is("variant_id", null).order("order_index");
  const real = (steps ?? []).filter((s: any) => !s.is_divider);
  const stepsText = real.map((s: any, i: number) => `Step ${i + 1}: ${s.subtitle}\n${String(s.description ?? "").trim()}`).join("\n\n").slice(0, 12_000);
  const brand = q.brands;
  const system =
    `You are the customer support team at ${brand?.name ?? "the brand"}, replying to a customer who is installing a product using our online installation guide. ` +
    `Write a friendly, practical reply in Australian English. Plain text only (no markdown, no headings). ` +
    `Answer from the guide content below; refer to steps by number. If the guide does not cover it, say so honestly and suggest calling ${brand?.support_phone ?? "our support line"}. ` +
    `Keep it under 170 words. Sign off as "${brand?.name ?? "Support"} Support". Do not invent torque values, part numbers or wiring colours that are not in the guide.`;
  const user =
    `Guide: ${q.instruction_sets?.title} (${q.instruction_sets?.product_code})\n` +
    (q.step_number ? `Customer was on step ${q.step_number}${q.step_title ? ` — ${q.step_title}` : ""}.\n` : "") +
    (q.customer_name ? `Customer name: ${q.customer_name}\n` : "") +
    `\nCustomer question:\n${q.question}\n\nGuide steps:\n${stepsText || "(no steps recorded)"}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: await resolveModel(apiKey, "sonnet"), max_tokens: 600, temperature: 0.3, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) {
    const t = await res.text();
    return json({ error: `Claude API error ${res.status}: ${t.slice(0, 200)}` }, 502);
  }
  const data = await res.json();
  const text = String(data.content?.[0]?.text ?? "").trim();
  if (!text) return json({ error: "empty draft" }, 502);
  await db.from("support_questions").update({ ai_draft: text }).eq("id", id);
  return json({ draft: text });
}

// ── Staff: reply (save + email) ──────────────────────────────────────────────
function renderReply(opts: { brand: any; guide: any; q: any; answer: string }) {
  const { brand, guide, q, answer } = opts;
  const colour = brand?.primary_colour || "#F59E0B";
  const guideUrl = brand?.domain && guide?.slug ? `https://${brand.domain}/${guide.slug}` : null;
  const first = String(q.customer_name ?? "").trim().split(" ")[0] || "there";
  const paragraphs = answer.split(/\n{2,}/).map((p) => `<p style="font-size:15px;line-height:1.55;color:#374151;margin:0 0 14px;">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const logo = brand?.logo_url ? `<img src="${brand.logo_url}" alt="${esc(brand.name)}" style="max-height:44px;max-width:200px;">` : `<strong style="font-size:18px;">${esc(brand?.name ?? "Support")}</strong>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-top:5px solid ${colour};">${logo}</td></tr>
    <tr><td style="padding:0 28px 8px;">
      <h1 style="font-size:20px;margin:0 0 14px;color:#111827;">Hi ${esc(first)}, here's an answer to your question</h1>
      ${paragraphs}
      ${guideUrl ? `<a href="${guideUrl}" style="display:inline-block;background:${colour};color:#111;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px;font-size:14px;margin:4px 0 18px;">Back to the guide →</a>` : ""}
      <div style="border-left:3px solid #e5e7eb;padding:8px 12px;margin:0 0 18px;font-size:13px;color:#6b7280;">
        <div style="font-weight:600;color:#374151;margin-bottom:4px;">Your question${q.step_number ? ` (Step ${q.step_number}${q.step_title ? ` — ${esc(q.step_title)}` : ""})` : ""}</div>
        ${esc(String(q.question)).replace(/\n/g, "<br>")}
      </div>
    </td></tr>
    <tr><td style="padding:12px 28px 28px;font-size:13px;color:#6b7280;line-height:1.5;">
      ${esc(guide?.title ?? "")}. Reply to this email if you need more help${brand?.support_phone ? ` or call <strong>${esc(brand.support_phone)}</strong>` : ""}.
    </td></tr>
  </table></td></tr></table></body></html>`;
  const text = `Hi ${first},\n\n${answer}\n\n${guideUrl ? `Guide: ${guideUrl}\n\n` : ""}Your question: ${q.question}\n\n${guide?.title ?? ""}. Reply to this email if you need more help${brand?.support_phone ? ` or call ${brand.support_phone}` : ""}.`;
  return { html, text };
}

async function reply(db: SupabaseClient, body: any, staffId?: string) {
  const id = String(body.id ?? "");
  const answer = String(body.answer ?? "").trim();
  const resolve = body.resolve !== false;
  if (!UUID.test(id)) return json({ error: "id required" }, 400);
  if (!answer) return json({ error: "answer required" }, 400);
  if (answer.length > 6000) return json({ error: "answer too long" }, 400);
  const q = await loadQuestion(db, id);
  if (!q) return json({ error: "not found" }, 404);

  const patch: Record<string, unknown> = { answer, answered_by: staffId ?? null, resolved: resolve };
  let sent = false, to: string | null = null, sendError: string | null = null;

  const email = String(q.customer_email ?? "").trim();
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) sendError = "RESEND_API_KEY not configured";
    else {
      const { data: settings } = await db.from("guide_delivery_settings").select("from_email").eq("id", 1).maybeSingle();
      const brand = q.brands, guide = q.instruction_sets;
      const fromDefault = "guides@updates.automotivegroup.com.au";
      // Keep the verified sending domain; put the brand name in the display part.
      const fromAddr = (settings?.from_email ?? "").match(/<([^>]+)>/)?.[1] ?? settings?.from_email ?? fromDefault;
      const from = `${brand?.name ?? "Guide"} Support <${fromAddr}>`;
      const msg = renderReply({ brand, guide, q, answer });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from, to: [email], reply_to: brand?.support_email || undefined,
          subject: `Re: your question about ${guide?.title ?? "your installation guide"}`,
          html: msg.html, text: msg.text,
          tags: [{ name: "type", value: "guide-support" }],
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { sent = true; to = email; patch.reply_sent_at = new Date().toISOString(); patch.reply_resend_id = out.id ?? null; }
      else sendError = `Resend ${res.status}: ${JSON.stringify(out).slice(0, 200)}`;
    }
  }

  const { error } = await db.from("support_questions").update(patch).eq("id", id);
  if (error) throw error;
  return json({ ok: true, sent, to, send_error: sendError, has_email: !!email });
}

// ── Router ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = admin();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const id = String(body.id ?? "");

    if (action === "submitted") {
      if (!UUID.test(id)) return json({ error: "id required" }, 400);
      return await onSubmitted(db, id);
    }

    const auth = await requireStaff(req, corsHeaders);
    if (!auth.ok) return auth.response;
    if (!(await isStaffUser(auth.userId))) return forbidden(corsHeaders);

    switch (action) {
      case "draft":
        if (!UUID.test(id)) return json({ error: "id required" }, 400);
        return await draft(db, id);
      case "reply":
        return await reply(db, body, auth.userId);
      case "resolve": {
        if (!UUID.test(id)) return json({ error: "id required" }, 400);
        const { error } = await db.from("support_questions").update({ resolved: body.resolved !== false }).eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("guide-support error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});
