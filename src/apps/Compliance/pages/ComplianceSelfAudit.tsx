import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useISO } from '../contexts/ISOContext';
import { AuditResult } from '../lib/iso-documents';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Shield, CheckCircle2, XCircle, AlertTriangle, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auditSupabase } from '../client';
import { toast } from 'sonner';

export default function ComplianceSelfAudit() {
  const navigate = useNavigate();
  const { documents, auditResults, setAuditResults, updateDocument, companyProfile } = useISO();
  const [isAuditing, setIsAuditing] = useState(false);
  const [fixingIds, setFixingIds] = useState<Set<string>>(new Set());
  const [fixingDocIds, setFixingDocIds] = useState<Set<string>>(new Set());
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set());
  const [auditProgress, setAuditProgress] = useState({ current: 0, total: 0 });

  const completedDocs = documents.filter((d) => d.status === 'complete');
  const findingKey = (result: AuditResult, index: number) => `${result.documentId}-${index}`;

  const runAudit = async () => {
    setIsAuditing(true);
    setFixedIds(new Set());
    try {
      // Fetch supporting docs — non-critical, audit continues with empty data if it fails
      let supportingDocs: { document_id: string; title: string; status: string }[] = [];
      try {
        const { data } = await auditSupabase.from('supporting_docs').select('document_id, title, status');
        supportingDocs = data || [];
      } catch {
        // silently ignore — audit still runs without evidence status
      }

      const allDocTitles = documents.map((d) => d.title);

      const BATCH_SIZE = 3;
      const allResults: AuditResult[] = [];
      const batches: typeof completedDocs[] = [];
      for (let i = 0; i < completedDocs.length; i += BATCH_SIZE) batches.push(completedDocs.slice(i, i + BATCH_SIZE));

      setAuditProgress({ current: 0, total: completedDocs.length });

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      for (let b = 0; b < batches.length; b++) {
        const res = await fetch(`${supabaseUrl}/functions/v1/iso-audit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
          body: JSON.stringify({
            allDocTitles,
            documents: batches[b].map((d) => ({
              id: d.id, title: d.title, clause: d.clause, generatedContent: d.generatedContent,
              messages: d.messages.map((m) => ({ role: m.role, content: m.content })),
              requiredEvidence: supportingDocs
                .filter((sd) => sd.document_id === d.id)
                .map((sd) => ({ title: sd.title, uploaded: sd.status === 'uploaded' })),
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Audit request failed (${res.status})`);
        if (data?.error) throw new Error(data.error);
        allResults.push(...(data.results || []));
        setAuditProgress({ current: Math.min((b + 1) * BATCH_SIZE, completedDocs.length), total: completedDocs.length });
      }

      setAuditResults(allResults);
    } catch (e: any) {
      toast.error(e.message || 'Audit failed. Please try again.');
    } finally {
      setIsAuditing(false);
    }
  };

  const handleApplyFix = async (result: AuditResult, index: number) => {
    const doc = documents.find((d) => d.id === result.documentId);
    if (!doc?.generatedContent) { toast.error('Document content not found'); return; }

    const key = findingKey(result, index);
    setFixingIds((prev) => new Set(prev).add(key));
    setFixingDocIds((prev) => new Set(prev).add(result.documentId));
    try {
      const docFindings = auditResults
        ?.map((r, i) => ({ result: r, index: i }))
        .filter(({ result: r, index: i }) => r.documentId === result.documentId && r.status !== 'pass' && !fixedIds.has(findingKey(r, i))) || [];

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const fixRes = await fetch(`${supabaseUrl}/functions/v1/apply-audit-fix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({
          documentTitle: doc.title,
          clause: doc.clause,
          currentContent: doc.generatedContent,
          finding: docFindings.map(f => f.result.finding).join('\n\n'),
          recommendation: docFindings.map(f => f.result.recommendation).join('\n\n'),
          companyProfile,
        }),
      });
      const data = await fixRes.json();
      if (!fixRes.ok) throw new Error(data?.error || `Fix request failed (${fixRes.status})`);
      if (data?.error) throw new Error(data.error);

      if (data?.content) {
        let cleanContent = data.content;
        const fenceMatch = cleanContent.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
        if (fenceMatch) cleanContent = fenceMatch[1];

        updateDocument(doc.id, { generatedContent: cleanContent });
        const newFixed = new Set(fixedIds);
        docFindings.forEach(f => newFixed.add(findingKey(f.result, f.index)));
        setFixedIds(newFixed);
        toast.success(`${doc.title} updated with ${docFindings.length} fix(es)`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to apply fix');
    } finally {
      setFixingIds((prev) => { const next = new Set(prev); next.delete(key); return next; });
      setFixingDocIds((prev) => { const next = new Set(prev); next.delete(result.documentId); return next; });
    }
  };

  const handleApplyAllFixes = async () => {
    if (!auditResults) return;
    const docGroups = new Map<string, { result: AuditResult; index: number }[]>();
    auditResults.forEach((r, i) => {
      if (r.status !== 'pass' && !fixedIds.has(findingKey(r, i))) {
        const group = docGroups.get(r.documentId) || [];
        group.push({ result: r, index: i });
        docGroups.set(r.documentId, group);
      }
    });
    if (docGroups.size === 0) { toast.info('No fixes to apply'); return; }
    for (const [, findings] of docGroups) await handleApplyFix(findings[0].result, findings[0].index);
  };

  const passCount    = auditResults?.filter((r) => r.status === 'pass').length || 0;
  const failCount    = auditResults?.filter((r) => r.status === 'fail').length || 0;
  const obsCount     = auditResults?.filter((r) => r.status === 'observation').length || 0;
  const totalFindings = auditResults?.length || 0;
  const fixableCount = auditResults?.filter((r, i) => (r.status === 'fail' || r.status === 'observation') && !fixedIds.has(findingKey(r, i))).length || 0;

  const statusIcon = {
    pass:        <CheckCircle2 className="h-5 w-5 text-success" />,
    fail:        <XCircle className="h-5 w-5 text-destructive" />,
    observation: <AlertTriangle className="h-5 w-5 text-warning" />,
  };
  const statusBorder = {
    pass: 'border-success/30', fail: 'border-destructive/30', observation: 'border-warning/30',
  };

  return (
    <div className="min-h-full overflow-y-auto">
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Self-Audit Tool</h1>
              <p className="text-sm text-muted-foreground">AI-powered ISO 9001 compliance audit</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {completedDocs.length === 0 ? (
          <div className="rounded-xl border border-border card-gradient p-12 text-center">
            <Shield className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">No Documents to Audit</h2>
            <p className="text-muted-foreground mb-6">Complete at least one document to run the self-audit.</p>
            <Button onClick={() => navigate('/compliance')}>Go to Dashboard</Button>
          </div>
        ) : !auditResults && !isAuditing ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-8 text-center">
            <Shield className="mx-auto h-16 w-16 text-primary mb-6" />
            <h2 className="text-2xl font-bold text-foreground mb-3">Ready to Audit</h2>
            <p className="text-muted-foreground mb-2">{completedDocs.length} of {documents.length} documents will be audited.</p>
            <p className="text-sm text-muted-foreground mb-8">AI will thoroughly evaluate each document against ISO 9001:2015 requirements.</p>
            <Button onClick={runAudit} className="gap-2 px-8 py-6 text-lg font-bold glow-gold" size="lg">
              <Shield className="h-5 w-5" /> START AUDIT
            </Button>
          </motion.div>
        ) : isAuditing ? (
          <div className="rounded-xl border border-border card-gradient p-8 text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary mb-6" />
            <h2 className="text-xl font-bold text-foreground mb-4">AI Auditing in Progress...</h2>
            <p className="text-sm text-muted-foreground mb-3">Evaluating {completedDocs.length} documents against ISO 9001:2015</p>
            {auditProgress.total > 0 && (
              <p className="text-sm font-medium text-primary">{auditProgress.current} / {auditProgress.total} documents audited</p>
            )}
          </div>
        ) : auditResults ? (
          <div className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-6">
              <h2 className="text-lg font-bold text-foreground mb-4">Audit Summary — {totalFindings} finding{totalFindings !== 1 ? 's' : ''}</h2>
              {totalFindings === 0 ? (
                <div className="rounded-lg border border-success/30 bg-success/5 p-6 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-success mb-2" />
                  <p className="font-semibold text-foreground">No findings — all documents passed audit</p>
                  <p className="text-xs text-muted-foreground mt-1">Your QMS documentation meets ISO 9001:2015 requirements.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-center">
                    <AlertTriangle className="mx-auto h-6 w-6 text-warning mb-2" />
                    <p className="text-2xl font-bold text-foreground">{obsCount}</p>
                    <p className="text-xs text-muted-foreground">Observations</p>
                  </div>
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                    <XCircle className="mx-auto h-6 w-6 text-destructive mb-2" />
                    <p className="text-2xl font-bold text-foreground">{failCount}</p>
                    <p className="text-xs text-muted-foreground">Fail</p>
                  </div>
                </div>
              )}
            </motion.div>

            <AnimatePresence>
              {auditResults.map((result, i) => {
                const key = findingKey(result, i);
                const isFixing = fixingIds.has(key);
                const isDocFixing = fixingDocIds.has(result.documentId);
                const isFixed = fixedIds.has(key);
                const canFix = result.status !== 'pass' && !isFixed;
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`rounded-xl border p-5 ${statusBorder[result.status]} card-gradient`}
                  >
                    <div className="flex items-start gap-3">
                      {isFixed ? <CheckCircle2 className="h-5 w-5 text-success" /> : statusIcon[result.status]}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground">{result.documentTitle}</h3>
                          <span className="text-xs font-mono text-muted-foreground">Clause {result.clause}</span>
                          {isFixed && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success">
                              <CheckCircle2 className="h-3 w-3" /> Fixed
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{result.finding}</p>
                        <p className="text-sm text-primary"><strong>Recommendation:</strong> {result.recommendation}</p>
                        {isDocFixing && isFixing && (
                          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Rewriting document with all fixes — this takes ~60 seconds, please wait…
                          </p>
                        )}
                      </div>
                      {canFix && (
                        <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" disabled={isDocFixing} onClick={() => handleApplyFix(result, i)}>
                          {isDocFixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                          {isDocFixing ? 'Rewriting...' : 'Apply Fix'}
                        </Button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            <div className="flex gap-3">
              {fixableCount > 0 && (
                <Button onClick={handleApplyAllFixes} disabled={fixingIds.size > 0} className="gap-2 glow-gold">
                  {fixingIds.size > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                  Apply All Fixes ({fixableCount})
                </Button>
              )}
              <Button onClick={() => { setAuditResults(null); setFixedIds(new Set()); }} variant="secondary">Re-run Audit</Button>
              <Button onClick={() => navigate('/compliance')}>Back to Dashboard</Button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
