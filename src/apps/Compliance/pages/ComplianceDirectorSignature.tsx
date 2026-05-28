import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useISO } from '../contexts/ISOContext';
import { motion } from 'framer-motion';
import { ArrowLeft, PenLine, RotateCcw, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import SignatureCanvas from 'react-signature-canvas';

export default function ComplianceDirectorSignature() {
  const navigate = useNavigate();
  const { companyProfile, directorSignature, setDirectorSignature } = useISO();
  const sigPadRef = useRef<SignatureCanvas>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const directorName = companyProfile?.contactName || 'Director';
  const directorTitle = companyProfile?.contactTitle || 'Director';

  const handleEnd = () => {
    const dataUrl = sigPadRef.current?.toDataURL('image/png') ?? null;
    setDraft(dataUrl);
  };

  const handleClear = () => {
    sigPadRef.current?.clear();
    setDraft(null);
  };

  const handleSave = () => {
    if (!draft) { toast.error('Draw your signature first'); return; }
    setDirectorSignature(draft);
    setDraft(null);
    toast.success('Signature saved');
  };

  const handleRemove = () => {
    setDirectorSignature(null);
    setDraft(null);
    sigPadRef.current?.clear();
    toast.success('Signature removed');
  };

  return (
    <div className="min-h-full overflow-y-auto">
      <header className="border-b border-border px-6 py-4 sticky top-0 bg-background/80 backdrop-blur z-10">
        <div className="mx-auto max-w-3xl flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-bold text-foreground flex items-center gap-2">
              <PenLine className="h-4 w-4 text-primary" /> Director Signature
            </h1>
            <p className="text-xs text-muted-foreground">Appears on all generated ISO documents</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border card-gradient p-6"
        >
          <div className="mb-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Signing as</p>
            <p className="text-lg font-bold text-foreground">{directorName}</p>
            <p className="text-sm text-muted-foreground">{directorTitle}</p>
          </div>

          {directorSignature && !draft && (
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Current Signature</p>
              <div className="rounded-xl border border-border bg-white p-4 flex items-center justify-center">
                <img src={directorSignature} alt="Director signature" className="max-h-32" />
              </div>
              <Button variant="ghost" size="sm" className="mt-2 gap-1.5 text-destructive hover:text-destructive" onClick={handleRemove}>
                <Trash2 className="h-3.5 w-3.5" /> Remove signature
              </Button>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              {directorSignature ? 'Replace Signature' : 'Draw Signature'}
            </p>
            <div className="rounded-xl border border-border bg-white overflow-hidden">
              <SignatureCanvas
                ref={sigPadRef}
                penColor="#1a1a2e"
                canvasProps={{ className: 'w-full', height: 200, style: { width: '100%', display: 'block' } }}
                onEnd={handleEnd}
              />
            </div>

            <div className="flex items-center justify-between mt-3">
              {draft
                ? <span className="text-xs text-success flex items-center gap-1"><PenLine className="h-3 w-3" /> Ready to save</span>
                : <span className="text-xs text-muted-foreground">Sign in the box above with your mouse or touch screen</span>
              }
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={handleClear}>
                  <RotateCcw className="h-3 w-3" /> Clear
                </Button>
                <Button type="button" size="sm" className="gap-1.5 text-xs glow-gold" disabled={!draft} onClick={handleSave}>
                  <Check className="h-3 w-3" /> Save signature
                </Button>
              </div>
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
