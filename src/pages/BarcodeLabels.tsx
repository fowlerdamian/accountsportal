/**
 * /labels/barcode — TrailBait product barcode labels as PDF.
 *
 * Text in, PDF out. The layout is fixed (see src/lib/labels/barcodeLabelPdf.ts):
 * logo, product name, optional subtitle, SKU, EAN-13 — scaled to the chosen
 * stock size. The preview on the right is the actual PDF, so what you see is
 * what the print shop gets.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  buildBarcodeLabelPdf, barcodeLabelFileName, validateBarcodeLabel, pageSize,
  LABEL_SIZES, LABEL_SIZE_OPTIONS, DEFAULT_LABEL_SIZE, resolveLabelSize,
  type BarcodeLabelInput, type LabelOutput, type LabelSizeKey,
} from "@portal/lib/labels/barcodeLabelPdf";
import { normaliseEan13 } from "@portal/lib/labels/ean13";

const EMPTY: BarcodeLabelInput = { title: "", subtitle: "", sku: "", barcode: "" };
const PREVIEW_DEBOUNCE_MS = 250;

const OUTPUTS: { key: LabelOutput; label: string }[] = [
  { key: "proof", label: "Proof with crop marks" },
  { key: "trim",  label: "Trimmed" },
];

const LABEL_SIZE_KEY = "barcode-labels:size";
const readSize = (): LabelSizeKey => { try { return resolveLabelSize(localStorage.getItem(LABEL_SIZE_KEY)); } catch { return DEFAULT_LABEL_SIZE; } };
const writeSize = (v: LabelSizeKey) => { try { localStorage.setItem(LABEL_SIZE_KEY, v); } catch { /* private window */ } };

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
const cardStyle: CSSProperties = { background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: "8px", padding: "20px" };
const btnPrimary: CSSProperties = {
  fontSize: "12px", fontWeight: 500, padding: "9px 18px", borderRadius: "6px",
  cursor: "pointer", color: "var(--brand-accent)", border: "1px solid rgba(var(--brand-accent-rgb),0.35)",
  background: "transparent", transition: "background 120ms", fontFamily: "inherit",
};
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

export default function BarcodeLabels() {
  const [input, setInput] = useState<BarcodeLabelInput>(EMPTY);
  const [output, setOutput] = useState<LabelOutput>("proof");
  const [size, setSize] = useState<LabelSizeKey>(readSize);
  const [copies, setCopies] = useState("1");
  useEffect(() => { writeSize(size); }, [size]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const errors = useMemo(() => validateBarcodeLabel(input), [input]);
  const valid = Object.keys(errors).length === 0;
  const ean = useMemo(() => normaliseEan13(input.barcode), [input.barcode]);
  const copiesN = Math.max(1, Math.min(500, parseInt(copies, 10) || 1));

  const upd = (field: keyof BarcodeLabelInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInput(v => ({ ...v, [field]: e.target.value }));
  const touch = (field: string) => () => setTouched(t => ({ ...t, [field]: true }));
  const showError = (field: string) => (touched[field] ? errors[field] : undefined);

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

  const download = () => {
    setTouched({ title: true, subtitle: true, sku: true, barcode: true });
    if (!valid) return;
    buildBarcodeLabelPdf(input, { output, size, copies: copiesN }).save(barcodeLabelFileName(input));
  };

  const stock = LABEL_SIZES[size];
  const [pw, ph] = pageSize(output, size);
  const outputHint = output === "proof"
    ? `${stock.w} × ${stock.h} mm label centred on a ${pw} × ${ph} mm page with crop marks`
    : `${stock.w} × ${stock.h} mm page, no marks`;

  return (
    <div style={{ flex: 1, overflowY: "auto", width: "100%" }}>
      <div style={{ padding: "32px 24px", maxWidth: "1100px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 600, color: "#ffffff", margin: 0, letterSpacing: "-0.01em" }}>Barcode Labels</h1>
          <p style={{ fontSize: "12px", color: "#a0a0a0", margin: "4px 0 0", fontFamily: '"JetBrains Mono", monospace' }}>
            TrailBait product label · EAN-13 · PDF
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 400px) 1fr", gap: "20px", alignItems: "start" }}>
          {/* ── Inputs ─────────────────────────────────────────────────── */}
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "16px" }}>
            <Field label="Product name" error={showError("title")} hint="Printed bold in capitals">
              <input
                style={showError("title") ? inputErrorStyle : inputStyle}
                value={input.title} onChange={upd("title")} onBlur={touch("title")}
                placeholder="Cross Bar Z Bracket" autoFocus
              />
            </Field>
            <Field label="Subtitle (optional)" hint="Small line under the name, e.g. (PAIR)">
              <input style={inputStyle} value={input.subtitle} onChange={upd("subtitle")} placeholder="(Pair)" />
            </Field>
            <Field label="SKU" error={showError("sku")}>
              <input
                style={showError("sku") ? inputErrorStyle : inputStyle}
                value={input.sku} onChange={upd("sku")} onBlur={touch("sku")}
                placeholder="TCZP"
              />
            </Field>
            <Field
              label="Barcode (EAN-13)"
              error={showError("barcode")}
              hint={ean.ok
                ? `Encodes ${ean.code}${input.barcode.replace(/[\s-]/g, "").length === 12 ? " (check digit added)" : ""}`
                : "13 digits, or 12 and the check digit is added"}
            >
              <input
                style={showError("barcode") ? inputErrorStyle : inputStyle}
                value={input.barcode} onChange={upd("barcode")} onBlur={touch("barcode")}
                placeholder="9360281002218" inputMode="numeric"
              />
            </Field>

            <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <Field label="Label size" hint="The design scales to fit; proportions stay the same">
                <select style={selectStyle} value={size} onChange={e => setSize(resolveLabelSize(e.target.value))}>
                  {LABEL_SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Output" hint={outputHint}>
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

            <div style={{ display: "flex", alignItems: "center", gap: "12px", paddingTop: "4px" }}>
              <button type="button" onClick={download} style={valid ? btnPrimary : btnDisabled}
                onMouseEnter={e => { if (valid) e.currentTarget.style.background = "rgba(var(--brand-accent-rgb),0.1)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                Download PDF{copiesN > 1 ? ` (${copiesN} pages)` : ""}
              </button>
              {!valid && <span style={{ fontSize: "11px", color: "#666" }}>Fill in the fields above</span>}
            </div>
          </div>

          {/* ── Preview ────────────────────────────────────────────────── */}
          <div style={{ ...cardStyle, minHeight: "420px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={labelStyle}>Preview</span>
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
      </div>
    </div>
  );
}
