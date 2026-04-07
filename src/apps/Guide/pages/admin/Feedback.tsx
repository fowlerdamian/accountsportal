import { useFeedback } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Star, MessageSquare, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function FeedbackPage() {
  const { data: feedbackItems = [], isLoading } = useFeedback();
  const [filter, setFilter] = useState("all");
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
    const { error } = await supabase.from("feedback").update({ resolved: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["feedback"] });
    toast.success("Marked resolved");
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
        <StatsCard title="Avg Rating" value={avgRating > 0 ? avgRating.toFixed(1) : '—'} icon={<Star className="w-5 h-5" />} />
        <StatsCard title="Total Feedback" value={feedbackItems.length} icon={<MessageSquare className="w-5 h-5" />} />
        <StatsCard title="Open Flags" value={flagCount} icon={<AlertTriangle className="w-5 h-5" />} />
        <StatsCard title="Resolved" value={feedbackItems.filter((f: any) => f.resolved).length} icon={<CheckCircle className="w-5 h-5" />} />
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

      <div className="bg-card rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Guide</th>
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
              <tr key={f.id} className="border-b hover:bg-muted/30">
                <td className="p-3 text-sm font-medium max-w-48 truncate">{f.instruction_sets?.title ?? '—'}</td>
                <td className="p-3 text-center"><Badge variant="secondary" className="text-xs">{f.brands?.key === 'trailbait' ? 'TB' : 'AGA'}</Badge></td>
                <td className="p-3 text-center">
                  {f.type === 'flag' ? (
                    <Badge variant="destructive" className="text-xs">Flag</Badge>
                  ) : f.type === 'comment' ? (
                    <Badge variant="secondary" className="text-xs">Comment</Badge>
                  ) : (
                    <Badge className="bg-primary text-primary-foreground text-xs">Rating</Badge>
                  )}
                </td>
                <td className="p-3 text-center">
                  {f.rating ? (
                    <span className="flex items-center justify-center gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < f.rating ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`} />
                      ))}
                    </span>
                  ) : '—'}
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
                    <Button variant="ghost" size="sm" onClick={() => markResolved(f.id)}>Mark Resolved</Button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No feedback yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
