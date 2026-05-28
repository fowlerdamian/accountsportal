import { useState } from 'react';
import { useISO } from '../contexts/ISOContext';
import { ISODocument } from '../lib/iso-documents';
import { motion } from 'framer-motion';
import { Cloud, CloudUpload, ExternalLink, Loader2, X, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase as portalSupabase } from '@portal/lib/supabase';
import { auditSupabase } from '../client';
import { loadHeaderConfig, generatePdf } from '../lib/pdf-export';

interface SupportingDocLite {
  id: string;
  title: string;
  clause: string;
  file_name: string | null;
  file_path: string | null;
  status: string;
}

interface DriveSyncPanelProps {
  documents: ISODocument[];
  supportingDocs: SupportingDocLite[];
}

// Extract a Drive folder ID from any of the common URL shapes the user can paste.
function extractFolderId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromUrl = raw.match(/folders\/([a-zA-Z0-9_-]{20,})/);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return null;
}

function safeName(title: string): string {
  return title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const result = String(r.result || '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    r.readAsDataURL(blob);
  });
}

export default function DriveSyncPanel({ documents, supportingDocs }: DriveSyncPanelProps) {
  const { driveFolderId, setDriveFolderId, companyProfile } = useISO();
  const [folderInput, setFolderInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [lastResult, setLastResult] = useState<{ ok: number; failed: number; at: Date } | null>(null);

  const folderUrl = driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : null;
  const completedDocs = documents.filter((d) => d.status === 'complete' && d.generatedContent);
  const uploadedEvidence = supportingDocs.filter((d) => d.status === 'uploaded' && d.file_path);
  const totalToSync = completedDocs.length + uploadedEvidence.length;

  const handleSetFolder = async () => {
    const id = extractFolderId(folderInput);
    if (!id) { toast.error('Could not extract a folder ID from that URL'); return; }
    setVerifying(true);
    try {
      const { data, error } = await portalSupabase.functions.invoke('compliance-drive', {
        body: { action: 'check_folder', folder_id: id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Folder not accessible by service account');
      setDriveFolderId(id);
      setFolderInput('');
      toast.success(`Linked: ${data.name || 'Drive folder'}`);
    } catch (e: any) {
      toast.error(e.message || 'Folder check failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleSync = async () => {
    if (!driveFolderId) return;
    if (totalToSync === 0) { toast.info('Nothing to sync yet'); return; }

    setSyncing(true);
    setProgress({ current: 0, total: totalToSync, label: 'Preparing…' });
    let ok = 0;
    let failed = 0;

    try {
      const hc = await loadHeaderConfig();

      // 1. Generated QMS procedures — render PDF client-side, ship as base64.
      for (const doc of completedDocs) {
        const filename = `${safeName(doc.title)}_Clause_${doc.clause}.pdf`;
        setProgress({ current: ok + failed, total: totalToSync, label: filename });
        try {
          const pdf = await generatePdf(
            { title: doc.title, clause: doc.clause, generatedContent: doc.generatedContent! },
            companyProfile,
            hc,
          );
          const blob = pdf.output('blob') as Blob;
          const base64 = await blobToBase64(blob);
          const { data, error } = await portalSupabase.functions.invoke('compliance-drive', {
            body: {
              action: 'upload',
              folder_id: driveFolderId,
              filename,
              mime_type: 'application/pdf',
              base64,
              replace_existing: true,
            },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          ok++;
        } catch (e: any) {
          console.warn('[drive-sync] failed', filename, e?.message);
          failed++;
        }
      }

      // 2. Supporting evidence — server fetches the bucket URL itself.
      for (const ev of uploadedEvidence) {
        const filename = ev.file_name || `Evidence_${ev.id}`;
        setProgress({ current: ok + failed, total: totalToSync, label: filename });
        try {
          const { data: urlData } = auditSupabase.storage.from('evidence').getPublicUrl(ev.file_path!);
          const { data, error } = await portalSupabase.functions.invoke('compliance-drive', {
            body: {
              action: 'upload',
              folder_id: driveFolderId,
              filename,
              file_url: urlData.publicUrl,
              replace_existing: true,
            },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          ok++;
        } catch (e: any) {
          console.warn('[drive-sync] failed', filename, e?.message);
          failed++;
        }
      }

      setLastResult({ ok, failed, at: new Date() });
      if (failed === 0) toast.success(`Synced ${ok} file${ok === 1 ? '' : 's'} to Drive`);
      else toast.error(`Synced ${ok} · ${failed} failed`);
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  const handleDisconnect = () => {
    setDriveFolderId(null);
    setLastResult(null);
    toast.success('Drive folder unlinked');
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 rounded-xl border border-border card-gradient p-5"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Cloud className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Google Drive Sync</h3>
            <p className="text-xs text-muted-foreground">
              {driveFolderId
                ? `${totalToSync} file${totalToSync === 1 ? '' : 's'} ready · all files land flat in the linked folder`
                : 'Paste a Drive folder URL the service account can access'}
            </p>
          </div>
        </div>
        {driveFolderId && (
          <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground hover:text-destructive" onClick={handleDisconnect}>
            <X className="h-3 w-3" /> Unlink
          </Button>
        )}
      </div>

      {!driveFolderId && (
        <div className="space-y-2">
          <Label className="text-xs">Folder URL</Label>
          <div className="flex gap-2">
            <Input
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              onKeyDown={(e) => { if (e.key === 'Enter') handleSetFolder(); }}
              disabled={verifying}
            />
            <Button onClick={handleSetFolder} disabled={verifying || !folderInput.trim()} className="gap-1.5">
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Link
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            Share the folder with the portal's Google service account email (Editor access) before linking.
          </p>
        </div>
      )}

      {driveFolderId && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSync} disabled={syncing || totalToSync === 0} className="gap-1.5 glow-gold">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
            {syncing ? 'Syncing…' : `Sync ${totalToSync} file${totalToSync === 1 ? '' : 's'} now`}
          </Button>
          {folderUrl && (
            <a href={folderUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Open Drive folder
              </Button>
            </a>
          )}
          {lastResult && (
            <span className="text-xs text-muted-foreground ml-auto">
              Last sync {lastResult.at.toLocaleTimeString()} · {lastResult.ok} ok{lastResult.failed > 0 ? ` · ${lastResult.failed} failed` : ''}
            </span>
          )}
        </div>
      )}

      {syncing && progress && (
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
            <span className="truncate pr-2">{progress.label}</span>
            <span>{progress.current}/{progress.total}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </motion.section>
  );
}
