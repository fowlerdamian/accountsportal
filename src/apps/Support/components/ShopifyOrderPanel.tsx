import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, RefreshCw, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface ShopifyLineItem {
  title: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  currency: string | null;
  variant_title: string | null;
}

interface ShopifyFulfilment {
  tracking_company: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
}

interface ShopifyOrder {
  found: boolean;
  error?: boolean;
  shopify_order_url: string | null;
  order_name: string | null;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  shipping_address: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
  } | null;
  line_items: ShopifyLineItem[];
  total_price: number | null;
  currency: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  note: string | null;
  tags: string | null;
  created_at: string | null;
  fulfillments: ShopifyFulfilment[];
}

function fmtCurrency(value: number | null | undefined, currency?: string | null): string | null {
  if (value === null || value === undefined || isNaN(value)) return null;
  return value.toLocaleString('en-AU', {
    style: 'currency',
    currency: currency || 'AUD',
    minimumFractionDigits: 2,
  });
}

function capitalize(s: string | null): string | null {
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

interface Props {
  customerReference: string | null;
}

export function ShopifyOrderPanel({ customerReference }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ShopifyOrder>({
    queryKey: ['shopify-order', customerReference],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('shopify-get-order', {
        body: { customerReference },
      });
      if (error) throw error;
      if (data?.error) throw new Error('Shopify error');
      return data as ShopifyOrder;
    },
    enabled: !!customerReference && expanded,
    staleTime: 5 * 60 * 1000,
  });

  if (!customerReference) return null;

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedTracking(text);
    setTimeout(() => setCopiedTracking(null), 2000);
  };

  const showError = isError || (data && data.error);
  const showNotFound = data && data.found === false;
  const order = data && data.found ? data : null;

  return (
    <div className="bg-card border border-border mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-foreground hover:bg-surface-elevated transition-colors"
      >
        <span className="font-heading text-xs tracking-wider">
          SHOPIFY ORDER{order?.order_name ? ` — ${order.order_name}` : customerReference ? ` — ${customerReference}` : ''}
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
      </button>
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
                  </div>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              )}

              {/* Error */}
              {!isLoading && showError && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Couldn't load Shopify order data.</p>
                  <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    {isFetching ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              )}

              {/* Not found */}
              {!isLoading && !showError && showNotFound && (
                <p className="text-sm text-muted-foreground">
                  No Shopify order found for reference <span className="font-medium text-foreground">{customerReference}</span>.
                </p>
              )}

              {/* Found */}
              {!isLoading && !showError && order && (
                <div className="space-y-4 text-sm">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <span className="text-foreground font-medium">{order.order_name}</span>
                    {order.shopify_order_url && (
                      <a
                        href={order.shopify_order_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border text-foreground hover:bg-surface-elevated transition-colors"
                      >
                        View in Shopify <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  {/* Status row */}
                  {(order.financial_status || order.fulfillment_status) && (
                    <div className="flex items-center gap-4">
                      {order.financial_status && (
                        <div>
                          <span className="text-muted-foreground text-xs block mb-0.5">Financial</span>
                          <span className="text-foreground">{capitalize(order.financial_status)}</span>
                        </div>
                      )}
                      {order.fulfillment_status && (
                        <div>
                          <span className="text-muted-foreground text-xs block mb-0.5">Fulfilment</span>
                          <span className="text-foreground">{capitalize(order.fulfillment_status)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Customer */}
                  {order.customer && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Customer</span>
                      <div className="space-y-0.5">
                        {order.customer.name && <p className="text-foreground">{order.customer.name}</p>}
                        {order.customer.email && (
                          <a href={`mailto:${order.customer.email}`} className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                            {order.customer.email}
                          </a>
                        )}
                        {order.customer.phone && <p className="text-xs text-muted-foreground">{order.customer.phone}</p>}
                      </div>
                    </div>
                  )}

                  {/* Shipping address */}
                  {order.shipping_address && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Ship to</span>
                      <div className="text-foreground text-sm">
                        {order.shipping_address.name && <div>{order.shipping_address.name}</div>}
                        {[order.shipping_address.address1, order.shipping_address.address2].filter(Boolean).map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                        <div>
                          {[order.shipping_address.city, order.shipping_address.province, order.shipping_address.zip].filter(Boolean).join(', ')}
                        </div>
                        {order.shipping_address.country && <div>{order.shipping_address.country}</div>}
                      </div>
                    </div>
                  )}

                  {/* Line items */}
                  {order.line_items && order.line_items.length > 0 && (
                    <div className="border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Product</th>
                            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Variant</th>
                            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">SKU</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Qty</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Unit price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.line_items.map((item, i) => (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="px-2 py-1.5 text-foreground">{item.title}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{item.variant_title && item.variant_title !== 'Default Title' ? item.variant_title : '—'}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{item.sku ?? '—'}</td>
                              <td className="text-right px-2 py-1.5 text-foreground">{item.quantity}</td>
                              <td className="text-right px-2 py-1.5 text-foreground">{fmtCurrency(item.unit_price, item.currency) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        {fmtCurrency(order.total_price, order.currency) && (
                          <tfoot>
                            <tr className="border-t border-border">
                              <td colSpan={4} className="text-right px-2 py-1.5 text-muted-foreground font-medium">Total</td>
                              <td className="text-right px-2 py-1.5 text-foreground font-medium">{fmtCurrency(order.total_price, order.currency)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}

                  {/* Fulfilments */}
                  {order.fulfillments && order.fulfillments.length > 0 && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Shipment</span>
                      <div className="space-y-2">
                        {order.fulfillments.map((f, i) => (
                          <div key={i} className="space-y-0.5">
                            {f.tracking_company && <p className="text-foreground">{f.tracking_company}</p>}
                            {f.tracking_number && (
                              <div className="flex items-center gap-2">
                                {f.tracking_url ? (
                                  <a
                                    href={f.tracking_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-mono underline text-foreground hover:text-muted-foreground transition-colors"
                                  >
                                    {f.tracking_number}
                                  </a>
                                ) : (
                                  <span className="text-xs font-mono text-foreground">{f.tracking_number}</span>
                                )}
                                <button
                                  onClick={() => handleCopy(f.tracking_number!)}
                                  className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                                  title="Copy tracking number"
                                >
                                  {copiedTracking === f.tracking_number ? <Check className="h-3 w-3 text-status-resolved" /> : <Copy className="h-3 w-3" />}
                                </button>
                                {copiedTracking === f.tracking_number && <span className="text-xs text-status-resolved">Copied</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Order notes */}
                  {order.note && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Order notes</span>
                      <p className="text-foreground text-sm">{order.note}</p>
                    </div>
                  )}

                  {/* Tags */}
                  {order.tags && (
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Tags</span>
                      <div className="flex flex-wrap gap-1.5">
                        {order.tags.split(', ').map((tag, i) => (
                          <span key={i} className="inline-block px-2 py-0.5 text-xs bg-muted text-muted-foreground border border-border">
                            {tag}
                          </span>
                        ))}
                      </div>
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
