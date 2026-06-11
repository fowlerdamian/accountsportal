// ─── Google Chat bot adapter ──────────────────────────────────────────────────
// Thin bridge between Google Chat and the portal's Ask AI assistant. All
// intelligence lives in supabase/functions/chat/index.ts — this function only:
//   1. verifies the request really comes from Google Chat,
//   2. loads the thread's recent history (gchat_messages),
//   3. forwards the question to the chat function (context: dashboard),
//   4. reformats the reply for Google Chat and stores both turns.
//
// The Chat app is configured as a Workspace add-on (the Cloud Console default),
// so events arrive in add-on format: auth is an ID token for the project's
// add-ons service agent with audience = this function's URL, the payload nests
// under event.chat, and replies must use the hostAppDataAction envelope. The
// classic chat@system.gserviceaccount.com format is still accepted in case the
// app config is ever switched off add-on mode.
//
// Deployed with verify_jwt = false — Google can't send a Supabase JWT, so we
// authenticate by validating Google's bearer ID token instead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HISTORY_LIMIT = 12;
const CLASSIC_ISSUER = "chat@system.gserviceaccount.com";

const WELCOME =
  "G'day! I'm the AGA portal assistant. Ask me about cases, tasks, leads, freight, POs or compliance — or say \"make a task for <person> re ...\" and I'll create it.";

interface ChatMessage {
  text?: string;
  argumentText?: string;
  thread?: { name?: string };
}

// Google signs every request with an ID token. tokeninfo validates signature +
// expiry server-side; we pin the issuer identity to this app's project number.
async function isFromGoogleChat(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) {
      console.warn("[gchat-bot] tokeninfo rejected token:", res.status, await res.text());
      return false;
    }
    const info = await res.json() as { email?: string; aud?: string };
    const projectNumber = Deno.env.get("GCHAT_PROJECT_NUMBER");

    // Workspace add-on style: per-project service agent, aud = endpoint URL.
    const addonAgent = projectNumber
      ? `service-${projectNumber}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`
      : null;
    if (addonAgent && info.email === addonAgent) return true;
    if (!projectNumber && /^service-\d+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com$/.test(info.email ?? "")) {
      return true;
    }

    // Classic Chat app style: chat@system, aud = project number.
    if (info.email === CLASSIC_ISSUER) {
      return !projectNumber || info.aud === projectNumber;
    }

    console.warn("[gchat-bot] rejected issuer:", info.email, "aud:", info.aud);
    return false;
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

// Add-on events must be answered with a hostAppDataAction envelope; classic
// events take a bare { text } message.
function reply(text: string, isAddon: boolean): Response {
  if (!isAddon) return Response.json({ text });
  return Response.json({
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: { message: { text } },
      },
    },
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!(await isFromGoogleChat(req))) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const event = await req.json();

    // Normalise the two event formats into message/userEmail/isAddon.
    const isAddon = !!event.chat;
    let message: ChatMessage | undefined;
    let userEmail = "Staff";
    let spaceName: string | undefined;

    if (isAddon) {
      if (event.chat.addedToSpacePayload) return reply(WELCOME, true);
      message = event.chat.messagePayload?.message as ChatMessage | undefined;
      userEmail = event.chat.user?.email ?? userEmail;
      spaceName = event.chat.messagePayload?.space?.name;
      if (!message) {
        return new Response("{}", { headers: { "Content-Type": "application/json" } });
      }
    } else {
      if (event.type === "ADDED_TO_SPACE") return reply(WELCOME, false);
      if (event.type !== "MESSAGE") {
        return new Response("{}", { headers: { "Content-Type": "application/json" } });
      }
      message = event.message as ChatMessage | undefined;
      userEmail = event.user?.email ?? userEmail;
      spaceName = event.space?.name;
    }

    const question = (message?.argumentText ?? message?.text ?? "").trim();
    if (!question) {
      return reply('Ask me a question — e.g. "how many open cases?"', isAddon);
    }
    const threadName = message?.thread?.name ?? spaceName ?? "unknown";

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
      return reply("Sorry — the assistant hit an error. Try again in a moment.", isAddon);
    }
    const { reply: answer } = await chatRes.json() as { reply: string };

    // Persist both turns; failures here shouldn't block the reply.
    const { error: insertErr } = await sb.from("gchat_messages").insert([
      { thread_name: threadName, role: "user", content: question, user_email: userEmail },
      { thread_name: threadName, role: "assistant", content: answer, user_email: userEmail },
    ]);
    if (insertErr) console.warn("[gchat-bot] history insert failed:", insertErr.message);

    return reply(toGoogleChatMarkup(answer), isAddon);
  } catch (err) {
    console.error("[gchat-bot] error:", err);
    return Response.json({ text: "Something went wrong. Please try again." });
  }
});
