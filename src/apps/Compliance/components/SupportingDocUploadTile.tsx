import { useState, useRef, useEffect } from 'react';
import { auditSupabase } from '../client';
import { useAuditAuth } from '../context/AuditAuthContext';
import { SUPPORTING_DOC_REQUIREMENTS, SupportingDocRequirement } from '../lib/supporting-docs';
import { Upload, CheckCircle2, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface SupportingDocUploadTileProps {
  documentId: string;
}

interface DocStatus {
  id: string;
  requirement: SupportingDocRequirement;
  fileName: string | null;
  filePath: string | null;
  status: string;
  dbId: string | null;
}

export default function SupportingDocUploadTile({ documentId }: SupportingDocUploadTileProps) {
  const { session } = useAuditAuth();
  const [docs, setDocs] = useState<DocStatus[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const requirements = SUPPORTING_DOC_REQUIREMENTS.filter((r) => r.documentId === documentId);

  useEffect(() => {
    if (requirements.length === 0) return;
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const loadStatus = async () => {
    const { data } = await auditSupabase
      .from('supporting_docs')
      .select('*')
      .eq('document_id', documentId);

    const statuses: DocStatus[] = requirements.map((req) => {
      const existing = data?.find((d: any) => d.title === req.title);
      return {
        id: req.id,
        requirement: req,
        fileName: existing?.file_name || null,
        filePath: existing?.file_path || null,
        status: existing?.status || 'pending',
        dbId: existing?.id || null,
      };
    });
    setDocs(statuses);
  };

  const handleUpload = async (reqId: string, file: File) => {
    if (!session?.user?.id) return;
    const doc = docs.find((d) => d.id === reqId);
    if (!doc) return;

    setUploading(reqId);
    try {
      const filePath = `${session.user.id}/${documentId}/${reqId}_${file.name}`;

      if (doc.filePath) {
        await auditSupabase.storage.from('evidence').remove([doc.filePath]);
      }

      const { error: uploadError } = await auditSupabase.storage.from('evidence').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const upsertData = {
        document_id: documentId,
        title: doc.requirement.title,
        description: doc.requirement.description,
        clause: doc.requirement.clause,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        status: 'uploaded',
        uploaded_by: session.user.id,
        uploaded_at: new Date().toISOString(),
      };

      if (doc.dbId) {
        const { error } = await auditSupabase.from('supporting_docs').update(upsertData).eq('id', doc.dbId);
        if (error) throw error;
      } else {
        const { error } = await auditSupabase.from('supporting_docs').insert(upsertData);
        if (error) throw error;
      }

      toast.success(`${file.name} uploaded`);
      await loadStatus();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  if (requirements.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-secondary/30 p-4"
    >
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Supporting Documentation Required
        </h4>
      </div>
      <div className="space-y-2">
        {(docs.length > 0 ? docs : requirements.map((r) => ({
          id: r.id, requirement: r, fileName: null, filePath: null, status: 'pending', dbId: null,
        }))).map((doc) => {
          const isUploading = uploading === doc.id;
          const isUploaded = doc.status === 'uploaded' && doc.fileName;
          return (
            <div
              key={doc.id}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-all ${
                isUploaded
                  ? 'border-success/40 bg-success/5'
                  : 'border-border hover:border-primary/40 hover:bg-primary/5'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{doc.requirement.title}</p>
                <p className="text-xs text-muted-foreground truncate">{doc.requirement.description}</p>
                {isUploaded && (
                  <p className="text-xs text-success mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {doc.fileName}
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
