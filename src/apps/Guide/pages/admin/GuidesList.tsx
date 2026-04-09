import { useNavigate } from "react-router-dom";
import { Plus, Search, Filter, Loader2, Trash2, Copy } from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Badge } from "@guide/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { useInstructionSets, useCategories, usePublications, useBrands, useAllGuideVehicles } from "@guide/hooks/use-supabase-query";
import { useState } from "react";
import { supabase } from "@guide/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Checkbox } from "@guide/components/ui/checkbox";
import { Label } from "@guide/components/ui/label";
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
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"><Trash2 className="w-4 h-4" /></Button>
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

export default function GuidesList() {
  const navigate = useNavigate();
  const { data: guides = [], isLoading } = useInstructionSets();
  const { data: categories = [] } = useCategories();
  const { data: publications = [] } = usePublications();
  const { data: brands = [] } = useBrands();
  const { data: allVehicles = [] } = useAllGuideVehicles();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filtered = guides.filter((g: any) => {
    const matchSearch = g.title.toLowerCase().includes(search.toLowerCase()) || g.product_code.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "all" || g.category_id === categoryFilter;
    return matchSearch && matchCat;
  });

  const deleteGuide = async (id: string) => {
    try {
      await supabase.from("instruction_steps").delete().eq("instruction_set_id", id);
      await supabase.from("guide_publications").delete().eq("instruction_set_id", id);
      await supabase.from("guide_variants").delete().eq("instruction_set_id", id);
      const { error } = await supabase.from("instruction_sets").delete().eq("id", id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["instruction_sets"] });
      toast.success("Guide deleted");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const duplicateGuide = async (guide: any) => {
    try {
      const slug = Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
      const { data: newGuide, error } = await supabase.from("instruction_sets").insert({
        title: `Copy of ${guide.title}`,
        product_code: `${guide.product_code}-COPY`,
        slug,
        category_id: guide.category_id,
        estimated_time: guide.estimated_time,
        short_description: guide.short_description,
        tools_required: guide.tools_required,
        product_image_url: guide.product_image_url,
        notice_text: guide.notice_text,
      }).select().single();
      if (error) throw error;

      // Copy steps
      const { data: steps } = await supabase.from("instruction_steps").select("*").eq("instruction_set_id", guide.id).order("order_index");
      if (steps && steps.length > 0) {
        await supabase.from("instruction_steps").insert(
          steps.map(s => ({
            instruction_set_id: newGuide.id,
            step_number: s.step_number,
            subtitle: s.subtitle,
            description: s.description,
            order_index: s.order_index,
            image_url: s.image_url,
            image_original_url: s.image_original_url,
            image2_url: s.image2_url,
            image2_original_url: s.image2_original_url,
          }))
        );
      }

      queryClient.invalidateQueries({ queryKey: ["instruction_sets"] });
      toast.success("Guide duplicated");
      navigate(`/guide/guides/${newGuide.id}/edit`);
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
          <h1 className="text-2xl font-bold">All Guides</h1>
          <p className="text-muted-foreground text-sm">{guides.length} guides total</p>
        </div>
        <Button onClick={() => navigate('/guide/guides/new')}>
          <Plus className="w-4 h-4 mr-2" />
          Create New Guide
        </Button>
      </div>

      <div className="flex gap-3">
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
      </div>

      <div className="grid gap-4">
        {filtered.map((guide: any) => {
          const guidePubs = publications.filter((p: any) => p.instruction_set_id === guide.id);
          const guideVehicles = allVehicles.filter(v => v.instruction_set_id === guide.id);

          return (
            <div key={guide.id} className="bg-card rounded-lg border p-5 hover:border-primary/30 transition-colors group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-sm truncate">{guide.title}</h3>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">{guide.product_code}</code>
                  </div>
                   <p className="text-sm text-muted-foreground line-clamp-1">{guide.short_description}</p>
                   {guideVehicles.length > 0 && (
                     <div className="flex flex-wrap gap-1.5 mt-2">
                       {guideVehicles.map((v, i) => (
                         <Badge key={i} variant="secondary" className="text-xs font-normal gap-1">
                           🚗 {v.make} {v.model} {v.year_from}–{v.year_to === 0 || !v.year_to ? 'Current' : v.year_to}
                         </Badge>
                       ))}
                     </div>
                   )}
                   <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                     <span>{guide.categories?.name ?? '—'}</span>
                     <span>•</span>
                     <span>{guide.estimated_time ?? '—'}</span>
                     <span>•</span>
                     <span>Updated {new Date(guide.updated_at).toLocaleDateString()}</span>
                   </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex gap-1.5">
                    {brands.map(b => {
                      const pub = guidePubs.find((p: any) => p.brand_id === b.id);
                      return pub?.status === 'published' ? (
                        <Badge key={b.id} className="bg-success text-success-foreground text-xs">{b.key === 'trailbait' ? 'TB' : 'AGA'} ✓</Badge>
                      ) : (
                        <Badge key={b.id} variant="outline" className="text-muted-foreground text-xs">{b.key === 'trailbait' ? 'TB' : 'AGA'}</Badge>
                      );
                    })}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/guide/guides/${guide.id}/edit`)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/guide/guides/${guide.id}/share`)}>Share</Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicateGuide(guide)} title="Duplicate">
                    <Copy className="w-4 h-4" />
                  </Button>
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
    </div>
  );
}
