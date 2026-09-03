// Guide → Support — rebuilt 2026-09-04.
//
// A customer question arrives from the viewer's "Need help?" sheet (with
// optional name/email/phone), staff get a Google Chat ping with a deep link
// (?q=<id>), and from here they can draft an answer with AI, email it back via
// the guide-support edge fn, and resolve the thread. Everything staff do runs
// through guide-support so the lifecycle timestamps stay consistent.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Mail, Phone, Sparkles, Send, Check, RotateCcw, ExternalLink, Search, Inbox } from "lucide-react";
import { toast } from "sonner";
import { useSupportQuestions } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Input } from "@guide/components/ui/input";
import { Textarea } from "@guide/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@guide/components/ui/sheet";
import { Switch } from "@guide/components/ui/switch";
import { Label } from "@guide/components/ui/label";
import { brandShort, cn } from "@guide/lib/utils";

type Question = {
  id: string; instruction_set_id: string; brand_id: string; session_id: string;
  question: string; answer: string | null; step_number: number | null; step_title: string | null;
  resolved: boolean; escalated: boolean; created_at: string;
  customer_name: string | null; customer_email: string | null; customer_phone: string | null;
  answered_at: string | null; reply_sent_at: string | null; resolved_at: string | null; ai_draft: string | null;
  instruction_sets?: { title: string } | null; brands?: { key: string; name: string } | null;
};
type Status = "open" | "answered" | "resolved";
const statusOf = (q: Question): Status => (q.resolved ? "resolved" : q.answer ? "answered" : "open");

async function callFn(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("guide-support", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmtHours = (h: number | null) => h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;

function StatusBadge({ q }: { q: Question }) {
  const s = statusOf(q);
  if (s === "resolved") return <Badge className="bg-success text-success-foreground text-xs">Resolved</Badge>;
  if (s === "answered") return <Badge variant="secondary" className="text-xs">Replied</Badge>;
  return <Badge className="bg-warning text-warning-foreground text-xs">Open</Badge>;
}

export default function Support() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useSupportQuestions();
  const questions = (data ?? []) as Question[];

  const [status, setStatus] = useState<"open" | "answered" | "resolved" | "all">("open");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("q"));
  const selected = questions.find((q) => q.id === selectedId) ?? null;

  // Deep link from the Google Chat ping: /guide/support?q=<id>
  useEffect(() => { const q = params.get("q"); if (q) setSelectedId(q); }, [params]);
  const close = () => { setSelectedId(null); if (params.has("q")) { params.delete("q"); setParams(params, { replace: true }); } };

  const stats = useMemo(() => {
    const now = Date.now(), d30 = now - 30 * 86_400_000;
    const open = questions.filter((q) => statusOf(q) === "open");
    const responseHours = questions.filter((q) => q.answered_at && new Date(q.created_at).getTime() >= d30)
      .map((q) => (new Date(q.answered_at!).getTime() - new Date(q.created_at).getTime()) / 3_600_000);
    return {
      open: open.length,
      noContact: open.filter((q) => !q.customer_email && !q.customer_phone).length,
      resolved30: questions.filter((q) => q.resolved_at && new Date(q.resolved_at).getTime() >= d30).length,
      medianResponse: median(responseHours),
      emailed: questions.filter((q) => q.reply_sent_at).length,
    };
  }, [questions]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (status !== "all" && statusOf(q) !== status) return false;
      if (!s) return true;
      return [q.question, q.answer, q.customer_name, q.customer_email, q.instruction_sets?.title, q.step_title].some((v) => (v ?? "").toLowerCase().includes(s));
    });
  }, [questions, status, search]);

  const rowKey = (q: Question) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(q.id); }
  };

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm space-y-2" role="alert">
        <div className="font-medium text-destructive">Couldn't load support questions</div>
        <div className="text-muted-foreground">{(error as any)?.message}</div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Support</h1>
        <p className="text-muted-foreground text-sm">Questions customers send from the "Need help?" button in a guide. Reply by email from here; every new question also pings the support Google Chat space.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatsCard title="Open" value={stats.open} subtitle={stats.noContact ? `${stats.noContact} left no contact details` : "All have contact details"} active={status === "open"} onClick={() => setStatus(status === "open" ? "all" : "open")} icon={<Inbox className="w-5 h-5" />} />
        <StatsCard title="Median first reply" value={fmtHours(stats.medianResponse)} subtitle="Last 30 days" icon={<Send className="w-5 h-5" />} />
        <StatsCard title="Resolved" value={stats.resolved30} subtitle="Last 30 days" active={status === "resolved"} onClick={() => setStatus(status === "resolved" ? "all" : "resolved")} icon={<Check className="w-5 h-5" />} />
        <StatsCard title="Replies emailed" value={stats.emailed} subtitle="All time" icon={<Mail className="w-5 h-5" />} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions, customers, guides…" className="pl-9" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-40" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="answered">Replied</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left font-semibold p-3">Question</th>
              <th className="text-left font-semibold p-3">Guide</th>
              <th className="text-left font-semibold p-3">Customer</th>
              <th className="text-center font-semibold p-3">Status</th>
              <th className="text-right font-semibold p-3">Asked</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((q) => (
              <tr key={q.id} tabIndex={0} role="button" aria-label={`Open question about ${q.instruction_sets?.title ?? "guide"}`}
                className={cn("border-b cursor-pointer focus-visible:outline-none focus-visible:bg-muted/40", q.id === selectedId ? "bg-primary/10" : "hover:bg-muted/30")}
                onClick={() => setSelectedId(q.id)} onKeyDown={rowKey(q)}>
                <td className="p-3 max-w-md">
                  <div className="line-clamp-2">{q.question}</div>
                  {q.step_number && <div className="text-[11px] text-muted-foreground mt-0.5">Step {q.step_number}{q.step_title ? ` — ${q.step_title}` : ""}</div>}
                </td>
                <td className="p-3 max-w-56">
                  <div className="truncate font-medium">{q.instruction_sets?.title ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground">{q.brands?.name ?? brandShort(q.brands)}</div>
                </td>
                <td className="p-3 max-w-48">
                  {q.customer_name || q.customer_email || q.customer_phone ? (
                    <>
                      <div className="truncate">{q.customer_name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{q.customer_email ?? q.customer_phone}</div>
                    </>
                  ) : <span className="text-muted-foreground text-xs">No contact left</span>}
                </td>
                <td className="p-3 text-center"><StatusBadge q={q} /></td>
                <td className="p-3 text-right text-muted-foreground whitespace-nowrap text-xs">{ago(q.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">
                {questions.length === 0 ? "No support questions yet. Customers can ask from the “Need help?” button in any published guide." : "Nothing matches this filter."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={!!selected} onOpenChange={(v) => { if (!v) close(); }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selected && <Conversation key={selected.id} q={selected} onChanged={() => qc.invalidateQueries({ queryKey: ["support_questions"] })} onOpenGuide={() => navigate(`/guide/guides/${selected.instruction_set_id}/edit`)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Conversation({ q, onChanged, onOpenGuide }: { q: Question; onChanged: () => void; onOpenGuide: () => void }) {
  const [reply, setReply] = useState(q.answer ?? q.ai_draft ?? "");
  const [resolveOnSend, setResolveOnSend] = useState(true);
  const [busy, setBusy] = useState<"draft" | "send" | "resolve" | null>(null);
  const [draftUsed, setDraftUsed] = useState(!q.answer && !!q.ai_draft);
  const hasEmail = !!q.customer_email?.trim();

  const run = async (key: typeof busy, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.message ?? String(e)); } finally { setBusy(null); }
  };

  const draft = () => run("draft", async () => {
    const r = await callFn({ action: "draft", id: q.id });
    setReply(r.draft); setDraftUsed(true);
    toast.message("Draft ready — read it before sending");
  });
  const send = () => run("send", async () => {
    const r = await callFn({ action: "reply", id: q.id, answer: reply.trim(), resolve: resolveOnSend });
    if (r.sent) toast.success(`Reply emailed to ${r.to}`);
    else if (r.send_error) toast.error(`Answer saved, but the email failed: ${r.send_error}`);
    else toast.success(hasEmail ? "Answer saved" : "Answer saved (no email on file — contact the customer another way)");
    onChanged();
  });
  const setResolved = (resolved: boolean) => run("resolve", async () => {
    await callFn({ action: "resolve", id: q.id, resolved });
    toast.success(resolved ? "Marked resolved" : "Reopened");
    onChanged();
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">Support question <StatusBadge q={q} /></SheetTitle>
        <SheetDescription>Asked {ago(q.created_at)} · {q.brands?.name ?? brandShort(q.brands)}</SheetDescription>
      </SheetHeader>

      <div className="mt-5 space-y-4">
        {/* Context */}
        <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm text-foreground truncate">{q.instruction_sets?.title ?? "Guide"}</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={onOpenGuide}>Open guide <ExternalLink className="w-3 h-3 ml-1" /></Button>
          </div>
          {q.step_number && <div className="text-muted-foreground">Customer was on <span className="text-foreground">Step {q.step_number}{q.step_title ? ` — ${q.step_title}` : ""}</span></div>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span className="text-foreground">{q.customer_name ?? "Name not given"}</span>
            {q.customer_email ? <a className="inline-flex items-center gap-1 hover:text-foreground underline underline-offset-2" href={`mailto:${q.customer_email}`}><Mail className="w-3 h-3" />{q.customer_email}</a> : <span>No email</span>}
            {q.customer_phone && <a className="inline-flex items-center gap-1 hover:text-foreground underline underline-offset-2" href={`tel:${q.customer_phone.replace(/\s+/g, "")}`}><Phone className="w-3 h-3" />{q.customer_phone}</a>}
          </div>
        </div>

        {/* Thread */}
        <div className="space-y-3">
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg rounded-bl-sm p-3 max-w-[85%] text-sm whitespace-pre-wrap">{q.question}</div>
          </div>
          {q.answer && (
            <div className="flex justify-end">
              <div className="max-w-[85%]">
                <div className="bg-primary text-primary-foreground rounded-lg rounded-br-sm p-3 text-sm whitespace-pre-wrap">{q.answer}</div>
                <div className="text-[11px] text-muted-foreground text-right mt-1">
                  {q.reply_sent_at ? `Emailed ${ago(q.reply_sent_at)}` : `Saved ${q.answered_at ? ago(q.answered_at) : ""} — not emailed`}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Compose */}
        <div className="pt-4 border-t space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm">{q.answer ? "Send another reply" : "Your reply"}</Label>
            <Button variant="outline" size="sm" className="h-8" onClick={draft} disabled={busy !== null}>
              {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span className="ml-1.5">Draft with AI</span>
            </Button>
          </div>
          <Textarea value={reply} onChange={(e) => { setReply(e.target.value); setDraftUsed(false); }} rows={7} placeholder="Write the answer the customer will receive…" />
          {draftUsed && <p className="text-[11px] text-[var(--brand-orange)]">Drafted from the guide's steps — check it before sending.</p>}
          <div className="flex items-center gap-2">
            <Switch id={`resolve-${q.id}`} checked={resolveOnSend} onCheckedChange={setResolveOnSend} />
            <Label htmlFor={`resolve-${q.id}`} className="text-xs text-muted-foreground">Mark resolved after sending</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {hasEmail
              ? <>The reply is emailed to <strong>{q.customer_email}</strong> from {q.brands?.name ?? "the brand"} Support, with the guide link and their question quoted.</>
              : <>The customer left no email, so this only saves the answer{q.customer_phone ? ` — call them on ${q.customer_phone}` : ""}.</>}
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={send} disabled={busy !== null || !reply.trim()}>
              {busy === "send" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : hasEmail ? <Send className="w-4 h-4 mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {hasEmail ? "Send reply" : "Save answer"}
            </Button>
            {q.resolved
              ? <Button variant="outline" onClick={() => setResolved(false)} disabled={busy !== null}><RotateCcw className="w-4 h-4 mr-1.5" /> Reopen</Button>
              : <Button variant="outline" onClick={() => setResolved(true)} disabled={busy !== null}>Resolve</Button>}
          </div>
        </div>
      </div>
    </>
  );
}
