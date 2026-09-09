/**
 * DYMO Connect (.dymo) label builder for guide QR labels.
 *
 * Produces XML in the exact shape DYMO Connect 1.5 writes itself (DYMOLabel
 * Version 3): every object carries a <Name>, multi-line text is one
 * <LineTextSpan> per line, and the QR code is a native <QRCodeObject> so DYMO
 * renders it at print resolution. Validated against the DYMO Connect Web
 * Service RenderLabel endpoint for all three supported label sizes.
 *
 * Coordinates are inches, origin top-left of the label.
 */

export type DymoLabelSize = "99012" | "30332" | "30334";

interface Box { x: number; y: number; w: number; h: number }

interface SizeSpec {
  /** LabelName DYMO Connect uses for this paper. */
  labelName: string;
  /** Printable area DYMO Connect reports for the paper. */
  rect: Box;
  /** wide = logo + text on the left, QR on the right. square = QR with code underneath. */
  layout: "wide" | "square";
}

export const DYMO_LABEL_SPECS: Record<DymoLabelSize, SizeSpec> = {
  // 99012 / S0722400 Large Address 36×89mm — the default.
  "99012": { labelName: "LargeAddressS0722400", rect: { x: 0.2233, y: 0.06, w: 3.2033, h: 1.3067 }, layout: "wide" },
  // 30334 Multi-Purpose 57×32mm.
  "30334": { labelName: "Small30334", rect: { x: 0.12, y: 0.12, w: 2.01, h: 1.01 }, layout: "wide" },
  // 30332 Square 25×25mm.
  "30332": { labelName: "Small30332", rect: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }, layout: "square" },
};

export const DEFAULT_DYMO_LABEL_SIZE: DymoLabelSize = "99012";

export function resolveDymoLabelSize(size: string | null | undefined): DymoLabelSize {
  return size && size in DYMO_LABEL_SPECS ? (size as DymoLabelSize) : DEFAULT_DYMO_LABEL_SIZE;
}

export interface DymoLabelInput {
  /** Brand's configured label size (brands.dymo_label_size). Unknown values fall back to 99012. */
  size: string | null | undefined;
  /** URL the QR code should open. */
  url: string;
  productCode: string;
  title?: string | null;
  /** Base64-encoded PNG of the brand logo (no data: prefix). Omitted on the square label. */
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

const layout = (b: Box) => `<ObjectLayout>
        <DYMOPoint>
          <X>${num(b.x)}</X>
          <Y>${num(b.y)}</Y>
        </DYMOPoint>
        <Size>
          <Width>${num(b.w)}</Width>
          <Height>${num(b.h)}</Height>
        </Size>
      </ObjectLayout>`;

interface TextLine { text: string; font?: string; size: number; bold?: boolean }

const textObject = (name: string, lines: TextLine[], box: Box, align: "Left" | "Center" | "Right") => `
    <TextObject>
      <Name>${name}</Name>
      ${brushes(false)}
      <HorizontalAlignment>${align}</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <FitMode>AlwaysFit</FitMode>
      <IsVertical>False</IsVertical>
      <FormattedText>
        <FitMode>AlwaysFit</FitMode>
        <HorizontalAlignment>${align}</HorizontalAlignment>
        <VerticalAlignment>Middle</VerticalAlignment>
        <IsVertical>False</IsVertical>${lines.map(l => `
        <LineTextSpan>
          <TextSpan>
            <Text>${escapeXml(l.text)}</Text>
            <FontInfo>
              <FontName>${l.font ?? "Arial"}</FontName>
              <FontSize>${l.size}</FontSize>
              <IsBold>${l.bold ? "True" : "False"}</IsBold>
              <IsItalic>False</IsItalic>
              <IsUnderline>False</IsUnderline>
              <FontBrush>${colour(1, 0)}</FontBrush>
            </FontInfo>
          </TextSpan>
        </LineTextSpan>`).join("")}
      </FormattedText>
      ${layout(box)}
    </TextObject>`;

const imageObject = (name: string, pngBase64: string, box: Box) => `
    <ImageObject>
      <Name>${name}</Name>
      ${brushes(false)}
      <Data>${pngBase64}</Data>
      <ScaleMode>Uniform</ScaleMode>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      ${layout(box)}
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
      ${layout(box)}
    </QRCodeObject>`;

function wideLayout(rect: Box, input: DymoLabelInput, codeLines: TextLine[]): string {
  const gap = 0.08;
  const qrSide = rect.h;
  const qr: Box = { x: rect.x + rect.w - qrSide, y: rect.y, w: qrSide, h: qrSide };
  const col = { x: rect.x, w: rect.w - qrSide - gap };
  const scanLines: TextLine[] = [
    { text: "SCAN HERE FOR", size: 14, bold: true },
    { text: "INSTRUCTIONS", size: 14, bold: true },
  ];
  const parts: string[] = [];
  if (input.logoBase64) {
    parts.push(imageObject("Logo", input.logoBase64, { x: col.x, y: rect.y, w: col.w, h: rect.h * 0.30 }));
    parts.push(textObject("ScanText", scanLines, { x: col.x, y: rect.y + rect.h * 0.32, w: col.w, h: rect.h * 0.40 }, "Center"));
    parts.push(textObject("ProductCode", codeLines, { x: col.x, y: rect.y + rect.h * 0.74, w: col.w, h: rect.h * 0.26 }, "Center"));
  } else {
    parts.push(textObject("ScanText", scanLines, { x: col.x, y: rect.y, w: col.w, h: rect.h * 0.68 }, "Center"));
    parts.push(textObject("ProductCode", codeLines, { x: col.x, y: rect.y + rect.h * 0.70, w: col.w, h: rect.h * 0.30 }, "Center"));
  }
  parts.push(qrObject("QRCode", input.url, qr));
  return parts.join("");
}

function squareLayout(rect: Box, input: DymoLabelInput, codeLines: TextLine[]): string {
  const qrSide = rect.h * 0.78;
  const qr: Box = { x: rect.x + (rect.w - qrSide) / 2, y: rect.y, w: qrSide, h: qrSide };
  return [
    qrObject("QRCode", input.url, qr),
    // Only the product code fits legibly on a 25mm label.
    textObject("ProductCode", codeLines.slice(0, 1), { x: rect.x, y: rect.y + rect.h * 0.80, w: rect.w, h: rect.h * 0.20 }, "Center"),
  ].join("");
}

/** Build the .dymo XML document (no BOM, LF line endings). */
export function buildDymoLabelXml(input: DymoLabelInput): string {
  const size = resolveDymoLabelSize(input.size);
  const spec = DYMO_LABEL_SPECS[size];
  const { rect } = spec;

  const codeLines: TextLine[] = [{ text: input.productCode.trim(), font: "Arial", size: 9, bold: true }];
  const title = (input.title ?? "").trim();
  // Only the large label has room for a title line without shrinking the code illegibly.
  if (title && size === "99012") codeLines.push({ text: title.length > 40 ? `${title.slice(0, 39)}…` : title, size: 7 });

  const objects = spec.layout === "wide" ? wideLayout(rect, input, codeLines) : squareLayout(rect, input, codeLines);

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
      <LabelObjects>${objects}
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
