import { useSupportQuestions } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { MessageCircle, AlertTriangle, CheckCircle, Clock, Loader2 } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@guide/components/ui/sheet";
import { Textarea } from "@guide/components/ui/textarea";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function Support() {
  const { data: questions = [], isLoading } = useSupportQuestions();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<any | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const filtered = questions.filter((q: any) => {
    if (filter === "escalated") return q.escalated;
    if (filter === "unresolved") return !q.resolved;
    return true;
  });

  const openCount = questions.filter((q: any) => !q.resolved).length;
  const escalatedCount = questions.filter((q: any) => q.escalated && !q.resolved).length;
  const resolvedToday = questions.filter((q: any) => {
    if (!q.resolved) return false;
    const today = new Date().toDateString();
    return new Date(q.created_at).toDateString() === today;
  }).length;

  const markResolved = async (id: string) => {
    const { error } = await supabase.from("support_questions").update({ resolved: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["support_questions"] });
    setSelected(null);
    toast.success("Marked resolved");
  };

  const sendReply = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    const { error } = await supabase.from("support_questions").update({
      answer: reply.trim(),
      resolved: true,
    }).eq("id", selected.id);
    setSending(false);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["support_questions"] });
    setReply("");
    setSelected(null);
    toast.success("Reply sent & marked resolved");
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Support Questions</h1>
        <p className="text-muted-foreground text-sm">Customer support questions from guide viewers</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Open Questions" value={openCount} icon={<MessageCircle className="w-5 h-5" />} />
        <StatsCard title="Escalated" value={escalatedCount} icon={<AlertTriangle className="w-5 h-5" />} />
        <StatsCard title="Resolved Today" value={resolvedToday} icon={<CheckCircle className="w-5 h-5" />} />
        <StatsCard title="Total" value={questions.length} icon={<Clock className="w-5 h-5" />} />
      </div>

      <div className="flex gap-3">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Questions</SelectItem>
            <SelectItem value="escalated">Escalated Only</SelectItem>
            <SelectItem value="unresolved">Unresolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Guide</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Step</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Brand</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Question</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Answered</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((q: any) => (
              <tr key={q.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => { setSelected(q); setReply(""); }}>
                <td className="p-3 text-sm font-medium max-w-48 truncate">{q.instruction_sets?.title ?? '—'}</td>
                <td className="p-3 text-center text-sm">{q.step_number || '—'}</td>
                <td className="p-3 text-center"><Badge variant="secondary" className="text-xs">{q.brands?.key === 'trailbait' ? 'TB' : 'AGA'}</Badge></td>
                <td className="p-3 text-sm text-muted-foreground max-w-64 truncate">{q.question}</td>
                <td className="p-3 text-center text-sm">{q.answer ? '✓' : '—'}</td>
                <td className="p-3 text-center">
                  {q.escalated && !q.resolved ? (
                    <Badge variant="destructive" className="text-xs">Escalated</Badge>
                  ) : q.resolved ? (
                    <Badge className="bg-success text-success-foreground text-xs">Resolved</Badge>
                  ) : (
                    <Badge className="bg-warning text-warning-foreground text-xs">Open</Badge>
                  )}
                </td>
                <td className="p-3 text-right text-sm text-muted-foreground">{new Date(q.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No support questions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader><SheetTitle>Support Conversation</SheetTitle></SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4">
              <div className="bg-muted rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">{selected.instruction_sets?.title}</p>
                <p>Step {selected.step_number || '—'} • {selected.brands?.name} • Session: {selected.session_id}</p>
              </div>

              <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-lg rounded-br-sm p-3 max-w-[80%] text-sm">{selected.question}</div>
                </div>
                {selected.answer && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg rounded-bl-sm p-3 max-w-[80%] text-sm">{selected.answer}</div>
                  </div>
                )}
              </div>

              {selected.escalated && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
                  ⚠️ Customer requested human support
                </div>
              )}

              <div className="pt-4 border-t space-y-3">
                <Textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  placeholder="Type a reply..."
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={sendReply} disabled={sending || !reply.trim()}>
                    {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Send Reply
                  </Button>
                  {!selected.resolved && (
                    <Button variant="outline" onClick={() => markResolved(selected.id)}>Mark Resolved</Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
