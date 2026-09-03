import { useFeedback } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@guide/components/ui/sheet";
import { Star, Loader2, ExternalLink } from "lucide-react";
import { StarIcon, MessageCircleIcon, TriangleAlertIcon, CheckedIcon } from "@portal/components/icons";
import { useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { brandShort } from "@guide/lib/utils";

function TypeBadge({ type }: { type: string }) {
  if (type === 'flag') return <Badge variant="destructive" className="text-xs">Flag</Badge>;
  if (type === 'comment') return <Badge variant="secondary" className="text-xs">Comment</Badge>;
  return <Badge className="bg-primary text-primary-foreground text-xs">Rating</Badge>;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[...Array(5)].map((_, i) => (
        <Star key={i} className={`w-3 h-3 ${i < rating ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`} />
      ))}
    </span>
  );
}

export default function FeedbackPage() {
  const { data: feedbackItems = [], isLoading } = useFeedback();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<any | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const filtered = feedbackItems.filter((f: any) => {
    if (filter === "flags") return f.type === 'flag';
    if (filter === "unresolved") return !f.resolved;
    return true;
  });

  const ratedItems = feedbackItems.filter((f: any) => f.rating);
  const avgRating = ratedItems.length > 0 ? ratedItems.reduce((sum: number, f: any) => sum + f.rating, 0) / ratedItems.length : 0;
  const flagCount = feedbackItems.filter((f: any) => f.type === 'flag' && !f.resolved).length;

  const markResolved = async (id: string) => {
    setResolving(id);
    const { error } = await supabase.from("feedback").update({ resolved: true }).eq("id", id);
    setResolving(null);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["feedback"] });
    setSelected((s: any) => (s?.id === id ? { ...s, resolved: true } : s));
    toast.success("Marked resolved");
  };

  const openRow = (f: any) => setSelected(f);
  const rowKeyDown = (f: any) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(f); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Feedback</h1>
        <p className="text-muted-foreground text-sm">Customer ratings, comments, and step flags</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Avg Rating" value={avgRating > 0 ? avgRating.toFixed(1) : '—'} icon={<StarIcon className="w-5 h-5" />} />
        <StatsCard title="Total Feedback" value={feedbackItems.length} icon={<MessageCircleIcon className="w-5 h-5" />} />
        <StatsCard title="Open Flags" value={flagCount} icon={<TriangleAlertIcon className="w-5 h-5" />} />
        <StatsCard title="Resolved" value={feedbackItems.filter((f: any) => f.resolved).length} icon={<CheckedIcon className="w-5 h-5" />} />
      </div>

      <div className="flex gap-3">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Feedback</SelectItem>
            <SelectItem value="flags">Flags Only</SelectItem>
            <SelectItem value="unresolved">Unresolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Guide</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Step</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Brand</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Rating</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Comment</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f: any) => (
              <tr key={f.id}
                className="border-b hover:bg-muted/30 cursor-pointer focus-visible:outline-none focus-visible:bg-muted/40"
                tabIndex={0} role="button" aria-label={`Open feedback for ${f.instruction_sets?.title ?? 'guide'}`}
                onClick={() => openRow(f)} onKeyDown={rowKeyDown(f)}>
                <td className="p-3 text-sm font-medium max-w-48">
                  {f.instruction_set_id ? (
                    <Link to={`/guide/guides/${f.instruction_set_id}/edit`} className="hover:underline underline-offset-2 block truncate"
                      onClick={(e) => e.stopPropagation()} title={f.instruction_sets?.title ?? ''}>
                      {f.instruction_sets?.title ?? '—'}
                    </Link>
                  ) : (
                    <span className="block truncate">{f.instruction_sets?.title ?? '—'}</span>
                  )}
                </td>
                <td className="p-3 text-center text-sm">{f.flagged_step ?? '—'}</td>
                <td className="p-3 text-center"><Badge variant="secondary" className="text-xs" title={f.brands?.name}>{brandShort(f.brands)}</Badge></td>
                <td className="p-3 text-center"><TypeBadge type={f.type} /></td>
                <td className="p-3 text-center">
                  {f.rating ? <span className="flex justify-center"><Stars rating={f.rating} /></span> : '—'}
                </td>
                <td className="p-3 text-sm text-muted-foreground max-w-64 truncate">{f.comment || '—'}</td>
                <td className="p-3 text-center">
                  {f.resolved ? (
                    <Badge className="bg-success text-success-foreground text-xs">Resolved</Badge>
                  ) : (
                    <Badge className="bg-warning text-warning-foreground text-xs">Open</Badge>
                  )}
                </td>
                <td className="p-3 text-right">
                  {!f.resolved && (
                    <Button variant="ghost" size="sm" disabled={resolving === f.id}
                      onClick={(e) => { e.stopPropagation(); markResolved(f.id); }}>
                      {resolving === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Mark Resolved"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No feedback yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={!!selected} onOpenChange={(v) => { if (!v) setSelected(null); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Feedback</SheetTitle>
            <SheetDescription>Full comment and details</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4">
              <div className="bg-muted rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">
                  {selected.instruction_set_id ? (
                    <Link to={`/guide/guides/${selected.instruction_set_id}/edit`} className="inline-flex items-center gap-1 hover:underline underline-offset-2">
                      {selected.instruction_sets?.title ?? '—'} <ExternalLink className="w-3 h-3" />
                    </Link>
                  ) : (selected.instruction_sets?.title ?? '—')}
                </p>
                <p>
                  Step {selected.flagged_step ?? '—'} • {selected.brands?.name ?? '—'} • {new Date(selected.created_at).toLocaleString()}
                </p>
                <p className="break-all">Session: {selected.session_id}</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <TypeBadge type={selected.type} />
                {selected.rating ? <Stars rating={selected.rating} /> : null}
                {selected.resolved ? (
                  <Badge className="bg-success text-success-foreground text-xs">Resolved</Badge>
                ) : (
                  <Badge className="bg-warning text-warning-foreground text-xs">Open</Badge>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Comment</p>
                <p className="text-sm whitespace-pre-wrap break-words">{selected.comment || <span className="text-muted-foreground">No comment left.</span>}</p>
              </div>

              {!selected.resolved && (
                <div className="pt-4 border-t">
                  <Button onClick={() => markResolved(selected.id)} disabled={resolving === selected.id}>
                    {resolving === selected.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Mark Resolved
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
