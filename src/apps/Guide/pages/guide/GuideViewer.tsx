import { useParams, useSearchParams } from "react-router-dom";
import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { useGuideBySlug, useGuideStepsBySetId, useGuideVariants, useBrands, useGuideVehicles } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import type { Tables } from "@guide/integrations/supabase/types";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Clock, Wrench, ChevronLeft, ChevronRight, Check, Star, ArrowLeft, Loader2, Flag, X, Send, Car, Zap, Phone } from "lucide-react";
import { BookIcon, MessageCircleIcon, LayersIcon } from "@portal/components/icons";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@guide/components/ui/sheet";
import { Textarea } from "@guide/components/ui/textarea";
import { Label } from "@guide/components/ui/label";
import { Toaster } from "@guide/components/ui/sonner";
import { toast } from "sonner";
import { notifyGuideComment, notifyGuideFlag, notifySupportQuestion } from "@guide/lib/notifyGoogleChat";
import { Input } from "@guide/components/ui/input";
import { safeLocal, safeSession } from "@guide/lib/safeStorage";
import { GuideErrorBoundary } from "@guide/components/ui/GuideErrorBoundary";

type Brand = Tables<"brands">;
type Step = Tables<"instruction_steps">;
type Submitting = null | "rating" | "comment" | "flag" | "support";

function generateSessionId() {
  return 'sess-' + Math.random().toString(36).substring(2, 10);
}

// Which brand is this visitor looking at? The viewer is served on each brand's
// own guide subdomain, so the hostname is authoritative; AGA is the fallback
// for the staff portal / local dev, then whatever is first.
function resolveBrand(brands: Brand[]): Brand | undefined {
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  return brands.find(b => b.domain === host) ?? brands.find(b => b.key === 'aga') ?? brands[0];
}

function brandInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
}

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

const isDividerStep = (s: Step | undefined) => !!(s && (s as any).is_divider);

// Guides opened this page load — backstop for when sessionStorage is unavailable.
const openedThisLoad = new Set<string>();

function SupportContact({ brand, className = "" }: { brand: Brand | undefined; className?: string }) {
  if (!brand || (!brand.support_phone && !brand.support_email)) return null;
  return (
    <div className={`text-sm text-muted-foreground space-y-1.5 ${className}`}>
      {brand.support_phone && (
        <p>
          <a href={telHref(brand.support_phone)} className="inline-flex items-center gap-1.5 min-h-[44px] font-medium text-foreground underline underline-offset-4">
            <Phone className="w-4 h-4" /> Call us on {brand.support_phone}
          </a>
        </p>
      )}
      {brand.support_email && (
        <p>
          <a href={`mailto:${brand.support_email}`} className="inline-flex items-center min-h-[44px] underline underline-offset-4">
            {brand.support_email}
          </a>
        </p>
      )}
    </div>
  );
}

function UnavailableCard({ brand, title, body }: { brand: Brand | undefined; title: string; body: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="text-center space-y-4 px-6 max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto">
          <BookIcon className="w-8 h-8 text-primary-foreground" />
        </div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-muted-foreground text-sm">{body}</p>
        <SupportContact brand={brand} className="mt-4" />
      </div>
    </div>
  );
}

export default function GuideViewer() {
  const { data: brands = [] } = useBrands();
  const brand = useMemo(() => resolveBrand(brands), [brands]);

  return (
    <>
      <Toaster position="top-center" richColors />
      <GuideErrorBoundary
        fallback={
          <UnavailableCard
            brand={brand}
            title="This guide isn't available right now."
            body="Something went wrong while showing this guide. Please reload the page, or get in touch and we'll help you out."
          />
        }
      >
        <GuideViewerInner brand={brand} />
      </GuideErrorBoundary>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// URL ↔ navigation state. `?v=<variantId|standard>&step=<n|done>` mirrors the
// customer's position so the phone back button steps back through the guide
// instead of leaving it, and a refresh lands on the same step.
// ─────────────────────────────────────────────────────────────────────────────
type VariantChoice = string | null | undefined;

function navSerial(variant: VariantChoice, stepIdx: number | null, finished: boolean) {
  const p = new URLSearchParams();
  if (variant !== undefined) p.set('v', variant ?? 'standard');
  if (finished) p.set('step', 'done');
  else if (stepIdx !== null) p.set('step', String(stepIdx + 1));
  return p.toString();
}

function parseNav(p: URLSearchParams) {
  const v = p.get('v');
  const s = p.get('step');
  const variant: VariantChoice = v === null ? undefined : v === 'standard' ? null : v;
  const finished = s === 'done';
  const n = s && !finished ? parseInt(s, 10) : NaN;
  const stepIdx = Number.isFinite(n) && n >= 1 ? n - 1 : null;
  return { variant, stepIdx, finished };
}

function GuideViewerInner({ brand }: { brand: Brand | undefined }) {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const guideQuery = useGuideBySlug(slug);
  const guide = guideQuery.data ?? null;
  const loadingGuide = !!slug && guideQuery.isLoading;

  const variantsQuery = useGuideVariants(guide?.id);
  const variants = variantsQuery.data ?? [];
  const variantsLoaded = variantsQuery.isSuccess || variantsQuery.isError;

  // undefined = not chosen yet (show picker); null = Standard; string = a variant id
  const [selectedVariantId, setSelectedVariantId] = useState<VariantChoice>(undefined);
  const stepsQuery = useGuideStepsBySetId(guide?.id, selectedVariantId);
  const guideSteps: Step[] = stepsQuery.data ?? [];
  const stepsLoaded = stepsQuery.isSuccess || stepsQuery.isError;
  const stepsError = stepsQuery.error;
  const { data: vehicles = [] } = useGuideVehicles(guide?.id);

  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  // Progress is stored as completed step *ids* so editing/reordering steps in
  // the admin never shifts a customer's ticks onto the wrong step.
  const [progress, setProgress] = useState<{ key: string | null; ids: Set<string> }>(() => ({ key: null, ids: new Set() }));
  const completedIds = progress.ids;
  const [openNotice, setOpenNotice] = useState<number | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  // Contact details are asked for AFTER the question is sent, so nothing stands
  // between the customer and hitting Send. Remembered per device.
  type Contact = { name?: string; email?: string; phone?: string };
  const remembered = () => safeLocal.getJSON<Contact>('guide-contact') ?? {};
  const [supportName, setSupportName] = useState(() => remembered().name ?? "");
  const [supportEmail, setSupportEmail] = useState(() => remembered().email ?? "");
  const [supportPhone, setSupportPhone] = useState(() => remembered().phone ?? "");
  // id of the question just sent — while set, the sheet shows the contact step
  const [supportSentId, setSupportSentId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [flagStep, setFlagStep] = useState("");
  const [flagDesc, setFlagDesc] = useState("");
  const [feedbackTab, setFeedbackTab] = useState<'rate' | 'flag'>('rate');
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [submitting, setSubmitting] = useState<Submitting>(null);
  const ratingRowRef = useRef<Promise<string | null> | null>(null);
  const [sessionId] = useState(() => {
    const stored = safeSession.get('guide-session-id');
    if (stored) return stored;
    const id = generateSessionId();
    safeSession.set('guide-session-id', id);
    return id;
  });

  useEffect(() => {
    document.title = guide?.title ? `${guide.title} | Product Guide` : 'Product Guide';
    return () => { document.title = 'Staff Portal'; };
  }, [guide?.title]);

  const variantKey = selectedVariantId ?? 'standard';
  const progressKey = guide?.id ? `guide-progress-${guide.id}-${variantKey}` : null;

  // Load progress for this guide+variant. Older builds stored numeric indexes;
  // those are ignored (only string ids survive) rather than mis-applied.
  useEffect(() => {
    if (!progressKey) return;
    const saved = safeLocal.getJSON<unknown>(progressKey);
    const ids = Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : [];
    setProgress({ key: progressKey, ids: new Set(ids) });
  }, [progressKey]);

  // Persist — only once the set in memory belongs to the current key.
  useEffect(() => {
    if (!progressKey || progress.key !== progressKey) return;
    safeLocal.set(progressKey, JSON.stringify([...progress.ids]));
  }, [progress, progressKey]);

  const setCompletedIds = (next: Set<string>) => setProgress(p => ({ ...p, ids: next }));

  // ── URL sync ──────────────────────────────────────────────────────────────
  // URL → state is applied *during render* (the "adjust state on prop change"
  // pattern) so navigation state never lags the address bar — on mount, on
  // back/forward, and under StrictMode's double effects.
  const urlNav = parseNav(searchParams);
  const urlSerial = navSerial(urlNav.variant, urlNav.stepIdx, urlNav.finished);
  const [appliedUrl, setAppliedUrl] = useState<string | null>(null);
  if (appliedUrl !== urlSerial) {
    setAppliedUrl(urlSerial);
    setSelectedVariantId(urlNav.variant);
    setCurrentStep(urlNav.stepIdx);
    setFinished(urlNav.finished);
  }

  // State → URL: push a history entry for every navigation the customer makes,
  // so the phone back button steps back through the guide.
  useEffect(() => {
    const serial = navSerial(selectedVariantId, currentStep, finished);
    if (serial === urlSerial) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('v');
      next.delete('step');
      new URLSearchParams(serial).forEach((val, key) => next.set(key, val));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariantId, currentStep, finished, urlSerial]);

  // A variant id from the URL that no longer exists → back to the picker.
  useEffect(() => {
    if (!variantsLoaded) return;
    if (typeof selectedVariantId === 'string' && !variants.some(v => v.id === selectedVariantId)) {
      setSelectedVariantId(undefined);
    }
  }, [variantsLoaded, variants, selectedVariantId]);

  // Step index outside the loaded steps (edited guide, stale URL) → overview.
  useEffect(() => {
    if (!stepsLoaded) return;
    if (currentStep !== null && !guideSteps[currentStep]) setCurrentStep(null);
  }, [stepsLoaded, guideSteps, currentStep]);

  // Fresh screen on every step change and on the finish screen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    setOpenNotice(null);
  }, [currentStep, finished]);

  // Warm the next step's images so the tap-through feels instant.
  useEffect(() => {
    if (currentStep === null) return;
    const next = guideSteps[currentStep + 1];
    if (!next) return;
    [next.image_url, next.image2_url].forEach(url => {
      if (url) { const img = new Image(); img.decoding = 'async'; img.src = url; }
    });
  }, [currentStep, guideSteps]);

  // Escape closes the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // "Guide opened" — one row per session+guide so drop-off before step 1 is
  // measurable in reports. step_number 0, completed false.
  useEffect(() => {
    if (!guide?.id || !brand) return;
    const key = `guide-opened-${guide.id}`;
    if (openedThisLoad.has(key) || safeSession.get(key)) return;
    openedThisLoad.add(key);
    safeSession.set(key, '1');
    supabase.from("step_views").insert({
      instruction_set_id: guide.id,
      brand_id: brand.id,
      session_id: sessionId,
      step_number: 0,
      completed: false,
    }).then(({ error }) => {
      if (error) console.warn('[guide] step_views open insert failed:', error.message);
    });
  }, [guide?.id, brand, sessionId]);

  if (loadingGuide) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!guide) {
    return (
      <UnavailableCard
        brand={brand}
        title="This guide isn't available right now."
        body="The guide may have been unpublished or the link is incorrect."
      />
    );
  }

  const brandColour = brand?.primary_colour ?? '#F59E0B';
  const chatEnabled = brand?.chat_enabled ?? true;
  const supportHint = brand?.support_phone ? ` If it keeps happening, call us on ${brand.support_phone}.` : '';
  const reportError = (what: string) => toast.error(`Couldn't send your ${what}.${supportHint}`);

  // When a guide has variants, make the customer pick one before the overview.
  const needsVariantChoice = variants.length > 0 && selectedVariantId === undefined;
  const selectedVariantLabel = selectedVariantId
    ? variants.find(v => v.id === selectedVariantId)?.variant_label
    : (guide.default_variant_label || 'Standard');

  // Wiring-break dividers are not "real" steps — they sit between groups of
  // bracket-only and wiring instructions. They're excluded from the count, the
  // progress bar, the completion total and every step number we record.
  const realSteps = guideSteps.filter(s => !isDividerStep(s));
  const realStepCount = realSteps.length;
  const realStepIndexOf = (fullIndex: number) =>
    guideSteps.slice(0, fullIndex + 1).filter(s => !isDividerStep(s)).length - 1;
  const completedRealCount = realSteps.filter(s => completedIds.has(s.id)).length;
  const firstIncompleteFullIndex = guideSteps.findIndex(s => !isDividerStep(s) && !completedIds.has(s.id));

  const step = currentStep !== null ? guideSteps[currentStep] : undefined;
  const isDivider = isDividerStep(step);
  const currentRealIndex = step && !isDivider ? realStepIndexOf(currentStep!) : -1;
  // The one step number shown to the customer and written to every table.
  const displayStepNumber = currentRealIndex + 1; // 0 when no real step is showing
  const isCurrentDone = !!(step && completedIds.has(step.id));

  // Reached the end: finish only when everything is ticked, otherwise jump to
  // the first step still open and say so.
  const finishOrJump = (ids: Set<string>) => {
    const done = realSteps.filter(s => ids.has(s.id)).length;
    if (done >= realStepCount) { setFinished(true); return; }
    const idx = guideSteps.findIndex(s => !isDividerStep(s) && !ids.has(s.id));
    setCurrentStep(idx >= 0 ? idx : null);
    // Set after the scroll effect clears it — deferred to the next tick.
    const open = realStepCount - done;
    setTimeout(() => setOpenNotice(open), 0);
  };

  const advanceFrom = (fullIndex: number, ids: Set<string>) => {
    if (fullIndex < guideSteps.length - 1) setCurrentStep(fullIndex + 1);
    else finishOrJump(ids);
  };

  const markDone = (fullIndex: number) => {
    const s = guideSteps[fullIndex];
    if (!s || isDividerStep(s)) return;

    // Already ticked → just move on (Undo is a separate control).
    if (completedIds.has(s.id)) { advanceFrom(fullIndex, completedIds); return; }

    const next = new Set(completedIds);
    next.add(s.id);
    setCompletedIds(next);

    if (brand) {
      supabase.from("step_views").insert({
        instruction_set_id: guide.id,
        brand_id: brand.id,
        session_id: sessionId,
        step_number: realStepIndexOf(fullIndex) + 1,
        variant_id: selectedVariantId ?? null,
        completed: true,
      }).then(({ error }) => {
        if (error) console.warn('[guide] step_views insert failed:', error.message);
      });
    }

    advanceFrom(fullIndex, next);
  };

  const undoDone = (fullIndex: number) => {
    const s = guideSteps[fullIndex];
    if (!s) return;
    const next = new Set(completedIds);
    next.delete(s.id);
    setCompletedIds(next);
  };

  // One feedback row per session for the rating: the first tap inserts and
  // remembers the id (as a promise, so rapid taps chain instead of racing);
  // every later tap updates that row.
  const persistRating = async (r: number): Promise<boolean> => {
    if (!brand) return false;
    const trimmed = comment.trim();
    if (!ratingRowRef.current) {
      ratingRowRef.current = (async () => {
        // Client-generated id: anon has no SELECT policy, so INSERT … RETURNING
        // would be rejected. Later star taps update this row by id.
        const id = crypto.randomUUID();
        const { error } = await supabase.from("feedback").insert({
          id,
          instruction_set_id: guide.id,
          brand_id: brand.id,
          session_id: sessionId,
          rating: r,
          comment: trimmed || null,
          type: 'rating' as const,
          variant_id: selectedVariantId ?? null,
        });
        if (error) { ratingRowRef.current = null; return null; }
        return id;
      })();
      return !!(await ratingRowRef.current);
    }
    const id = await ratingRowRef.current;
    if (!id) { ratingRowRef.current = null; return persistRating(r); }
    // Anonymous customers can't UPDATE feedback directly (no SELECT policy);
    // update_guide_rating is a narrow RPC that only touches this fresh rating row.
    const { data: changed, error } = await supabase.rpc("update_guide_rating", { p_id: id, p_rating: r, p_comment: trimmed || null });
    return !error && changed !== false;
  };

  const submitRating = async (r: number) => {
    setRating(r);
    if (!brand) return;
    setSubmitting('rating');
    const ok = await persistRating(r);
    setSubmitting(null);
    if (!ok) { reportError('rating'); return; }
    const trimmed = comment.trim();
    // Only ping chat when the user actually wrote something — bare ratings are noise.
    if (trimmed && guide.title) notifyGuideComment({ guideTitle: guide.title, comment: trimmed, rating: r });
    toast.success("Thanks for your feedback!");
  };

  const submitComment = async () => {
    const trimmed = comment.trim();
    if (!trimmed || !brand || submitting) return;
    setSubmitting('comment');
    const { error } = await supabase.from("feedback").insert({
      instruction_set_id: guide.id,
      brand_id: brand.id,
      session_id: sessionId,
      comment: trimmed,
      type: 'comment' as const,
      variant_id: selectedVariantId ?? null,
    });
    setSubmitting(null);
    if (error) { reportError('comment'); return; }
    if (guide.title) notifyGuideComment({ guideTitle: guide.title, comment: trimmed });
    setComment("");
    toast.success("Comment submitted!");
  };

  const openFlag = () => {
    setFlagStep(displayStepNumber > 0 ? String(displayStepNumber) : "");
    setFeedbackTab('flag');
    setSupportOpen(false);
    setFeedbackOpen(true);
  };

  const submitFlag = async () => {
    const trimmed = flagDesc.trim();
    if (!trimmed || !brand || submitting) return;
    const stepNo = flagStep ? parseInt(flagStep, 10) : NaN;
    const flagged = Number.isFinite(stepNo) && stepNo >= 1 ? stepNo : null;
    setSubmitting('flag');
    const { error } = await supabase.from("feedback").insert({
      instruction_set_id: guide.id,
      brand_id: brand.id,
      session_id: sessionId,
      flagged_step: flagged,
      comment: trimmed,
      type: 'flag' as const,
      variant_id: selectedVariantId ?? null,
    });
    setSubmitting(null);
    if (error) { reportError('flag'); return; }
    if (guide.title) notifyGuideFlag({ guideTitle: guide.title, stepNumber: flagged, description: trimmed });
    setFlagStep("");
    setFlagDesc("");
    setFeedbackOpen(false);
    toast.success("Step flagged. Thank you!");
  };

  const emailLooksValid = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
  const submitSupport = async () => {
    const trimmed = supportMessage.trim();
    if (!trimmed || !brand || submitting) return;
    setSubmitting('support');
    const questionId = crypto.randomUUID(); // no RETURNING for anon — see persistRating
    const { error } = await supabase.from("support_questions").insert({
      id: questionId,
      instruction_set_id: guide.id,
      brand_id: brand.id,
      session_id: sessionId,
      step_number: displayStepNumber > 0 ? displayStepNumber : null,
      step_title: step && !isDivider ? (step.subtitle ?? null) : null,
      question: trimmed,
    });
    setSubmitting(null);
    if (error) { reportError('message'); return; }
    notifySupportQuestion(questionId);
    setSupportMessage("");
    setSupportSentId(questionId); // → contact step
  };

  // Step 2 of the sheet: attach an email or phone to the question just sent.
  const submitSupportContact = async () => {
    if (!supportSentId || submitting) return;
    const email = supportEmail.trim(), phone = supportPhone.trim(), name = supportName.trim();
    if (!email && !phone) { toast.error("Add an email or a phone number so we can reply."); return; }
    if (email && !emailLooksValid(email)) { toast.error("That email address doesn't look right."); return; }
    setSubmitting('support');
    const { data: ok, error } = await supabase.rpc("set_support_contact", { p_id: supportSentId, p_email: email || null, p_phone: phone || null, p_name: name || null });
    setSubmitting(null);
    if (error || ok === false) { reportError('contact details'); return; }
    safeLocal.set('guide-contact', JSON.stringify({ name, email, phone }));
    setSupportSentId(null);
    setSupportOpen(false);
    toast.success(email ? `Thanks — we'll reply to ${email}.` : `Thanks — we'll call you on ${phone}.`);
  };
  const skipSupportContact = () => {
    setSupportSentId(null);
    setSupportOpen(false);
    toast.success(`Sent — we'll do our best to help.${brand?.support_phone ? ` For anything urgent call ${brand.support_phone}.` : ""}`);
  };

  const openLightbox = (src: string, alt: string) => setLightbox({ src, alt });

  const stepImage = (src: string, alt: string, extraClass = "") => (
    <button
      type="button"
      onClick={() => openLightbox(src, alt)}
      aria-label={`Enlarge image: ${alt}`}
      className={`block w-full rounded-lg bg-muted overflow-hidden hover:opacity-90 transition-opacity ${extraClass}`}
    >
      <img src={src} alt={alt} decoding="async" className="w-full h-auto object-contain bg-white" />
    </button>
  );

  const productImage = (
    <div className="w-full rounded-xl bg-muted flex items-center justify-center overflow-hidden">
      {guide.product_image_url ? (
        <img src={guide.product_image_url} alt={guide.title} decoding="async" className="w-full max-h-64 sm:max-h-80 object-contain bg-white" />
      ) : (
        <BookIcon className="w-12 h-12 text-muted-foreground/30 my-10" />
      )}
    </div>
  );

  const showOverview = !needsVariantChoice && currentStep === null && !finished;
  const showStepView = !needsVariantChoice && currentStep !== null && !finished;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background border-b px-4 py-2">
        <div className="max-w-2xl mx-auto flex items-center justify-between min-h-[44px]">
          <div className="flex items-center gap-1">
            {!finished && currentStep !== null && (
              <button
                type="button"
                onClick={() => setCurrentStep(null)}
                aria-label="Back to guide overview"
                className="w-11 h-11 -ml-3 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            {brand?.logo_url ? (
              <img src={brand.logo_url} alt={brand.name} decoding="async" className="h-8 object-contain" />
            ) : brand && (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ backgroundColor: brandColour + '20', color: brandColour }} aria-label={brand.name}>
                {brandInitials(brand.name)}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{guide.product_code}</span>
        </div>
      </header>

      {/* pb-28 keeps the floating support button clear of Next / Mark done */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-28">
        {/* Variants still loading — don't show an overview the customer could start from */}
        {!variantsLoaded && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        )}

        {/* Variant selection — shown first when the guide has variants */}
        {variantsLoaded && needsVariantChoice && !finished && (
          <div className="space-y-5 sm:space-y-6 animate-fade-in">
            {productImage}

            <div>
              <h1 className="text-xl font-bold">{guide.title}</h1>
              <code className="text-xs text-muted-foreground">{guide.product_code}</code>
            </div>

            <div className="space-y-2">
              <h2 className="font-semibold text-sm flex items-center gap-1.5">
                <LayersIcon className="w-4 h-4" /> Choose your version
              </h2>
              <p className="text-sm text-muted-foreground">Select the option that matches your product to see the right instructions.</p>
            </div>

            <div className="space-y-2.5">
              {/* Base variant is always available — it uses the guide's base steps */}
              <button
                type="button"
                onClick={() => setSelectedVariantId(null)}
                className="w-full flex items-center justify-between gap-3 rounded-xl border p-4 text-left hover:border-primary hover:bg-muted/40 transition-colors"
              >
                <p className="font-semibold text-sm">{guide.default_variant_label || 'Standard'}</p>
                <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </button>

              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVariantId(v.id)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border p-4 text-left hover:border-primary hover:bg-muted/40 transition-colors"
                >
                  <p className="font-semibold text-sm">{v.variant_label}</p>
                  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Overview */}
        {variantsLoaded && showOverview && (
          <div className="space-y-5 sm:space-y-6 animate-fade-in">
            {variants.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  Version: <span className="font-medium text-foreground">{selectedVariantLabel}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => { setSelectedVariantId(undefined); setCurrentStep(null); }}
                >
                  Change
                </Button>
              </div>
            )}
            {productImage}

            <div>
              <h1 className="text-xl font-bold">{guide.title}</h1>
              <code className="text-xs text-muted-foreground">{guide.product_code}</code>
              {guide.short_description && <p className="text-base text-muted-foreground mt-2">{guide.short_description}</p>}
            </div>

            {/* Vehicle Fitment */}
            {vehicles.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h2 className="font-semibold text-sm flex items-center gap-1.5">
                  <Car className="w-4 h-4" /> Suits
                </h2>
                <div className="flex flex-wrap gap-2">
                  {vehicles.map((v) => (
                    <Badge key={v.id} variant="secondary" className="text-sm font-medium py-1.5 px-3">
                      {v.make} {v.model} ({v.year_from}–{v.year_to === 0 || !v.year_to ? 'Current' : v.year_to})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {guide.notice_text && (
              <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-sm text-warning">
                ⚠️ {guide.notice_text}
              </div>
            )}

            {guide.estimated_time && (
              <Badge variant="secondary" className="gap-1.5 py-1 px-3">
                <Clock className="w-3.5 h-3.5" />
                {guide.estimated_time}
              </Badge>
            )}

            {guide.tools_required && guide.tools_required.length > 0 && (
              <div className="space-y-2">
                <h2 className="font-semibold text-sm">Tools Required</h2>
                <ul className="space-y-1.5">
                  {guide.tools_required.map((tool, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wrench className="w-3.5 h-3.5 shrink-0" />
                      {tool}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {stepsLoaded && realStepCount > 0 && completedRealCount > 0 && (
              <div className="bg-muted rounded-lg p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {firstIncompleteFullIndex >= 0
                      ? `Resume — Step ${realStepIndexOf(firstIncompleteFullIndex) + 1}`
                      : 'All steps done'}
                  </p>
                  <p className="text-xs text-muted-foreground">{completedRealCount} of {realStepCount} steps done</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="h-10" onClick={() => { setCompletedIds(new Set()); setCurrentStep(0); }}>Start Over</Button>
                  <Button
                    size="sm"
                    className="h-10"
                    style={{ backgroundColor: brandColour }}
                    onClick={() => {
                      if (firstIncompleteFullIndex >= 0) setCurrentStep(firstIncompleteFullIndex);
                      else setFinished(true);
                    }}
                  >
                    {firstIncompleteFullIndex >= 0 ? 'Resume' : 'Finish'}
                  </Button>
                </div>
              </div>
            )}

            {stepsLoaded && (stepsError || realStepCount === 0) ? (
              <div className="rounded-xl border p-5 text-center space-y-2">
                <p className="font-semibold">
                  {stepsError ? "We couldn't load the steps for this guide." : "This guide has no steps yet."}
                </p>
                <p className="text-sm text-muted-foreground">
                  {stepsError
                    ? "Please check your connection and reload the page."
                    : "We're still putting the instructions together. Please check back soon, or get in touch and we'll help you out."}
                </p>
                <SupportContact brand={brand} className="pt-2 flex flex-col items-center" />
              </div>
            ) : (
              <>
                <Button
                  className="w-full py-6 text-base font-semibold"
                  style={{ backgroundColor: brandColour }}
                  disabled={!stepsLoaded}
                  onClick={() => setCurrentStep(0)}
                >
                  {stepsLoaded ? 'Start Guide →' : <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading steps…</>}
                </Button>
                {stepsLoaded && (
                  <p className="text-center text-xs text-muted-foreground">
                    {realStepCount} steps
                    {guideSteps.some(s => isDividerStep(s)) && " · includes wiring instructions"}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Step View */}
        {showStepView && !stepsLoaded && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        )}
        {showStepView && stepsLoaded && step && (
          <div className="space-y-6 animate-fade-in">
            {/* Progress bar — one segment per real step, dividers excluded */}
            <div className="flex gap-1 h-11 -my-3 items-center" role="list" aria-label={`Progress: ${completedRealCount} of ${realStepCount} steps done`}>
              {realSteps.map((realStep, ri) => {
                const fullIndex = guideSteps.indexOf(realStep);
                const done = completedIds.has(realStep.id);
                const current = fullIndex === currentStep;
                return (
                  <button
                    key={realStep.id}
                    type="button"
                    role="listitem"
                    onClick={() => setCurrentStep(fullIndex)}
                    aria-label={`Go to step ${ri + 1}${done ? ' (done)' : ''}`}
                    aria-current={current ? 'step' : undefined}
                    className="flex-1 h-11 flex items-center"
                  >
                    <span
                      className="block w-full h-2 rounded-full transition-colors"
                      style={{
                        backgroundColor: done ? 'hsl(var(--success))' : current ? brandColour : 'hsl(var(--muted))',
                      }}
                    />
                  </button>
                );
              })}
            </div>

            {openNotice !== null && openNotice > 0 && (
              <div className="rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-sm text-warning" role="status">
                {openNotice} {openNotice === 1 ? 'step is' : 'steps are'} still open — we've brought you to the first one.
              </div>
            )}

            {isDivider ? (
              /* Wiring-break interstitial — full-card "Continue" prompt */
              <div className="rounded-xl border-2 border-[rgba(var(--brand-accent-rgb),0.4)] bg-[rgba(var(--brand-accent-rgb),0.05)] p-5 sm:p-7 space-y-5 text-center">
                {step.image_url ? (
                  stepImage(step.image_url, step.subtitle, "max-w-xs mx-auto")
                ) : (
                  <div className="w-12 h-12 mx-auto rounded-full bg-[rgba(var(--brand-accent-rgb),0.15)] flex items-center justify-center">
                    <Zap className="w-6 h-6 text-[var(--brand-orange)] dark:text-[var(--brand-orange)]" />
                  </div>
                )}
                <div className="space-y-2">
                  <h2 className="text-lg sm:text-xl font-bold">{step.subtitle}</h2>
                  <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-line">
                    {step.description}
                  </p>
                </div>
                <Button
                  className="w-full py-5 font-semibold"
                  style={{ backgroundColor: brandColour }}
                  onClick={() => {
                    // Skip past the divider — don't count it toward completion.
                    if (currentStep < guideSteps.length - 1) setCurrentStep(currentStep + 1);
                    else finishOrJump(completedIds);
                  }}
                >
                  Continue to Wiring <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            ) : (
              <div className={`rounded-xl border p-3 sm:p-5 space-y-4 transition-opacity ${isCurrentDone ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ backgroundColor: brandColour + '20', color: brandColour }}>
                    {displayStepNumber}
                  </span>
                  <h2 className="text-base font-semibold pt-1.5 sm:pt-2">{step.subtitle}</h2>
                </div>

                <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-line break-words">{step.description}</p>

                {/* Dual image support — stack on mobile */}
                {step.image_url && step.image2_url ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {stepImage(step.image_url, `${step.subtitle} — image 1`)}
                    {stepImage(step.image2_url, `${step.subtitle} — image 2`)}
                  </div>
                ) : step.image_url ? (
                  stepImage(step.image_url, step.subtitle)
                ) : (
                  <div className="w-full aspect-video rounded-lg bg-muted flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">Step image</span>
                  </div>
                )}
              </div>
            )}

            {!isDivider && (
              <div className="space-y-2">
                <Button
                  className="w-full py-5 font-semibold"
                  style={{ backgroundColor: isCurrentDone ? 'hsl(var(--success))' : brandColour }}
                  onClick={() => markDone(currentStep)}
                >
                  {isCurrentDone ? (
                    <><Check className="w-4 h-4 mr-2" /> Done — Next Step</>
                  ) : (
                    <>✓ Mark as Done</>
                  )}
                </Button>
                {isCurrentDone && (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => undoDone(currentStep)}
                      className="inline-flex items-center min-h-[44px] px-3 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Undo — mark step {displayStepNumber} as not done
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" size="sm" className="h-11" disabled={currentStep === 0} onClick={() => setCurrentStep(currentStep - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground self-center">
                {isDivider ? "Wiring instructions" : `${displayStepNumber} of ${realStepCount}`}
              </span>
              <Button variant="ghost" size="sm" className="h-11" disabled={currentStep === guideSteps.length - 1} onClick={() => setCurrentStep(currentStep + 1)}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Finished */}
        {finished && (
          <div className="text-center space-y-6 py-12 animate-fade-in">
            <div className="text-5xl">✅</div>
            <h1 className="text-2xl font-bold">Installation Complete!</h1>
            <p className="text-muted-foreground text-base">Great work! Your {guide.title} has been installed successfully.</p>

            <div className="space-y-3">
              <p className="text-sm font-medium">How was this guide?</p>
              <div className="flex justify-center" role="group" aria-label="Rate this guide">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => submitRating(n)}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    aria-pressed={n <= rating}
                    className="w-11 h-11 flex items-center justify-center"
                  >
                    <Star className={`w-8 h-8 ${n <= rating ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`} />
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <div className="space-y-2 max-w-sm mx-auto">
                  <Textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Any comments? (optional)"
                    rows={2}
                  />
                  {comment.trim() && (
                    <Button size="sm" variant="outline" className="h-10" onClick={submitComment} disabled={submitting === 'comment'}>
                      {submitting === 'comment' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : 'Submit Comment'}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">Thanks! Your feedback helps us improve.</p>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-center">
              <Button variant="outline" className="h-11" onClick={() => { setFinished(false); setCurrentStep(null); setCompletedIds(new Set()); setRating(0); }}>
                Start Over
              </Button>
              <Button variant="outline" className="h-11" onClick={openFlag}>
                <Flag className="w-4 h-4 mr-2" /> Flag a Step
              </Button>
            </div>

            {brand?.support_phone && (
              <div className="pt-2">
                <p className="text-sm text-muted-foreground">Need a hand?</p>
                <SupportContact brand={{ ...brand, support_email: null }} className="flex flex-col items-center" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            type="button"
            aria-label="Close image"
            className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center rounded-full bg-black/40 text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            decoding="async"
            className="max-w-full max-h-full object-contain"
            style={{ touchAction: 'pinch-zoom' }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Floating support button */}
      {!finished && chatEnabled && (
        <Sheet open={supportOpen} onOpenChange={(v) => { setSupportOpen(v); if (!v && supportSentId) setSupportSentId(null); }}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Need help? Message support"
              className="fixed right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40"
              style={{ backgroundColor: brandColour, bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
            >
              <MessageCircleIcon className="w-6 h-6 text-white" />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto rounded-t-2xl">
            {supportSentId ? (
              <>
                <SheetHeader>
                  <SheetTitle>Message sent — how should we reply?</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-muted-foreground">Leave an email or phone number and we'll get back to you, usually the same business day.</p>
                  <Input value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="Email" type="email" inputMode="email" autoComplete="email" aria-label="Your email" className="h-11 text-base md:text-sm" />
                  <Input value={supportPhone} onChange={e => setSupportPhone(e.target.value)} placeholder="Phone" type="tel" inputMode="tel" autoComplete="tel" aria-label="Your phone" className="h-11 text-base md:text-sm" />
                  <Input value={supportName} onChange={e => setSupportName(e.target.value)} placeholder="Your name (optional)" autoComplete="name" aria-label="Your name" className="h-11 text-base md:text-sm" />
                  <div className="flex gap-2">
                    <Button className="flex-1 h-11" style={{ backgroundColor: brandColour }} onClick={submitSupportContact} disabled={submitting === 'support' || (!supportEmail.trim() && !supportPhone.trim())}>
                      {submitting === 'support' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : <><Check className="w-4 h-4 mr-2" /> Save contact details</>}
                    </Button>
                    <Button variant="outline" className="h-11" onClick={skipSupportContact}>No thanks</Button>
                  </div>
                </div>
              </>
            ) : (
              <>
            <SheetHeader>
              <SheetTitle>Need help?</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              {step && !isDivider && (
                <p className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                  You're on Step {displayStepNumber} — {step.subtitle}
                </p>
              )}
              <Textarea
                value={supportMessage}
                onChange={e => setSupportMessage(e.target.value)}
                placeholder={step && !isDivider ? `I'm stuck on Step ${displayStepNumber} — ${step.subtitle}. Can you help?` : "How can we help?"}
                rows={4}
              />
              <div className="flex gap-2">
                <Button className="flex-1 h-11" style={{ backgroundColor: brandColour }} onClick={submitSupport} disabled={!supportMessage.trim() || submitting === 'support'}>
                  {submitting === 'support'
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                    : <><Send className="w-4 h-4 mr-2" /> Send Message</>}
                </Button>
                <Button variant="outline" className="h-11" onClick={openFlag}>
                  <Flag className="w-4 h-4 mr-2" /> Flag Step
                </Button>
              </div>
              {brand?.support_phone && (
                <p className="text-sm text-muted-foreground">
                  Prefer to talk?{' '}
                  <a href={telHref(brand.support_phone)} className="inline-flex items-center gap-1 min-h-[44px] font-medium text-foreground underline underline-offset-4">
                    <Phone className="w-4 h-4" /> Call us on {brand.support_phone}
                  </a>
                </p>
              )}
            </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* Feedback bottom sheet */}
      <Sheet open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Feedback</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <Button variant={feedbackTab === 'rate' ? 'default' : 'outline'} size="sm" className="h-10" onClick={() => setFeedbackTab('rate')}>
                <Star className="w-4 h-4 mr-1" /> Rate
              </Button>
              <Button variant={feedbackTab === 'flag' ? 'default' : 'outline'} size="sm" className="h-10" onClick={() => { if (!flagStep && displayStepNumber > 0) setFlagStep(String(displayStepNumber)); setFeedbackTab('flag'); }}>
                <Flag className="w-4 h-4 mr-1" /> Flag a Step
              </Button>
            </div>

            {feedbackTab === 'rate' && (
              <div className="space-y-3">
                <div className="flex justify-center" role="group" aria-label="Rate this guide">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      aria-pressed={n <= rating}
                      className="w-11 h-11 flex items-center justify-center"
                    >
                      <Star className={`w-8 h-8 ${n <= rating ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`} />
                    </button>
                  ))}
                </div>
                <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Optional comment..." rows={2} />
                <Button
                  className="w-full h-11"
                  style={{ backgroundColor: brandColour }}
                  onClick={async () => { await submitRating(rating); setFeedbackOpen(false); }}
                  disabled={rating === 0 || submitting === 'rating'}
                >
                  {submitting === 'rating' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : 'Submit Rating'}
                </Button>
              </div>
            )}

            {feedbackTab === 'flag' && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="flag-step" className="text-sm">Which step has an issue?</Label>
                  <select
                    id="flag-step"
                    value={flagStep}
                    onChange={e => setFlagStep(e.target.value)}
                    className="mt-1 flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Not sure / general</option>
                    {realSteps.map((s, ri) => (
                      <option key={s.id} value={String(ri + 1)}>
                        Step {ri + 1} — {s.subtitle}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="flag-desc" className="text-sm">What's the problem?</Label>
                  <Textarea id="flag-desc" value={flagDesc} onChange={e => setFlagDesc(e.target.value)} placeholder="Describe the issue..." rows={3} className="mt-1" />
                </div>
                <Button className="w-full h-11" style={{ backgroundColor: brandColour }} onClick={submitFlag} disabled={!flagDesc.trim() || submitting === 'flag'}>
                  {submitting === 'flag' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : 'Submit Flag'}
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
