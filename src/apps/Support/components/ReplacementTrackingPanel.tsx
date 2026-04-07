import { Copy, ExternalLink, Package, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Props {
  trackingNumber: string | null;
  carrier: string | null;
  shipDate: string | null;
  hasReplacementOrder: boolean;
}

function getTrackingUrl(carrier: string, tracking: string): string | null {
  const c = carrier.toLowerCase();
  if (c.includes('auspost') || c === 'australia_post')
    return `https://auspost.com.au/mypost/track/details/${tracking}`;
  if (c.includes('startrack'))
    return `https://startrack.com.au/track/?id=${tracking}`;
  if (c.includes('sendle'))
    return `https://track.sendle.com/tracking?ref=${tracking}`;
  if (c.includes('tnt'))
    return `https://tntexpress.com.au/InterAction/ASPs/CnmHxAS.asp?${tracking}`;
  return null;
}

export function ReplacementTrackingPanel({ trackingNumber, carrier, shipDate, hasReplacementOrder }: Props) {
  if (!hasReplacementOrder) return null;

  const copyTracking = () => {
    if (trackingNumber) {
      navigator.clipboard.writeText(trackingNumber);
      toast.success('Tracking number copied');
    }
  };

  // Awaiting tracking
  if (!trackingNumber) {
    return (
      <div className="border border-border p-3 mt-3 flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-muted-foreground/40 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/60" />
        </span>
        <span className="text-sm text-muted-foreground">Awaiting tracking number from ShipStation...</span>
      </div>
    );
  }

  const trackingUrl = carrier ? getTrackingUrl(carrier, trackingNumber) : null;
  let formattedDate = shipDate || '';
  try {
    if (shipDate) formattedDate = format(new Date(shipDate), 'dd MMM yyyy');
  } catch { /* use raw */ }

  return (
    <div className="border border-border p-3 mt-3" style={{ borderLeftWidth: '3px', borderLeftColor: 'hsl(122, 46%, 33%)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Package className="h-3.5 w-3.5 text-status-resolved" />
        <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium border bg-status-resolved/15 text-status-resolved border-status-resolved/30">
          Tracking received
        </span>
      </div>

      <div className="space-y-1.5 text-sm">
        {carrier && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs w-16">Carrier</span>
            <span className="text-foreground">{carrier}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs w-16">Tracking</span>
          <span className="text-foreground font-mono text-xs">{trackingNumber}</span>
          <button onClick={copyTracking} className="text-muted-foreground hover:text-foreground transition-colors" title="Copy">
            <Copy className="h-3.5 w-3.5" />
          </button>
          {trackingUrl && (
            <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" title="Track shipment">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        {formattedDate && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs w-16">Shipped</span>
            <span className="text-foreground">{formattedDate}</span>
          </div>
        )}
      </div>
    </div>
  );
}
