// Guide auto-delivery: Shopify order → matched guides → email (Resend).
// Backed by edge function `guide-delivery` and tables guide_delivery_settings /
// guide_product_links / guide_deliveries.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@guide/integrations/supabase/client";
import { useInstructionSets, useBrands } from "@guide/hooks/use-supabase-query";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Badge } from "@guide/components/ui/badge";
import { Switch } from "@guide/components/ui/switch";
import { Textarea } from "@guide/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@guide/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@guide/components/ui/table";
import { toast } from "sonner";
import { Loader2, RefreshCw, Send, Mail, Link2, Trash2, ExternalLink, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Delivery = {
  id: string; shopify_order_id: number; order_name: string | null; order_created_at: string | null;
  customer_name: string | null; customer_email: string | null; source: string; status: string;
  line_items: { sku: string | null; title: string; quantity: number }[];
  matched_guides: { sku: string; title: string; url: string; match: string }[];
  unmatched_skus: string[]; error: string | null; sent_at: string | null; created_at: string; attempts: number;
  fulfilled_at: string | null; send_after: string | null; refreshed_at: string | null;
};
type Settings = {
  id: number; enabled: boolean; brand_id: string | null; from_email: string; reply_to: string | null; bcc_email: string | null;
  subject: string; intro_text: string; auto_match: boolean; poll_lookback_hours: number; delay_hours: number;
};
type Link = { id: string; sku: string; instruction_set_id: string | null; note: string | null };

const NONE = "__none__";

async function callFn(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("guide-delivery", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

const statusVariant = (s: string) =>
  s === "sent" ? "default" : s === "failed" ? "destructive" : s === "scheduled" || s === "pending" ? "secondary" : "outline";

export default function Deliveries() {
  const qc = useQueryClient();
  const { data: guides = [] } = useInstructionSets();
  const { data: brands = [] } = useBrands();

  const settingsQ = useQuery({
    queryKey: ["guide_delivery_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guide_delivery_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as Settings;
    },
  });
  const linksQ = useQuery({
    queryKey: ["guide_product_links"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guide_product_links").select("*").order("sku");
      if (error) throw error;
      return data as Link[];
    },
  });
  const deliveriesQ = useQuery({
    queryKey: ["guide_deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guide_deliveries").select("*")
        .order("order_created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data as Delivery[];
    },
    refetchInterval: 60_000,
  });

  const deliveries = deliveriesQ.data ?? [];
  const stats = useMemo(() => ({
    sent: deliveries.filter((d) => d.status === "sent").length,
    pending: deliveries.filter((d) => d.status === "scheduled" || d.status === "pending").length,
    failed: deliveries.filter((d) => d.status === "failed").length,
    skipped: deliveries.filter((d) => d.status === "skipped").length,
  }), [deliveries]);

  // SKUs seen on orders that didn't match — the mapping to-do list.
  const unmatchedCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deliveries) for (const s of d.unmatched_skus ?? []) m.set(s, (m.get(s) ?? 0) + 1);
    const linked = new Set((linksQ.data ?? []).map((l) => l.sku.toUpperCase()));
    return [...m.entries()].filter(([s]) => !linked.has(s.toUpperCase())).sort((a, b) => b[1] - a[1]);
  }, [deliveries, linksQ.data]);

  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e.message ?? String(e)); } finally { setBusy(null); }
  };

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["guide_deliveries"] });
    qc.invalidateQueries({ queryKey: ["guide_product_links"] });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Auto-delivery</h1>
          <p className="text-muted-foreground text-sm">Emails installation guides to Shopify customers {settingsQ.data?.delay_hours ?? 24}h after their order ships. The order is re-checked in Shopify at send time.</p>
        </div>
        <div className="flex items-center gap-2">
          {settingsQ.data && (
            <Badge variant={settingsQ.data.enabled ? "default" : "secondary"} className="h-7 px-3">
              {settingsQ.data.enabled ? "Live" : "Paused"}
            </Badge>
          )}
          <Button variant="outline" size="sm" disabled={busy !== null}
            onClick={() => run("poll", async () => {
              const r = await callFn({ action: "poll" });
              toast.success(`Checked ${r.scanned} recent orders — ${r.enqueued} new`);
              refreshAll();
            })}>
            {busy === "poll" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-1.5">Sync Shopify now</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Sent", stats.sent], ["Scheduled", stats.pending], ["Failed", stats.failed], ["Skipped", stats.skipped]].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="text-2xl font-semibold mt-1">{v}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Deliveries</TabsTrigger>
          <TabsTrigger value="links" className="gap-1.5">
            SKU mapping {unmatchedCounts.length > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{unmatchedCounts.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="log" className="mt-4">
          <DeliveryLog deliveries={deliveries} loading={deliveriesQ.isLoading} busy={busy}
            onResend={(id) => run(`resend:${id}`, async () => {
              const r = await callFn({ action: "resend", id });
              if (r.result?.status === "sent") toast.success("Sent"); else toast.warning(`Result: ${r.result?.status} ${r.result?.error ?? ""}`);
              refreshAll();
            })} />
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          <SkuLinks links={linksQ.data ?? []} guides={guides} unmatched={unmatchedCounts} onChange={refreshAll} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          {settingsQ.data && <SettingsForm settings={settingsQ.data} brands={brands} busy={busy} run={run}
            onSaved={() => qc.invalidateQueries({ queryKey: ["guide_delivery_settings"] })} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DeliveryLog({ deliveries, loading, busy, onResend }: {
  deliveries: Delivery[]; loading: boolean; busy: string | null; onResend: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const rows = deliveries.filter((d) => (filter === "all" || d.status === filter) &&
    (!q || `${d.order_name} ${d.customer_name} ${d.customer_email}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, name or email" className="pl-8 w-64" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all", "sent", "scheduled", "failed", "skipped"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Guides</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
            {!loading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No deliveries yet — click “Sync Shopify now”.</TableCell></TableRow>}
            {rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="whitespace-nowrap">
                  <div className="font-medium">{d.order_name ?? d.shopify_order_id}</div>
                  <div className="text-xs text-muted-foreground">{d.fulfilled_at ? `shipped ${formatDistanceToNow(new Date(d.fulfilled_at), { addSuffix: true })}` : d.order_created_at ? `ordered ${formatDistanceToNow(new Date(d.order_created_at), { addSuffix: true })}` : ""} · {d.source}</div>
                </TableCell>
                <TableCell>
                  <div>{d.customer_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{d.customer_email ?? "no email"}</div>
                </TableCell>
                <TableCell className="max-w-md">
                  {d.matched_guides.map((g) => (
                    <div key={g.url} className="text-sm flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] px-1">{g.sku}</Badge>
                      <a href={g.url} target="_blank" rel="noreferrer" className="hover:underline truncate">{g.title}</a>
                      <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                    </div>
                  ))}
                  {d.unmatched_skus.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">No guide: {d.unmatched_skus.join(", ")}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                  {d.status === "scheduled" && d.send_after && <div className="text-xs text-muted-foreground mt-1">sends {formatDistanceToNow(new Date(d.send_after), { addSuffix: true })}</div>}
                  {d.error && <div className="text-xs text-muted-foreground mt-1 max-w-[220px]">{d.error}</div>}
                  {d.sent_at && <div className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(d.sent_at), { addSuffix: true })}</div>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" disabled={busy !== null || !d.customer_email} title="Re-fetch order, re-match and send now"
                    onClick={() => onResend(d.id)}>
                    {busy === `resend:${d.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SkuLinks({ links, guides, unmatched, onChange }: {
  links: Link[]; guides: any[]; unmatched: [string, number][]; onChange: () => void;
}) {
  const [sku, setSku] = useState("");
  const [guideId, setGuideId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const sorted = useMemo(() => [...guides].sort((a, b) => (a.product_code ?? "").localeCompare(b.product_code ?? "")), [guides]);
  const guideName = (id: string | null) => {
    if (!id) return <span className="text-muted-foreground italic">Never send (suppressed)</span>;
    const g = guides.find((x) => x.id === id);
    return g ? `${g.product_code} — ${g.title}` : id;
  };

  const save = async (s: string, g: string) => {
    if (!s.trim() || !g) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("guide_product_links")
      .upsert({ sku: s.trim().toUpperCase(), instruction_set_id: g === NONE ? null : g, created_by: user?.id }, { onConflict: "sku" });
    // onConflict on the expression index isn't supported by PostgREST; fall back to delete+insert.
    if (error) {
      await supabase.from("guide_product_links").delete().ilike("sku", s.trim());
      const { error: e2 } = await supabase.from("guide_product_links")
        .insert({ sku: s.trim().toUpperCase(), instruction_set_id: g === NONE ? null : g, created_by: user?.id });
      if (e2) { toast.error(e2.message); setSaving(false); return; }
    }
    toast.success(`Mapped ${s.trim().toUpperCase()}`);
    setSku(""); setGuideId(""); setSaving(false); onChange();
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("guide_product_links").delete().eq("id", id);
    if (error) toast.error(error.message); else onChange();
  };

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4">
        <div className="rounded-lg border p-4 space-y-3">
          <div className="font-medium flex items-center gap-2"><Link2 className="w-4 h-4" /> Add a mapping</div>
          <p className="text-sm text-muted-foreground">
            Explicit mappings win over auto-matching. Auto-match links a Shopify SKU to a published guide whose product code equals the SKU, or is a prefix of it (e.g. <code>BGLBHX21</code> → <code>BGLBHX</code>).
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Shopify SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="CBT1325-2" className="w-44 mt-1 font-mono uppercase" />
            </div>
            <div className="flex-1 min-w-[260px]">
              <Label className="text-xs">Guide</Label>
              <Select value={guideId} onValueChange={setGuideId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a guide…" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value={NONE}>— Never send a guide for this SKU —</SelectItem>
                  {sorted.map((g) => <SelectItem key={g.id} value={g.id}>{g.product_code} — {g.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={saving || !sku.trim() || !guideId} onClick={() => save(sku, guideId)}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Guide</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {links.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No explicit mappings yet.</TableCell></TableRow>}
              {links.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono">{l.sku}</TableCell>
                  <TableCell>{guideName(l.instruction_set_id)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove(l.id)}><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <div className="font-medium mb-1">Unmatched SKUs on recent orders</div>
        <p className="text-xs text-muted-foreground mb-3">Click one to map it. Most are accessories with no guide — map those to “Never send” to clear them.</p>
        {unmatched.length === 0 && <div className="text-sm text-muted-foreground">Nothing outstanding 🎉</div>}
        <div className="space-y-1">
          {unmatched.map(([s, n]) => (
            <button key={s} onClick={() => setSku(s)} className="w-full flex justify-between items-center text-sm px-2 py-1.5 rounded hover:bg-muted font-mono">
              <span>{s}</span><Badge variant="secondary" className="text-[10px]">{n}×</Badge>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsForm({ settings, brands, busy, run, onSaved }: {
  settings: Settings; brands: any[]; busy: string | null;
  run: (k: string, fn: () => Promise<void>) => Promise<void>; onSaved: () => void;
}) {
  const [s, setS] = useState<Settings>(settings);
  const [testTo, setTestTo] = useState("");
  useEffect(() => setS(settings), [settings]);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setTestTo((t) => t || data.user?.email || "")); }, []);
  const set = (k: keyof Settings, v: unknown) => setS((p) => ({ ...p, [k]: v }));

  const save = () => run("save", async () => {
    const { id: _id, ...patch } = s;
    const { error } = await supabase.from("guide_delivery_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw error;
    toast.success("Settings saved"); onSaved();
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="rounded-lg border p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Auto-send after shipment</div>
            <div className="text-xs text-muted-foreground">Off = orders are still logged and matched, nothing is emailed.</div>
          </div>
          <Switch checked={s.enabled} onCheckedChange={(v) => set("enabled", v)} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Auto-match by product code</div>
            <div className="text-xs text-muted-foreground">Off = only explicit SKU mappings send.</div>
          </div>
          <Switch checked={s.auto_match} onCheckedChange={(v) => set("auto_match", v)} />
        </div>
        <div>
          <Label>Brand (guide domain + support email)</Label>
          <Select value={s.brand_id ?? ""} onValueChange={(v) => set("brand_id", v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Brand" /></SelectTrigger>
            <SelectContent>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} — {b.domain}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>From</Label>
          <Input value={s.from_email} onChange={(e) => set("from_email", e.target.value)} className="mt-1" />
          <div className="text-xs text-muted-foreground mt-1">Domain must be verified in Resend.</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Reply-to</Label><Input value={s.reply_to ?? ""} onChange={(e) => set("reply_to", e.target.value || null)} placeholder="brand support email" className="mt-1" /></div>
          <div><Label>BCC (copy of every send)</Label><Input value={s.bcc_email ?? ""} onChange={(e) => set("bcc_email", e.target.value || null)} className="mt-1" /></div>
        </div>
        <div>
          <Label>Subject</Label>
          <Input value={s.subject} onChange={(e) => set("subject", e.target.value)} className="mt-1" />
          <div className="text-xs text-muted-foreground mt-1">Placeholders: <code>{"{{order}}"}</code> <code>{"{{name}}"}</code> <code>{"{{s}}"}</code> (plural s)</div>
        </div>
        <div>
          <Label>Intro paragraph</Label>
          <Textarea value={s.intro_text} onChange={(e) => set("intro_text", e.target.value)} rows={3} className="mt-1" />
        </div>
        <div>
          <Label>Delay after shipment (hours)</Label>
          <Input type="number" min={0} max={720} value={s.delay_hours} onChange={(e) => set("delay_hours", Number(e.target.value))} className="mt-1 w-32" />
          <div className="text-xs text-muted-foreground mt-1">Email goes out this many hours after the order is marked fulfilled in Shopify. The order is re-fetched at that moment so cancellations, refunds and email changes are respected.</div>
        </div>
        <div>
          <Label>Backup poll look-back (hours)</Label>
          <Input type="number" min={1} max={720} value={s.poll_lookback_hours} onChange={(e) => set("poll_lookback_hours", Number(e.target.value))} className="mt-1 w-32" />
          <div className="text-xs text-muted-foreground mt-1">The webhook is instant; a 15-minute poll also catches anything the webhook missed.</div>
        </div>
        <Button onClick={save} disabled={busy !== null}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save settings"}</Button>
      </div>

      <div className="rounded-lg border p-5 space-y-4 h-fit">
        <div className="font-medium flex items-center gap-2"><Mail className="w-4 h-4" /> Send a test email</div>
        <p className="text-sm text-muted-foreground">Uses the saved settings and two real published guides.</p>
        <div className="flex gap-2">
          <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@…" />
          <Button variant="outline" disabled={busy !== null || !testTo} onClick={() => run("test", async () => {
            const r = await callFn({ action: "test", to: testTo });
            toast.success(`Test sent to ${r.to}`);
          })}>{busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send test"}</Button>
        </div>
        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <div><strong>How it works:</strong> Shopify fires <code>orders/fulfilled</code> → the order is scheduled for shipment + delay → when due, the portal re-fetches the order from Shopify, matches each remaining SKU to a published guide, and emails the customer. Every order is logged once (never double-sent).</div>
        </div>
      </div>
    </div>
  );
}
