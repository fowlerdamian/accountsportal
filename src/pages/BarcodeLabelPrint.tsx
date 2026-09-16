/**
 * /labels/print-barcode?title=…&sku=…&barcode=…[&subtitle=…][&notes=…][&copies=n][&preview=1]
 *
 * Chrome-free render route for the warehouse product barcode label on the
 * DYMO 99012 Large Address roll — the same browser print pipeline the Guide
 * app uses (see src/lib/labels/printLabels.ts). `@page` is the DYMO driver's
 * paper form with zero margin, one label per printed page, absolute
 * millimetre positioning from DYMO_LAYOUT (the layout the PDF preview is
 * drawn with), League Spartan embedded so the print matches the preview, the
 * EAN-13 as an inline SVG so it stays crisp on the 300dpi head, and the
 * optional logo (`logo=` key from barcodeLogos.ts) as an <img> top-right.
 *
 * Normally loaded inside the hidden iframe that `printBarcodeLabel()`
 * creates; it posts `labels:ready` to the parent once fonts are in and text
 * has been fitted so the parent can call print(). Opened directly it prints
 * itself, unless `preview=1` is set.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DYMO_LAYOUT, DYMO_LOGO_LAYOUT, barcodeValue, dymoBarcodeModule, dymoLogoTextLines, dymoNoteLines, validateBarcodeLabel,
  type BarcodeLabelInput, type DymoBarcodeBox,
} from "@portal/lib/labels/barcodeLabelPdf";
import { barcodeLogoUrl } from "@portal/lib/labels/barcodeLogos";
import { EAN13_MODULES, ean13Bars, ean13Groups, isGuardModule } from "@portal/lib/labels/ean13";
import { LEAGUE_SPARTAN_LIGHT, LEAGUE_SPARTAN_MEDIUM } from "@portal/lib/labels/leagueSpartanFonts";
import { abs, fitTexts, inPrintFrame, mm, nextPaint, postToOpener as post, stockCss, whenImagesSettled } from "@portal/lib/labels/labelPrintDom";
import { barcodeLabelFromParams } from "@portal/lib/labels/printLabels";
import type { LabelStockKey } from "@portal/lib/labels/labelStock";

/** The barcode label only prints on the Large Address roll. */
const STOCK: LabelStockKey = "99012";
const MAX_COPIES = 100;
const PT_MM = 25.4 / 72;

const FONT = "LeagueSpartan";
const LIGHT = 300;
const MEDIUM = 500;

/** Same faces the PDF embeds, so the printed label and the preview agree. */
const fontCss = `
@font-face { font-family: "${FONT}"; font-weight: ${LIGHT}; font-style: normal; src: url(data:font/ttf;base64,${LEAGUE_SPARTAN_LIGHT}) format("truetype"); }
@font-face { font-family: "${FONT}"; font-weight: ${MEDIUM}; font-style: normal; src: url(data:font/ttf;base64,${LEAGUE_SPARTAN_MEDIUM}) format("truetype"); }
.label { font-family: "${FONT}", Arial, Helvetica, sans-serif; }
`;

const pt = (p: number) => `${p}pt`;

/** EAN-13 drawn in millimetre units inside the DYMO barcode box: bars, taller guards, digits underneath. */
function Ean13({ code, box: C }: { code: string; box: DymoBarcodeBox }) {
  const module = dymoBarcodeModule(C);
  const bx = (C.w - EAN13_MODULES * module) / 2;
  const { lead, left, right } = ean13Groups(code);
  const dy = C.digitBaseline;
  return (
    <svg viewBox={`0 0 ${C.w} ${C.h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <g fill="#000" shapeRendering="crispEdges">
        {ean13Bars(code).map(([start, width]) => (
          <rect key={start} x={bx + start * module} y={0} width={width * module} height={isGuardModule(start) ? C.guardH : C.barH} />
        ))}
      </g>
      <g fill="#000" fontFamily={`${FONT}, Arial, sans-serif`} fontWeight={LIGHT} fontSize={C.digitPt * PT_MM}>
        <text x={bx - module * 1.5} y={dy} textAnchor="end">{lead}</text>
        {left.split("").map((d, i) => <text key={`l${i}`} x={bx + (3 + 7 * i + 3.5) * module} y={dy} textAnchor="middle">{d}</text>)}
        {right.split("").map((d, i) => <text key={`r${i}`} x={bx + (50 + 7 * i + 3.5) * module} y={dy} textAnchor="middle">{d}</text>)}
      </g>
    </svg>
  );
}

const row: CSSProperties = { display: "flex", alignItems: "center" };

/** BGLBDM arrangement — logo top-left, text block top-right, barcode across the bottom. */
function DymoLogoLabel({ input, code, logoSrc }: { input: BarcodeLabelInput; code: string; logoSrc: string }) {
  const { logo: L, text: X, barcode: C } = DYMO_LOGO_LAYOUT;
  const lines = dymoLogoTextLines(input);
  const lineH = Math.min(X.lineH, X.h / lines.length);
  return (
    <>
      <div style={{ ...abs(L), display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img src={logoSrc} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
      </div>
      <div style={{ ...abs(X), display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {lines.map((l, i) => (
          <span key={i} className="fit" data-fit style={{ maxWidth: "100%", height: mm(lineH), lineHeight: mm(lineH), fontSize: pt(l.bold ? X.titlePt : X.pt), fontWeight: l.bold ? MEDIUM : LIGHT }}>{l.text}</span>
        ))}
      </div>
      <div style={abs(C)}>
        <Ean13 code={code} box={C} />
      </div>
    </>
  );
}

/** AMBHX2 arrangement — no logo: title / subtitle across the top, notes + SKU bottom-left, barcode bottom-right. */
function DymoPlainLabel({ input, code }: { input: BarcodeLabelInput; code: string }) {
  const { title: T, subtitle: B, notes: N, barcode: C } = DYMO_LAYOUT;
  const subtitle = input.subtitle.trim();
  const lines = dymoNoteLines(input);
  return (
    <>
      <div style={{ ...abs(T), ...row }}>
        <span className="fit" data-fit style={{ maxWidth: "100%", fontSize: pt(T.pt), fontWeight: MEDIUM }}>{input.title.trim()}</span>
      </div>
      {subtitle && (
        <div style={{ ...abs(B), ...row }}>
          <span className="fit" data-fit style={{ maxWidth: "100%", fontSize: pt(B.pt), fontWeight: LIGHT }}>{subtitle}</span>
        </div>
      )}
      <div style={{ ...abs(N), display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        {lines.map((l, i) => (
          <span key={i} className="fit" data-fit style={{ maxWidth: "100%", height: mm(N.lineH), lineHeight: mm(N.lineH), fontSize: pt(N.pt), fontWeight: LIGHT }}>{l}</span>
        ))}
      </div>
      <div style={abs(C)}>
        <Ean13 code={code} box={C} />
      </div>
    </>
  );
}

export function DymoBarcodeLabel({ input, code }: { input: BarcodeLabelInput; code: string }) {
  const logoSrc = barcodeLogoUrl(input.logo);
  const ref = useRef<HTMLDivElement>(null);
  // Shrink overflowing text before first paint so the label is print-ready as soon as it is in the DOM.
  useLayoutEffect(() => { if (ref.current) fitTexts(ref.current); }, [input, code]);
  return (
    <div ref={ref} className="label" data-label={code}>
      {logoSrc ? <DymoLogoLabel input={input} code={code} logoSrc={logoSrc} /> : <DymoPlainLabel input={input} code={code} />}
    </div>
  );
}

export default function BarcodeLabelPrint() {
  const [params] = useSearchParams();
  const input = useMemo(() => barcodeLabelFromParams(params), [params]);
  const copies = Math.max(1, Math.min(MAX_COPIES, parseInt(params.get("copies") ?? "1", 10) || 1));
  const preview = params.get("preview") === "1";
  const rootRef = useRef<HTMLDivElement>(null);

  const firstError = useMemo(() => Object.values(validateBarcodeLabel(input))[0] ?? null, [input]);
  const code = useMemo(() => (firstError ? null : barcodeValue(input)), [input, firstError]);
  const problem = firstError ?? (code ? null : "Invalid barcode");

  // Report errors to the opener so it can surface them instead of hanging.
  useEffect(() => { if (problem) post({ type: "labels:error", message: problem }); }, [problem]);

  // Once the labels are in the DOM: wait for the embedded fonts, fit text,
  // then tell the parent (or print directly when opened stand-alone).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !code) return;
    let cancelled = false;
    (async () => {
      fitTexts(root);
      await whenImagesSettled(root);
      const fonts = document.fonts;
      if (fonts) {
        await Promise.all([fonts.load(`${MEDIUM} 16pt "${FONT}"`), fonts.load(`${LIGHT} 10pt "${FONT}"`)]).catch(() => undefined);
        await fonts.ready;
      }
      await nextPaint();
      if (cancelled) return;
      fitTexts(root);
      if (inPrintFrame()) post({ type: "labels:ready", count: copies });
      else if (!preview) window.print();
    })();
    return () => { cancelled = true; };
  }, [input, code, copies, preview]);

  if (problem || !code) return <p style={{ fontFamily: "Arial, sans-serif", padding: 16 }}>{problem}</p>;

  return (
    <>
      <style>{stockCss(STOCK)}{fontCss}</style>
      <div ref={rootRef} data-labels data-stock={STOCK} data-count={copies}>
        {Array.from({ length: copies }, (_, i) => <DymoBarcodeLabel key={i} input={input} code={code} />)}
      </div>
    </>
  );
}
