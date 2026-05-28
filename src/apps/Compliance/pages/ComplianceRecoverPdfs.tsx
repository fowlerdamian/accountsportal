/**
 * TEMPORARY recovery tool. One-off after the 2026-05-28 sync data-loss
 * incident. Lets the user drop downloaded ISO PDFs (or the Export-All ZIP)
 * and rebuilds each document's generatedContent + status from the PDF text.
 *
 * SAFE TO DELETE this file + its route + dashboard link once recovery is done.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useISO } from '../contexts/ISOContext';
import { ISO_DOCUMENTS } from '../lib/iso-documents';
import { motion } from 'framer-motion';
import { ArrowLeft, Upload, FileText, CheckCircle2, XCircle, Loader2, AlertTriangle, FileArchive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

interface ParsedPdf {
  fileName: string;
  text: string;
  detectedTitle: string | null;
  detectedClause: string | null;
  matchedDocId: string | null;
  status: 'pending' | 'restored' | 'skipped' | 'error';
  errorMessage?: string;
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function detectClauseFromText(text: string): string | null {
  const m = text.match(/Clause[\s:]+([\d.]+(?:\s*\/\s*[\d.]+)?)/i)
         ?? text.match(/^\s*([\d]+\.[\d]+(?:\s*\/\s*[\d]+\.[\d]+)?)\s+/m);
  return m ? m[1].trim() : null;
}

function detectTitleFromText(text: string): string | null {
  // First non-empty line that isn't a table separator/document metadata
  for (const raw of text.split('\n').slice(0, 30)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[#|*\-=]+$/.test(line)) continue;
    if (/^document no/i.test(line)) continue;
    if (/^clause/i.test(line)) continue;
    if (/^version/i.test(line)) continue;
    if (line.length < 4 || line.length > 80) continue;
    return line.replace(/^#+\s*/, '');
  }
  return null;
}

function matchDoc(title: string | null, clause: string | null, fileName: string): string | null {
  // Try filename pattern from FileManager: "<Safe_Name>_Clause_<n>.pdf"
  const fnMatch = fileName.replace(/\.pdf$/i, '').match(/^(.+?)_Clause_(.+)$/i);
  const fnTitle = fnMatch?.[1]?.replace(/_/g, ' ').trim() ?? null;
  const fnClause = fnMatch?.[2]?.replace(/_/g, ' ').trim() ?? null;

  const candidateTitle = title ?? fnTitle ?? '';
  const candidateClause = clause ?? fnClause ?? '';

  // Clause match wins; tie-break by title similarity.
  const clauseNorm = candidateClause.replace(/\s+/g, '').toLowerCase();
  const titleNorm = normalizeForCompare(candidateTitle);

  const byClause = ISO_DOCUMENTS.filter(d => d.clause.replace(/\s+/g, '').toLowerCase() === clauseNorm);
  if (byClause.length === 1) return byClause[0].id;
  if (byClause.length > 1 && titleNorm) {
    const t = byClause.find(d => normalizeForCompare(d.title) === titleNorm)
           ?? byClause.find(d => normalizeForCompare(d.title).includes(titleNorm) || titleNorm.includes(normalizeForCompare(d.title)));
    if (t) return t.id;
  }

  if (titleNorm) {
    const exact = ISO_DOCUMENTS.find(d => normalizeForCompare(d.title) === titleNorm);
    if (exact) return exact.id;
    const fuzzy = ISO_DOCUMENTS.find(d => {
      const n = normalizeForCompare(d.title);
      return n.includes(titleNorm) || titleNorm.includes(n);
    });
    if (fuzzy) return fuzzy.id;
  }
  return null;
}

async function extractPdfText(file: File | Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    // Group items by Y so we preserve line breaks roughly.
    type Item = { str: string; transform: number[] };
    const items = tc.items as Item[];
    const byY = new Map<number, string[]>();
    for (const it of items) {
      const y = Math.round((it.transform?.[5] ?? 0) * 10) / 10;
      const row = byY.get(y) ?? [];
      row.push(it.str);
      byY.set(y, row);
    }
    const sortedY = Array.from(byY.keys()).sort((a, b) => b - a);
    pages.push(sortedY.map(y => byY.get(y)!.join(' ')).join('\n'));
  }
  return pages.join('\n\n');
}

async function parsePdfFile(name: string, blob: Blob | File): Promise<ParsedPdf> {
  try {
    const text = await extractPdfText(blob);
    const detectedTitle = detectTitleFromText(text);
    const detectedClause = detectClauseFromText(text);
    const matchedDocId = matchDoc(detectedTitle, detectedClause, name);
    return { fileName: name, text, detectedTitle, detectedClause, matchedDocId, status: 'pending' };
  } catch (e: any) {
    return { fileName: name, text: '', detectedTitle: null, detectedClause: null, matchedDocId: null, status: 'error', errorMessage: e?.message || 'Parse failed' };
  }
}

export default function ComplianceRecoverPdfs() {
  const navigate = useNavigate();
  const { updateDocument, snapshotProfileFor, documents } = useISO();
  const [parsed, setParsed] = useState<ParsedPdf[]>([]);
  const [working, setWorking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setWorking(true);
    try {
      const incoming: ParsedPdf[] = [];

      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.zip')) {
          // Unpack ZIP and process every .pdf inside.
          try {
            const zip = await JSZip.loadAsync(file);
            const entries: { name: string; blob: Blob }[] = [];
            await Promise.all(
              Object.values(zip.files).map(async (entry) => {
                if (entry.dir || !entry.name.toLowerCase().endsWith('.pdf')) return;
                const blob = await entry.async('blob');
                entries.push({ name: entry.name.split('/').pop() || entry.name, blob });
              })
            );
            for (const e of entries) incoming.push(await parsePdfFile(e.name, e.blob));
          } catch (err: any) {
            incoming.push({ fileName: file.name, text: '', detectedTitle: null, detectedClause: null, matchedDocId: null, status: 'error', errorMessage: 'ZIP read failed: ' + (err?.message || 'unknown') });
          }
        } else if (lower.endsWith('.pdf')) {
          incoming.push(await parsePdfFile(file.name, file));
        }
      }

      setParsed((prev) => [...prev, ...incoming]);
      toast.success(`Parsed ${incoming.length} file${incoming.length === 1 ? '' : 's'}`);
    } finally {
      setWorking(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const setMatch = (idx: number, docId: string | null) => {
    setParsed((prev) => prev.map((p, i) => i === idx ? { ...p, matchedDocId: docId, status: 'pending' } : p));
  };

  const restoreOne = (idx: number) => {
    setParsed((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      if (!p.matchedDocId || !p.text.trim()) return { ...p, status: 'error', errorMessage: 'Pick a document and ensure text was extracted.' };
      updateDocument(p.matchedDocId, {
        status: 'complete',
        progress: 100,
        generatedContent: p.text,
        messages: [{
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `_(restored from ${p.fileName})_`,
          timestamp: new Date(),
        }],
      } as any);
      snapshotProfileFor(p.matchedDocId);
      return { ...p, status: 'restored' };
    }));
    toast.success('Document restored');
  };

  const restoreAllMatched = () => {
    let n = 0;
    setParsed((prev) => prev.map((p) => {
      if (p.status === 'restored' || !p.matchedDocId || !p.text.trim()) return p;
      updateDocument(p.matchedDocId, {
        status: 'complete',
        progress: 100,
        generatedContent: p.text,
        messages: [{
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `_(restored from ${p.fileName})_`,
          timestamp: new Date(),
        }],
      } as any);
      snapshotProfileFor(p.matchedDocId);
      n++;
      return { ...p, status: 'restored' as const };
    }));
    if (n > 0) toast.success(`Restored ${n} document${n === 1 ? '' : 's'}`);
    else toast.info('Nothing to restore — match each file to a document first');
  };

  const skip = (idx: number) => setParsed((prev) => prev.map((p, i) => i === idx ? { ...p, status: 'skipped' } : p));

  return (
    <div className="min-h-full overflow-y-auto">
      <header className="border-b border-warning/40 bg-warning/5 px-6 py-4 sticky top-0 z-10 backdrop-blur">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                PDF Recovery <span className="text-[10px] uppercase tracking-widest rounded bg-warning/20 text-warning px-1.5 py-0.5">temporary</span>
              </h1>
              <p className="text-xs text-muted-foreground">Drop ISO PDFs (or the Export-All ZIP) to rebuild completed documents from disk.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="gap-1.5 glow-gold" onClick={() => fileInputRef.current?.click()} disabled={working}>
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Add files
            </Button>
            <input ref={fileInputRef} type="file" accept=".pdf,.zip" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <Button size="sm" variant="secondary" onClick={restoreAllMatched} disabled={parsed.length === 0}>
              Restore all matched
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground space-y-2">
          <p className="text-foreground font-semibold">How this works</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>PDFs downloaded from <span className="font-mono">/compliance/files</span> follow the pattern <span className="font-mono">&lt;Title&gt;_Clause_&lt;n&gt;.pdf</span>; the matcher uses that plus text in the page header.</li>
            <li>Restoring sets the doc to <span className="font-semibold">complete</span> with the extracted text as its content. Formatting (markdown tables, bold) won't survive — the text becomes the new source of truth and re-exports will be plain.</li>
            <li>Changes sync to the shared row immediately, so anyone refreshing <span className="font-mono">/compliance</span> sees the restored docs.</li>
          </ul>
        </div>

        {parsed.length === 0 && !working && (
          <div
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <Upload className="h-10 w-10 text-muted-foreground/60 mb-3" />
            <p className="text-sm font-semibold text-foreground">Drop ISO PDFs or a ZIP here</p>
            <p className="text-xs text-muted-foreground">…or click to browse</p>
          </div>
        )}

        {parsed.map((p, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border p-4 ${
              p.status === 'restored' ? 'border-success/40 bg-success/5'
              : p.status === 'error'   ? 'border-destructive/40 bg-destructive/5'
              : p.status === 'skipped' ? 'border-border bg-secondary/20 opacity-60'
              : 'border-border card-gradient'
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  {p.fileName.toLowerCase().endsWith('.zip')
                    ? <FileArchive className="h-4 w-4 text-primary" />
                    : <FileText className="h-4 w-4 text-primary" />
                  }
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{p.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.detectedTitle ? <>Detected: <span className="font-medium">{p.detectedTitle}</span></> : 'No title detected'}
                    {p.detectedClause ? <> · Clause {p.detectedClause}</> : null}
                    {' · '}{p.text.length.toLocaleString()} chars
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                {p.status === 'restored' && <CheckCircle2 className="h-5 w-5 text-success" />}
                {p.status === 'error' && <XCircle className="h-5 w-5 text-destructive" />}
              </div>
            </div>

            {p.status === 'error' && p.errorMessage && (
              <p className="text-xs text-destructive mb-2">{p.errorMessage}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-2">
              <label className="text-xs text-muted-foreground">Restore to:</label>
              <select
                className="bg-secondary text-sm rounded px-2 py-1 border border-border min-w-[260px]"
                value={p.matchedDocId ?? ''}
                onChange={(e) => setMatch(idx, e.target.value || null)}
                disabled={p.status === 'restored'}
              >
                <option value="">— choose document —</option>
                {ISO_DOCUMENTS.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.title} (Clause {d.clause}) {documents.find(x => x.id === d.id)?.status === 'complete' ? '· currently complete' : ''}
                  </option>
                ))}
              </select>
              {p.status !== 'restored' && p.status !== 'skipped' && (
                <>
                  <Button size="sm" className="gap-1.5 text-xs" disabled={!p.matchedDocId} onClick={() => restoreOne(idx)}>
                    Restore
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => skip(idx)}>Skip</Button>
                </>
              )}
            </div>

            {p.text && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">Preview extracted text</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-background/60 p-3 rounded border border-border text-[11px] leading-relaxed">{p.text.slice(0, 4000)}{p.text.length > 4000 ? '\n…(truncated)…' : ''}</pre>
              </details>
            )}
          </motion.div>
        ))}
      </main>
    </div>
  );
}
