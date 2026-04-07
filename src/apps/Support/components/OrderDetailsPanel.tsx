import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, RefreshCw, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { CustomerReferenceLink } from '@/components/CustomerReferenceLink';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface Cin7Line {
  SKU: string | null;
  Name: string | null;
  Quantity: number | null;
  Price: number | null;
  Total: number | null;
}

interface Cin7Detail {
  found: boolean;
  error?: boolean;
  SaleOrderNumber: string | null;
  Customer: string | null;
  OrderDate: string | null;
  CustomerReference: string | null;
  Note: string | null;
  Lines: Cin7Line[];
  ShippingAddress: {
    Line1: string | null;
    Line2: string | null;
    City: string | null;
    State: string | null;
    Postcode: string | null;
    Country: string | null;
  } | null;
  Fulfilment: {
    ShippingCompany: string | null;
    TrackingNumber: string | null;
    ShipmentDate: string | null;
  } | null;
  Invoice: {
    InvoiceNumber: string | null;
    Total: number | null;
  } | null;
  last_refreshed: string;
}

interface Props {
  cin7SaleId: string | null;
  cin7OrderNumber: string | null;
  // Fallback data from case record
  fallbackOrderNumber?: string | null;
  fallbackPurchaseDate?: string | null;
  fallbackCustomerReference?: string | null;
}

function fmtCurrency(value: number | null | undefined): string | null {
  if (value === null || value === undefined || isNaN(value)) return null;
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });
}

function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return value;
  }
}

export function OrderDetailsPanel({ cin7SaleId, cin7OrderNumber, fallbackOrderNumber, fallbackPurchaseDate, fallbackCustomerReference }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);

  const { data: detail, isLoading, isError, refetch, isFetching } = useQuery<Cin7Detail>({
    queryKey: ['cin7-detail', cin7SaleId],
    queryFn: async () => {
      console.log('SaleID for Cin7 lookup:', cin7SaleId);
      const { data, error } = await supabase.functions.invoke('cin7-get-order-detail', {
        body: { saleId: cin7SaleId },
      });
      if (error) throw error;
      if (data?.error) throw new Error('Cin7 error');
      return data as Cin7Detail;
    },
    enabled: !!cin7SaleId && expanded,
    staleTime: 5 * 60 * 1000,
  });

  if (!cin7SaleId) {
    return null;
  }

  const handleCopyTracking = async (tracking: string) => {
    await navigator.clipboard.writeText(tracking);
    setCopiedTracking(true);
    setTimeout(() => setCopiedTracking(false), 2000);
  };

  const showError = isError || (detail && detail.error);
  const showNotFound = detail && detail.found === false;

  const orderTotal = detail?.Invoice?.Total ?? detail?.Lines?.reduce((sum, l) => sum + (l.Total ?? 0), 0) ?? null;

  return (
    <div className="bg-card border border-border mb-4">
      <div className="flex items-center justify-between px-4 py-3 text-sm text-foreground">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <span className="font-heading text-xs tracking-wider">ORDER DETAILS — {cin7OrderNumber || 'CIN7'}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
        <a
          href={`https://inventory.dearsystems.com/Sale#${cin7SaleId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary hover:underline transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          View in Cin7
        </a>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 border-t border-border pt-3">
              {/* Loading */}
              {isLoading && (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-1/2" />
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              )}

              {/* Not linked */}
              {!isLoading && showNotFound && (
                <p className="text-sm text-muted-foreground">No order linked to this case.</p>
              )}

              {/* Error — show fallback */}
              {!isLoading && showError && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Couldn't load live order data. Showing details from when the case was created.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {fallbackOrderNumber && (
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Order</span>
                        <span className="text-foreground">{fallbackOrderNumber}</span>
                      </div>
                    )}
                    {fallbackPurchaseDate && (
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Order date</span>
                        <span className="text-foreground">{fmtDate(fallbackPurchaseDate)}</span>
                      </div>
                    )}
                    {fallbackCustomerReference && (
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Customer ref</span>
                        <CustomerReferenceLink reference={fallbackCustomerReference} className="text-foreground text-sm" />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    {isFetching ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              )}

              {/* Success */}
              {!isLoading && !showError && !showNotFound && detail && detail.found && (
                <div className="space-y-4 text-sm">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {detail.SaleOrderNumber && (
                        <span className="text-foreground font-medium">{detail.SaleOrderNumber}</span>
                      )}
                      {detail.last_refreshed && (
                        <span className="text-xs text-muted-foreground">
                          Last refreshed {formatDistanceToNow(new Date(detail.last_refreshed), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => refetch()}
                      disabled={isFetching}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      title="Refresh"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
                    </button>
                  </div>

                  {/* Order info grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {detail.Customer && (
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Customer</span>
                        <span className="text-foreground">{detail.Customer}</span>
                      </div>
                    )}
                    {fmtDate(detail.OrderDate) && (
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Order date</span>
                        <span className="text-foreground">{fmtDate(detail.OrderDate)}</span>
                      </div>
                    )}
                    {detail.CustomerReference && (
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Customer ref</span>
                        <CustomerReferenceLink reference={detail.CustomerReference} className="text-foreground text-sm" />
                      </div>
                    )}
                    {detail.Invoice?.InvoiceNumber && (
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Invoice number</span>
                        <span className="text-foreground">{detail.Invoice.InvoiceNumber}</span>
                      </div>
                    )}
                  </div>

                  {/* Line items */}
                  {detail.Lines && detail.Lines.length > 0 ? (
                    <div className="border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">SKU</th>
                            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Product</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Qty</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Unit price</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.Lines.map((line, i) => (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="px-2 py-1.5 text-muted-foreground">{line.SKU ?? '—'}</td>
                              <td className="px-2 py-1.5 text-foreground">{line.Name ?? '—'}</td>
                              <td className="text-right px-2 py-1.5 text-foreground">{line.Quantity ?? '—'}</td>
                              <td className="text-right px-2 py-1.5 text-foreground">{fmtCurrency(line.Price) ?? '—'}</td>
                              <td className="text-right px-2 py-1.5 text-foreground">{fmtCurrency(line.Total) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        {fmtCurrency(orderTotal) && (
                          <tfoot>
                            <tr className="border-t border-border">
                              <td colSpan={4} className="text-right px-2 py-1.5 text-muted-foreground font-medium">Total</td>
                              <td className="text-right px-2 py-1.5 text-foreground font-medium">{fmtCurrency(orderTotal)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No line items found</p>
                  )}

                  {/* Shipping address */}
                  {detail.ShippingAddress && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Ship to</span>
                      <div className="text-foreground text-sm">
                        {[
                          detail.ShippingAddress.Line1,
                          detail.ShippingAddress.Line2,
                        ].filter(Boolean).map((line, i) => <div key={i}>{line}</div>)}
                        <div>
                          {[detail.ShippingAddress.City, detail.ShippingAddress.State, detail.ShippingAddress.Postcode].filter(Boolean).join(', ')}
                        </div>
                        {detail.ShippingAddress.Country && <div>{detail.ShippingAddress.Country}</div>}
                      </div>
                    </div>
                  )}

                  {/* Fulfilment */}
                  {detail.Fulfilment && detail.Fulfilment.TrackingNumber && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Shipment</span>
                      <div className="space-y-1">
                        {detail.Fulfilment.ShippingCompany && (
                          <p className="text-foreground">{detail.Fulfilment.ShippingCompany}</p>
                        )}
                        {fmtDate(detail.Fulfilment.ShipmentDate) && (
                          <p className="text-xs text-muted-foreground">Shipped {fmtDate(detail.Fulfilment.ShipmentDate)}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-foreground text-xs font-mono">{detail.Fulfilment.TrackingNumber}</span>
                          <button
                            onClick={() => handleCopyTracking(detail.Fulfilment!.TrackingNumber!)}
                            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy tracking number"
                          >
                            {copiedTracking ? <Check className="h-3 w-3 text-status-resolved" /> : <Copy className="h-3 w-3" />}
                          </button>
                          {copiedTracking && <span className="text-xs text-status-resolved">Copied</span>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Order notes */}
                  {detail.Note && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Order notes</span>
                      <p className="text-foreground text-sm">{detail.Note}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
