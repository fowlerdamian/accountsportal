import { useState, useEffect } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Phone, Globe, Star, User, Link,
  ExternalLink, Loader2, CheckCircle, TrendingDown, TrendingUp, Minus, Save, MessageSquare,
} from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import {
  useLead,
  useCallEntryByLead,
  useOrderHistory,
  useUpdateCallOutcome,
  useSaveCallNotes,
} from "../hooks/useSalesQueries";
import { type Channel } from "../lib/constants";
import { supabase } from "@portal/lib/supabase";
import { LeadScoreBadge } from "../components/LeadScoreBadge";

const OUTCOMES = [
  { key: "connected",      label: "Connected",      color: "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30" },
  { key: "voicemail",      label: "Voicemail",      color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30" },
  { key: "no_answer",      label: "No Answer",      color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/30" },
  { key: "callback",       label: "Callback",       color: "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30" },
  { key: "not_interested", label: "Not Interested", color: "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30" },
];

export default function LeadCallCard() {
  const { leadId }  = useParams<{ leadId: string }>();
  const { channel } = useOutletContext<{ channel: Channel }>();
  const navigate    = useNavigate();

  const { data: lead,      isLoading: loadingLead } = useLead(leadId!);
  const { data: callEntry, isLoading: loadingCall } = useCallEntryByLead(leadId!);
  const { data: orderHistory } = useOrderHistory(lead?.cin7_customer_id ?? null);

  const updateOutcome = useUpdateCallOutcome();
  const saveNotes     = useSaveCallNotes();

  const [notes, setNotes]           = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [syncingOutcome, setSyncingOutcome] = useState<string | null>(null);
  const [revealedPhone, setRevealedPhone]   = useState<string | null>(null);
  const [revealingPhone, setRevealingPhone] = useState(false);
  // Track the live call entry ID (may be created on first outcome/save)
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  useEffect(() => {
    if (callEntry?.call_notes) setNotes(callEntry.call_notes);
    if (callEntry?.id) setActiveCallId(callEntry.id);
  }, [callEntry?.id, callEntry?.call_notes]);

  if (loadingLead || loadingCall || !lead) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Merge context_brief from call entry with direct lead fields as fallback
  const brief = callEntry?.context_brief ?? {};
  const companyName     = brief.company_name     ?? lead.company_name;
  const address         = brief.address          ?? lead.address;
  const website         = brief.website          ?? lead.website;
  const phone           = revealedPhone ?? brief.phone ?? lead.phone;
  const googleRating    = brief.google_rating    ?? lead.google_rating;
  const googleReviews   = brief.google_reviews   ?? lead.google_review_count;
  const contactName     = brief.recommended_contact ?? (lead.recommended_contact_name
    ? `${[lead.recommended_contact_title, lead.recommended_contact_name, lead.recommended_contact_last_name].filter(Boolean).join(" ")}${lead.recommended_contact_position ? ', ' + lead.recommended_contact_position : ''}`
    : null);
  const contactSource   = brief.contact_source   ?? lead.recommended_contact_source;
  const companySummary  = brief.company_summary  ?? lead.website_summary;
  const tenderContext   = brief.tender_context   ?? lead.tender_context;
  const social = brief.social ?? {
    facebook:  lead.social_facebook,
    instagram: lead.social_instagram,
    linkedin:  lead.social_linkedin,
  };

  // Cin7 data — prefer call entry, fall back to live order history
  const cin7 = brief.cin7_data ?? (orderHistory ? {
    is_winback:           orderHistory.is_winback_candidate,
    last_order:           orderHistory.last_order_date,
    order_count_30d:      orderHistory.order_count_30d,
    order_count_90d:      orderHistory.order_count_90d,
    avg_order_value:      orderHistory.average_order_value,
    days_since_last_order: orderHistory.days_since_last_order,
    top_products:         orderHistory.top_products?.map((p) => p.name ?? p.sku) ?? [],
  } : null);

  // Context points — AI-generated pitch from call entry, or fall back to key products / summary
  const contextPoints: string[] = [
    brief.recommended_pitch ?? brief.channel_pitch,
    ...(callEntry?.talking_points ?? []),
    ...(!callEntry && lead.key_products_services?.length
      ? [`Key products: ${lead.key_products_services.slice(0, 3).join(", ")}`]
      : []),
  ].filter(Boolean).slice(0, 4) as string[];

  async function ensureCallEntry(): Promise<string> {
    if (activeCallId) return activeCallId;
    const { data, error } = await supabase
      .from("call_list")
      .insert({
        lead_id:        lead.id,
        channel,
        priority_rank:  99,
        call_reason:    "Direct",
        scheduled_date: new Date().toISOString().split("T")[0],
        is_complete:    false,
        context_brief: {
          company_name:        lead.company_name,
          website:             lead.website,
          phone:               lead.phone,
          address:             lead.address,
          google_rating:       lead.google_rating,
          google_reviews:      lead.google_review_count,
          recommended_contact: lead.recommended_contact_name
            ? `${[lead.recommended_contact_title, lead.recommended_contact_name, lead.recommended_contact_last_name].filter(Boolean).join(" ")}${lead.recommended_contact_position ? ', ' + lead.recommended_contact_position : ''}`
            : null,
          contact_source:      lead.recommended_contact_source,
          company_summary:     lead.website_summary,
          is_existing_customer: lead.is_existing_customer,
          lead_score:          lead.lead_score,
          social: {
            facebook:  lead.social_facebook,
            instagram: lead.social_instagram,
            linkedin:  lead.social_linkedin,
          },
          tender_context: lead.tender_context,
        },
      })
      .select("id")
      .single();
    if (error) throw error;
    setActiveCallId(data.id);
    return data.id;
  }

  async function markOutcome(outcome: string) {
    setSyncingOutcome(outcome);
    try {
      const id = await ensureCallEntry();
      await updateOutcome.mutateAsync({
        callId:   id,
        outcome,
        notes,
        calledAt: new Date().toISOString(),
      });
      if (lead.hubspot_company_id) {
        setSyncing(true);
        try {
          await supabase.functions.invoke("sales-hubspot-sync", { body: { action: "sync_notes" } });
        } finally {
          setSyncing(false);
        }
      }
    } finally {
      setSyncingOutcome(null);
    }
  }

  async function handleSaveNotes() {
    const id = await ensureCallEntry();
    await saveNotes.mutateAsync({ callId: id, notes });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  async function revealPhone() {
    setRevealingPhone(true);
    try {
      const { data } = await supabase.functions.invoke("sales-lead-enrichment", {
        body: { action: "reveal_phone", lead_id: lead.id },
      });
      if (data?.phone) setRevealedPhone(data.phone);
    } finally {
      setRevealingPhone(false);
    }
  }

  const isComplete = callEntry?.is_complete ?? false;

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
        onClick={() => navigate(`/sales-support/${channel}/leads`)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Leads
      </button>

      {/* Company header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <LeadScoreBadge score={lead.lead_score} size="lg" />
            <div>
              <h1 className="text-xl font-bold">{companyName}</h1>
              {address && <p className="text-sm text-muted-foreground mt-0.5">{address}</p>}
              {callEntry && (
                <div className="mt-1.5">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {callEntry.call_reason}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
            {website && (
              <a href={website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-muted hover:bg-muted/70 transition-colors">
                <Globe className="w-3.5 h-3.5" /> Website
              </a>
            )}
            {lead.hubspot_company_id && (
              <a href={`https://app-ap1.hubspot.com/contacts/22572063/company/${lead.hubspot_company_id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> HubSpot
              </a>
            )}
            {channel === "trailbait" && lead.cin7_customer_id && (
              <a href={`https://inventory.dearsystems.com/Customer#guid=${lead.cin7_customer_id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> Cin7
              </a>
            )}
          </div>
        </div>

        {/* Phone */}
        {phone ? (
          <a href={`tel:${phone}`}
            className="mt-4 flex items-center gap-2 text-2xl font-mono font-semibold text-primary hover:text-primary/80 transition-colors">
            <Phone className="w-5 h-5" />
            {phone}
          </a>
        ) : (
          <button
            onClick={revealPhone}
            disabled={revealingPhone}
            className="mt-4 flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50 text-muted-foreground"
          >
            {revealingPhone
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Phone className="w-4 h-4" />}
            {revealingPhone ? "Finding number…" : "Reveal direct number"}
          </button>
        )}
      </div>

      {/* Context / pitch points */}
      {contextPoints.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-400">Context</div>
            {brief.hook_tier && (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded font-mono font-semibold",
                brief.hook_tier === 1 ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                brief.hook_tier === 2 ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                                        "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30"
              )}>
                {brief.hook_tier === 1 ? "T1 · Urgent" : brief.hook_tier === 2 ? "T2 · Pain point" : "T3 · General fit"}
              </span>
            )}
          </div>
          <ul className="space-y-2">
            {contextPoints.map((point, i) => (
              <li key={i} className="text-sm text-foreground/80 flex gap-2.5 leading-relaxed">
                <span className="text-amber-400 font-bold flex-shrink-0">·</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Contact + Online */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommended Contact</div>
          {contactName ? (
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-muted-foreground" />
              <span>{contactName}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No contact identified</p>
          )}
          {contactSource && (
            <p className="text-xs text-muted-foreground/60">Source: {contactSource}</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Online</div>
          <div className="flex flex-wrap gap-3 text-sm">
            {googleRating && (
              <span className="flex items-center gap-1 text-yellow-400">
                <Star className="w-4 h-4 fill-yellow-400" />
                {googleRating}
                {googleReviews && <span className="text-muted-foreground text-xs">({googleReviews})</span>}
              </span>
            )}
            {social?.facebook && (
              <a href={social.facebook} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" title="Facebook"><Link className="w-4 h-4" /></a>
            )}
            {social?.instagram && (
              <a href={social.instagram} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300" title="Instagram"><Link className="w-4 h-4" /></a>
            )}
            {social?.linkedin && (
              <a href={social.linkedin} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400" title="LinkedIn"><Link className="w-4 h-4" /></a>
            )}
            {!googleRating && !social?.facebook && !social?.instagram && !social?.linkedin && (
              <span className="text-muted-foreground text-sm">No online presence found</span>
            )}
          </div>
        </div>
      </div>

      {/* Previous contact (HubSpot notes) */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <MessageSquare className="w-3.5 h-3.5" />
          Previous Contact
        </div>
        {(brief.hubspot_notes?.length || lead.hubspot_previous_contact?.length) ? (
          <div className="space-y-2.5">
            {(brief.hubspot_notes ?? lead.hubspot_previous_contact ?? []).map((note: { date: string; body: string }, i: number) => (
              <div key={i} className="text-sm">
                <span className="text-xs text-muted-foreground/60 font-mono mr-2">{note.date}</span>
                <span className="text-foreground/70">{note.body}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic">No previous contact on record</p>
        )}
      </div>

      {/* Company summary */}
      {companySummary && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Company Overview</div>
          <p className="text-sm text-foreground/80 leading-relaxed">{companySummary}</p>
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
              { label: "Last order",      value: cin7.last_order ?? "—" },
              { label: "Orders 30d",      value: cin7.order_count_30d ?? 0 },
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
      {channel === "fleetcraft" && tenderContext && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-400 mb-2">Tender / Contract Context</div>
          <p className="text-sm text-foreground/80">{tenderContext}</p>
        </div>
      )}

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

      {/* Outcome */}
      {!isComplete ? (
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Outcome</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => markOutcome(key)}
                disabled={!!syncingOutcome || syncing}
                className={cn("px-4 py-2 text-sm rounded-lg border transition-all disabled:opacity-50", color)}
              >
                {syncingOutcome === key
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
              Outcome: {callEntry?.call_outcome?.replace(/_/g, " ") ?? "recorded"}
              {callEntry?.called_at && ` · ${new Date(callEntry.called_at).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}`}
              {callEntry?.hubspot_note_synced && " · HubSpot synced"}
            </p>
          </div>
          <button
            onClick={() => navigate(`/sales-support/${channel}/leads`)}
            className="ml-auto px-3 py-1.5 text-xs bg-muted rounded hover:bg-muted/70 transition-colors"
          >
            Back to leads
          </button>
        </div>
      )}
    </div>
  );
}
