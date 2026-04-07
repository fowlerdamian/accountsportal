import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { CaseType, ErrorOrigin } from '@/lib/types';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { CustomerReferenceLink } from '@/components/CustomerReferenceLink';
import { DuplicateCaseWarning } from '@/components/DuplicateCaseWarning';
import { notifyNewCase } from '@/lib/notifyGoogleChat';
import { CASE_TYPE_LABELS } from '@/lib/types';

type Step = 1 | 2 | 3;

interface Cin7Order {
  found: boolean;
  SaleID: string;
  SaleOrderNumber: string | null;
  Customer: string | null;
  OrderDate: string | null;
  CustomerReference: string | null;
  Total: number | null;
  LineCount: number | null;
}

interface TileConfig {
  value: string;
  label: string;
  description: string;
  type: CaseType;
  errorOrigin: ErrorOrigin;
  badge?: string;
  accent: string;
  char: string;
}

const issueTiles: TileConfig[] = [
  { value: 'warranty_claim', label: 'Warranty Claim', description: 'Product failed or not fit for purpose within warranty period', type: 'warranty_claim', errorOrigin: null, accent: '#C0392B', char: 'W' },
  { value: 'order_entry', label: 'Order Entry Error', description: 'Wrong item or quantity entered on the order before dispatch', type: 'order_error', errorOrigin: 'order_entry', badge: 'Order error', accent: '#D4860A', char: 'O' },
  { value: 'warehouse', label: 'Warehouse Error', description: 'Correct item on the order but wrong thing picked or packed', type: 'order_error', errorOrigin: 'warehouse', badge: 'Order error', accent: '#6B3FA0', char: 'W' },
  { value: 'freight_issue', label: 'Freight Issue', description: 'Damaged, lost, or delayed in transit', type: 'freight_issue', errorOrigin: null, accent: '#1A6FA8', char: 'F' },
  { value: 'complaint', label: 'Complaint', description: 'Customer dissatisfied with product, service, or experience', type: 'complaint', errorOrigin: null, accent: '#D4860A', char: 'C' },
  { value: 'general', label: 'General', description: 'Other enquiry not covered above', type: 'general', errorOrigin: null, accent: '#5A5A5A', char: 'G' },
];

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount: number | null): string {
  if (amount === null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(amount);
}

export default function NewCasePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [selectedTile, setSelectedTile] = useState<string>('');
  const [issueType, setIssueType] = useState<CaseType | ''>('');
  const [errorOrigin, setErrorOrigin] = useState<ErrorOrigin>(null);
  const [orderInput, setOrderInput] = useState('');
  const [description, setDescription] = useState('');
  const [direction, setDirection] = useState(1);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cin7 lookup state
  const [lookedUpOrder, setLookedUpOrder] = useState<Cin7Order | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);
  const [manualOrderNumber, setManualOrderNumber] = useState('');

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 100 : -100, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -100 : 100, opacity: 0 }),
  };

  const goNext = () => { setDirection(1); setStep(s => Math.min(3, s + 1) as Step); };
  const goBack = () => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    setDirection(-1);
    setStep(s => Math.max(1, s - 1) as Step);
  };

  const autoAdvance = () => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = setTimeout(() => goNext(), 300);
  };

  const handleTileClick = (tile: TileConfig) => {
    setSelectedTile(tile.value);
    setIssueType(tile.type);
    setErrorOrigin(tile.errorOrigin);
    autoAdvance();
  };

  const getDbType = (): CaseType => {
    return issueType as CaseType;
  };

  const getTitle = (): string => {
    const tile = issueTiles.find(t => t.value === selectedTile);
    const typeLabel = tile?.label || 'Case';
    const orderNum = lookedUpOrder?.SaleOrderNumber || manualOrderNumber || null;
    const custName = lookedUpOrder?.Customer || null;
    const parts = [typeLabel];
    if (orderNum) parts.push(orderNum);
    if (custName) parts.push(custName);
    return parts.join(' — ');
  };

  const handleStep2Next = async () => {
    const trimmed = orderInput.trim();
    // If no order input or already looked up or manual fallback, just proceed
    if (!trimmed || lookedUpOrder || manualFallback) {
      goNext();
      return;
    }
    // Try lookup
    setIsLookingUp(true);
    setLookupError(null);
    setLookedUpOrder(null);
    try {
      const { data, error } = await supabase.functions.invoke('cin7-get-order', {
        body: { orderNumber: trimmed },
      });
      if (error) throw error;
      if (data.error) throw new Error('API error');
      if (!data.found) {
        setLookupError(trimmed);
      } else {
        setLookedUpOrder(data as Cin7Order);
        // Auto-advance after successful lookup
        setDirection(1);
        setTimeout(() => setStep(3), 400);
      }
    } catch (err) {
      console.error('Order lookup failed:', err);
      setLookupError(trimmed);
    } finally {
      setIsLookingUp(false);
    }
  };

  const clearOrder = () => {
    setLookedUpOrder(null);
    setLookupError(null);
    setOrderInput('');
    setManualFallback(false);
    setManualOrderNumber('');
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const purchaseDate = lookedUpOrder?.OrderDate
        ? new Date(lookedUpOrder.OrderDate).toISOString().split('T')[0]
        : null;

      const { data, error } = await supabase
        .from('cases')
        .insert({
          user_id: user!.id,
          type: getDbType(),
          error_origin: issueType === 'order_error' ? errorOrigin : null,
          title: getTitle(),
          description: description || null,
          order_number: lookedUpOrder?.SaleOrderNumber || manualOrderNumber || null,
          cin7_order_number: lookedUpOrder?.SaleOrderNumber || null,
          cin7_sale_id: lookedUpOrder?.SaleID || null,
          customer_reference: lookedUpOrder?.CustomerReference || null,
          customer_name: lookedUpOrder?.Customer || null,
          product_name: null,
          purchase_date: purchaseDate,
        } as any)
        .select('case_number, id')
        .maybeSingle();
      if (error) throw error;

      // Google Chat notification — fire & forget
      if (data) {
        notifyNewCase({
          caseId: data.id,
          caseNumber: data.case_number,
          caseTitle: getTitle(),
          caseType: CASE_TYPE_LABELS[getDbType()] || getDbType(),
          errorOrigin: issueType === 'order_error' ? errorOrigin : null,
          orderNumber: lookedUpOrder?.SaleOrderNumber || manualOrderNumber || null,
          customerName: lookedUpOrder?.Customer || null,
        });
      }

      return { caseNumber: data?.case_number, id: data?.id };
    },
    onSuccess: (result) => {
      toast.success('Case created');
      if (result?.id) {
        navigate(`/support/cases/${result.id}`);
      } else {
        navigate('/support');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <button onClick={() => navigate('/support')} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[28px] font-heading font-bold uppercase text-foreground">NEW CASE</h2>
        <span className="text-xs text-[hsl(0,0%,35%)]">Step {step} of 3</span>
      </div>
      <p className="text-sm text-muted-foreground mb-8">What type of issue is this?</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn('h-6 w-6 flex items-center justify-center text-xs font-medium border', s <= step ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border')}>
              {s}
            </div>
            {s < 3 && <div className={cn('w-8 h-px', s < step ? 'bg-foreground' : 'bg-border')} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait" custom={direction}>
        {step === 1 && (
          <motion.div key="step1" custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6" style={{ alignItems: 'stretch' }}>
              {issueTiles.map(tile => {
                const isSelected = selectedTile === tile.value;
                return (
                  <button
                    key={tile.value}
                    onClick={() => handleTileClick(tile)}
                    className="group relative text-left cursor-pointer"
                    style={{
                      padding: '24px',
                      borderRadius: '2px',
                      minHeight: '100px',
                      border: isSelected
                        ? `1px solid ${tile.accent}`
                        : '1px solid hsl(0,0%,16.5%)',
                      borderTop: isSelected
                        ? `3px solid ${tile.accent}`
                        : `3px solid ${tile.accent}`,
                      background: isSelected
                        ? `${tile.accent}33`
                        : '#141414',
                      transform: isSelected ? 'scale(0.98)' : undefined,
                      transition: 'all 200ms ease',
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) {
                        const el = e.currentTarget;
                        el.style.background = `${tile.accent}1F`;
                        el.style.border = `1px solid ${tile.accent}80`;
                        el.style.borderTop = `3px solid ${tile.accent}`;
                        el.style.boxShadow = `0 0 0 1px ${tile.accent}33`;
                        el.style.transform = 'scale(1.02)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) {
                        const el = e.currentTarget;
                        el.style.background = '#141414';
                        el.style.border = '1px solid hsl(0,0%,16.5%)';
                        el.style.borderTop = `3px solid ${tile.accent}`;
                        el.style.boxShadow = 'none';
                        el.style.transform = 'scale(1)';
                      }
                    }}
                  >
                    {/* Badge — visible at rest, fades on hover */}
                    {tile.badge && (
                      <span
                        className="absolute top-3 right-3 text-[9px] uppercase tracking-wide text-[hsl(0,0%,35%)] border border-border bg-[hsl(0,0%,12%)] px-1.5 py-0.5 transition-opacity duration-200 group-hover:opacity-0"
                        style={{ borderRadius: '2px' }}
                      >
                        {tile.badge}
                      </span>
                    )}

                    {/* Large character — fades in on hover */}
                    <span
                      className="absolute top-3 right-4 font-heading font-bold text-[48px] leading-none pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-[0.06]"
                      style={{ color: tile.accent }}
                    >
                      {tile.char}
                    </span>

                    <span
                      className="text-[18px] font-heading font-bold uppercase tracking-wide block mb-1.5 transition-colors duration-200"
                      style={{ color: isSelected ? '#fff' : undefined }}
                    >
                      <span className="text-foreground group-hover:text-current" style={{ '--tw-text-opacity': 1, color: isSelected ? '#fff' : undefined } as any}>
                        <span className="group-hover:hidden">{tile.label}</span>
                        <span className="hidden group-hover:inline" style={{ color: tile.accent }}>{tile.label}</span>
                      </span>
                    </span>
                    <span
                      className="text-[13px] leading-snug block transition-colors duration-200"
                      style={{ color: isSelected ? `${tile.accent}B3` : 'hsl(0,0%,60%)', marginTop: '6px' }}
                    >
                      <span className="group-hover:hidden">{tile.description}</span>
                      <span className="hidden group-hover:inline" style={{ color: `${tile.accent}B3` }}>{tile.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button onClick={() => navigate('/support')} className="px-5 py-2.5 text-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
              Cancel
            </button>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step2" custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <label className="text-sm text-muted-foreground mb-2 block">Sales order number</label>

            {!lookedUpOrder && !manualFallback && (
              <>
                <input
                  type="text"
                  value={orderInput}
                  onChange={e => { setOrderInput(e.target.value); setLookupError(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleStep2Next(); }}
                  placeholder="e.g. SO-00123"
                  disabled={isLookingUp}
                  className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors mb-2"
                />

                {lookupError && (
                  <div className="mb-4">
                    <p className="text-sm text-destructive mb-1">
                      We couldn't find order <span className="font-medium">{lookupError}</span>. Check the number and try again.
                    </p>
                    <button
                      onClick={() => { setManualFallback(true); setManualOrderNumber(orderInput); setLookupError(null); }}
                      className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      Continue without a sales order
                    </button>
                  </div>
                )}
              </>
            )}

            {lookedUpOrder && (
              <div className="mb-4">
                <div className="border-l-2 border-foreground bg-card p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Check className="h-4 w-4 text-status-resolved shrink-0" />
                    <span className="text-sm font-medium text-foreground">{lookedUpOrder.SaleOrderNumber ?? '—'}</span>
                  </div>
                  <p className="text-sm text-muted-foreground ml-6">{lookedUpOrder.Customer ?? '—'}</p>
                  <div className="flex items-center gap-2 ml-6 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {lookedUpOrder.OrderDate ? formatDate(lookedUpOrder.OrderDate) : '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{formatCurrency(lookedUpOrder.Total)}</span>
                  </div>
                  {lookedUpOrder.CustomerReference && (
                    <p className="text-xs text-muted-foreground ml-6 mt-1">Customer ref: <CustomerReferenceLink reference={lookedUpOrder.CustomerReference} className="text-xs" /></p>
                  )}
                  {lookedUpOrder.LineCount != null && (
                    <p className="text-xs text-muted-foreground ml-6 mt-1">{lookedUpOrder.LineCount} line item{lookedUpOrder.LineCount !== 1 ? 's' : ''}</p>
                  )}
                </div>
                <button onClick={clearOrder} className="text-xs text-muted-foreground hover:text-foreground mt-2 underline transition-colors">
                  Not the right order? Clear
                </button>
              </div>
            )}

            {manualFallback && (
              <div className="mb-4">
                <p className="text-sm text-muted-foreground mb-2">Continuing without a linked sales order.</p>
                <button onClick={clearOrder} className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                  Try looking up again
                </button>
              </div>
            )}

            <p className="text-sm text-muted-foreground mb-2 mt-4">Describe the problem</p>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none mb-1"
              placeholder="What went wrong?"
            />
            <p className="text-xs text-muted-foreground mb-4">{description.length}/500</p>

            <div className="flex gap-3">
              <button onClick={goBack} className="px-5 py-2.5 text-sm border border-foreground text-foreground hover:bg-surface-elevated transition-colors">Back</button>
              <button
                onClick={handleStep2Next}
                disabled={isLookingUp}
                className={cn(
                  'flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity',
                  isLookingUp && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isLookingUp ? <><Loader2 className="h-4 w-4 animate-spin" /> Looking up...</> : <>Next <ArrowRight className="h-4 w-4" /></>}
              </button>
              {!lookedUpOrder && !manualFallback && !lookupError && orderInput.trim() === '' && (
                <button
                  onClick={() => { setManualFallback(true); goNext(); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline transition-colors self-center"
                >
                  Skip — no sales order
                </button>
              )}
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step3" custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <p className="text-sm text-muted-foreground mb-4">Review & submit</p>
            <div className="bg-card border border-border p-5 mb-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Type</span>
                <span className="text-foreground">{issueTiles.find(t => t.value === selectedTile)?.label || issueType}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Order</span>
                <span className="text-foreground">{lookedUpOrder?.SaleOrderNumber || manualOrderNumber || 'Not specified'}</span>
              </div>
              {lookedUpOrder && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Customer</span>
                    <span className="text-foreground">{lookedUpOrder.Customer ?? '—'}</span>
                  </div>
                  {lookedUpOrder.OrderDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Order date</span>
                      <span className="text-foreground">{formatDate(lookedUpOrder.OrderDate)}</span>
                    </div>
                  )}
                  {lookedUpOrder.CustomerReference && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Customer reference</span>
                      <CustomerReferenceLink reference={lookedUpOrder.CustomerReference} className="text-foreground text-sm" />
                    </div>
                  )}
                </>
              )}
              {description && (
                <div className="text-sm">
                  <span className="text-muted-foreground block mb-1">Description</span>
                  <span className="text-foreground">{description}</span>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={goBack} className="px-5 py-2.5 text-sm border border-foreground text-foreground hover:bg-surface-elevated transition-colors">Back</button>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitMutation.isPending ? 'Submitting...' : 'Submit case'} <Check className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
