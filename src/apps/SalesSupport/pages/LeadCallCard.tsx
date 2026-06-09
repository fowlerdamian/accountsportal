import { useState, useEffect, useRef, type ReactNode } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Phone, Globe, Star, User, Link,
  ExternalLink, Loader2, CheckCircle, TrendingDown, TrendingUp, Minus, Save, MessageSquare, PhoneCall, Sparkles, RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import {
  useLead,
  useCallEntryByLead,
  useOrderHistory,
  useUpdateCallOutcome,
  useSaveCallNotes,
} from "../hooks/useSalesQueries";
import CallHistory from "../components/CallHistory";
import CompanyIntel from "../components/CompanyIntel";
import { type Channel } from "../lib/constants";
import { supabase } from "@portal/lib/supabase";
import { localToday } from "@portal/lib/dates";
import { LeadScoreBadge } from "../components/LeadScoreBadge";

const CHANNEL_PITCH: Record<string, string> = {
  trailbait:  "Accelerate accessory fitment times through innovative products. Add additional unique products to increase average invoice value.",
  fleetcraft: "Accelerate accessory fitment times through innovative products such as wiring looms and brackets.",
  aga:        "We offer turn-key products to complement your range without the need to design and manufacture yourself.",
};

// One labeled provenance block in the "Source data" toggle. Keeps every piece
// of info shown with the system it came from so the salesperson can verify.
function SourceBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="font-semibold text-amber-400/80 uppercase tracking-wider text-[10px] mb-0.5">
        {label}
      </div>
      <div className="text-foreground/70">{children}</div>
    </div>
  );
}

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

  const queryClient                                  = useQueryClient();
  const { data: lead,      isLoading: loadingLead } = useLead(leadId!);
  const { data: callEntry, isLoading: loadingCall } = useCallEntryByLead(leadId!);
  const { data: orderHistory } = useOrderHistory(lead?.cin7_customer_id ?? null);

  const updateOutcome = useUpdateCallOutcome();
  const saveNotes     = useSaveCallNotes();

  const [notes, setNotes]           = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [syncingOutcome, setSyncingOutcome] = useState<string | null>(null);
  const [lushaLoading, setLushaLoading] = useState(false);
  const [lushaError, setLushaError]     = useState<string | null>(null);
  const [numberRevealed, setNumberRevealed] = useState(false);
  // Track the live call entry ID (may be created on first outcome/save)
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  // In-flight insert guard — concurrent ensureCallEntry() calls share one insert
  const callEntryInsertRef = useRef<Promise<string> | null>(null);
  // AI brief — auto-loads on first view; manual refresh button regenerates.
  const [briefBullets, setBriefBullets]   = useState<string[] | null>(null);
  const [briefLoading, setBriefLoading]   = useState(false);
  const [briefError, setBriefError]       = useState<string | null>(null);
  const [showBriefSource, setShowBriefSource] = useState(false);
  // Rescore — re-runs the scoring function for this lead using current data
  const [rescoring, setRescoring]   = useState(false);
  const [rescoreError, setRescoreError] = useState<string | null>(null);

  // Reset per-lead state when navigating to a different lead so notes/brief
  // never attach to the wrong lead.
  useEffect(() => {
    setActiveCallId(null);
    callEntryInsertRef.current = null;
    setNotes("");
    setNotesDirty(false);
    setBriefBullets(null);
  }, [leadId]);

  useEffect(() => {
    // Only sync notes from the server while the textarea is untouched —
    // a background refetch must not clobber typed-but-unsaved notes.
    if (callEntry?.call_notes && !notesDirty) setNotes(callEntry.call_notes);
    if (callEntry?.id) setActiveCallId(callEntry.id);
  }, [callEntry?.id, callEntry?.call_notes, notesDirty]);

  // Seed bullets from cached lead row; auto-generate if missing.
  useEffect(() => {
    if (!lead) return;
    if (lead.ai_brief_bullets?.length) {
      setBriefBullets(lead.ai_brief_bullets);
      return;
    }
    // No cached brief — fire one off automatically (skip if already in-flight).
    if (briefLoading || briefBullets) return;
    void generateBrief(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  async function rescore() {
    if (!lead || rescoring) return;
    setRescoring(true);
    setRescoreError(null);
    try {
      const { error } = await supabase.functions.invoke("sales-lead-scoring", {
        body: { lead_id: lead.id },
      });
      if (error) throw new Error(error.message);
      queryClient.invalidateQueries({ queryKey: ["sales_lead", lead.id] });
      queryClient.invalidateQueries({ queryKey: ["sales_leads"] });
    } catch (err: unknown) {
      setRescoreError((err as Error).message ?? "Rescore failed");
    } finally {
      setRescoring(false);
    }
  }

  async function generateBrief(force: boolean) {
    if (!lead) return;
    setBriefLoading(true);
    setBriefError(null);
    try {
      const { data, error } = await supabase.functions.invoke("sales-lead-brief", {
        body: { lead_id: lead.id, force },
      });
      if (error) throw new Error(error.message);
      const bullets = (data as { bullets?: string[] } | null)?.bullets ?? [];
      if (!bullets.length) throw new Error("AI returned no bullets");
      setBriefBullets(bullets);
      queryClient.invalidateQueries({ queryKey: ["sales_lead", lead.id] });
    } catch (err: unknown) {
      setBriefError((err as Error).message ?? "Brief generation failed");
    } finally {
      setBriefLoading(false);
    }
  }


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
  const phone           = brief.phone ?? lead.phone;
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

  // Discovery-source labels — humanise the raw enum value stored on the lead.
  const DISCOVERY_LABEL: Record<string, string> = {
    google_maps:      "Google Maps Places",
    web_scrape:       "Google web search",
    austender:        "AusTender OCDS API",
    user_suggestion:  "User research suggestion",
    news_tender:      "News article (tender win)",
    linkedin:         "LinkedIn company search",
    seek_jobs:        "Seek (hiring activity)",
    yellow_pages:     "Yellow Pages directory",
    facebook:         "Facebook business page",
    instagram:        "Instagram business profile",
    trade_press:      "Australian trade press",
    trade_directory:  "AAAA trade directory",
    market_news:      "Market news search",
  };
  const cleanDomain = (url: string) => {
    try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
    catch { return url; }
  };
  const housePitch = brief.recommended_pitch ?? brief.channel_pitch ?? CHANNEL_PITCH[channel];
  const priorNotes = (brief.hubspot_notes ?? lead.hubspot_previous_contact ?? []) as Array<{ date: string; body: string }>;
  const hasAnySource =
    !!lead.website_summary || !!lead.company_description || !!lead.industry ||
    !!lead.employee_count  || !!lead.founded_year       || !!lead.key_products_services?.length ||
    !!contactName          || !!tenderContext           || priorNotes.length > 0 ||
    !!callEntry?.talking_points?.length || (channel === "trailbait" && !!cin7);

  async function ensureCallEntry(): Promise<string> {
    if (activeCallId) return activeCallId;
    // Concurrent calls share the in-flight insert instead of double-inserting
    if (callEntryInsertRef.current) return callEntryInsertRef.current;
    const insertPromise = (async (): Promise<string> => {
    const { data, error } = await supabase
      .from("call_list")
      .insert({
        lead_id:        lead.id,
        channel,
        priority_rank:  99,
        call_reason:    "Direct",
        scheduled_date: localToday(),
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
    })();
    callEntryInsertRef.current = insertPromise;
    try {
      return await insertPromise;
    } catch (err) {
      callEntryInsertRef.current = null; // allow retry after a failed insert
      throw err;
    }
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
      setNotesDirty(false); // notes were persisted with the outcome
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
    setNotesDirty(false);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  async function lookupLusha() {
    setLushaLoading(true);
    setLushaError(null);
    try {
      const { data, error } = await supabase.functions.invoke("sales-lusha-lookup", {
        body: { lead_id: lead.id, action: "enrich" },
      });
      if (error) throw new Error(error.message);
      if (!data?.found && !data?.company && !data?.scraped) setLushaError("Not found");
      queryClient.invalidateQueries({ queryKey: ["sales_lead", leadId] });
    } catch (err: any) {
      setLushaError(err.message ?? "Lookup failed");
    } finally {
      setLushaLoading(false);
    }
  }

  async function revealLusha() {
    setLushaLoading(true);
    setLushaError(null);
    try {
      const { data, error } = await supabase.functions.invoke("sales-lusha-lookup", {
        body: { lead_id: lead.id, action: "reveal" },
      });
      if (error) throw new Error(error.message);
      if (data?.mobile) {
        setNumberRevealed(true);
        queryClient.invalidateQueries({ queryKey: ["sales_lead", leadId] });
      } else {
        setLushaError("Not found in Lusha");
      }
    } catch (err: any) {
      setLushaError(err.message ?? "Reveal failed");
    } finally {
      setLushaLoading(false);
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

  // score_breakdown stores { factor_name: { weight, sub_score, contribution } }
  // plus flat enrichment metadata — keep only the per-factor objects.
  type ScoreFactor = { name: string; weight: number; subScore: number; contribution: number };
  const scoreFactors: ScoreFactor[] = lead.score_breakdown
    ? Object.entries(lead.score_breakdown)
        .filter(([, v]) => v !== null && typeof v === "object" && "contribution" in (v as object) && "weight" in (v as object))
        .map(([k, v]) => {
          const obj = v as { weight: number; sub_score: number; contribution: number };
          return {
            name:         k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            weight:       obj.weight ?? 0,
            subScore:     obj.sub_score ?? 0,
            contribution: Math.round((obj.contribution ?? 0) * 10) / 10,
          };
        })
        .sort((a, b) => b.contribution - a.contribution)
    : [];
  const scoreTotal = Math.round(scoreFactors.reduce((s, f) => s + f.contribution, 0) * 10) / 10;

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
              <a href={`https://go.cin7.com/Customer#guid=${lead.cin7_customer_id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> Cin7
              </a>
            )}
          </div>
        </div>

        {/* Company phone — click-to-dial via Dialpad CTI */}
        {phone && (
          <a href={`tel:${phone}`}
            className="mt-4 inline-flex items-center gap-2 text-2xl font-mono font-semibold text-primary hover:text-primary/80 transition-colors">
            <PhoneCall className="w-5 h-5" />
            {phone}
          </a>
        )}
      </div>

      {/* AI-generated sales brief — 3 bullets summarising every raw signal we
          have on the lead (website summary, tender context, key products,
          HubSpot notes, channel pitch). Raw inputs are available under
          "Show source data" for the salesperson who wants to verify. */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-400">Sales Brief</div>
            {briefLoading && <Loader2 className="w-3 h-3 animate-spin text-amber-400/70" />}
          </div>
          <div className="flex items-center gap-2">
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
            <button
              onClick={() => generateBrief(true)}
              disabled={briefLoading}
              title="Regenerate brief from latest raw data"
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-amber-500/30 text-amber-400/80 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3 h-3", briefLoading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {briefBullets?.length ? (
          <ul className="space-y-2">
            {briefBullets.map((point, i) => (
              <li key={i} className="text-sm text-foreground/85 flex gap-2.5 leading-relaxed">
                <span className="text-amber-400 font-bold flex-shrink-0">·</span>
                {point}
              </li>
            ))}
          </ul>
        ) : briefLoading ? (
          <p className="text-sm text-muted-foreground italic">Generating brief from raw data…</p>
        ) : briefError ? (
          <p className="text-sm text-red-400">Brief failed: {briefError}</p>
        ) : (
          <p className="text-sm text-muted-foreground/60 italic">No brief yet — click Refresh to generate one.</p>
        )}

        {/* Source data — collapsed by default. Each section labels where the
            information came from so the salesperson can verify the brief. */}
        <div className="mt-3 pt-3 border-t border-amber-500/15">
          <button
            onClick={() => setShowBriefSource(!showBriefSource)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/70 hover:text-amber-400 transition-colors"
          >
            {showBriefSource ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Source data
          </button>
          {showBriefSource && (
            <div className="mt-3 space-y-3 text-xs text-foreground/65 leading-relaxed">
              {/* Discovery provenance — always shown */}
              <SourceBlock label={`Discovery · ${DISCOVERY_LABEL[lead.discovery_source] ?? lead.discovery_source}`}>
                {lead.discovery_query && <span>Query: <span className="font-mono text-foreground/80">"{lead.discovery_query}"</span> · </span>}
                <span>Found {new Date(lead.created_at).toLocaleDateString("en-AU")}</span>
              </SourceBlock>

              {/* Google Places */}
              {(lead.google_rating != null || lead.google_place_id) && (
                <SourceBlock label="Google Places API">
                  {lead.google_rating != null && (
                    <span>{lead.google_rating}★ ({lead.google_review_count ?? 0} reviews)</span>
                  )}
                  {address && <span> · {address}</span>}
                  {lead.google_place_id && (
                    <>
                      {" · "}
                      <a
                        href={`https://www.google.com/maps/place/?q=place_id:${lead.google_place_id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-amber-400 hover:underline"
                      >
                        View on Maps ↗
                      </a>
                    </>
                  )}
                </SourceBlock>
              )}

              {/* Website summary — enrichment scrape */}
              {companySummary && (
                <SourceBlock
                  label={`Website summary · enrichment scrape${lead.website ? ` of ${cleanDomain(lead.website)}` : ""}`}
                >
                  <p>{companySummary}</p>
                  {lead.website && (
                    <a
                      href={lead.website} target="_blank" rel="noopener noreferrer"
                      className="text-amber-400 hover:underline mt-1 inline-block"
                    >
                      {lead.website} ↗
                    </a>
                  )}
                </SourceBlock>
              )}

              {/* Company profile — Apollo / Lusha */}
              {(lead.industry || lead.employee_count || lead.founded_year || lead.company_description) && (
                <SourceBlock label="Company profile · Apollo / Lusha enrichment">
                  {[
                    lead.industry        && `Industry: ${lead.industry}`,
                    lead.employee_count  && `${lead.employee_count} employees`,
                    lead.founded_year    && `Founded ${lead.founded_year}`,
                    lead.annual_revenue_estimate && `Revenue est: ${lead.annual_revenue_estimate}`,
                    lead.abn             && `ABN ${lead.abn}`,
                  ].filter(Boolean).join(" · ")}
                  {lead.company_description && <p className="mt-1">{lead.company_description}</p>}
                </SourceBlock>
              )}

              {/* Key products */}
              {lead.key_products_services?.length ? (
                <SourceBlock label="Key products & services · enrichment AI from website">
                  <p>{lead.key_products_services.join(", ")}</p>
                </SourceBlock>
              ) : null}

              {/* Contact */}
              {contactName && (
                <SourceBlock
                  label={`Recommended contact${contactSource ? ` · ${contactSource}` : ""}`}
                >
                  <p>{contactName}</p>
                </SourceBlock>
              )}

              {/* Tender context */}
              {tenderContext && (
                <SourceBlock label="Tender / contract · AusTender OCDS or news scrape">
                  <p>{tenderContext}</p>
                </SourceBlock>
              )}

              {/* HubSpot notes */}
              {priorNotes.length > 0 && (
                <SourceBlock label={`Prior contact · HubSpot timeline (${priorNotes.length})`}>
                  <ul className="space-y-1">
                    {priorNotes.slice(0, 3).map((n, i) => (
                      <li key={i}>
                        <span className="font-mono text-foreground/40 mr-1.5">{n.date}</span>
                        {n.body}
                      </li>
                    ))}
                  </ul>
                </SourceBlock>
              )}

              {/* Talking points — call list generator */}
              {callEntry?.talking_points?.length ? (
                <SourceBlock label="Talking points · call list generator AI">
                  <ul className="space-y-1">
                    {callEntry.talking_points.map((p: string, i: number) => (
                      <li key={i} className="flex gap-2"><span className="text-amber-400/60 flex-shrink-0">·</span>{p}</li>
                    ))}
                  </ul>
                </SourceBlock>
              ) : null}

              {/* Channel pitch — hardcoded / call list AI */}
              <SourceBlock label={`Channel pitch · ${brief.recommended_pitch ? "call list AI" : "hardcoded house line"}`}>
                <p>{housePitch}</p>
              </SourceBlock>

              {/* Cin7 (TrailBait only) */}
              {channel === "trailbait" && cin7 && (
                <SourceBlock label="Order history · Cin7 daily sync">
                  <div>
                    Last order {cin7.last_order ?? "—"} ·{" "}
                    {cin7.order_count_30d ?? 0} orders (30d) ·{" "}
                    avg ${Math.round(cin7.avg_order_value ?? 0).toLocaleString()}
                  </div>
                </SourceBlock>
              )}

              {!hasAnySource && (
                <p className="italic text-foreground/40">
                  No enrichment data yet — only discovery metadata above. Run enrichment to populate.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

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

          {lead.lusha_mobile && numberRevealed ? (
            <a href={`tel:${lead.lusha_mobile}`} className="flex items-center gap-1.5 text-sm font-mono font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
              <PhoneCall className="w-3.5 h-3.5" />
              {lead.lusha_mobile}
            </a>
          ) : (lead.lusha_contact_id || lead.lusha_mobile) ? (
            <button
              onClick={revealLusha}
              disabled={lushaLoading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {lushaLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
              {lushaLoading ? "Revealing…" : "Reveal number"}
            </button>
          ) : contactName ? (
            <div className="flex items-center gap-2 pt-0.5">
              <button
                onClick={lookupLusha}
                disabled={lushaLoading}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-border hover:bg-muted/50 transition-colors disabled:opacity-50 text-muted-foreground"
              >
                {lushaLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
                {lushaLoading ? "Enriching…" : "Find & Enrich"}
              </button>
              {lushaError && <span className="text-xs text-muted-foreground/60">{lushaError}</span>}
            </div>
          ) : null}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors truncate">
              {lead.email}
            </a>
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

      {/* Company intel */}
      <CompanyIntel lead={lead} />

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

      {/* Dialpad call history */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <PhoneCall className="w-3.5 h-3.5" />
          Call History
        </div>
        <CallHistory leadId={lead?.id} />
      </div>

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
          onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
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

      {/* Score breakdown — explains where lead_score came from */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Score Breakdown
          </div>
          <div className="flex items-center gap-3">
            {scoreFactors.length > 0 && (
              <div className="text-xs text-muted-foreground font-mono">
                Total <span className="text-foreground font-semibold">{scoreTotal}</span> / 100
              </div>
            )}
            <button
              onClick={rescore}
              disabled={rescoring}
              title="Re-run scoring using the current lead data"
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border hover:bg-muted/50 transition-colors disabled:opacity-50 text-muted-foreground"
            >
              <RefreshCw className={cn("w-3 h-3", rescoring && "animate-spin")} />
              {rescoring ? "Scoring…" : "Rescore"}
            </button>
          </div>
        </div>
        {rescoreError && (
          <p className="text-xs text-red-400">Rescore failed: {rescoreError}</p>
        )}
        {scoreFactors.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 italic">
            Not scored yet — this lead hasn't been through the scoring pass.
          </p>
        ) : (
          <div className="space-y-1.5">
            {scoreFactors.map((f) => {
              const fillPct = f.weight > 0 ? Math.max(0, Math.min(100, (f.contribution / f.weight) * 100)) : 0;
              const isZero  = f.contribution === 0;
              return (
                <div key={f.name} className={cn("grid grid-cols-[1fr_auto] gap-x-3 items-center", isZero && "opacity-50")}>
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-foreground/80 truncate">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono flex-shrink-0">
                        weight {f.weight}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted/40 rounded-sm overflow-hidden mt-0.5">
                      <div
                        className="h-full bg-amber-400/80 rounded-sm transition-all"
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-foreground/90 w-12 text-right">
                    +{f.contribution.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
