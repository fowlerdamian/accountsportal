import { useNavigate } from "react-router-dom";
import { Plus, Search, Filter, Loader2, Trash2, QrCode, Link2 } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { BookIcon, MessageCircleIcon, FileDescriptionIcon, TriangleAlertIcon } from "@portal/components/icons";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Badge } from "@guide/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { useInstructionSets, useCategories, usePublications, useBrands, useAllGuideVehicles, useSupportQuestions, useFeedback } from "@guide/hooks/use-supabase-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@guide/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Checkbox } from "@guide/components/ui/checkbox";
import { Label } from "@guide/components/ui/label";
import { brandShort } from "@guide/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@guide/components/ui/alert-dialog";

function DeleteGuideDialog({ guide, onDelete }: { guide: any; onDelete: (id: string) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmed(false); }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete guide" aria-label={`Delete ${guide.title}`}><Trash2 className="w-4 h-4" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete guide?</AlertDialogTitle>
          <AlertDialogDescription>This will permanently delete "{guide.title}" and all its steps. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center space-x-2 py-2">
          <Checkbox id={`confirm-${guide.id}`} checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
          <Label htmlFor={`confirm-${guide.id}`} className="text-sm">I understand this action cannot be undone</Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!confirmed} onClick={() => { onDelete(guide.id); setOpen(false); }} className="bg-destructive text-destructive-foreground disabled:opacity-50">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CopiedTip({ children }: { children: React.ReactNode }) {
  return (
    <span role="status" className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-8 whitespace-nowrap rounded bg-foreground text-background text-[11px] px-2 py-1 shadow animate-fade-in">
      {children}
      <span className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-foreground" />
    </span>
  );
}

export default function GuidesList() {
  const navigate = useNavigate();
  const { data: guides = [], isLoading } = useInstructionSets();
  const { data: categories = [] } = useCategories();
  const { data: publications = [] } = usePublications();
  const { data: brands = [] } = useBrands();
  const { data: allVehicles = [] } = useAllGuideVehicles();
  const { data: supportQuestions = [] } = useSupportQuestions();
  const { data: feedbackItems = [] } = useFeedback();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");

  // Overview figures (formerly the separate Dashboard page)
  const isPublished = (g: any) => publications.some((p: any) => p.instruction_set_id === g.id && p.status === "published");
  const publishedCount = guides.filter(isPublished).length;
  const draftCount = guides.length - publishedCount;
  const openSupport = supportQuestions.filter((q: any) => !q.resolved).length;
  const openFeedback = feedbackItems.filter((f: any) => !f.resolved && f.type === "flag").length;

  const filtered = guides.filter((g: any) => {
    const matchSearch = g.title.toLowerCase().includes(search.toLowerCase()) || g.product_code.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "all" || g.category_id === categoryFilter;
    const matchStatus = statusFilter === "all" || (statusFilter === "published" ? isPublished(g) : !isPublished(g));
    return matchSearch && matchCat && matchStatus;
  });

  // Public link for a guide: the brand it's published on, else the first brand.
  const shareTarget = (guide: any) => {
    const pubBrand = brands.find(b => publications.some((p: any) => p.instruction_set_id === guide.id && p.brand_id === b.id && p.status === "published"));
    const brand = pubBrand ?? brands[0];
    const url = brand ? `https://${brand.domain}/${guide.slug}` : `${window.location.origin}/guide/view/${guide.slug}`;
    return { url, published: !!pubBrand };
  };
  const shareAction = (guide: any) => ({ label: "Share options", onClick: () => navigate(`/guide/guides/${guide.id}/share`) });

  // Brief "copied" tooltip over whichever button was pressed.
  const [copied, setCopied] = useState<{ id: string; kind: "link" | "qr" } | null>(null);
  const flashCopied = (id: string, kind: "link" | "qr") => {
    setCopied({ id, kind });
    window.setTimeout(() => setCopied((c) => (c?.id === id && c.kind === kind ? null : c)), 1800);
  };

  // Share: copy the public link to the clipboard. The toast offers the full
  // share page (QR / per-brand links).
  const shareGuide = async (guide: any) => {
    const { url, published } = shareTarget(guide);
    try {
      await navigator.clipboard.writeText(url);
      flashCopied(guide.id, "link");
      if (!published) toast.message("Link copied — guide is not published yet", { description: url, action: shareAction(guide) });
    } catch {
      toast.error("Couldn't copy link", { description: url, action: shareAction(guide) });
    }
  };

  // QR: render the code offscreen for the clicked guide, then copy it to the
  // clipboard as a PNG. The render is a single frame, so it stays inside the
  // browser's user-gesture window for clipboard writes.
  const [qrJob, setQrJob] = useState<{ guide: any; url: string; published: boolean } | null>(null);
  const qrHost = useRef<HTMLDivElement | null>(null);
  const copyQr = (guide: any) => setQrJob({ guide, ...shareTarget(guide) });
  useEffect(() => {
    if (!qrJob) return;
    const { guide, url, published } = qrJob;
    const canvas = qrHost.current?.querySelector("canvas");
    const fail = (why: string) => toast.error("Couldn't copy QR code", { description: why, action: shareAction(guide) });
    if (!canvas) { fail("QR code did not render"); setQrJob(null); return; }
    canvas.toBlob(async (blob) => {
      try {
        if (!blob) throw new Error("PNG encode failed");
        if (typeof ClipboardItem === "undefined") throw new Error("This browser can't copy images to the clipboard");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        flashCopied(guide.id, "qr");
        if (!published) toast.message("QR code copied — guide is not published yet", { description: url, action: shareAction(guide) });
      } catch (err: any) {
        fail(err?.message ?? String(err));
      } finally {
        setQrJob(null);
      }
    }, "image/png");
  }, [qrJob]);

  const deleteGuide = async (id: string) => {
    try {
      // Child rows (steps, publications, variants, vehicles, support
      // questions, feedback) cascade in the DB — a single parent delete is
      // atomic, so nothing is orphaned on a mid-way failure.
      const { error } = await supabase.from("instruction_sets").delete().eq("id", id);
      if (error) throw error;
      for (const key of ["instruction_sets", "publications", "support_questions", "feedback", "guide_vehicles_all"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success("Guide deleted");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Guides</h1>
          <p className="text-muted-foreground text-sm">{guides.length} guides · {publishedCount} published · {draftCount} drafts</p>
        </div>
        <Button onClick={() => navigate('/guide/guides/new')}>
          <Plus className="w-4 h-4 mr-2" />
          Create New Guide
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <button type="button" className="text-left" onClick={() => setStatusFilter("all")}>
          <StatsCard title="Total Guides" value={guides.length} icon={<BookIcon className="w-5 h-5" />} />
        </button>
        <button type="button" className="text-left" onClick={() => setStatusFilter(statusFilter === "published" ? "all" : "published")}>
          <StatsCard title="Published" value={publishedCount} icon={<FileDescriptionIcon className="w-5 h-5" />} subtitle={statusFilter === "published" ? "Filtering" : "Across all brands"} />
        </button>
        <button type="button" className="text-left" onClick={() => setStatusFilter(statusFilter === "draft" ? "all" : "draft")}>
          <StatsCard title="Drafts" value={draftCount} icon={<FileDescriptionIcon className="w-5 h-5" />} subtitle={statusFilter === "draft" ? "Filtering" : undefined} />
        </button>
        <button type="button" className="text-left" onClick={() => navigate("/guide/support")}>
          <StatsCard title="Open Support" value={openSupport} icon={<MessageCircleIcon className="w-5 h-5" />} />
        </button>
        <button type="button" className="text-left" onClick={() => navigate("/guide/feedback")}>
          <StatsCard title="Feedback Flags" value={openFeedback} icon={<TriangleAlertIcon className="w-5 h-5" />} />
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by title or product code..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        {filtered.map((guide: any) => {
          const guidePubs = publications.filter((p: any) => p.instruction_set_id === guide.id);
          const guideVehicles = allVehicles.filter(v => v.instruction_set_id === guide.id);

          return (
            <div key={guide.id} className="bg-card rounded-lg border px-4 py-2 hover:border-primary/30 transition-colors group">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-sm truncate">{guide.title}</h3>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">{guide.product_code}</code>
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">Updated {new Date(guide.updated_at).toLocaleDateString()}</span>
                  </div>
                   {guideVehicles.length > 0 && (
                     <div className="flex flex-wrap gap-1.5 mt-1">
                       {guideVehicles.map((v, i) => (
                         <Badge key={i} variant="secondary" className="text-xs font-normal gap-1">
                           🚗 {v.make} {v.model} {v.year_from}–{v.year_to === 0 || !v.year_to ? 'Current' : v.year_to}
                         </Badge>
                       ))}
                     </div>
                   )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className="flex gap-1.5">
                    {brands.map(b => {
                      const pub = guidePubs.find((p: any) => p.brand_id === b.id);
                      const short = brandShort(b);
                      if (pub?.status === 'published') return <Badge key={b.id} className="bg-success text-success-foreground text-xs" title={`${b.name}: published`}>{short} ✓</Badge>;
                      if (pub) return <Badge key={b.id} className="bg-warning text-warning-foreground text-xs" title={`${b.name}: draft`}>{short} draft</Badge>;
                      return <Badge key={b.id} variant="outline" className="text-muted-foreground text-xs" title={`${b.name}: not published`}>{short}</Badge>;
                    })}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/guide/guides/${guide.id}/edit`)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/guide/view/${guide.slug}`)}>Preview</Button>
                  <span className="relative inline-flex">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shareGuide(guide)} title="Copy public link" aria-label="Copy public link">
                      <Link2 className="w-4 h-4" />
                    </Button>
                    {copied?.id === guide.id && copied.kind === "link" && <CopiedTip>Link copied to clipboard</CopiedTip>}
                  </span>
                  <span className="relative inline-flex">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyQr(guide)} disabled={qrJob?.guide.id === guide.id} title="Copy QR code as PNG" aria-label="Copy QR code as PNG">
                      <QrCode className="w-4 h-4" />
                    </Button>
                    {copied?.id === guide.id && copied.kind === "qr" && <CopiedTip>QR code copied to clipboard</CopiedTip>}
                  </span>
                  <DeleteGuideDialog guide={guide} onDelete={deleteGuide} />
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No guides found. Create your first guide to get started.</p>
          </div>
        )}
      </div>

      {/* Offscreen QR render target for copyQr — mounted only while a copy is in flight */}
      {qrJob && (
        <div ref={qrHost} aria-hidden className="fixed -left-[9999px] top-0">
          <QRCodeCanvas value={qrJob.url} size={512} marginSize={2} bgColor="#ffffff" fgColor="#000000" level="M" />
        </div>
      )}
    </div>
  );
}
