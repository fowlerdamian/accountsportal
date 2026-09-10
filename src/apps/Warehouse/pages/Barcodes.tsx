/**
 * /warehouse/barcodes — TrailBait product barcode labels (Warehouse sub-app).
 *
 * Type a SKU to pull the product name and EAN-13 from Cin7 Core (or fill the
 * fields by hand), then download the label as a PDF in the chosen stock size
 * or as a DYMO Connect .dymo file. The layout is fixed
 * (see src/lib/labels/barcodeLabelPdf.ts) and the preview on the right is the
 * actual PDF, so what you see is what prints.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  buildBarcodeLabelPdf, barcodeLabelFileName, validateBarcodeLabel, barcodeValue, pageSize,
  LABEL_SIZES, LABEL_SIZE_OPTIONS, DEFAULT_LABEL_SIZE, resolveLabelSize,
  type BarcodeLabelInput, type LabelOutput, type LabelSizeKey,
} from "@portal/lib/labels/barcodeLabelPdf";
import { buildDymoLabelFile, dymoLabelFileName } from "@portal/lib/labels/dymoLabelFile";

const EMPTY: BarcodeLabelInput = { title: "", subtitle: "", sku: "", barcode: "", notes: "" };
const PREVIEW_DEBOUNCE_MS = 250;

const OUTPUTS: { key: LabelOutput; label: string }[] = [
  { key: "proof", label: "Proof with crop marks" },
  { key: "trim",  label: "Trimmed" },
];

const LABEL_SIZE_KEY = "barcode-labels:size";
const readSize = (): LabelSizeKey => { try { return resolveLabelSize(localStorage.getItem(LABEL_SIZE_KEY)); } catch { return DEFAULT_LABEL_SIZE; } };
const writeSize = (v: LabelSizeKey) => { try { localStorage.setItem(LABEL_SIZE_KEY, v); } catch { /* private window */ } };

/** Save a text file through a temporary link (same-origin blob, so no popup rules apply). */
function saveTextFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Cin7Product { sku: string; name: string; barcode: string }

async function lookupCin7(sku: string): Promise<Cin7Product> {
  const resp = await fetch("/api/cin7-product", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body?.error ?? `Lookup failed (${resp.status})`);
  return body.product as Cin7Product;
}

// ─── Styles (match the Logistics design language) ────────────────────────────
const inputStyle: CSSProperties = {
  background: "#0a0a0a", border: "1px solid #222222", borderRadius: "6px",
  color: "#ffffff", fontSize: "13px", padding: "8px 10px", outline: "none",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const inputErrorStyle: CSSProperties = { ...inputStyle, borderColor: "rgba(158,42,43,0.7)" };
const selectStyle: CSSProperties = { ...inputStyle, cursor: "pointer", appearance: "auto" };
const labelStyle: CSSProperties = {
  fontSize: "11px", fontFamily: '"JetBrains Mono", monospace', color: "#a0a0a0",
  textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "6px",
};
const hintStyle: CSSProperties = { fontSize: "11px", color: "#666", marginTop: "5px", lineHeight: 1.4 };
const errorStyle: CSSProperties = { ...hintStyle, color: "#e07070" };
const okStyle: CSSProperties = { ...hintStyle, color: "var(--status-success, #6fbf8a)" };
const cardStyle: CSSProperties = { background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: "8px", padding: "20px" };
const btnPrimary: CSSProperties = {
  fontSize: "12px", fontWeight: 500, padding: "9px 18px", borderRadius: "6px",
  cursor: "pointer", color: "var(--brand-accent)", border: "1px solid rgba(var(--brand-accent-rgb),0.35)",
  background: "transparent", transition: "background 120ms", fontFamily: "inherit", whiteSpace: "nowrap",
};
const btnGhost: CSSProperties = { ...btnPrimary, color: "#a0a0a0", borderColor: "#222" };
const btnDisabled: CSSProperties = { ...btnPrimary, color: "#555", borderColor: "#222", cursor: "not-allowed" };

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
      {error ? <div style={errorStyle}>{error}</div> : hint ? <div style={hintStyle}>{hint}</div> : null}
    </div>
  );
}

function Button({ kind, onClick, children }: { kind: "primary" | "ghost" | "disabled"; onClick: () => void; children: React.ReactNode }) {
  const style = kind === "primary" ? btnPrimary : kind === "ghost" ? btnGhost : btnDisabled;
  return (
    <button
      type="button" onClick={onClick} style={style} disabled={kind === "disabled"}
      onMouseEnter={e => { if (kind !== "disabled") e.currentTarget.style.background = "rgba(var(--brand-accent-rgb),0.1)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

export default function BarcodeLabels() {
  const [input, setInput] = useState<BarcodeLabelInput>(EMPTY);
  const [output, setOutput] = useState<LabelOutput>("proof");
  const [size, setSize] = useState<LabelSizeKey>(readSize);
  const [copies, setCopies] = useState("1");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Cin7 SKU search.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const searchGen = useRef(0);

  const isDymo = LABEL_SIZES[size].layout === "dymo";
  useEffect(() => { writeSize(size); }, [size]);

  const errors = useMemo(() => validateBarcodeLabel(input), [input]);
  const valid = Object.keys(errors).length === 0;
  const encoded = useMemo(() => barcodeValue(input), [input]);
  const copiesN = Math.max(1, Math.min(500, parseInt(copies, 10) || 1));

  const upd = (field: keyof BarcodeLabelInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setInput(v => ({ ...v, [field]: e.target.value }));
  const touch = (field: string) => () => setTouched(t => ({ ...t, [field]: true }));
  const showError = (field: string) => (touched[field] ? errors[field] : undefined);

  const search = async () => {
    const sku = query.trim();
    if (!sku || searching) return;
    const gen = ++searchGen.current;
    setSearching(true);
    setSearchMsg(null);
    try {
      const p = await lookupCin7(sku);
      if (gen !== searchGen.current) return;
      setInput(v => ({ ...v, title: p.name || v.title, sku: p.sku || sku, barcode: p.barcode || "" }));
      setTouched({ title: true, sku: true, barcode: true });
      setSearchMsg(p.barcode
        ? { kind: "ok", text: `Found ${p.sku} — ${p.name}` }
        : { kind: "err", text: `Found ${p.sku} — ${p.name}, but it has no barcode in Cin7. Enter one below.` });
    } catch (e: any) {
      if (gen !== searchGen.current) return;
      setSearchMsg({ kind: "err", text: e?.message ?? String(e) });
    } finally {
      if (gen === searchGen.current) setSearching(false);
    }
  };

  // Live preview: rebuild the (single-page) PDF a beat after typing stops.
  useEffect(() => {
    if (!valid) { setPreviewUrl(null); setPreviewError(null); return; }
    let url: string | null = null;
    const t = window.setTimeout(() => {
      try {
        const doc = buildBarcodeLabelPdf(input, { output, size, copies: 1 });
        url = URL.createObjectURL(doc.output("blob"));
        setPreviewUrl(url);
        setPreviewError(null);
      } catch (e: any) {
        setPreviewUrl(null);
        setPreviewError(e?.message ?? String(e));
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [input, output, size, valid]);

  const touchAll = () => setTouched({ title: true, subtitle: true, sku: true, barcode: true });

  const downloadPdf = () => {
    touchAll();
    if (!valid) return;
    buildBarcodeLabelPdf(input, { output, size, copies: copiesN }).save(barcodeLabelFileName(input));
  };

  const downloadDymo = () => {
    touchAll();
    const xml = buildDymoLabelFile(input);
    if (!valid || !xml) return;
    saveTextFile(dymoLabelFileName(input), xml, "application/xml");
  };

  const stock = LABEL_SIZES[size];
  const [pw, ph] = pageSize(output, size);
  const outputHint = output === "proof"
    ? `${stock.w} × ${stock.h} mm label centred on a ${pw} × ${ph} mm page with crop marks`
    : `${stock.w} × ${stock.h} mm page, no marks`;

  return (
    <>
      <p style={{ ...hintStyle, marginTop: 0, marginBottom: "16px" }}>
        Look a SKU up in Cin7 or fill the fields in, then download the label as a PDF or a DYMO file. EAN-13, League Spartan, TrailBait logo.
      </p>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 400px) 1fr", gap: "20px", alignItems: "start" }}>
          {/* ── Inputs ─────────────────────────────────────────────────── */}
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "16px" }}>
            <Field label="Find in Cin7" hint={searchMsg ? undefined : "Type a SKU and press Enter — the name and barcode fill in from Cin7 Core"}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  style={inputStyle} value={query} onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
                  placeholder="SKU, e.g. TCZP" autoFocus spellCheck={false}
                />
                <Button kind={query.trim() && !searching ? "primary" : "disabled"} onClick={search}>{searching ? "Searching…" : "Look up"}</Button>
              </div>
              {searchMsg && <div style={searchMsg.kind === "ok" ? okStyle : errorStyle}>{searchMsg.text}</div>}
            </Field>

            <div style={{ borderTop: "1px solid #1e1e1e" }} />

            <Field label="Product name" error={showError("title")} hint={isDymo ? "Printed bold, top left" : "Printed bold in capitals"}>
              <input
                style={showError("title") ? inputErrorStyle : inputStyle}
                value={input.title} onChange={upd("title")} onBlur={touch("title")}
                placeholder={isDymo ? "Bonnet Aerial Mount" : "Cross Bar Z Bracket"}
              />
            </Field>
            <Field label={isDymo ? "Second line (optional)" : "Subtitle (optional)"} hint={isDymo ? "Under the name, e.g. the vehicle fit" : "Small line under the name, e.g. (PAIR)"}>
              <input style={inputStyle} value={input.subtitle} onChange={upd("subtitle")} placeholder={isDymo ? "Hilux N90 2025.5+" : "(Pair)"} />
            </Field>
            <Field label="SKU" error={showError("sku")}>
              <input
                style={showError("sku") ? inputErrorStyle : inputStyle}
                value={input.sku} onChange={upd("sku")} onBlur={touch("sku")}
                placeholder={isDymo ? "AMBHX2" : "TCZP"}
              />
            </Field>
            <Field
              label="Barcode (EAN-13)"
              error={showError("barcode")}
              hint={encoded
                ? `Encodes ${encoded}${input.barcode.replace(/[\s-]/g, "").length === 12 ? " (check digit added)" : ""}`
                : "13 digits, or 12 and the check digit is added"}
            >
              <input
                style={showError("barcode") ? inputErrorStyle : inputStyle}
                value={input.barcode} onChange={upd("barcode")} onBlur={touch("barcode")}
                placeholder="9360281002218" inputMode="numeric"
              />
            </Field>
            <Field label="Notes (optional)" hint="DYMO layout and .dymo file only — one per line, printed above the SKU">
              <textarea
                style={{ ...inputStyle, resize: "vertical", minHeight: "58px" }} rows={2}
                value={input.notes ?? ""} onChange={upd("notes")} placeholder="Passenger Side"
              />
            </Field>

            <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <Field label="Label size" hint={isDymo ? "Warehouse DYMO template — prints 1:1 on the LabelWriter" : "The design scales to fit; proportions stay the same"}>
                <select style={selectStyle} value={size} onChange={e => setSize(resolveLabelSize(e.target.value))}>
                  {LABEL_SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="PDF output" hint={outputHint}>
                <div style={{ display: "inline-flex", border: "1px solid #222222", borderRadius: "8px", overflow: "hidden" }}>
                  {OUTPUTS.map(o => {
                    const active = o.key === output;
                    return (
                      <button
                        key={o.key} type="button" onClick={() => setOutput(o.key)}
                        style={{
                          padding: "8px 14px", fontSize: "12px", fontWeight: 500, cursor: "pointer", border: "none", fontFamily: "inherit",
                          background: active ? "rgba(var(--brand-accent-rgb),0.1)" : "transparent",
                          color: active ? "var(--brand-accent)" : "#666", transition: "color 120ms, background 120ms",
                        }}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Copies" hint="Pages in the PDF, one label per page">
                <input
                  style={{ ...inputStyle, width: "90px" }} value={copies} inputMode="numeric"
                  onChange={e => setCopies(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  onBlur={() => setCopies(String(copiesN))}
                />
              </Field>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", paddingTop: "4px" }}>
              <Button kind={valid ? "primary" : "disabled"} onClick={downloadPdf}>
                Download PDF{copiesN > 1 ? ` (${copiesN} pages)` : ""}
              </Button>
              <Button kind={valid ? "ghost" : "disabled"} onClick={downloadDymo}>Download .dymo</Button>
              {!valid && <span style={{ fontSize: "11px", color: "#666" }}>Fill in the fields above</span>}
            </div>
            <div style={{ ...hintStyle, marginTop: "-8px" }}>
              The .dymo file is the Large Address (99012) template for DYMO Connect, whatever size is picked above.
            </div>
          </div>

          {/* ── Preview ────────────────────────────────────────────────── */}
          <div style={{ ...cardStyle, minHeight: "420px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={labelStyle}>PDF preview</span>
              <span style={{ ...hintStyle, marginTop: 0 }}>{pw} × {ph} mm page</span>
            </div>
            {previewUrl ? (
              <iframe
                title="Label preview"
                src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                style={{ flex: 1, width: "100%", minHeight: "380px", border: "1px solid #222", borderRadius: "6px", background: "#fff" }}
              />
            ) : (
              <div style={{
                flex: 1, minHeight: "380px", display: "flex", alignItems: "center", justifyContent: "center",
                border: "1px dashed #222", borderRadius: "6px", color: "#555", fontSize: "12px", textAlign: "center", padding: "20px",
              }}>
                {previewError ?? "The label appears here once the product name, SKU and barcode are filled in."}
              </div>
            )}
          </div>
        </div>
    </>
  );
}
