import { useState, useRef, useEffect } from 'react';
import { auditSupabase } from '../client';
import { useAuth } from '@guide/contexts/AuthContext';
import { Upload, CheckCircle2, Loader2, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface SupportingDocUploadTileProps {
  documentId: string;
}

interface DbDoc {
  id: string;
  title: string;
  description: string | null;
  clause: string;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  status: string;
}

export default function SupportingDocUploadTile({ documentId }: SupportingDocUploadTileProps) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DbDoc[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const loadStatus = async () => {
    const { data } = await auditSupabase
      .from('supporting_docs')
      .select('id, title, description, clause, file_name, file_path, file_size, status')
      .eq('document_id', documentId)
      .order('title');
    setDocs(data || []);
  };

  const handleUpload = async (docId: string, file: File) => {
    if (!user?.id) return;
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;

    setUploading(docId);
    try {
      const filePath = `${user.id}/${documentId}/${docId}_${file.name}`;

      if (doc.file_path) {
        await auditSupabase.storage.from('evidence').remove([doc.file_path]);
      }

      const { error: uploadError } = await auditSupabase.storage
        .from('evidence')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { error } = await auditSupabase
        .from('supporting_docs')
        .update({
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          status: 'uploaded',
          uploaded_by: user.id,
          uploaded_at: new Date().toISOString(),
        })
        .eq('id', docId);
      if (error) throw error;

      toast.success(`${file.name} uploaded`);
      await loadStatus();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  if (docs.length === 0) return null;

  const uploadedCount = docs.filter((d) => d.status === 'uploaded').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-secondary/30 p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Supporting Documentation Required
          </h4>
        </div>
        <span className="text-xs text-muted-foreground">{uploadedCount}/{docs.length} uploaded</span>
      </div>
      <div className="space-y-2">
        {docs.map((doc) => {
          const isUploading = uploading === doc.id;
          const isUploaded = doc.status === 'uploaded' && doc.file_name;
          const isRequired = doc.status === 'required' && !doc.file_name;
          return (
            <div
              key={doc.id}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-all ${
                isUploaded
                  ? 'border-success/40 bg-success/5'
                  : isRequired
                  ? 'border-warning/40 bg-warning/5'
                  : 'border-border hover:border-primary/40 hover:bg-primary/5'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {isRequired && !isUploaded && <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />}
                  <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
                </div>
                {doc.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{doc.description}</p>
                )}
                {isUploaded && (
                  <p className="text-xs text-success mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {doc.file_name}
                  </p>
                )}
              </div>
              <input
                type="file"
                ref={(el) => { fileInputRefs.current[doc.id] = el; }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(doc.id, file);
                  if (fileInputRefs.current[doc.id]) fileInputRefs.current[doc.id]!.value = '';
                }}
                className="hidden"
              />
              <Button
                variant={isUploaded ? 'outline' : 'secondary'}
                size="sm"
                className="gap-1.5 shrink-0 h-8 text-xs"
                disabled={isUploading}
                onClick={() => fileInputRefs.current[doc.id]?.click()}
              >
                {isUploading ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Uploading...</>
                ) : isUploaded ? (
                  <><Upload className="h-3 w-3" /> Replace</>
                ) : (
                  <><Upload className="h-3 w-3" /> Upload</>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
