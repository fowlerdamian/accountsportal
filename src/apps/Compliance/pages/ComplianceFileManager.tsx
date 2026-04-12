import { useNavigate } from 'react-router-dom';
import { useISO } from '../context/ISOContext';
import { motion } from 'framer-motion';
import {
  FileText, Shield, Download, Loader2, Eye, Printer,
  ArrowLeft, PackageOpen, Paperclip,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { loadHeaderConfig, generatePdf, savePdf } from '../lib/pdf-export';
import { auditSupabase } from '../client';

const categoryLabels: Record<string, string> = { plan: 'Plan', do: 'Do', check: 'Check', act: 'Act' };

interface SupportingDocRow {
  id: string;
  title: string;
  clause: string;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  status: string;
  uploaded_at: string | null;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ComplianceFileManager() {
  const { documents, companyProfile } = useISO();
  const navigate = useNavigate();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [supportingDocs, setSupportingDocs] = useState<SupportingDocRow[]>([]);
  const [loadingSupportingDocs, setLoadingSupportingDocs] = useState(true);

  useEffect(() => {
    auditSupabase
      .from('supporting_docs')
      .select('id, title, clause, file_name, file_path, file_size, status, uploaded_at')
      .eq('status', 'uploaded')
      .order('clause')
      .then(({ data }) => { setSupportingDocs(data || []); setLoadingSupportingDocs(false); });
  }, []);

  const completedDocs = documents
    .filter((d) => d.status === 'complete' && d.generatedContent)
    .sort((a, b) => {
      const order = ['plan', 'do', 'check', 'act'];
      return order.indexOf(a.category) - order.indexOf(b.category) || a.clause.localeCompare(b.clause);
    });

  const makePdf = async (doc: typeof completedDocs[0]) => {
    const hc = await loadHeaderConfig();
    return generatePdf({ title: doc.title, clause: doc.clause, generatedContent: doc.generatedContent! }, companyProfile, hc);
  };

  const handlePreview = async (doc: typeof completedDocs[0]) => {
    setLoadingId(doc.id);
    try {
      const pdf = await makePdf(doc);
      window.open(URL.createObjectURL(pdf.output('blob')), '_blank');
    } catch { toast.error('Failed to generate preview'); }
    finally { setLoadingId(null); }
  };

  const handlePrint = async (doc: typeof completedDocs[0]) => {
    setLoadingId(doc.id);
    try {
      const pdf = await makePdf(doc);
      const url = URL.createObjectURL(pdf.output('blob'));
      const w = window.open(url, '_blank');
      if (w) w.addEventListener('load', () => w.print());
    } catch { toast.error('Failed to print'); }
    finally { setLoadingId(null); }
  };

  const handleSave = async (doc: typeof completedDocs[0]) => {
    setLoadingId(doc.id);
    try { const pdf = await makePdf(doc); savePdf(pdf, doc.title, doc.clause); }
    catch { toast.error('Failed to save PDF'); }
    finally { setLoadingId(null); }
  };

  const handleDownloadSupportingDoc = async (doc: SupportingDocRow) => {
    if (!doc.file_path) return;
    setLoadingId(doc.id);
    try {
      const { data, error } = await auditSupabase.storage.from('evidence').download(doc.file_path);
      if (error) throw error;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(data);
      link.download = doc.file_name || 'file';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch { toast.error('Failed to download file'); }
    finally { setLoadingId(null); }
  };

  const handlePreviewSupportingDoc = async (doc: SupportingDocRow) => {
    if (!doc.file_path) return;
    setLoadingId(doc.id);
    try {
      const { data } = auditSupabase.storage.from('evidence').getPublicUrl(doc.file_path);
      window.open(data.publicUrl, '_blank');
    } catch { toast.error('Failed to preview file'); }
    finally { setLoadingId(null); }
  };

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      const hc = await loadHeaderConfig();
      const zip = new JSZip();
      const proceduresFolder = zip.folder('Procedures');
      const evidenceFolder = zip.folder('Supporting Evidence');

      for (const doc of completedDocs) {
        const pdf = await generatePdf({ title: doc.title, clause: doc.clause, generatedContent: doc.generatedContent! }, companyProfile, hc);
        const safeName = doc.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
        proceduresFolder?.file(`${safeName}_Clause_${doc.clause}.pdf`, pdf.output('blob'));
      }

      for (const sd of supportingDocs) {
        if (!sd.file_path) continue;
        try {
          const { data, error } = await auditSupabase.storage.from('evidence').download(sd.file_path);
          if (!error && data) evidenceFolder?.file(`Clause_${sd.clause.replace(/[^a-zA-Z0-9.]/g, '_')}_${sd.file_name || 'file'}`, data);
        } catch { /* skip */ }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const businessName = (companyProfile?.companyName || 'Company').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `${businessName}_QMS_Procedures.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success(`Exported ${completedDocs.length + supportingDocs.length} file(s) as ZIP`);
    } catch { toast.error('Failed to export ZIP'); }
    finally { setIsExporting(false); }
  };

  const totalFiles = completedDocs.length + supportingDocs.length;

  return (
    <div className="min-h-full">
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')} title="Back to Dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {companyProfile?.logoUrl ? (
              <img src={companyProfile.logoUrl} alt="Logo" className="h-10 w-10 rounded-lg object-contain bg-secondary p-1" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                <Shield className="h-5 w-5 text-primary-foreground" />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-foreground">File Manager</h1>
              <p className="text-sm text-muted-foreground">Preview, print and save your QMS documents</p>
            </div>
          </div>
          <Button onClick={handleExportAll} disabled={isExporting || totalFiles === 0} className="glow-gold gap-2">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
            Export All
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* QMS Procedures */}
        <section className="mb-10">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">QMS Procedures ({completedDocs.length})</h3>
          {completedDocs.length === 0 ? (
            <div className="rounded-xl border border-border bg-secondary/10 p-6 text-center">
              <p className="text-sm text-muted-foreground">No completed documents yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completedDocs.map((doc, idx) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="group flex items-center gap-4 rounded-xl border border-border bg-secondary/20 p-4 transition-all hover:border-primary/40 hover:bg-secondary/40"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-foreground truncate">{doc.title}</h4>
                    <p className="text-xs text-muted-foreground">Clause {doc.clause} · {categoryLabels[doc.category]}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" disabled={loadingId === doc.id} onClick={() => handlePreview(doc)}>
                      {loadingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                      Preview
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" disabled={loadingId === doc.id} onClick={() => handlePrint(doc)}>
                      <Printer className="h-3.5 w-3.5" /> Print
                    </Button>
                    <Button variant="secondary" size="sm" className="gap-1.5 h-8 text-xs" disabled={loadingId === doc.id} onClick={() => handleSave(doc)}>
                      <Download className="h-3.5 w-3.5" /> Save
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Supporting Evidence */}
        <section>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Supporting Evidence ({supportingDocs.length})</h3>
          {loadingSupportingDocs ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : supportingDocs.length === 0 ? (
            <div className="rounded-xl border border-border bg-secondary/10 p-6 text-center">
              <p className="text-sm text-muted-foreground">No supporting documents uploaded yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {supportingDocs.map((sd, idx) => (
                <motion.div
                  key={sd.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="group flex items-center gap-4 rounded-xl border border-border bg-secondary/20 p-4 transition-all hover:border-primary/40 hover:bg-secondary/40"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/30">
                    <Paperclip className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-foreground truncate">{sd.title}</h4>
                    <p className="text-xs text-muted-foreground">
                      Clause {sd.clause} · {sd.file_name || 'No file'}{sd.file_size ? ` · ${formatFileSize(sd.file_size)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" disabled={!sd.file_path || loadingId === sd.id} onClick={() => handlePreviewSupportingDoc(sd)}>
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </Button>
                    <Button variant="secondary" size="sm" className="gap-1.5 h-8 text-xs" disabled={!sd.file_path || loadingId === sd.id} onClick={() => handleDownloadSupportingDoc(sd)}>
                      {loadingId === sd.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Save
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
