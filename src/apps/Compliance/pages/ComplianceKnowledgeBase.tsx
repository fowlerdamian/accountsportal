import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useISO } from '../contexts/ISOContext';
import { supabase } from '@portal/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Globe, FileText, Trash2, Plus, Loader2, BookOpen, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

interface KBItem {
  id: string;
  type: 'document' | 'website' | 'text';
  title: string;
  url?: string;
  file_name?: string;
  created_at: string;
  content: string;
}

export default function ComplianceKnowledgeBase() {
  const navigate = useNavigate();
  const { companyProfile } = useISO();
  const [items, setItems] = useState<KBItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'idle' | 'website' | 'document'>('idle');
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const companyDomain = companyProfile?.email?.split('@')[1]?.toLowerCase() || '';

  const fetchItems = async () => {
    if (!companyDomain) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('compliance_kb_items')
        .select('id, type, title, url, file_name, created_at, content')
        .eq('company_domain', companyDomain)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems(data || []);
    } catch (err: any) {
      toast.error('Failed to load knowledge base');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, [companyDomain]);

  const handleDeleteItem = async (id: string) => {
    try {
      const { error } = await supabase.from('compliance_kb_items').delete().eq('id', id);
      if (error) throw error;
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success('Item removed from knowledge base');
    } catch {
      toast.error('Failed to delete item');
    }
  };

  const handleAddWebsite = async () => {
    if (!urlInput.trim()) { toast.error('Enter a URL'); return; }
    if (!companyDomain) { toast.error('Company profile email required to scope knowledge base'); return; }
    setIngesting(true);
    try {
      let url = urlInput.trim();
      if (!url.startsWith('http')) url = 'https://' + url;

      const { data, error } = await supabase.functions.invoke('kb-ingest', {
        body: { type: 'website', url, title: titleInput.trim() || undefined, companyDomain },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setItems((prev) => [data, ...prev]);
      setUrlInput('');
      setTitleInput('');
      setMode('idle');
      toast.success('Website added to knowledge base');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add website');
    } finally {
      setIngesting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!companyDomain) { toast.error('Company profile email required'); return; }

    setIngesting(true);
    try {
      let content = '';

      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          pages.push(textContent.items.map((item: any) => item.str).join(' '));
        }
        content = pages.join('\n\n');
      } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        content = await file.text();
      } else {
        toast.error('Supported formats: PDF, TXT, MD');
        return;
      }

      const title = file.name.replace(/\.[^.]+$/, '');
      const { data, error } = await supabase.functions.invoke('kb-ingest', {
        body: { type: 'document', title, content: content.slice(0, 60_000), fileName: file.name, companyDomain },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setItems((prev) => [data, ...prev]);
      setMode('idle');
      toast.success('Document added to knowledge base');
    } catch (err: any) {
      toast.error(err.message || 'Failed to process document');
    } finally {
      setIngesting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const typeConfig = {
    document: { icon: FileText, label: 'Document', color: 'text-primary bg-primary/10' },
    website:  { icon: Globe,    label: 'Website',  color: 'text-accent bg-accent/20' },
    text:     { icon: BookOpen, label: 'Text',     color: 'text-success bg-success/10' },
  };

  return (
    <div className="min-h-full overflow-y-auto">
      <header className="border-b border-border px-6 py-4 sticky top-0 bg-background/80 backdrop-blur z-10">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" /> Knowledge Base
              </h1>
              <p className="text-xs text-muted-foreground">Context sources for AI document suggestions</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setMode('website'); setTitleInput(''); setUrlInput(''); }}>
              <Globe className="h-3.5 w-3.5" /> Add Website
            </Button>
            <Button size="sm" className="gap-1.5 glow-gold" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Upload Doc
            </Button>
            <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md" className="hidden" onChange={handleFileSelect} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {/* Add website panel */}
        <AnimatePresence>
          {mode === 'website' && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-6 rounded-xl border border-border card-gradient p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Add Website</h3>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setMode('idle')}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">URL *</Label>
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://www.example.com/quality-policy"
                    className="mt-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddWebsite()}
                  />
                </div>
                <div>
                  <Label className="text-xs">Title (optional — auto-detected)</Label>
                  <Input
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="Leave blank to use page title"
                    className="mt-1"
                  />
                </div>
                <Button onClick={handleAddWebsite} disabled={ingesting} className="gap-2">
                  {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {ingesting ? 'Fetching…' : 'Add'}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Ingesting overlay */}
        {ingesting && mode !== 'website' && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-border card-gradient p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Processing document…
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-base font-semibold text-foreground mb-1">No sources yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Add websites or upload documents. The AI will use them to suggest tailored answers when completing your ISO documents.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Items list */}
        <div className="space-y-3">
          {items.map((item) => {
            const cfg = typeConfig[item.type] || typeConfig.text;
            const Icon = cfg.icon;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-4 rounded-xl border border-border card-gradient p-4"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground truncate">{item.title}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary truncate block">
                      {item.url}
                    </a>
                  )}
                  {item.file_name && !item.url && (
                    <p className="text-xs text-muted-foreground">{item.file_name}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                    {item.content.slice(0, 200)}…
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Added {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteItem(item.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </motion.div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
