// ─── Google Chat bot adapter ──────────────────────────────────────────────────
// Thin bridge between Google Chat and the portal's Ask AI assistant. All
// intelligence lives in supabase/functions/chat/index.ts — this function only:
//   1. verifies the request really comes from Google Chat,
//   2. loads the thread's recent history (gchat_messages),
//   3. forwards the question to the chat function (context: dashboard),
//   4. reformats the reply for Google Chat and stores both turns.
//
// Deployed with verify_jwt = false — Google can't send a Supabase JWT, so we
// authenticate by validating Google's bearer ID token instead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HISTORY_LIMIT = 12;
const CHAT_ISSUER = "chat@system.gserviceaccount.com";

interface ChatEvent {
  type: string;
  message?: {
    text?: string;
    argumentText?: string;
    thread?: { name?: string };
  };
  user?: { email?: string; displayName?: string };
  space?: { name?: string; type?: string };
}

// Google signs every request with an ID token issued to chat@system.
// tokeninfo validates signature + expiry server-side; we check the issuer
// email and, when GCHAT_PROJECT_NUMBER is set, the audience too.
async function isFromGoogleChat(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return false;
    const info = await res.json() as { email?: string; aud?: string };
    if (info.email !== CHAT_ISSUER) return false;
    const expectedAud = Deno.env.get("GCHAT_PROJECT_NUMBER");
    if (expectedAud && info.aud !== expectedAud) return false;
    return true;
  } catch (err) {
    console.error("[gchat-bot] token verification failed:", err);
    return false;
  }
}

// Google Chat uses its own markup: *bold*, _italic_, no headings, plain URLs.
function toGoogleChatMarkup(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")          // headings → bold lines
    .replace(/\*\*(.+?)\*\*/g, "*$1*")             // **bold** → *bold*
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2") // [t](url) → t: url
    .replace(/^[ \t]*[-*]\s+/gm, "• ")             // list markers → bullets
    .trim();
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!(await isFromGoogleChat(req))) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const event = await req.json() as ChatEvent;

    if (event.type === "ADDED_TO_SPACE") {
      return Response.json({
        text: "G'day! I'm the AGA portal assistant. Ask me about cases, tasks, leads, freight, POs or compliance — or say \"make a task for <person> re ...\" and I'll create it.",
      });
    }
    if (event.type !== "MESSAGE") {
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }

    const question = (event.message?.argumentText ?? event.message?.text ?? "").trim();
    if (!question) {
      return Response.json({ text: "Ask me a question — e.g. \"how many open cases?\"" });
    }

    const userEmail = event.user?.email ?? "Staff";
    const threadName = event.message?.thread?.name ?? event.space?.name ?? "unknown";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Prior turns in this thread, oldest-first, so follow-ups have context.
    const { data: history } = await sb.from("gchat_messages")
      .select("role, content")
      .eq("thread_name", threadName)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    const messages = [
      ...(history ?? []).reverse(),
      { role: "user", content: question },
    ];

    const chatRes = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ messages, context: "dashboard", userEmail }),
    });
    if (!chatRes.ok) {
      console.error("[gchat-bot] chat function error:", await chatRes.text());
      return Response.json({ text: "Sorry — the assistant hit an error. Try again in a moment." });
    }
    const { reply } = await chatRes.json() as { reply: string };

    // Persist both turns; failures here shouldn't block the reply.
    const { error: insertErr } = await sb.from("gchat_messages").insert([
      { thread_name: threadName, role: "user", content: question, user_email: userEmail },
      { thread_name: threadName, role: "assistant", content: reply, user_email: userEmail },
    ]);
    if (insertErr) console.warn("[gchat-bot] history insert failed:", insertErr.message);

    return Response.json({ text: toGoogleChatMarkup(reply) });
  } catch (err) {
    console.error("[gchat-bot] error:", err);
    return Response.json({ text: "Something went wrong. Please try again." });
  }
});
