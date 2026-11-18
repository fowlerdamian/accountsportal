/**
 * /warehouse/auto-labels — product labels that print by themselves.
 *
 * A list of SKUs (table product_label_skus). When a pick containing one of
 * them is authorised in Cin7, the shipstation-webhook `poll-orders` cron
 * (the same trigger that prints the Guide labels) queues that SKU's product
 * barcode label in label_print_jobs — copies = picked quantity × "per unit" —
 * and the /labels/station PC prints it on the DYMO.
 *
 * The label itself (product, vehicle, barcode, notes, logo) is stored with
 * the SKU when it is added, filled from Cin7 exactly as the Barcode Labels
 * tab does, so what prints is what is shown here.
 */
import { Fragment, useCallback, useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@portal/lib/supabase";
import { validateBarcodeLabel, barcodeValue, type BarcodeLabelInput } from "@portal/lib/labels/barcodeLabelPdf";
import { queueBarcodeLabelPrint } from "@portal/lib/labels/queueLabelPrint";
import { splitProductName } from "@portal/lib/labels/productName";
import { BARCODE_LOGO_OPTIONS, DEFAULT_BARCODE_LOGO, resolveBarcodeLogo } from "@portal/lib/labels/barcodeLogos";

interface Row {
  sku: string;
  payload: BarcodeLabelInput;
  copies_per_unit: number;
  enabled: boolean;
  updated_at: string;
}

interface RecentJob {
  id: string;
  created_at: string;
  order_number: string | null;
  customer_name: string | null;
  sku: string | null;
  copies: number;
  status: string;
  error: string | null;
}

const LOGO_KEY = "barcode-labels:logo"; // shared with the Barcode Labels tab
const readLogo = (): string => { try { return resolveBarcodeLogo(localStorage.getItem(LOGO_KEY)); } catch { return DEFAULT_BARCODE_LOGO; } };

const parseSkus = (text: string) => [...new Set(text.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];

async function lookupCin7(sku: string): Promise<{ sku: string; name: string; barcode: string }> {
  const resp = await fetch("/api/cin7-product", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body?.error ?? `Lookup failed (${resp.status})`);
  return body.product;
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const problem = (p: BarcodeLabelInput): string | null => Object.values(validateBarcodeLabel(p))[0] ?? null;

// ─── Styles (same language as the Barcode Labels tab) ────────────────────────
const inputStyle: CSSProperties = {
  background: "#0a0a0a", border: "1px solid #222222", borderRadius: "6px",
  color: "#ffffff", fontSize: "13px", padding: "8px 10px", outline: "none",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const selectStyle: CSSProperties = { ...inputStyle, cursor: "pointer", appearance: "auto" };
const labelStyle: CSSProperties = {
  fontSize: "11px", fontFamily: '"JetBrains Mono", monospace', color: "#a0a0a0",
  textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "6px",
};
const hintStyle: CSSProperties = { fontSize: "11px", color: "#666", marginTop: "5px", lineHeight: 1.4 };
const errorStyle: CSSProperties = { ...hintStyle, color: "#e07070" };
const okStyle: CSSProperties = { ...hintStyle, color: "var(--status-success, #6fbf8a)" };
const cardStyle: CSSProperties = { background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: "8px", padding: "20px" };
const btn: CSSProperties = {
  fontSize: "12px", fontWeight: 500, padding: "9px 18px", borderRadius: "6px",
  cursor: "pointer", color: "var(--brand-accent)", border: "1px solid rgba(var(--brand-accent-rgb),0.35)",
  background: "transparent", fontFamily: "inherit", whiteSpace: "nowrap",
};
const btnOff: CSSProperties = { ...btn, color: "#555", borderColor: "#222", cursor: "not-allowed" };
const link: CSSProperties = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "12px", fontFamily: "inherit", color: "#a0a0a0", textDecoration: "underline" };
const th: CSSProperties = { ...labelStyle, display: "table-cell", marginBottom: 0, padding: "8px 10px", textAlign: "left", fontWeight: 400, borderBottom: "1px solid #1e1e1e" };
const td: CSSProperties = { padding: "10px", fontSize: "13px", color: "#e5e5e5", borderBottom: "1px solid #161616", verticalAlign: "top" };
const mono: CSSProperties = { fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" };

export default function AutoLabels() {
  const [rows, setRows] = useState<Row[]>([]);
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [logo, setLogo] = useState(readLogo);
  const [adding, setAdding] = useState(false);
  const [addLog, setAddLog] = useState<{ kind: "ok" | "err"; text: string }[]>([]);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<BarcodeLabelInput | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, { kind: "ok" | "err"; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Customers whose orders never auto-print, product or guide labels (matched on the Cin7 customer name).
  const [excluded, setExcluded] = useState<string[]>([]);
  const [customer, setCustomer] = useState("");
  const [customerMsg, setCustomerMsg] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);

  const load = useCallback(async () => {
    supabase.from("product_label_excluded_customers").select("customer").order("customer")
      .then(({ data }) => { if (data) setExcluded(data.map(r => r.customer as string)); });
    // Customer names as Cin7 sends them, for the suggestions under the box.
    supabase.from("label_print_jobs").select("customer_name").eq("source", "picked").not("customer_name", "is", null)
      .order("created_at", { ascending: false }).limit(400)
      .then(({ data }) => { if (data) setKnown([...new Set(data.map(r => String(r.customer_name).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))); });
    const [list, jobs] = await Promise.all([
      supabase.from("product_label_skus").select("sku, payload, copies_per_unit, enabled, updated_at").order("sku"),
      supabase.from("label_print_jobs").select("id, created_at, order_number, customer_name, sku, copies, status, error")
        .eq("kind", "barcode").eq("source", "picked").order("created_at", { ascending: false }).limit(15),
    ]);
    setLoadError(list.error?.message ?? null);
    if (list.data) setRows(list.data as Row[]);
    if (jobs.data) setRecent(jobs.data as RecentJob[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const note = (sku: string, kind: "ok" | "err", msg: string) => setRowMsg(m => ({ ...m, [sku]: { kind, text: msg } }));

  const add = async () => {
    const skus = parseSkus(text);
    if (!skus.length || adding) return;
    setAdding(true);
    setAddLog([]);
    const { data: auth } = await supabase.auth.getUser();
    const have = new Set(rows.map(r => r.sku));
    const failed: string[] = [];
    for (const sku of skus) {
      const log = (kind: "ok" | "err", msg: string) => setAddLog(l => [...l, { kind, text: msg }]);
      if (have.has(sku)) { log("err", `${sku} is already on the list`); continue; }
      try {
        const p = await lookupCin7(sku);
        const key = (p.sku || sku).trim().toUpperCase();
        if (have.has(key)) { log("err", `${key} is already on the list`); continue; }
        // Cin7 names run product and vehicle together; split them into the label's two lines.
        const split = splitProductName(p.name || "");
        const payload: BarcodeLabelInput = {
          title: split.product || p.name || key, subtitle: split.vehicle, notes: split.extra,
          sku: p.sku || sku, barcode: p.barcode || "", logo,
        };
        const { error } = await supabase.from("product_label_skus").insert({ sku: key, payload, created_by: auth.user?.id ?? null });
        if (error) throw new Error(error.message);
        have.add(key);
        log(p.barcode ? "ok" : "err", p.barcode ? `Added ${key} — ${p.name}` : `Added ${key} — ${p.name}, but it has no barcode in Cin7. Edit it below or it will not print.`);
      } catch (e: any) {
        failed.push(sku);
        log("err", `${sku}: ${e?.message ?? String(e)}`);
      }
    }
    setText(failed.join(", "));
    setAdding(false);
    load();
  };

  const patch = async (sku: string, values: Partial<Pick<Row, "payload" | "copies_per_unit" | "enabled">>) => {
    setRows(rs => rs.map(r => (r.sku === sku ? { ...r, ...values } : r)));
    const { error } = await supabase.from("product_label_skus").update({ ...values, updated_at: new Date().toISOString() }).eq("sku", sku);
    if (error) { note(sku, "err", error.message); load(); }
    return !error;
  };

  const remove = async (sku: string) => {
    setRows(rs => rs.filter(r => r.sku !== sku));
    const { error } = await supabase.from("product_label_skus").delete().eq("sku", sku);
    if (error) { note(sku, "err", error.message); load(); }
  };

  const testPrint = async (row: Row) => {
    if (busy) return;
    setBusy(row.sku);
    note(row.sku, "ok", "Printing…");
    try {
      const result = await queueBarcodeLabelPrint(row.payload, { copies: 1 });
      note(row.sku, "ok", result === "printed" ? "Printed 1 label" : "Queued — the print station isn't responding");
    } catch (e: any) {
      note(row.sku, "err", e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const excludeCustomer = async () => {
    const name = customer.replace(/\s+/g, " ").trim();
    if (!name) return;
    setCustomerMsg(null);
    if (excluded.some(c => c.toLowerCase() === name.toLowerCase())) { setCustomerMsg(`${name} is already excluded`); return; }
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("product_label_excluded_customers").insert({ customer: name, created_by: auth.user?.id ?? null });
    if (error) { setCustomerMsg(error.message); return; }
    setExcluded(list => [...list, name].sort((a, b) => a.localeCompare(b)));
    setCustomer("");
  };
  const includeCustomer = async (name: string) => {
    setExcluded(list => list.filter(c => c !== name));
    const { error } = await supabase.from("product_label_excluded_customers").delete().eq("customer", name);
    if (error) { setCustomerMsg(error.message); load(); }
  };

  const startEdit = (row: Row) => { setEditing(row.sku); setDraft({ ...row.payload }); };
  const saveEdit = async () => {
    if (!editing || !draft) return;
    if (await patch(editing, { payload: draft })) { setEditing(null); setDraft(null); }
  };
  const draftProblem = draft ? problem(draft) : null;
  const updDraft = (field: keyof BarcodeLabelInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(d => (d ? { ...d, [field]: e.target.value } : d));

  const count = parseSkus(text).length;
  const active = rows.filter(r => r.enabled && !problem(r.payload)).length;

  return (
    <>
      <p style={{ ...hintStyle, marginTop: 0, marginBottom: "16px" }}>
        SKUs on this list print their product label on the DYMO as soon as their pick is authorised in Cin7 — one label per unit picked.
      </p>

      <div style={{ ...cardStyle, marginBottom: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px auto", gap: "12px", alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Add SKUs</label>
            <input
              style={inputStyle} value={text} onChange={e => setText(e.target.value)} spellCheck={false}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              placeholder="TCZP, AMBHX2 — one or many, separated by commas or spaces"
            />
          </div>
          <div>
            <label style={labelStyle}>Logo</label>
            <select style={selectStyle} value={logo} onChange={e => setLogo(resolveBarcodeLogo(e.target.value))}>
              {BARCODE_LOGO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button type="button" style={count && !adding ? btn : btnOff} disabled={!count || adding} onClick={add}>
            {adding ? "Adding…" : count > 1 ? `Add ${count} SKUs` : "Add SKU"}
          </button>
        </div>
        {addLog.map((l, i) => <div key={i} style={l.kind === "ok" ? okStyle : errorStyle}>{l.text}</div>)}
      </div>

      <div style={{ ...cardStyle, padding: 0, marginBottom: "20px", overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 20px" }}>
          <span style={{ ...labelStyle, marginBottom: 0 }}>Auto-print list</span>
          <span style={{ ...hintStyle, marginTop: 0 }}>{rows.length} {rows.length === 1 ? "SKU" : "SKUs"} · {active} printing automatically</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>On</th>
              <th style={th}>SKU</th>
              <th style={th}>Label</th>
              <th style={th}>Barcode</th>
              <th style={th}>Logo</th>
              <th style={th}>Per unit</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ ...td, color: "#666", textAlign: "center", padding: "28px" }}>
                {loading ? "Loading…" : loadError ? `Couldn't load the list: ${loadError}` : "No SKUs yet. Add one above and its label prints the next time it is picked."}
              </td></tr>
            )}
            {rows.map(row => {
              const bad = problem(row.payload);
              const msg = rowMsg[row.sku];
              const isEditing = editing === row.sku && draft;
              return (
                <Fragment key={row.sku}>
                  <tr style={{ opacity: row.enabled ? 1 : 0.5 }}>
                    <td style={td}>
                      <input type="checkbox" checked={row.enabled} onChange={e => patch(row.sku, { enabled: e.target.checked })} aria-label={`Auto-print ${row.sku}`} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ ...td, ...mono, whiteSpace: "nowrap" }}>{row.sku}</td>
                    <td style={td}>
                      {row.payload.title || "—"}
                      {(row.payload.subtitle || row.payload.notes) && (
                        <span style={{ display: "block", fontSize: "11px", color: "#888" }}>{[row.payload.subtitle, row.payload.notes].filter(Boolean).join(" · ")}</span>
                      )}
                      {msg && <span style={{ display: "block", ...(msg.kind === "ok" ? okStyle : errorStyle) }}>{msg.text}</span>}
                    </td>
                    <td style={{ ...td, ...mono, whiteSpace: "nowrap" }}>
                      {bad ? <span style={{ color: "#e07070", fontFamily: "inherit" }}>Will not print — {bad}</span> : barcodeValue(row.payload)}
                    </td>
                    <td style={td}>
                      <select
                        style={{ ...selectStyle, padding: "5px 8px", fontSize: "12px", width: "150px" }} value={resolveBarcodeLogo(row.payload.logo)}
                        onChange={e => patch(row.sku, { payload: { ...row.payload, logo: resolveBarcodeLogo(e.target.value) } })}
                      >
                        {BARCODE_LOGO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <select
                        style={{ ...selectStyle, padding: "5px 8px", fontSize: "12px", width: "64px" }} value={row.copies_per_unit}
                        onChange={e => patch(row.sku, { copies_per_unit: Number(e.target.value) })} aria-label={`Labels per unit for ${row.sku}`}
                      >
                        {[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      <button type="button" style={{ ...link, marginRight: "14px" }} onClick={() => (isEditing ? (setEditing(null), setDraft(null)) : startEdit(row))}>{isEditing ? "Close" : "Edit"}</button>
                      <button type="button" style={{ ...link, marginRight: "14px", color: bad || busy ? "#555" : "var(--brand-accent)" }} disabled={!!bad || !!busy} onClick={() => testPrint(row)}>Test print</button>
                      <button type="button" style={link} onClick={() => remove(row.sku)}>Remove</button>
                    </td>
                  </tr>
                  {isEditing && draft && (
                    <tr>
                      <td style={{ ...td, background: "#070707" }} />
                      <td colSpan={6} style={{ ...td, background: "#070707" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr)) auto", gap: "12px", alignItems: "end" }}>
                          <div><label style={labelStyle}>Product</label><input style={inputStyle} value={draft.title} onChange={updDraft("title")} /></div>
                          <div><label style={labelStyle}>Vehicle</label><input style={inputStyle} value={draft.subtitle} onChange={updDraft("subtitle")} /></div>
                          <div><label style={labelStyle}>Barcode (EAN-13)</label><input style={inputStyle} value={draft.barcode} onChange={updDraft("barcode")} inputMode="numeric" /></div>
                          <div><label style={labelStyle}>Notes</label><input style={inputStyle} value={draft.notes ?? ""} onChange={updDraft("notes")} /></div>
                          <button type="button" style={draftProblem ? btnOff : btn} disabled={!!draftProblem} onClick={saveEdit}>Save</button>
                        </div>
                        {draftProblem && <div style={errorStyle}>{draftProblem}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, marginBottom: "20px" }}>
        <label style={labelStyle}>Excluded customers</label>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 420px) auto", gap: "12px", justifyContent: "start" }}>
          <input
            style={inputStyle} value={customer} onChange={e => setCustomer(e.target.value)} list="auto-label-customers" spellCheck={false}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); excludeCustomer(); } }}
            placeholder="Customer name, exactly as in Cin7"
          />
          <datalist id="auto-label-customers">{known.filter(k => !excluded.includes(k)).map(k => <option key={k} value={k} />)}</datalist>
          <button type="button" style={customer.trim() ? btn : btnOff} disabled={!customer.trim()} onClick={excludeCustomer}>Exclude</button>
        </div>
        {customerMsg && <div style={errorStyle}>{customerMsg}</div>}
        <div style={hintStyle}>Orders for these customers never auto-print — no product labels and no guide labels.</div>
        {excluded.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
            {excluded.map(name => (
              <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid #222", borderRadius: "999px", padding: "4px 6px 4px 12px", fontSize: "12px", color: "#e5e5e5" }}>
                {name}
                <button type="button" onClick={() => includeCustomer(name)} aria-label={`Stop excluding ${name}`} title="Remove" style={{ ...link, textDecoration: "none", fontSize: "14px", lineHeight: 1, padding: "0 4px" }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "14px 20px" }}><span style={{ ...labelStyle, marginBottom: 0 }}>Recently auto-printed</span></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Time</th><th style={th}>Order</th><th style={th}>Customer</th><th style={th}>SKU</th><th style={th}>Labels</th><th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, color: "#666", textAlign: "center", padding: "24px" }}>Nothing yet.</td></tr>
            )}
            {recent.map(j => (
              <tr key={j.id}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtTime(j.created_at)}</td>
                <td style={{ ...td, ...mono, whiteSpace: "nowrap" }}>{j.order_number ?? "—"}</td>
                <td style={td}>{j.customer_name ?? "—"}</td>
                <td style={{ ...td, ...mono }}>{j.sku ?? "—"}</td>
                <td style={td}>{j.copies}</td>
                <td style={{ ...td, color: j.status === "failed" ? "#e07070" : j.status === "printed" ? "var(--status-success, #6fbf8a)" : "#a0a0a0" }}>
                  {j.status}{j.status === "failed" && j.error ? ` — ${j.error}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
