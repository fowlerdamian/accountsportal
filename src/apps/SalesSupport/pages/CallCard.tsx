import { useState, useEffect } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Phone, Globe, Star, User, Link,
  ExternalLink, Loader2, CheckCircle, TrendingDown, TrendingUp, Minus, Save,
} from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import { useCallEntry, useUpdateCallOutcome, useSaveCallNotes } from "../hooks/useSalesQueries";
import { SUPABASE_FN_URL, type Channel } from "../lib/constants";
import { supabase } from "../../../lib/supabase";

const OUTCOMES = [
  { key: "connected",      label: "Connected",      color: "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30" },
  { key: "voicemail",      label: "Voicemail",      color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30" },
  { key: "no_answer",      label: "No Answer",      color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/30" },
  { key: "callback",       label: "Callback",       color: "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30" },
  { key: "not_interested", label: "Not Interested", color: "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30" },
];

export default function CallCard() {
  const { callId }  = useParams<{ callId: string }>();
  const { channel } = useOutletContext<{ channel: Channel }>();
  const navigate    = useNavigate();

  const { data: call, isLoading } = useCallEntry(callId!);
  const updateOutcome             = useUpdateCallOutcome();
  const saveNotes                 = useSaveCallNotes();

  const [notes, setNotes]         = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [syncing, setSyncing]     = useState(false);

  useEffect(() => {
    if (call?.call_notes) setNotes(call.call_notes);
  }, [call?.call_notes]);

  if (isLoading || !call) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const brief = call.context_brief ?? {};
  const cin7  = brief.cin7_data;
  const lead  = call.sales_leads;

  async function markOutcome(outcome: string) {
    await updateOutcome.mutateAsync({
      callId:   call.id,
      outcome,
      notes,
      calledAt: new Date().toISOString(),
    });
    // Sync note to HubSpot
    if (lead?.hubspot_company_id) {
      setSyncing(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await fetch(SUPABASE_FN_URL("sales-hubspot-sync"), {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
          body: JSON.stringify({ action: "sync_notes" }),
        });
      } finally {
        setSyncing(false);
      }
    }
  }

  async function handleSaveNotes() {
    await saveNotes.mutateAsync({ callId: call.id, notes });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  const trendDir = () => {
    if (!cin7) return null;
    const expected = cin7.order_count_90d / 3;
    if (cin7.order_count_30d < expected * 0.5) return "declining";
    if (cin7.order_count_30d >= expected * 1.2) return "growing";
    return "stable";
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Back nav */}
      <button
        onClick={() => navigate(`/apps/sales-support/${channel}/calls`)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Call List
      </button>

      {/* Priority + Company header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">
              #{call.priority_rank}
            </div>
            <div>
              <h1 className="text-xl font-bold">{brief.company_name}</h1>
              {brief.address && <p className="text-sm text-muted-foreground mt-0.5">{brief.address}</p>}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {brief.website && (
              <a href={brief.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-muted hover:bg-muted/70 transition-colors">
                <Globe className="w-3.5 h-3.5" /> Website
              </a>
            )}
            {lead?.hubspot_company_id && (
              <a href={`https://app.hubspot.com/contacts/${lead.hubspot_company_id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> HubSpot
              </a>
            )}
          </div>
        </div>

        {/* Phone — prominent */}
        {brief.phone && (
          <a href={`tel:${brief.phone}`}
            className="mt-4 flex items-center gap-2 text-2xl font-mono font-semibold text-primary hover:text-primary/80 transition-colors">
            <Phone className="w-5 h-5" />
            {brief.phone}
          </a>
        )}
      </div>

      {/* Call reason */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-1">Why call today</div>
        <p className="text-sm text-foreground/90">{call.call_reason}</p>
        {call.talking_points?.length ? (
          <ul className="mt-3 space-y-1">
            {call.talking_points.map((tp, i) => (
              <li key={i} className="text-sm text-foreground/70 flex gap-2">
                <span className="text-amber-400 font-bold">·</span>
                {tp}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Contact + Google */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommended Contact</div>
          {brief.recommended_contact ? (
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-muted-foreground" />
              <span>{brief.recommended_contact}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No contact identified</p>
          )}
          {brief.contact_source && (
            <p className="text-xs text-muted-foreground/60">Source: {brief.contact_source}</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Online</div>
          <div className="flex flex-wrap gap-3 text-sm">
            {brief.google_rating && (
              <span className="flex items-center gap-1 text-yellow-400">
                <Star className="w-4 h-4 fill-yellow-400" />
                {brief.google_rating}
                {brief.google_reviews && <span className="text-muted-foreground text-xs">({brief.google_reviews})</span>}
              </span>
            )}
            {brief.social?.facebook && (
              <a href={brief.social.facebook} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300"><Link className="w-4 h-4" /></a>
            )}
            {brief.social?.instagram && (
              <a href={brief.social.instagram} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300"><Link className="w-4 h-4" /></a>
            )}
            {brief.social?.linkedin && (
              <a href={brief.social.linkedin} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400"><Link className="w-4 h-4" /></a>
            )}
          </div>
        </div>
      </div>

      {/* Company summary */}
      {brief.company_summary && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Company Overview</div>
          <p className="text-sm text-foreground/80 leading-relaxed">{brief.company_summary}</p>
        </div>
      )}

      {/* TrailBait: Cin7 order history */}
      {channel === "trailbait" && cin7 && (
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order History</div>
          {cin7.is_winback && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <TrendingDown className="w-4 h-4" />
              Win-back — {cin7.days_since_last_order} days since last order
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: "Last order", value: cin7.last_order ?? "—" },
              { label: "Orders 30d", value: cin7.order_count_30d ?? 0 },
              { label: "Avg order value", value: cin7.avg_order_value ? `$${Math.round(cin7.avg_order_value).toLocaleString()}` : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/30 rounded-lg p-2.5">
                <div className="font-semibold text-base">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          {cin7.top_products?.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">Top products</div>
              <div className="flex flex-wrap gap-1.5">
                {cin7.top_products.map((sku: string) => (
                  <span key={sku} className="text-xs px-2 py-0.5 bg-muted/50 rounded border border-border">{sku}</span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {trendDir() === "declining" ? <TrendingDown className="w-4 h-4 text-red-400" /> :
             trendDir() === "growing"   ? <TrendingUp   className="w-4 h-4 text-green-400" /> :
                                          <Minus         className="w-4 h-4 text-yellow-400" />}
            <span className="capitalize">{trendDir()} order trend</span>
          </div>
        </div>
      )}

      {/* FleetCraft: tender context */}
      {channel === "fleetcraft" && brief.tender_context && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-400 mb-2">Tender / Contract Context</div>
          <p className="text-sm text-foreground/80">{brief.tender_context}</p>
        </div>
      )}

      {/* Channel pitch */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Channel Pitch</div>
        <p className="text-sm italic text-foreground/70">"{brief.channel_pitch}"</p>
      </div>

      {/* Call notes */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Notes</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Type your call notes here..."
          rows={5}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
        <button
          onClick={handleSaveNotes}
          disabled={saveNotes.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50"
        >
          {notesSaved ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Save className="w-3.5 h-3.5" />}
          {notesSaved ? "Saved" : "Save Notes"}
        </button>
      </div>

      {/* Outcome buttons */}
      {!call.is_complete ? (
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Outcome</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => markOutcome(key)}
                disabled={updateOutcome.isPending || syncing}
                className={cn("px-4 py-2 text-sm rounded-lg border transition-all disabled:opacity-50", color)}
              >
                {(updateOutcome.isPending || syncing) && updateOutcome.variables?.outcome === key
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : label}
              </button>
            ))}
          </div>
          {syncing && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing note to HubSpot...
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-sm font-medium text-green-400">Call completed</p>
            <p className="text-xs text-muted-foreground capitalize">
              Outcome: {call.call_outcome?.replace(/_/g, " ") ?? "recorded"}
              {call.called_at && ` · ${new Date(call.called_at).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}`}
              {call.hubspot_note_synced && " · HubSpot synced"}
            </p>
          </div>
          <button
            onClick={() => navigate(`/apps/sales-support/${channel}/calls`)}
            className="ml-auto px-3 py-1.5 text-xs bg-muted rounded hover:bg-muted/70 transition-colors"
          >
            Back to list
          </button>
        </div>
      )}
    </div>
  );
}
