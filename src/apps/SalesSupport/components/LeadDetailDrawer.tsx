import { useState } from "react";
import { X, ExternalLink, Star, Globe, Phone, MapPin, User, Link, TrendingDown, TrendingUp, Minus, Loader2, PhoneCall } from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import { LeadScoreBadge } from "./LeadScoreBadge";
import { LEAD_STATUS_COLOR, LEAD_STATUS_LABEL, type Channel } from "../lib/constants";
import { useOrderHistory } from "../hooks/useSalesQueries";
import type { SalesLead } from "../hooks/useSalesQueries";
import { supabase } from "@portal/lib/supabase";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface Props {
  lead: SalesLead | null;
  onClose: () => void;
  onLeadUpdated: () => void;
}

export function LeadDetailDrawer({ lead, onClose, onLeadUpdated }: Props) {
  const [syncing, setSyncing]           = useState(false);
  const [addingToCall, setAddingToCall] = useState(false);
  const [addedToCall, setAddedToCall]   = useState(false);
  const [disqualReason, setDisqual]     = useState("");
  const [showDisqual, setShowDisqual]   = useState(false);

  const { data: orderHistory } = useOrderHistory(
    lead?.channel === "trailbait" ? (lead?.cin7_customer_id ?? null) : null
  );

  if (!lead) return null;

  const scoreFactors = lead.score_breakdown
    ? Object.entries(lead.score_breakdown)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => ({ name: k.replace(/_/g, " "), value: v as number }))
    : [];

  async function pushToHubSpot() {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("sales-hubspot-sync", {
        body: { lead_id: lead.id },
      });
      if (!error) onLeadUpdated();
    } finally {
      setSyncing(false);
    }
  }

  async function addToCallList() {
    setAddingToCall(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      // Check if already on today's list
      const { data: existing } = await supabase
        .from("call_list")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("scheduled_date", today)
        .limit(1);

      if (existing?.length) {
        setAddedToCall(true);
        return;
      }

      // Get next priority rank for today
      const { data: callList } = await supabase
        .from("call_list")
        .select("priority_rank")
        .eq("channel", lead.channel)
        .eq("scheduled_date", today)
        .order("priority_rank", { ascending: false })
        .limit(1);

      const nextRank = ((callList?.[0]?.priority_rank) ?? 0) + 1;

      await supabase.from("call_list").insert({
        lead_id:        lead.id,
        channel:        lead.channel,
        priority_rank:  nextRank,
        call_reason:    `Manually added — ${lead.website_summary?.slice(0, 100) ?? lead.company_name}`,
        talking_points: [],
        context_brief: {
          company_name:        lead.company_name,
          website:             lead.website,
          phone:               lead.phone,
          address:             lead.address,
          google_rating:       lead.google_rating,
          google_reviews:      lead.google_review_count,
          recommended_contact: lead.recommended_contact_name
            ? `${lead.recommended_contact_name}${lead.recommended_contact_position ? ", " + lead.recommended_contact_position : ""}`
            : null,
          company_summary:     lead.website_summary,
          is_existing_customer: lead.is_existing_customer,
          lead_score:          lead.lead_score,
        },
        scheduled_date: today,
      });

      setAddedToCall(true);
      setTimeout(() => setAddedToCall(false), 3000);
    } finally {
      setAddingToCall(false);
    }
  }

  async function disqualify() {
    if (!disqualReason.trim()) return;
    await supabase
      .from("sales_leads")
      .update({ status: "disqualified", disqualification_reason: disqualReason })
      .eq("id", lead.id);
    onLeadUpdated();
    onClose();
  }

  const trendIcon = () => {
    if (!orderHistory) return null;
    const expected = (orderHistory.order_count_90d / 3);
    if (orderHistory.order_count_30d < expected * 0.5) return <TrendingDown className="w-4 h-4 text-red-400" />;
    if (orderHistory.order_count_30d >= expected * 1.2) return <TrendingUp className="w-4 h-4 text-green-400" />;
    return <Minus className="w-4 h-4 text-yellow-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-card border-l border-border overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4 flex items-start justify-between">
          <div className="flex-1 min-w-0 mr-4">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-semibold truncate">{lead.company_name}</h2>
              <LeadScoreBadge score={lead.lead_score} />
              <span className={cn("text-xs px-2 py-0.5 rounded-full", LEAD_STATUS_COLOR[lead.status])}>
                {LEAD_STATUS_LABEL[lead.status]}
              </span>
            </div>
            {lead.address && (
              <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {lead.address}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted/50 transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            {lead.website && (
              <a href={lead.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted hover:bg-muted/70 text-sm transition-colors">
                <Globe className="w-3.5 h-3.5" /> Website
              </a>
            )}
            {lead.hubspot_company_id ? (
              <a href={`https://app-ap1.hubspot.com/contacts/22572063/company/${lead.hubspot_company_id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-orange-500/10 text-orange-400 text-sm hover:bg-orange-500/20 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> View in HubSpot
              </a>
            ) : (
              <button onClick={pushToHubSpot} disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted hover:bg-muted/70 text-sm transition-colors disabled:opacity-50">
                {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                Push to HubSpot
              </button>
            )}
            <button onClick={addToCallList} disabled={addingToCall || addedToCall}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted hover:bg-muted/70 text-sm transition-colors disabled:opacity-70">
              {addingToCall ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
              {addedToCall ? "Added!" : "Add to Call List"}
            </button>
            <button onClick={() => setShowDisqual(!showDisqual)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-colors">
              Disqualify
            </button>
          </div>

          {/* Disqualify form */}
          {showDisqual && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 space-y-2">
              <input
                type="text"
                placeholder="Reason for disqualification..."
                value={disqualReason}
                onChange={(e) => setDisqual(e.target.value)}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500/50"
              />
              <div className="flex gap-2">
                <button onClick={disqualify}
                  className="px-3 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors">
                  Confirm
                </button>
                <button onClick={() => setShowDisqual(false)}
                  className="px-3 py-1.5 text-xs bg-muted rounded hover:bg-muted/70 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Company summary */}
          {lead.website_summary && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Summary</h3>
              <p className="text-sm text-foreground/80 leading-relaxed">{lead.website_summary}</p>
            </section>
          )}

          {/* Contact */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Contact</h3>
            <div className="space-y-1.5">
              {lead.recommended_contact_name && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{lead.recommended_contact_name}</span>
                  {lead.recommended_contact_position && <span className="text-muted-foreground">— {lead.recommended_contact_position}</span>}
                  {lead.recommended_contact_source && <span className="text-xs text-muted-foreground/60">via {lead.recommended_contact_source}</span>}
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <a href={`tel:${lead.phone}`} className="hover:text-primary transition-colors">{lead.phone}</a>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <a href={`mailto:${lead.email}`} className="hover:text-primary transition-colors">{lead.email}</a>
                </div>
              )}
            </div>
          </section>

          {/* Google & Social */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Online Presence</h3>
            <div className="flex flex-wrap gap-4 items-center">
              {lead.google_rating != null && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  <span className="font-semibold">{lead.google_rating}</span>
                  {lead.google_review_count != null && <span className="text-muted-foreground">({lead.google_review_count} reviews)</span>}
                </div>
              )}
              {lead.social_facebook && (
                <a href={lead.social_facebook} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors">
                  <Link className="w-4 h-4" /> Facebook
                </a>
              )}
              {lead.social_instagram && (
                <a href={lead.social_instagram} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-pink-400 hover:text-pink-300 transition-colors">
                  <Link className="w-4 h-4" /> Instagram
                </a>
              )}
              {lead.social_linkedin && (
                <a href={lead.social_linkedin} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-400 transition-colors">
                  <Link className="w-4 h-4" /> LinkedIn
                </a>
              )}
            </div>
          </section>

          {/* TrailBait order history */}
          {lead.channel === "trailbait" && lead.is_existing_customer && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Order History</h3>
              {orderHistory ? (
                <div className="space-y-3">
                  {orderHistory.is_winback_candidate && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                      <TrendingDown className="w-4 h-4" />
                      Win-back candidate — {orderHistory.days_since_last_order} days since last order
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Orders (30d)", value: orderHistory.order_count_30d },
                      { label: "Orders (90d)", value: orderHistory.order_count_90d },
                      { label: "Avg Order", value: `$${Math.round(orderHistory.average_order_value ?? 0).toLocaleString()}` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-muted/30 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-semibold">{value}</div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                  {orderHistory.top_products?.length ? (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1.5">Top products</div>
                      <div className="flex flex-wrap gap-1.5">
                        {orderHistory.top_products.map((p) => (
                          <span key={p.sku} className="text-xs px-2 py-0.5 bg-muted/50 rounded border border-border">{p.name || p.sku}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2 text-sm">
                    {trendIcon()}
                    <span className="text-muted-foreground">
                      {orderHistory.order_count_30d < (orderHistory.order_count_90d / 3) * 0.5 ? "Declining" :
                       orderHistory.order_count_30d >= (orderHistory.order_count_90d / 3) * 1.2 ? "Growing" : "Stable"} order trend
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No order history loaded.</p>
              )}
            </section>
          )}

          {/* FleetCraft tender context */}
          {lead.channel === "fleetcraft" && lead.tender_context && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tender Context</h3>
              <p className="text-sm text-foreground/80 leading-relaxed bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
                {lead.tender_context}
              </p>
            </section>
          )}

          {/* Score breakdown */}
          {scoreFactors.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Score Breakdown</h3>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreFactors} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" domain={[0, 25]} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip
                      contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, fontSize: 12 }}
                    />
                    <Bar dataKey="value" fill="#f3ca0f" radius={[0, 3, 3, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Products / services */}
          {lead.key_products_services?.length ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Products & Services</h3>
              <div className="flex flex-wrap gap-1.5">
                {lead.key_products_services.map((p) => (
                  <span key={p} className="text-xs px-2 py-0.5 bg-muted/50 rounded border border-border">{p}</span>
                ))}
              </div>
            </section>
          ) : null}

          {/* Metadata */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Discovery</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Source</dt>
              <dd>{lead.discovery_source}</dd>
              <dt className="text-muted-foreground">Found</dt>
              <dd>{new Date(lead.created_at).toLocaleDateString("en-AU")}</dd>
              {lead.cin7_customer_id && (
                <>
                  <dt className="text-muted-foreground">Cin7 ID</dt>
                  <dd className="font-mono text-xs">{lead.cin7_customer_id}</dd>
                </>
              )}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
