import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Trash2, Loader2 } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { supabase } from "@guide/integrations/supabase/client";
import { useAuth } from "@guide/contexts/AuthContext";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  useAiChatMessages,
  useClearAiChat,
  useContractors,
  useProjects,
  useOverdueTaskCount,
  type AiChatMessage,
} from "@guide/hooks/use-hub-queries";
import { ActionConfirmationCard, type ToolResult } from "./ActionConfirmationCard";
import { useQueryClient } from "@tanstack/react-query";

interface AiAssistantPanelProps {
  open:           boolean;
  onClose:        () => void;
  searchInputRef: React.RefObject<HTMLTextAreaElement>;
}

type ChatMessage = AiChatMessage & { pending?: boolean };

export function AiAssistantPanel({ open, onClose, searchInputRef }: AiAssistantPanelProps) {
  const { user }       = useAuth();
  const location       = useLocation();
  const qc             = useQueryClient();
  const [input, setInput]     = useState("");
  const [sending, setSending] = useState(false);
  const [initDone, setInitDone] = useState(false);
  // Local optimistic messages to show while DB refreshes
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const scrollRef      = useRef<HTMLDivElement>(null);
  const textareaRef    = searchInputRef;

  const { data: dbMessages = [] } = useAiChatMessages(user?.id);
  const { mutateAsync: clearChat } = useClearAiChat();
  const { data: contractors } = useContractors();
  const { data: projects }    = useProjects();
  const overdueCount          = useOverdueTaskCount();

  // Merge DB messages with any pending local-only messages
  const allMessages: ChatMessage[] = localMessages.length > 0 ? localMessages : dbMessages;

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages, sending]);

  // Focus textarea when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [open]);

  // Trigger __init__ on first open with empty chat
  useEffect(() => {
    if (!open || initDone || !user) return;
    if (dbMessages.length > 0) {
      setInitDone(true);
      return;
    }
    setInitDone(true);
    runInit();
  }, [open, dbMessages.length, user, initDone]);

  async function callEdgeFunction(body: Record<string, unknown>): Promise<{ text: string; tool_results: ToolResult[] }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hub-ai-assistant`,
      {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${session.access_token}`,
          apikey:          import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err.error ?? `HTTP ${resp.status}`);
    }

    return resp.json();
  }

  async function runInit() {
    setSending(true);
    try {
      await callEdgeFunction({ message: "__init__", conversation_history: [] });
      qc.invalidateQueries({ queryKey: ["hub_ai_chat", user?.id] });
    } catch {
      // Silent — init failure is non-critical
    } finally {
      setSending(false);
    }
  }

  function buildInitialContext() {
    return {
      contractors: contractors?.map((c) => ({
        id: c.id, name: c.name, role: c.role,
        status: c.status, source: c.source, hourly_rate: c.hourly_rate,
      })),
      projects: projects?.map((p) => ({
        id: p.id, name: p.name, status: p.status,
        type: p.type, budget_allocated: p.budget_allocated,
      })),
      overdue_count: overdueCount,
      current_page:  location.pathname,
    };
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !user) return;

    setInput("");
    setSending(true);

    const isFirst = allMessages.length === 0;

    // Build conversation history from existing messages
    const conversationHistory = allMessages.map((m) => ({
      role:    m.role,
      content: m.content,
    }));

    // Optimistic user bubble
    const optimisticUser: ChatMessage = {
      id:          `opt-user-${Date.now()}`,
      user_id:     user.id,
      role:        "user",
      content:     text,
      metadata:    null,
      created_at:  new Date().toISOString(),
      pending:     true,
    };
    setLocalMessages([...allMessages, optimisticUser]);

    try {
      const result = await callEdgeFunction({
        message:              text,
        conversation_history: conversationHistory,
        initial_context:      isFirst ? buildInitialContext() : undefined,
      });

      // Invalidate to pull both user + assistant messages from DB
      await qc.invalidateQueries({ queryKey: ["hub_ai_chat", user.id] });
      setLocalMessages([]);

      // Fire-and-forget notifications for tool write results
      result.tool_results?.forEach((tr) => {
        if (tr.tool === "update_task" || tr.tool === "create_task") {
          sendNotification({ type: "task_status", tr });
        }
      });
    } catch (err) {
      toast.error("AI assistant unavailable — try again in a moment.");
      setLocalMessages([]);
    } finally {
      setSending(false);
    }
  }

  async function sendNotification(payload: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contractor-hub-notifications`,
      {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${session.access_token}`,
          apikey:         import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(payload),
      },
    ).catch(() => {});
  }

  async function handleClear() {
    if (!user) return;
    await clearChat(user.id);
    setLocalMessages([]);
    setInitDone(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function renderMessage(msg: ChatMessage) {
    const isUser = msg.role === "user";

    // Parse tool_results from metadata if assistant message
    const toolResults: ToolResult[] = isUser
      ? []
      : ((msg.metadata as any)?.tool_results ?? []);

    return (
      <div
        key={msg.id}
        className={cn(
          "flex flex-col gap-1.5",
          isUser ? "items-end" : "items-start",
          msg.pending && "opacity-60",
        )}
      >
        <div
          className={cn(
            "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary/20 text-foreground rounded-br-sm"
              : "bg-muted/50 text-foreground rounded-bl-sm",
          )}
        >
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>

        {toolResults.length > 0 && (
          <div className="w-full max-w-[85%] flex flex-col gap-1.5">
            {toolResults
              .filter((tr) => tr.tool !== "query_data")
              .map((tr, i) => (
                <ActionConfirmationCard key={i} toolResult={tr} />
              ))}
          </div>
        )}

        <span className="text-[10px] text-muted-foreground px-1">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    );
  }

  return (
    <>
      {/* Slide-in panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[400px] z-40",
          "flex flex-col bg-background border-l shadow-2xl",
          "transition-transform duration-[250ms] ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">AI Assistant</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleClear}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Clear chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        >
          {allMessages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Ask anything about projects,<br />tasks, or contractors.
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                I can also take actions — create tasks,<br />log time, post notes, and more.
              </p>
            </div>
          )}

          {allMessages.map((msg) => renderMessage(msg))}

          {sending && (
            <div className="flex items-start gap-2">
              <div className="bg-muted/50 rounded-xl rounded-bl-sm px-3.5 py-2.5">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2 border-t shrink-0">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything, or tell me what to do..."
              rows={3}
              className={cn(
                "w-full resize-none rounded-lg border bg-muted/30 px-3 py-2.5 pr-10",
                "text-sm outline-none placeholder:text-muted-foreground/60",
                "focus:border-primary/50 focus:ring-1 focus:ring-primary/30",
                "transition-colors",
              )}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className={cn(
                "absolute bottom-2.5 right-2.5 p-1.5 rounded-md transition-colors",
                input.trim() && !sending
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground/40 cursor-not-allowed",
              )}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* Backdrop when panel open */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px]"
          onClick={onClose}
        />
      )}
    </>
  );
}

// ── Toggle button (mounted in HubLayout) ─────────────────────

interface AiToggleButtonProps {
  open:     boolean;
  onToggle: () => void;
}

export function AiToggleButton({ open, onToggle }: AiToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      title="AI Assistant [/]"
      className={cn(
        "fixed bottom-6 right-6 z-50",
        "flex items-center gap-2 rounded-full px-4 py-2.5 shadow-lg",
        "text-sm font-medium transition-all",
        open
          ? "bg-primary text-primary-foreground"
          : "bg-background border text-foreground hover:bg-muted",
      )}
    >
      <Sparkles className="w-4 h-4 shrink-0" />
      <span className="hidden sm:inline">Ask AI</span>
      <kbd className="hidden sm:inline-flex h-4 items-center rounded border px-1 text-[9px] font-mono opacity-60">
        /
      </kbd>
    </button>
  );
}
