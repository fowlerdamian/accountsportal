import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@guide/contexts/AuthContext';
import { useISO } from '../context/ISOContext';
import { auditSupabase } from '../client';
import { SUPPORTING_DOC_REQUIREMENTS } from '../lib/supporting-docs';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Upload, CheckCircle2, FileText, Trash2, Loader2, Shield, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

interface UploadedDoc {
  id: string;
  document_id: string;
  title: string;
  description: string;
  clause: string;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  status: string;
}

export default function ComplianceSupportingDocs() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { companyProfile } = useISO();
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeRequirementId, setActiveRequirementId] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    const { data, error } = await auditSupabase.from('supporting_docs').select('*');
    if (error) console.error('Failed to load supporting docs:', error);
    else setDocs((data as UploadedDoc[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const getUploadedDoc = (requirementId: string) =>
    docs.find((d) => d.title === requirementId && d.status === 'uploaded');

  const handleUploadClick = (requirementId: string) => {
    setActiveRequirementId(requirementId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeRequirementId || !user?.id) return;

    const requirement = SUPPORTING_DOC_REQUIREMENTS.find((r) => r.id === activeRequirementId);
    if (!requirement) return;

    setUploading(activeRequirementId);
    try {
      const filePath = `${user!.id}/${activeRequirementId}/${file.name}`;
      const { error: uploadError } = await auditSupabase.storage.from('evidence').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const existing = getUploadedDoc(activeRequirementId);
      if (existing) await auditSupabase.from('supporting_docs').delete().eq('id', existing.id);

      const { error: insertError } = await auditSupabase.from('supporting_docs').insert({
        document_id: requirement.documentId,
        title: requirement.id,
        description: requirement.description,
        clause: requirement.clause,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        uploaded_by: user!.id,
        uploaded_at: new Date().toISOString(),
        status: 'uploaded',
      });
      if (insertError) throw insertError;

      toast.success(`Uploaded: ${file.name}`);
      await fetchDocs();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(null);
      setActiveRequirementId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (requirementId: string) => {
    const uploaded = getUploadedDoc(requirementId);
    if (!uploaded) return;
    try {
      if (uploaded.file_path) await auditSupabase.storage.from('evidence').remove([uploaded.file_path]);
      await auditSupabase.from('supporting_docs').delete().eq('id', uploaded.id);
      toast.success('File removed');
      await fetchDocs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const uploadedCount = SUPPORTING_DOC_REQUIREMENTS.filter((r) => getUploadedDoc(r.id)).length;
  const totalCount = SUPPORTING_DOC_REQUIREMENTS.length;
  const progress = totalCount > 0 ? Math.round((uploadedCount / totalCount) * 100) : 0;

  const grouped = SUPPORTING_DOC_REQUIREMENTS.reduce<Record<string, typeof SUPPORTING_DOC_REQUIREMENTS>>(
    (acc, req) => { if (!acc[req.clause]) acc[req.clause] = []; acc[req.clause].push(req); return acc; },
    {}
  );

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto max-w-6xl flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            {companyProfile?.logoUrl ? (
              <img src={companyProfile.logoUrl} alt="Logo" className="h-10 w-10 rounded-lg object-contain bg-secondary p-1" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                <Shield className="h-5 w-5 text-primary-foreground" />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-foreground">Supporting Documentation</h1>
              <p className="text-sm text-muted-foreground">Upload evidence files for ISO certification</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8 rounded-xl border border-border card-gradient p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Evidence Uploaded</h2>
            <span className="text-2xl font-bold text-gradient-gold">{uploadedCount}/{totalCount}</span>
          </div>
          <Progress value={progress} className="h-2" />
          <p className="mt-2 text-sm text-muted-foreground">Upload supporting evidence files for your ISO 9001 documentation.</p>
        </motion.div>

        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

        {Object.entries(grouped).map(([clause, requirements], groupIdx) => (
          <motion.section
            key={clause}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIdx * 0.05 }}
            className="mb-6"
          >
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Clause {clause}</h3>
            <div className="space-y-2">
              <AnimatePresence>
                {requirements.map((req) => {
                  const uploaded = getUploadedDoc(req.id);
                  const isUploading = uploading === req.id;
                  return (
                    <motion.div
                      key={req.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`rounded-xl border p-4 transition-all ${uploaded ? 'border-success/40 bg-success/5' : 'border-border hover:border-primary/40'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${uploaded ? 'bg-success/20' : 'bg-secondary'}`}>
                          {uploaded ? <CheckCircle2 className="h-5 w-5 text-success" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-foreground">{req.title}</h4>
                          <p className="text-xs text-muted-foreground">{req.description}</p>
                          {uploaded && (
                            <p className="text-xs text-success mt-1 flex items-center gap-1">
                              <FolderOpen className="h-3 w-3" />
                              {uploaded.file_name}
                              {uploaded.file_size && ` (${(uploaded.file_size / 1024).toFixed(0)} KB)`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {uploaded ? (
                            <>
                              <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => handleUploadClick(req.id)} disabled={isUploading}>
                                {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                Replace
                              </Button>
                              <Button variant="ghost" size="sm" className="gap-1 h-8 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(req.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => handleUploadClick(req.id)} disabled={isUploading}>
                              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                              Upload
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.section>
        ))}
      </main>
    </div>
  );
}
