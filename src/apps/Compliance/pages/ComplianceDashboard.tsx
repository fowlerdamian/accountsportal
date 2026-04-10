import { useNavigate } from 'react-router-dom';
import { useISO } from '../context/ISOContext';
import { useAuditAuth } from '../context/AuditAuthContext';
import { useActions } from '../context/ActionsContext';
import { motion } from 'framer-motion';
import {
  FileText, CheckCircle2, Clock, Circle, Shield, ArrowRight,
  AlertTriangle, X, FolderOpen, FolderArchive,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const categoryLabels = { plan: 'Plan', do: 'Do', check: 'Check', act: 'Act' };

const categoryColors = {
  plan: 'border-primary/40 bg-primary/5',
  do: 'border-accent bg-accent/30',
  check: 'border-success/40 bg-success/5',
  act: 'border-warning/40 bg-warning/5',
};

const statusConfig = {
  not_started: { icon: Circle, label: 'Not Started', className: 'text-muted-foreground' },
  in_progress:  { icon: Clock,        label: 'In Progress', className: 'text-primary' },
  complete:     { icon: CheckCircle2, label: 'Complete',    className: 'text-success' },
};

export default function ComplianceDashboard() {
  const { documents, completedCount, totalCount, auditResults, companyProfile } = useISO();
  const { isAdmin } = useAuditAuth();
  const { actions, closeAction, deleteAction } = useActions();
  const navigate = useNavigate();
  const overallProgress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const grouped = {
    plan:  documents.filter((d) => d.category === 'plan'),
    do:    documents.filter((d) => d.category === 'do'),
    check: documents.filter((d) => d.category === 'check'),
    act:   documents.filter((d) => d.category === 'act'),
  };

  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          {companyProfile?.logoUrl ? (
            <img src={companyProfile.logoUrl} alt="Logo" className="h-10 w-10 rounded-lg object-contain bg-secondary p-1" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-foreground">{companyProfile?.companyName || 'ISO 9001 QMS'}</h1>
            <p className="text-sm text-muted-foreground">ISO 9001:2015 QMS Documentation</p>
          </div>
        </div>

        {/* Overall progress */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 rounded-xl border border-border card-gradient p-6"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Overall Progress</h2>
            <span className="text-2xl font-bold text-gradient-gold">{overallProgress}%</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
          <p className="mt-2 text-sm text-muted-foreground">{completedCount} of {totalCount} documents completed</p>
          <div className="mt-4 flex gap-2 flex-wrap">
            {completedCount > 0 && (
              <Button variant="secondary" size="sm" onClick={() => navigate('audit')} className="gap-2">
                <Shield className="h-4 w-4" />
                {completedCount === totalCount ? 'Run Self-Audit' : 'Self-Audit (Preview)'}
              </Button>
            )}
            {completedCount > 0 && (
              <Button variant="secondary" size="sm" onClick={() => navigate('files')} className="gap-2">
                <FolderArchive className="h-4 w-4" />
                File Manager
              </Button>
            )}
            {isAdmin && (
              <Button variant="secondary" size="sm" onClick={() => navigate('profile')} className="gap-2">
                <Shield className="h-4 w-4" />
                Company Profile
              </Button>
            )}
          </div>
        </motion.div>

        {/* Document groups */}
        {(Object.keys(grouped) as Array<keyof typeof grouped>).map((cat, catIdx) => (
          <motion.section
            key={cat}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: catIdx * 0.1 }}
            className="mb-8"
          >
            <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              PDCA: {categoryLabels[cat]}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[cat].map((doc) => {
                const StatusIcon = statusConfig[doc.status].icon;
                return (
                  <button
                    key={doc.id}
                    onClick={() => navigate(`document/${doc.id}`)}
                    className={`group relative flex flex-col items-start rounded-xl border p-5 text-left transition-all hover:shadow-lg hover:border-primary/50 ${categoryColors[cat]}`}
                  >
                    <div className="flex w-full items-start justify-between mb-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                        <FileText className="h-4 w-4 text-foreground" />
                      </div>
                      <StatusIcon className={`h-5 w-5 ${statusConfig[doc.status].className}`} />
                    </div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">{doc.title}</h4>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{doc.description}</p>
                    <div className="mt-auto flex w-full items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">Clause {doc.clause}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                    </div>
                    {doc.status === 'in_progress' && (
                      <div className="mt-3 w-full">
                        <Progress value={doc.progress} className="h-1" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.section>
        ))}

        {/* Supporting Docs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mb-8"
        >
          <button
            onClick={() => navigate('supporting-docs')}
            className="group flex w-full items-center gap-4 rounded-xl border border-border/60 bg-secondary/30 p-5 text-left transition-all hover:border-primary/40 hover:bg-secondary/60"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-foreground">Supporting Documentation</h4>
              <p className="text-xs text-muted-foreground">Upload and manage evidence files required for your ISO certification audit</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
          </button>
        </motion.div>

        {/* Actions */}
        {actions.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mb-8"
          >
            <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              Action Items ({actions.filter((a) => a.status === 'open').length} open)
            </h3>
            <div className="space-y-2">
              {actions.map((action) => {
                const docTitle = documents.find((d) => d.id === action.document_id)?.title || action.document_id;
                return (
                  <div
                    key={action.id}
                    className={`rounded-xl border p-4 transition-all ${
                      action.status === 'open' ? 'border-warning/40 bg-warning/5' : 'border-border bg-muted/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            action.status === 'open' ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success'
                          }`}>
                            {action.status === 'open'
                              ? <><AlertTriangle className="h-3 w-3" /> Open</>
                              : <><CheckCircle2 className="h-3 w-3" /> Closed</>}
                          </span>
                          <span className="text-xs text-muted-foreground">{docTitle}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground mb-1">{action.question_text}</p>
                        <p className="text-xs text-muted-foreground mb-1"><span className="font-medium">Your answer:</span> {action.answer_text}</p>
                        <p className="text-xs text-warning">{action.ai_feedback}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {action.status === 'open' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 h-7 text-xs"
                              onClick={() => navigate(`document/${action.document_id}?reanswer=${action.question_index}&actionId=${action.id}`)}
                            >
                              <ArrowRight className="h-3 w-3" /> Re-answer
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 h-7 text-xs"
                              onClick={async () => { await closeAction(action.id); toast.success('Action item closed'); }}
                            >
                              <X className="h-3 w-3" /> Close
                            </Button>
                          </>
                        )}
                        {action.status === 'closed' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={async () => { await deleteAction(action.id); toast.success('Action item deleted'); }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.section>
        )}
      </main>
    </div>
  );
}
