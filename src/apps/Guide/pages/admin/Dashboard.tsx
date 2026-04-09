import { useNavigate } from "react-router-dom";
import { BookOpen, MessageCircle, FileText, AlertTriangle, Plus, Loader2 } from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Input } from "@guide/components/ui/input";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { useInstructionSets, usePublications, useBrands, useSupportQuestions, useFeedback } from "@guide/hooks/use-supabase-query";
import { useState } from "react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: guides = [], isLoading: loadingGuides } = useInstructionSets();
  const { data: publications = [] } = usePublications();
  const { data: brands = [] } = useBrands();
  const { data: supportQuestions = [] } = useSupportQuestions();
  const { data: feedbackItems = [] } = useFeedback();
  const [search, setSearch] = useState("");

  if (loadingGuides) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const totalGuides = guides.length;
  const publishedCount = guides.filter(g => publications.some(p => p.instruction_set_id === g.id && p.status === 'published')).length;
  const draftCount = totalGuides - publishedCount;
  const openSupport = supportQuestions.filter((q: any) => !q.resolved).length;
  const openFeedback = feedbackItems.filter((f: any) => !f.resolved && f.type === 'flag').length;

  const filteredGuides = guides.filter((g: any) =>
    g.title.toLowerCase().includes(search.toLowerCase()) ||
    g.product_code.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusBadge = (guideId: string, brandId: string) => {
    const pub = publications.find((p: any) => p.instruction_set_id === guideId && p.brand_id === brandId);
    if (!pub) return <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">Not published</Badge>;
    if (pub.status === 'published') return <Badge className="bg-success text-success-foreground">Published</Badge>;
    return <Badge className="bg-warning text-warning-foreground">Draft</Badge>;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Overview of your installation guides</p>
        </div>
        <Button onClick={() => navigate('/guide/guides/new')}>
          <Plus className="w-4 h-4 mr-2" />
          Create New Guide
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatsCard title="Total Guides" value={totalGuides} icon={<BookOpen className="w-5 h-5" />} />
        <StatsCard title="Published" value={publishedCount} icon={<FileText className="w-5 h-5" />} subtitle="Across all brands" />
        <StatsCard title="Drafts" value={draftCount} icon={<FileText className="w-5 h-5" />} />
        <StatsCard title="Open Support" value={openSupport} icon={<MessageCircle className="w-5 h-5" />} />
        <StatsCard title="Feedback Flags" value={openFeedback} icon={<AlertTriangle className="w-5 h-5" />} />
      </div>

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between gap-4">
          <h2 className="font-semibold">All Guides</h2>
          <Input placeholder="Search guides..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Code</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</th>
                {brands.map(b => (
                  <th key={b.id} className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{b.name}</th>
                ))}
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredGuides.map((guide: any) => (
                <tr key={guide.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-3"><span className="font-medium text-sm">{guide.title}</span></td>
                  <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{guide.product_code}</code></td>
                  <td className="p-3 text-sm text-muted-foreground">{guide.categories?.name ?? '—'}</td>
                  {brands.map(b => (
                    <td key={b.id} className="p-3 text-center">{getStatusBadge(guide.id, b.id)}</td>
                  ))}
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/guide/guides/${guide.id}`)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/guide/view/${guide.slug}`)}>Preview</Button>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/guide/guides/${guide.id}/share`)}>Share</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredGuides.length === 0 && (
                <tr><td colSpan={4 + brands.length} className="p-8 text-center text-muted-foreground">No guides found. Create your first guide to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
