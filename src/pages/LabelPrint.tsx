/**
 * /labels/print?ids=<guide ids>[&brand=key][&logo=key][&stock=99012][&copies=n][&preview=1]
 *
 * Chrome-free label render route for the browser print pipeline. Outputs only
 * label markup: `@page` sized to the DYMO stock with zero margin, one label per
 * printed page, absolute millimetre positioning, system fonts only, no shadows.
 * The QR is an inline SVG (qrcode.react) so it stays crisp on the 300dpi head.
 *
 * Normally loaded inside the hidden iframe that `printLabels()` creates; it
 * posts `labels:ready` to the parent once every QR and logo has
 * rendered so the parent can call print(). Opened directly it prints itself,
 * unless `preview=1` is set.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@guide/integrations/supabase/client";
import { labelLogoUrl, resolveLabelLogoKey } from "@guide/lib/dymoLabel";
import { LABEL_STOCK, SCAN_LINES, codeLines, computeLabelLayout, resolveLabelStock, type Box, type LabelStockKey } from "@portal/lib/labels/labelStock";
import type { LabelPrintMessage } from "@portal/lib/labels/printLabels";

interface GuideRow { id: string; title: string; product_code: string | null; slug: string }
interface BrandRow { id: string; key: string; name: string; domain: string; dymo_label_size: string | null; label_logo?: string | null }
interface PubRow { instruction_set_id: string; brand_id: string; status: string }

export interface LabelData {
  key: string;
  url: string;
  productCode: string;
  title: string;
  logoSrc: string | null;
}

const mm = (n: number) => `${n.toFixed(3)}mm`;
const abs = (b: Box): CSSProperties => ({ position: "absolute", left: mm(b.x), top: mm(b.y), width: mm(b.w), height: mm(b.h) });

/** Page + label CSS for one stock. Everything else on the page is inline so nothing from the portal shell leaks in. */
/**
 * The label box is a hair smaller than the page so px rounding of the mm
 * values can never overflow the page box and feed a blank label.
 */
const PAGE_SLACK_MM = 0.3;

export function stockCss(stock: LabelStockKey): string {
  const { width, height } = LABEL_STOCK[stock];
  return `
@page { size: ${mm(width)} ${mm(height)}; margin: 0; }
html, body, #root { margin: 0; padding: 0; height: auto; min-height: 0; background: #fff; color: #000; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.label { position: relative; width: ${mm(width - PAGE_SLACK_MM)}; height: ${mm(height - PAGE_SLACK_MM)}; overflow: hidden; background: #fff; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
.label:last-child { page-break-after: auto; break-after: auto; }
.label * { box-sizing: border-box; }
/* Only the label sheet may reach the page box: portal chrome that mounts on
   every route (mention/shortcut helpers, toast + dialog portals appended to
   body) would otherwise lay out as flow content after the last label and
   push a blank page onto the roll. */
body > :not(#root), #root > :not([data-labels]) { display: none !important; }
[data-labels] { display: block; }
.fit { white-space: nowrap; overflow: hidden; line-height: 1.15; }
@media screen {
  body { background: #d4d4d4; padding: 8mm; }
  .label { margin: 0 auto 4mm; outline: 1px solid #888; }
}
`;
}

/** Shrink any `[data-fit]` text that overflows its box, down to a 4pt floor. */
function fitTexts(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-fit]").forEach(el => {
    let size = parseFloat(getComputedStyle(el).fontSize);
    const floor = (4 * 96) / 72;
    let guard = 40;
    while (el.scrollWidth > el.clientWidth + 0.5 && size > floor && guard-- > 0) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  });
}

export function Label({ data, stock }: { data: LabelData; stock: LabelStockKey }) {
  const lay = computeLabelLayout(stock, !!data.logoSrc);
  const lines = codeLines(stock, data.productCode, data.title);
  const pt = (p: number) => `${p}pt`;
  const ref = useRef<HTMLDivElement>(null);
  // Shrink overflowing text before first paint so the label is print-ready as soon as it is in the DOM.
  useLayoutEffect(() => { if (ref.current) fitTexts(ref.current); }, [data, stock]);
  return (
    <div ref={ref} className="label" data-label={data.key}>
      {lay.logo && data.logoSrc && (
        <div style={{ ...abs(lay.logo), display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={data.logoSrc} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
        </div>
      )}
      {lay.scan && (
        <div style={{ ...abs(lay.scan), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", fontWeight: 700, fontSize: pt(lay.spec.fonts.scan) }}>
          {SCAN_LINES.map(l => <span key={l} className="fit" data-fit style={{ maxWidth: "100%" }}>{l}</span>)}
        </div>
      )}
      <div style={{ ...abs(lay.code), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        {lines.map((l, i) => (
          <span key={i} className="fit" data-fit style={{ maxWidth: "100%", fontSize: pt(l.size), fontWeight: l.bold ? 700 : 400 }}>{l.text}</span>
        ))}
      </div>
      <div style={abs(lay.qr)}>
        <QRCodeSVG value={data.url} size={256} level="M" marginSize={0} fgColor="#000000" bgColor="#ffffff" style={{ width: "100%", height: "100%", display: "block" }} shapeRendering="crispEdges" />
      </div>
    </div>
  );
}

function whenImagesSettled(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  return Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise<void>(res => {
    img.addEventListener("load", () => res(), { once: true });
    img.addEventListener("error", () => res(), { once: true });
  }))).then(() => undefined);
}

function post(msg: LabelPrintMessage) {
  if (window.parent && window.parent !== window) window.parent.postMessage(msg, window.location.origin);
}

export default function LabelPrint() {
  const [params] = useSearchParams();
  const ids = useMemo(() => (params.get("ids") ?? "").split(",").map(s => s.trim()).filter(Boolean), [params]);
  const brandKey = params.get("brand");
  const logoParam = params.get("logo");
  const stockParam = params.get("stock");
  const copies = Math.max(1, Math.min(50, parseInt(params.get("copies") ?? "1", 10) || 1));
  const preview = params.get("preview") === "1";
  const rootRef = useRef<HTMLDivElement>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["label-print", ids, brandKey],
    enabled: ids.length > 0,
    queryFn: async () => {
      const [guides, brands, pubs] = await Promise.all([
        supabase.from("instruction_sets").select("id, title, product_code, slug").in("id", ids),
        supabase.from("brands").select("*").order("name"),
        supabase.from("guide_publications").select("instruction_set_id, brand_id, status").in("instruction_set_id", ids),
      ]);
      for (const r of [guides, brands, pubs]) if (r.error) throw r.error;
      return { guides: (guides.data ?? []) as GuideRow[], brands: (brands.data ?? []) as BrandRow[], pubs: (pubs.data ?? []) as PubRow[] };
    },
  });

  // One stock per job (the printer holds one roll): explicit param, else the first label's brand setting.
  const built = useMemo(() => {
    if (!data) return null;
    const { guides, brands, pubs } = data;
    const forced = brandKey ? brands.find(b => b.key === brandKey) ?? null : null;
    const byId = new Map(guides.map(g => [g.id, g]));
    const labels: LabelData[] = [];
    let stock: LabelStockKey | null = stockParam ? resolveLabelStock(stockParam) : null;
    for (const id of ids) {
      const g = byId.get(id);
      if (!g) continue;
      const published = pubs.find(p => p.instruction_set_id === g.id && p.status === "published");
      const brand = forced ?? brands.find(b => b.id === published?.brand_id) ?? brands[0];
      if (!brand) continue;
      stock ??= resolveLabelStock(brand.dymo_label_size);
      const logoKey = resolveLabelLogoKey(logoParam ?? brand.label_logo);
      const base: LabelData = {
        key: `${g.id}-${brand.key}`,
        url: `https://${brand.domain}/${g.slug}`,
        productCode: (g.product_code || g.slug || "").trim(),
        title: g.title ?? "",
        logoSrc: labelLogoUrl(logoKey),
      };
      for (let c = 0; c < copies; c++) labels.push({ ...base, key: `${base.key}-${c}` });
    }
    return { labels, stock: stock ?? resolveLabelStock(null) };
  }, [data, ids, brandKey, logoParam, stockParam, copies]);

  // Report errors to the opener so it can surface them instead of hanging.
  useEffect(() => {
    if (!ids.length) post({ type: "labels:error", message: "No label ids supplied" });
    else if (error) post({ type: "labels:error", message: (error as any)?.message ?? "Failed to load labels" });
    else if (built && built.labels.length === 0) post({ type: "labels:error", message: "None of the requested guides were found" });
  }, [ids, error, built]);

  // Once the labels are in the DOM: fit text, wait for logos, then tell the
  // parent (or print directly when opened stand-alone).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !built || built.labels.length === 0) return;
    let cancelled = false;
    (async () => {
      fitTexts(root);
      await whenImagesSettled(root);
      await (document.fonts?.ready ?? Promise.resolve());
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      fitTexts(root);
      if (window.parent && window.parent !== window) post({ type: "labels:ready", count: built.labels.length });
      else if (!preview) window.print();
    })();
    return () => { cancelled = true; };
  }, [built, preview]);

  if (!ids.length) return <p style={{ fontFamily: "Arial, sans-serif", padding: 16 }}>No label ids supplied.</p>;
  if (error) return <p style={{ fontFamily: "Arial, sans-serif", padding: 16 }}>Failed to load labels: {(error as any)?.message}</p>;
  if (isLoading || !built) return null;
  if (built.labels.length === 0) return <p style={{ fontFamily: "Arial, sans-serif", padding: 16 }}>No guides found for the requested ids.</p>;

  return (
    <>
      <style>{stockCss(built.stock)}</style>
      <div ref={rootRef} data-labels data-stock={built.stock} data-count={built.labels.length}>
        {built.labels.map(l => <Label key={l.key} data={l} stock={built.stock} />)}
      </div>
    </>
  );
}
