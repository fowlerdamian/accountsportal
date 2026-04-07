import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { useGuideBySlug, useGuideStepsBySetId, useBrands, useGuideVehicles } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { BookOpen, Clock, Wrench, ChevronLeft, ChevronRight, Check, MessageCircle, Star, ArrowLeft, Loader2, Flag, X, Send, Car } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@guide/components/ui/sheet";
import { Textarea } from "@guide/components/ui/textarea";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { toast } from "sonner";

function generateSessionId() {
  return 'sess-' + Math.random().toString(36).substring(2, 10);
}

export default function GuideViewer() {
  const { slug } = useParams();
  const { data: guide, isLoading: loadingGuide } = useGuideBySlug(slug);
  const { data: guideSteps = [] } = useGuideStepsBySetId(guide?.id);
  const { data: brands = [] } = useBrands();
  const { data: vehicles = [] } = useGuideVehicles(guide?.id);

  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [flagStep, setFlagStep] = useState("");
  const [flagDesc, setFlagDesc] = useState("");
  const [feedbackTab, setFeedbackTab] = useState<'rate' | 'flag'>('rate');
  const [finished, setFinished] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [sessionId] = useState(() => {
    const stored = sessionStorage.getItem('guide-session-id');
    if (stored) return stored;
    const id = generateSessionId();
    sessionStorage.setItem('guide-session-id', id);
    return id;
  });

  const brand = brands[0];

  useEffect(() => {
    if (guide?.id) {
      const saved = localStorage.getItem(`guide-progress-${guide.id}`);
      if (saved) setCompletedSteps(new Set(JSON.parse(saved)));
    }
  }, [guide?.id]);

  useEffect(() => {
    if (guide?.id) {
      localStorage.setItem(`guide-progress-${guide.id}`, JSON.stringify([...completedSteps]));
    }
  }, [completedSteps, guide?.id]);

  if (loadingGuide) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!guide) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-4 px-6">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto">
            <BookOpen className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">This guide isn't available right now.</h1>
          <p className="text-muted-foreground text-sm">The guide may have been unpublished or the link is incorrect.</p>
          {brand && (
            <div className="text-sm text-muted-foreground space-y-1 mt-4">
              {brand.support_phone && <p>📞 {brand.support_phone}</p>}
              {brand.support_email && <p>✉️ {brand.support_email}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  const brandColour = brand?.primary_colour ?? '#F59E0B';
  const chatEnabled = (brand as any)?.chat_enabled ?? true;

  const markDone = (stepIndex: number) => {
    const newCompleted = new Set(completedSteps);
    const wasCompleted = newCompleted.has(stepIndex);

    if (wasCompleted) {
      newCompleted.delete(stepIndex);
      setCompletedSteps(newCompleted);
      return;
    }

    newCompleted.add(stepIndex);
    setCompletedSteps(newCompleted);

    if (brand) {
      supabase.from("step_views").insert({
        instruction_set_id: guide.id,
        brand_id: brand.id,
        session_id: sessionId,
        step_number: stepIndex + 1,
        completed: true,
      }).then(() => {});
    }

    if (stepIndex < guideSteps.length - 1) {
      setCurrentStep(stepIndex + 1);
    } else {
      setFinished(true);
    }
  };

  const submitRating = async (r: number) => {
    setRating(r);
    if (brand) {
      await supabase.from("feedback").insert({
        instruction_set_id: guide.id,
        brand_id: brand.id,
        session_id: sessionId,
        rating: r,
        comment: comment || null,
        type: 'rating' as const,
      });
    }
    toast.success("Thanks for your feedback!");
  };

  const submitComment = async () => {
    if (!comment.trim() || !brand) return;
    await supabase.from("feedback").insert({
      instruction_set_id: guide.id,
      brand_id: brand.id,
      session_id: sessionId,
      comment: comment.trim(),
      type: 'comment' as const,
    });
    setComment("");
    toast.success("Comment submitted!");
  };

  const submitFlag = async () => {
    if (!flagDesc.trim() || !brand) return;
    await supabase.from("feedback").insert({
      instruction_set_id: guide.id,
      brand_id: brand.id,
      session_id: sessionId,
      flagged_step: flagStep ? parseInt(flagStep) : null,
      comment: flagDesc.trim(),
      type: 'flag' as const,
    });
    setFlagStep("");
    setFlagDesc("");
    setFeedbackOpen(false);
    toast.success("Step flagged. Thank you!");
  };

  const submitSupport = async () => {
    if (!supportMessage.trim() || !brand) return;
    await supabase.from("support_questions").insert({
      instruction_set_id: guide.id,
      brand_id: brand.id,
      session_id: sessionId,
      step_number: currentStep !== null ? currentStep + 1 : null,
      question: supportMessage.trim(),
    });
    setSupportMessage("");
    setSupportOpen(false);
    toast.success("Question sent! We'll get back to you.");
  };

  const step = currentStep !== null ? guideSteps[currentStep] : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background border-b px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            {brand?.logo_url ? (
              <img src={brand.logo_url} alt={brand.name} className="h-8 object-contain" />
            ) : brand && (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ backgroundColor: brandColour + '20', color: brandColour }}>
                {brand.key === 'trailbait' ? 'TB' : 'AGA'}
              </div>
            )}
            {!finished && currentStep !== null && (
              <button onClick={() => setCurrentStep(null)} className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{guide.product_code}</span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* Overview */}
        {currentStep === null && !finished && (
          <div className="space-y-5 sm:space-y-6 animate-fade-in">
            <div className="w-full rounded-xl bg-muted flex items-center justify-center overflow-hidden">
              {guide.product_image_url ? (
                <img src={guide.product_image_url} alt={guide.title} className="w-full h-auto object-contain bg-white" />
              ) : (
                <BookOpen className="w-12 h-12 text-muted-foreground/30" />
              )}
            </div>

            <div>
              <h1 className="text-xl font-bold">{guide.title}</h1>
              <code className="text-xs text-muted-foreground">{guide.product_code}</code>
              <p className="text-sm text-muted-foreground mt-2">{guide.short_description}</p>
            </div>

            {/* Vehicle Fitment */}
            {vehicles.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h2 className="font-semibold text-sm flex items-center gap-1.5">
                  <Car className="w-4 h-4" /> Suits
                </h2>
                <div className="flex flex-wrap gap-2">
                  {vehicles.map((v, i) => (
                    <Badge key={i} variant="secondary" className="text-sm font-medium py-1.5 px-3">
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

            {completedSteps.size > 0 && (
              <div className="bg-muted rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Resume — Step {Math.max(...completedSteps) + 2}</p>
                  <p className="text-xs text-muted-foreground">{completedSteps.size} of {guideSteps.length} steps done</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setCompletedSteps(new Set()); setCurrentStep(0); }}>Start Over</Button>
                  <Button size="sm" onClick={() => setCurrentStep(Math.min(Math.max(...completedSteps) + 1, guideSteps.length - 1))} style={{ backgroundColor: brandColour }}>Resume</Button>
                </div>
              </div>
            )}

            <Button className="w-full py-6 text-base font-semibold" style={{ backgroundColor: brandColour }} onClick={() => setCurrentStep(0)}>
              Start Guide →
            </Button>
            <p className="text-center text-xs text-muted-foreground">{guideSteps.length} steps</p>
          </div>
        )}

        {/* Step View */}
        {currentStep !== null && step && !finished && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex gap-1">
              {guideSteps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  className="flex-1 h-2 rounded-full transition-colors"
                  style={{
                    backgroundColor: completedSteps.has(i) ? 'hsl(var(--success))' :
                      i === currentStep ? brandColour : 'hsl(var(--muted))'
                  }}
                />
              ))}
            </div>

            <div className={`rounded-xl border p-3 sm:p-5 space-y-4 transition-opacity ${completedSteps.has(currentStep) ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ backgroundColor: brandColour + '20', color: brandColour }}>
                  {step.step_number}
                </span>
                <h2 className="font-semibold text-sm sm:text-base">{step.subtitle}</h2>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line break-words">{step.description}</p>

              {/* Dual image support — stack on mobile */}
              {step.image_url && step.image2_url ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <img
                    src={step.image_url}
                    alt={`${step.subtitle} - 1`}
                    className="w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity bg-white"
                    onClick={() => setLightbox(step.image_url!)}
                  />
                  <img
                    src={step.image2_url}
                    alt={`${step.subtitle} - 2`}
                    className="w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity bg-white"
                    onClick={() => setLightbox(step.image2_url!)}
                  />
                </div>
              ) : step.image_url ? (
                <img
                  src={step.image_url}
                  alt={step.subtitle}
                  className="w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity bg-white"
                  onClick={() => setLightbox(step.image_url!)}
                />
              ) : (
                <div className="w-full aspect-video rounded-lg bg-muted flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">Step image</span>
                </div>
              )}
            </div>

            <Button
              className="w-full py-5 font-semibold"
              style={{ backgroundColor: completedSteps.has(currentStep) ? 'hsl(var(--success))' : brandColour }}
              onClick={() => markDone(currentStep)}
            >
              {completedSteps.has(currentStep) ? (
                <><Check className="w-4 h-4 mr-2" /> Done — Next Step</>
              ) : (
                <>✓ Mark as Done</>
              )}
            </Button>

            <div className="flex justify-between">
              <Button variant="ghost" size="sm" disabled={currentStep === 0} onClick={() => setCurrentStep(currentStep - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground self-center">{currentStep + 1} of {guideSteps.length}</span>
              <Button variant="ghost" size="sm" disabled={currentStep === guideSteps.length - 1} onClick={() => setCurrentStep(currentStep + 1)}>
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
            <p className="text-muted-foreground text-sm">Great work! Your {guide.title} has been installed successfully.</p>

            <div className="space-y-3">
              <p className="text-sm font-medium">How was this guide?</p>
              <div className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => submitRating(n)}>
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
                    className="text-sm"
                  />
                  {comment.trim() && (
                    <Button size="sm" variant="outline" onClick={submitComment}>Submit Comment</Button>
                  )}
                  <p className="text-xs text-muted-foreground">Thanks! Your feedback helps us improve.</p>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => { setFinished(false); setCurrentStep(null); setCompletedSteps(new Set()); setRating(0); }}>
                Start Over
              </Button>
              <Button variant="outline" onClick={() => { setFeedbackOpen(true); setFeedbackTab('flag'); }}>
                <Flag className="w-4 h-4 mr-2" /> Flag a Step
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightbox(null)}><X className="w-6 h-6" /></button>
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}

      {/* Floating support button */}
      {!finished && chatEnabled && (
        <Sheet open={supportOpen} onOpenChange={setSupportOpen}>
          <SheetTrigger asChild>
            <button className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40" style={{ backgroundColor: brandColour }}>
              <MessageCircle className="w-6 h-6 text-white" />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Need help?</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              {step && (
                <p className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                  You're on Step {step.step_number} — {step.subtitle}
                </p>
              )}
              <Textarea
                value={supportMessage}
                onChange={e => setSupportMessage(e.target.value)}
                placeholder={step ? `I'm stuck on Step ${step.step_number} — ${step.subtitle}. Can you help?` : "How can we help?"}
                rows={3}
              />
              <div className="flex gap-2">
                <Button className="flex-1" style={{ backgroundColor: brandColour }} onClick={submitSupport}>
                  <Send className="w-4 h-4 mr-2" /> Send Message
                </Button>
                <Button variant="outline" onClick={() => { setSupportOpen(false); setFeedbackOpen(true); setFeedbackTab('flag'); }}>
                  <Flag className="w-4 h-4 mr-2" /> Flag Step
                </Button>
              </div>
            </div>
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
              <Button variant={feedbackTab === 'rate' ? 'default' : 'outline'} size="sm" onClick={() => setFeedbackTab('rate')}>
                <Star className="w-4 h-4 mr-1" /> Rate
              </Button>
              <Button variant={feedbackTab === 'flag' ? 'default' : 'outline'} size="sm" onClick={() => setFeedbackTab('flag')}>
                <Flag className="w-4 h-4 mr-1" /> Flag a Step
              </Button>
            </div>

            {feedbackTab === 'rate' && (
              <div className="space-y-3">
                <div className="flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} onClick={() => setRating(n)}>
                      <Star className={`w-8 h-8 ${n <= rating ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`} />
                    </button>
                  ))}
                </div>
                <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Optional comment..." rows={2} />
                <Button className="w-full" style={{ backgroundColor: brandColour }} onClick={() => { submitRating(rating); setFeedbackOpen(false); }} disabled={rating === 0}>
                  Submit Rating
                </Button>
              </div>
            )}

            {feedbackTab === 'flag' && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Which step has an issue?</Label>
                  <Input value={flagStep} onChange={e => setFlagStep(e.target.value)} placeholder="e.g. 3" type="number" min="1" max={guideSteps.length} className="mt-1" />
                </div>
                <div>
                  <Label className="text-sm">What's the problem?</Label>
                  <Textarea value={flagDesc} onChange={e => setFlagDesc(e.target.value)} placeholder="Describe the issue..." rows={3} className="mt-1" />
                </div>
                <Button className="w-full" style={{ backgroundColor: brandColour }} onClick={submitFlag} disabled={!flagDesc.trim()}>
                  Submit Flag
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
