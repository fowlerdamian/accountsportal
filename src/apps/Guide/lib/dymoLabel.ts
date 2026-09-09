/**
 * DYMO Connect (.dymo) label builder for guide QR labels.
 *
 * Produces XML in the exact shape DYMO Connect 1.5 writes itself (DYMOLabel
 * Version 3): every object carries a <Name>, multi-line text is one
 * <LineTextSpan> per line, and the QR code is a native <QRCodeObject> so DYMO
 * renders it at print resolution. Validated against the DYMO Connect Web
 * Service RenderLabel endpoint for all three supported label sizes.
 *
 * `computeLabelLayout` is the single source of truth for where things sit on
 * the label; both the XML here and the on-screen preview
 * (components/LabelPreview.tsx) are drawn from it so they always match.
 *
 * Coordinates are inches, origin top-left of the label.
 */

export type DymoLabelSize = "99012" | "30332" | "30334";

export interface Box { x: number; y: number; w: number; h: number }

interface SizeSpec {
  /** Human name shown in settings. */
  name: string;
  /** LabelName DYMO Connect uses for this paper. */
  labelName: string;
  /** Physical label size. */
  label: { w: number; h: number };
  /** Printable area DYMO Connect reports for the paper. */
  rect: Box;
  /** wide = logo + text on the left, QR on the right. square = QR with code underneath. */
  layout: "wide" | "square";
  /** Font sizes in points. 0 = element not shown on this size. */
  fonts: { scan: number; code: number; title: number };
}

export const DYMO_LABEL_SPECS: Record<DymoLabelSize, SizeSpec> = {
  // 99012 / S0722400 Large Address 36×89mm — the default.
  "99012": {
    name: "99012 — Large Address (36×89mm)",
    labelName: "LargeAddressS0722400",
    label: { w: 3.5, h: 1.4 },
    rect: { x: 0.2233, y: 0.06, w: 3.2033, h: 1.3067 },
    layout: "wide",
    fonts: { scan: 9, code: 7, title: 5.5 },
  },
  // 30334 Multi-Purpose 57×32mm.
  "30334": {
    name: "30334 — Multi-Purpose (57×32mm)",
    labelName: "Small30334",
    label: { w: 2.25, h: 1.25 },
    rect: { x: 0.12, y: 0.12, w: 2.01, h: 1.01 },
    layout: "wide",
    fonts: { scan: 7, code: 6, title: 0 },
  },
  // 30332 Square 25×25mm.
  "30332": {
    name: "30332 — Square (25×25mm)",
    labelName: "Small30332",
    label: { w: 1, h: 1 },
    rect: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 },
    layout: "square",
    fonts: { scan: 0, code: 5.5, title: 0 },
  },
};

export const DYMO_LABEL_SIZES = (Object.keys(DYMO_LABEL_SPECS) as DymoLabelSize[]).map(value => ({ value, label: DYMO_LABEL_SPECS[value].name }));

export const DEFAULT_DYMO_LABEL_SIZE: DymoLabelSize = "99012";

export function resolveDymoLabelSize(size: string | null | undefined): DymoLabelSize {
  return size && size in DYMO_LABEL_SPECS ? (size as DymoLabelSize) : DEFAULT_DYMO_LABEL_SIZE;
}

// ---------------------------------------------------------------------------
// Logos

/** Logos selectable on the label. Files live in public/label-logos (same origin, so canvas re-encoding is never tainted). */
export interface LabelLogo { key: string; name: string; url: string }

export const LABEL_LOGOS: LabelLogo[] = [
  { key: "trailbait", name: "TrailBait", url: "/label-logos/trailbait.png" },
  { key: "aga", name: "Automotive Group Australia", url: "/label-logos/aga.png" },
  { key: "fleetcraft", name: "FleetCraft", url: "/label-logos/fleetcraft.png" },
  { key: "ultravision", name: "Ultra Vision", url: "/label-logos/ultravision.png" },
];

export const NO_LOGO = "none";
export const DEFAULT_LABEL_LOGO = "trailbait";

/** Normalise a stored/selected logo key: unknown values fall back to the TrailBait default. */
export function resolveLabelLogoKey(key: string | null | undefined): string {
  if (key === NO_LOGO) return NO_LOGO;
  return key && LABEL_LOGOS.some(l => l.key === key) ? key : DEFAULT_LABEL_LOGO;
}

export function labelLogoUrl(key: string | null | undefined): string | null {
  return LABEL_LOGOS.find(l => l.key === key)?.url ?? null;
}

export function labelLogoName(key: string | null | undefined): string {
  return LABEL_LOGOS.find(l => l.key === key)?.name ?? "No logo";
}

// ---------------------------------------------------------------------------
// Layout

export interface LabelLayout {
  size: DymoLabelSize;
  spec: SizeSpec;
  /** Logo box, absent when no logo or the size has no room for one. */
  logo?: Box;
  /** "SCAN HERE FOR INSTRUCTIONS" box, absent on the square label. */
  scan?: Box;
  /** Product code (+ title on the large label). */
  code: Box;
  qr: Box;
}

/** Breathing room inside the printable area, and between the text column and the QR. */
const PAD = 0.07;
const GAP = 0.12;
const ROW_GAP = 0.04;

export function computeLabelLayout(sizeIn: string | null | undefined, hasLogo: boolean): LabelLayout {
  const size = resolveDymoLabelSize(sizeIn);
  const spec = DYMO_LABEL_SPECS[size];
  const r = spec.rect;
  const inner: Box = { x: r.x + PAD, y: r.y + PAD, w: r.w - 2 * PAD, h: r.h - 2 * PAD };

  if (spec.layout === "square") {
    const qrSide = inner.h * 0.76;
    return {
      size, spec,
      qr: { x: inner.x + (inner.w - qrSide) / 2, y: inner.y, w: qrSide, h: qrSide },
      code: { x: inner.x, y: inner.y + qrSide + ROW_GAP, w: inner.w, h: inner.h - qrSide - ROW_GAP },
    };
  }

  const qrSide = inner.h;
  const qr: Box = { x: inner.x + inner.w - qrSide, y: inner.y, w: qrSide, h: qrSide };
  const col = { x: inner.x, w: qr.x - GAP - inner.x };
  const H = inner.h;
  if (hasLogo) {
    const logoH = H * 0.28, scanH = H * 0.40, codeH = H - logoH - scanH - 2 * ROW_GAP;
    return {
      size, spec, qr,
      logo: { x: col.x, y: inner.y, w: col.w, h: logoH },
      scan: { x: col.x, y: inner.y + logoH + ROW_GAP, w: col.w, h: scanH },
      code: { x: col.x, y: inner.y + logoH + scanH + 2 * ROW_GAP, w: col.w, h: codeH },
    };
  }
  const scanH = H * 0.62, codeH = H - scanH - ROW_GAP;
  return {
    size, spec, qr,
    scan: { x: col.x, y: inner.y, w: col.w, h: scanH },
    code: { x: col.x, y: inner.y + scanH + ROW_GAP, w: col.w, h: codeH },
  };
}

export const SCAN_LINES = ["SCAN HERE FOR", "INSTRUCTIONS"];

/** Text lines for the product-code block, given the size's font budget. */
export function codeLines(sizeIn: string | null | undefined, productCode: string, title?: string | null): { text: string; size: number; bold: boolean }[] {
  const spec = DYMO_LABEL_SPECS[resolveDymoLabelSize(sizeIn)];
  const lines = [{ text: productCode.trim(), size: spec.fonts.code, bold: true }];
  const t = (title ?? "").trim();
  if (t && spec.fonts.title > 0) lines.push({ text: t.length > 44 ? `${t.slice(0, 43)}…` : t, size: spec.fonts.title, bold: false });
  return lines;
}

// ---------------------------------------------------------------------------
// XML

export interface DymoLabelInput {
  /** Brand's configured label size (brands.dymo_label_size). Unknown values fall back to 99012. */
  size: string | null | undefined;
  /** URL the QR code should open. */
  url: string;
  productCode: string;
  title?: string | null;
  /** Base64-encoded PNG of the logo (no data: prefix). Omitted on the square label. */
  logoBase64?: string | null;
}

export const escapeXml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const num = (n: number) => n.toFixed(4).replace(/\.?0+$/, "");

const colour = (a: number, rgb: number) =>
  `<SolidColorBrush><Color A="${a}" R="${rgb}" G="${rgb}" B="${rgb}"></Color></SolidColorBrush>`;

/** Brush block shared by every object. `opaque` gives the object a white background (used by the QR). */
const brushes = (opaque: boolean) => `<Brushes>
        <BackgroundBrush>${opaque ? colour(1, 1) : colour(0, 0)}</BackgroundBrush>
        <BorderBrush>${colour(1, 0)}</BorderBrush>
        <StrokeBrush>${colour(1, 0)}</StrokeBrush>
        <FillBrush>${opaque ? colour(1, 0) : colour(0, 0)}</FillBrush>
      </Brushes>
      <Rotation>Rotation0</Rotation>
      <OutlineThickness>1</OutlineThickness>
      <IsOutlined>False</IsOutlined>
      <BorderStyle>SolidLine</BorderStyle>
      <Margin>
        <DYMOThickness Left="0" Top="0" Right="0" Bottom="0" />
      </Margin>`;

const layoutXml = (b: Box) => `<ObjectLayout>
        <DYMOPoint>
          <X>${num(b.x)}</X>
          <Y>${num(b.y)}</Y>
        </DYMOPoint>
        <Size>
          <Width>${num(b.w)}</Width>
          <Height>${num(b.h)}</Height>
        </Size>
      </ObjectLayout>`;

interface TextLine { text: string; size: number; bold?: boolean }

/** ShrinkToFit keeps the requested point size and only shrinks if a line would overflow. */
const textObject = (name: string, lines: TextLine[], box: Box) => `
    <TextObject>
      <Name>${name}</Name>
      ${brushes(false)}
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <FitMode>ShrinkToFit</FitMode>
      <IsVertical>False</IsVertical>
      <FormattedText>
        <FitMode>ShrinkToFit</FitMode>
        <HorizontalAlignment>Center</HorizontalAlignment>
        <VerticalAlignment>Middle</VerticalAlignment>
        <IsVertical>False</IsVertical>${lines.map(l => `
        <LineTextSpan>
          <TextSpan>
            <Text>${escapeXml(l.text)}</Text>
            <FontInfo>
              <FontName>Arial</FontName>
              <FontSize>${l.size}</FontSize>
              <IsBold>${l.bold ? "True" : "False"}</IsBold>
              <IsItalic>False</IsItalic>
              <IsUnderline>False</IsUnderline>
              <FontBrush>${colour(1, 0)}</FontBrush>
            </FontInfo>
          </TextSpan>
        </LineTextSpan>`).join("")}
      </FormattedText>
      ${layoutXml(box)}
    </TextObject>`;

const imageObject = (name: string, pngBase64: string, box: Box) => `
    <ImageObject>
      <Name>${name}</Name>
      ${brushes(false)}
      <Data>${pngBase64}</Data>
      <ScaleMode>Uniform</ScaleMode>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      ${layoutXml(box)}
    </ImageObject>`;

const qrObject = (name: string, url: string, box: Box) => `
    <QRCodeObject>
      <Name>${name}</Name>
      ${brushes(true)}
      <BarcodeFormat>QRCode</BarcodeFormat>
      <Data>
        <DataString>${escapeXml(url)}</DataString>
      </Data>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <Size>AutoFit</Size>
      <EQRCodeType>QRCodeText</EQRCodeType>
      <TextDataHolder>
        <Value>${escapeXml(url)}</Value>
      </TextDataHolder>
      ${layoutXml(box)}
    </QRCodeObject>`;

/** Build the .dymo XML document (no BOM, LF line endings). */
export function buildDymoLabelXml(input: DymoLabelInput): string {
  const lay = computeLabelLayout(input.size, !!input.logoBase64);
  const { spec } = lay;
  const { rect } = spec;

  const parts: string[] = [];
  if (lay.logo && input.logoBase64) parts.push(imageObject("Logo", input.logoBase64, lay.logo));
  if (lay.scan) parts.push(textObject("ScanText", SCAN_LINES.map(text => ({ text, size: spec.fonts.scan, bold: true })), lay.scan));
  parts.push(textObject("ProductCode", codeLines(lay.size, input.productCode, input.title), lay.code));
  parts.push(qrObject("QRCode", input.url, lay.qr));

  return `<?xml version="1.0" encoding="utf-8"?>
<DesktopLabel Version="1">
  <DYMOLabel Version="3">
    <Description>DYMO Label</Description>
    <Orientation>Landscape</Orientation>
    <LabelName>${spec.labelName}</LabelName>
    <InitialLength>0</InitialLength>
    <BorderStyle>SolidLine</BorderStyle>
    <DYMORect>
      <DYMOPoint>
        <X>${num(rect.x)}</X>
        <Y>${num(rect.y)}</Y>
      </DYMOPoint>
      <Size>
        <Width>${num(rect.w)}</Width>
        <Height>${num(rect.h)}</Height>
      </Size>
    </DYMORect>
    <BorderColor>${colour(1, 0)}</BorderColor>
    <BorderThickness>1</BorderThickness>
    <Show_Border>False</Show_Border>
    <DynamicLayoutManager>
      <RotationBehavior>ClearObjects</RotationBehavior>
      <LabelObjects>${parts.join("")}
      </LabelObjects>
    </DynamicLayoutManager>
  </DYMOLabel>
  <LabelApplication>Blank</LabelApplication>
  <DataTable>
    <Columns></Columns>
    <Rows></Rows>
  </DataTable>
</DesktopLabel>`;
}

/** Bytes DYMO Connect expects on disk: UTF-8 with BOM and CRLF line endings. */
export function dymoLabelFileContents(xml: string): string {
  return "﻿" + xml.replace(/\r?\n/g, "\r\n");
}

/**
 * Browser-only: load an image URL and return it as base64 PNG, re-encoding
 * through a canvas so SVG/WebP/JPEG logos all become PNG (the only raster
 * format DYMO Connect reliably decodes). Returns null on any failure so the
 * label is still produced without a logo.
 */
export async function fetchLogoAsPngBase64(url: string, maxPx = 600): Promise<string | null> {
  if (typeof document === "undefined") return null;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo load failed"));
      img.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1] || null;
  } catch {
    return null;
  }
}
