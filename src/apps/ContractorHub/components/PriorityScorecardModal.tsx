import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";

interface Question {
  id:          string;
  label:       string;
  description: string;
  lowLabel:    string;
  highLabel:   string;
  weight:      number;
}

const QUESTIONS: Question[] = [
  {
    id:          "market_size",
    label:       "Market Size",
    description: "How large is the potential customer base for this product or project?",
    lowLabel:    "Very niche — < 1,000 buyers",
    highLabel:   "Mass market — global reach",
    weight:      0.18,
  },
  {
    id:          "npd_ease",
    label:       "Ease of Development",
    description: "How straightforward is the product development or project execution?",
    lowLabel:    "Highly complex / novel engineering",
    highLabel:   "Simple / well-understood process",
    weight:      0.14,
  },
  {
    id:          "expected_volume",
    label:       "Expected Volume",
    description: "What are the expected annual unit sales or usage scale?",
    lowLabel:    "< 10 units / year",
    highLabel:   "> 500 units / year",
    weight:      0.18,
  },
  {
    id:          "profit_margin",
    label:       "Profit Margin",
    description: "What is the expected gross profit margin on this project?",
    lowLabel:    "< 5% margin",
    highLabel:   "> 50% margin",
    weight:      0.18,
  },
  {
    id:          "retail_price",
    label:       "Estimated Retail Price",
    description: "What is the expected retail selling price per unit?",
    lowLabel:    "< $25",
    highLabel:   "> $2,000",
    weight:      0.10,
  },
  {
    id:          "time_to_market",
    label:       "Time to Market",
    description: "How quickly can this be launched or delivered?",
    lowLabel:    "> 18 months away",
    highLabel:   "< 3 months away",
    weight:      0.08,
  },
  {
    id:          "strategic_fit",
    label:       "Strategic Fit",
    description: "How well does this align with your core capabilities and business strategy?",
    lowLabel:    "Major pivot from core business",
    highLabel:   "Perfect fit with core competency",
    weight:      0.09,
  },
  {
    id:          "competitive_edge",
    label:       "Competitive Advantage",
    description: "How differentiated is this from existing alternatives in the market?",
    lowLabel:    "Commodity / easily replicated",
    highLabel:   "Unique, patented, or first-mover",
    weight:      0.05,
  },
];

function computeScore(ratings: Record<string, number>): number {
  const raw = QUESTIONS.reduce((sum, q) => sum + (ratings[q.id] ?? 5) * q.weight, 0);
  return Math.round(raw * 10) / 10;
}

interface PriorityScorecardModalProps {
  open:       boolean;
  onClose:    () => void;
  onComplete: (score: number) => void;
}

export function PriorityScorecardModal({ open, onClose, onComplete }: PriorityScorecardModalProps) {
  const [step,    setStep]    = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const isResults      = step === QUESTIONS.length;
  const isLastQuestion = step === QUESTIONS.length - 1;
  const current        = QUESTIONS[step];
  const score          = computeScore(ratings);
  const currentRating  = current ? ratings[current.id] : undefined;

  function reset() {
    setStep(0);
    setRatings({});
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleUseScore() {
    onComplete(Math.round(score));
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Priority Scorecard</DialogTitle>
        </DialogHeader>

        {!isResults ? (
          <div className="space-y-5 mt-2">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Question {step + 1} of {QUESTIONS.length}</span>
                <span>{Math.round(((step + 1) / QUESTIONS.length) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Question text */}
            <div className="space-y-0.5">
              <p className="text-sm font-semibold">{current.label}</p>
              <p className="text-sm text-muted-foreground">{current.description}</p>
            </div>

            {/* 1–10 buttons */}
            <div className="space-y-2">
              <div className="flex gap-1.5">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRatings(prev => ({ ...prev, [current.id]: n }))}
                    className={[
                      "flex-1 h-10 rounded-md text-sm font-semibold border transition-all",
                      currentRating === n
                        ? n >= 8 ? "bg-green-500 text-white border-green-500 scale-110"
                          : n >= 5 ? "bg-amber-500 text-white border-amber-500 scale-110"
                          : "bg-red-500 text-white border-red-500 scale-110"
                        : "border-border text-muted-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground px-0.5">
                <span>{current.lowLabel}</span>
                <span className="text-right">{current.highLabel}</span>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep(s => s - 1)}
                disabled={step === 0}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!currentRating}
                onClick={() => {
                  if (isLastQuestion) setStep(QUESTIONS.length);
                  else setStep(s => s + 1);
                }}
              >
                {isLastQuestion ? "See Score" : "Next"} <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        ) : (
          /* Results screen */
          <div className="space-y-5 mt-2">
            <div className="flex flex-col items-center gap-1.5 py-2">
              <CheckCircle2 className={`w-8 h-8 ${score >= 8 ? "text-green-500" : score >= 5 ? "text-amber-500" : "text-red-500"}`} />
              <p className="text-4xl font-bold tabular-nums">{score.toFixed(1)}<span className="text-lg text-muted-foreground font-normal"> / 10</span></p>
              <p className="text-sm text-muted-foreground text-center">
                {score >= 8 ? "High priority — strong business case"
                  : score >= 5 ? "Medium priority — worth pursuing with review"
                  : "Lower priority — consider deferring or rethinking"}
              </p>
            </div>

            {/* Breakdown */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score Breakdown</p>
              {QUESTIONS.map(q => {
                const r = ratings[q.id] ?? 0;
                return (
                  <div key={q.id} className="flex items-center gap-2 text-xs">
                    <span className="w-40 text-muted-foreground shrink-0 truncate">{q.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${r >= 8 ? "bg-green-500" : r >= 5 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${r * 10}%` }}
                      />
                    </div>
                    <span className="w-4 text-right font-semibold">{r}</span>
                    <span className="text-muted-foreground w-10 text-right">{Math.round(q.weight * 100)}% wt</span>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(0)}>
                Retake
              </Button>
              <Button type="button" className="flex-1" onClick={handleUseScore}>
                Use Score ({Math.round(score)}/10)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
