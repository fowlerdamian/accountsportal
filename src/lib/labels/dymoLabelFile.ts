/**
 * Build a DYMO Connect `.dymo` file for a barcode label — the warehouse
 * Large Address (99012) template with the text filled in, so the label can be
 * opened, tweaked and printed from DYMO Connect on the label PC.
 *
 * The XML mirrors the AMBHX2.dymo template: title (bold 16pt) top-left, second
 * line under it, notes + "SKU:" bottom-left, EAN-13 with its text bottom-right.
 * Fonts are the template's own (Segoe UI / Arial) because DYMO Connect
 * substitutes anything not installed on that PC.
 */
import type { BarcodeLabelInput } from "./barcodeLabelPdf";
import { normaliseEan13 } from "./ean13";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BRUSHES = `
          <Brushes>
            <BackgroundBrush><SolidColorBrush><Color A="0" R="0" G="0" B="0"></Color></SolidColorBrush></BackgroundBrush>
            <BorderBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></BorderBrush>
            <StrokeBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></StrokeBrush>
            <FillBrush><SolidColorBrush><Color A="0" R="0" G="0" B="0"></Color></SolidColorBrush></FillBrush>
          </Brushes>`;

const fontInfo = (name: string, size: number, bold: boolean) => `
                <FontInfo>
                  <FontName>${name}</FontName>
                  <FontSize>${size}</FontSize>
                  <IsBold>${bold ? "True" : "False"}</IsBold>
                  <IsItalic>False</IsItalic>
                  <IsUnderline>False</IsUnderline>
                  <FontBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></FontBrush>
                </FontInfo>`;

const span = (text: string, font: string, size: number, bold: boolean) => `
            <LineTextSpan>
              <TextSpan>
                <Text>${esc(text)}</Text>${fontInfo(font, size, bold)}
              </TextSpan>
            </LineTextSpan>`;

const layout = (x: number, y: number, w: number, h: number) => `
          <ObjectLayout>
            <DYMOPoint><X>${x}</X><Y>${y}</Y></DYMOPoint>
            <Size><Width>${w}</Width><Height>${h}</Height></Size>
          </ObjectLayout>`;

function textObject(name: string, spans: string, fit: "None" | "AlwaysFit", box: [number, number, number, number]) {
  return `
        <TextObject>
          <Name>${name}</Name>${BRUSHES}
          <Rotation>Rotation0</Rotation>
          <OutlineThickness>1</OutlineThickness>
          <IsOutlined>False</IsOutlined>
          <BorderStyle>SolidLine</BorderStyle>
          <Margin><DYMOThickness Left="0" Top="0" Right="0" Bottom="0" /></Margin>
          <HorizontalAlignment>Left</HorizontalAlignment>
          <VerticalAlignment>Middle</VerticalAlignment>
          <FitMode>${fit}</FitMode>
          <IsVertical>False</IsVertical>
          <FormattedText>
            <FitMode>${fit}</FitMode>
            <HorizontalAlignment>Left</HorizontalAlignment>
            <VerticalAlignment>Middle</VerticalAlignment>
            <IsVertical>False</IsVertical>${spans}
          </FormattedText>${layout(...box)}
        </TextObject>`;
}

/** The .dymo XML, or null when the barcode is not a valid EAN-13. */
export function buildDymoLabelFile(input: BarcodeLabelInput): string | null {
  const ean = normaliseEan13(input.barcode);
  if (!ean.ok) return null;

  const title = input.title.trim();
  const subtitle = input.subtitle.trim();
  const notes = (input.notes ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const lines = [...notes, `SKU: ${input.sku.trim()}`];

  const objects = [
    textObject("ITextObject0", span(title, "Segoe UI", 16, true), "None", [0.2303423, 0.06682076, 3.162285, 0.4130743]),
    subtitle ? textObject("ITextObject1", span(subtitle, "Segoe UI", 16.3, false), "AlwaysFit", [0.2233333, 0.4024055, 1.997805, 0.3055072]) : "",
    `
        <BarcodeObject>
          <Name>IBarcodeObject0</Name>
          <Brushes>
            <BackgroundBrush><SolidColorBrush><Color A="1" R="1" G="1" B="1"></Color></SolidColorBrush></BackgroundBrush>
            <BorderBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></BorderBrush>
            <StrokeBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></StrokeBrush>
            <FillBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></FillBrush>
          </Brushes>
          <Rotation>Rotation0</Rotation>
          <OutlineThickness>1</OutlineThickness>
          <IsOutlined>False</IsOutlined>
          <BorderStyle>SolidLine</BorderStyle>
          <Margin><DYMOThickness Left="0" Top="0" Right="0" Bottom="0" /></Margin>
          <BarcodeFormat>Ean13</BarcodeFormat>
          <Data>
            <DataString>${ean.code}</DataString>
          </Data>
          <HorizontalAlignment>Center</HorizontalAlignment>
          <VerticalAlignment>Middle</VerticalAlignment>
          <Size>Small</Size>
          <TextPosition>Bottom</TextPosition>${fontInfo("Arial", 8, false)}${layout(1.318699, 0.8486786, 1.921352, 0.4342235)}
        </BarcodeObject>`,
    textObject("ITextObject2", lines.map(l => span(l, "Arial", 10, false)).join(""), "None", [0.2303423, 0.6045253, 1.051442, 0.6533329]),
  ].join("");

  return `<?xml version="1.0" encoding="utf-8"?>
<DesktopLabel Version="1">
  <DYMOLabel Version="4">
    <Description>DYMO Label</Description>
    <Orientation>Landscape</Orientation>
    <LabelName>LargeAddressS0722400</LabelName>
    <InitialLength>0</InitialLength>
    <BorderStyle>SolidLine</BorderStyle>
    <DYMORect>
      <DYMOPoint><X>0.2233333</X><Y>0.06</Y></DYMOPoint>
      <Size><Width>3.203333</Width><Height>1.306666</Height></Size>
    </DYMORect>
    <BorderColor><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></BorderColor>
    <BorderThickness>1</BorderThickness>
    <Show_Border>False</Show_Border>
    <HasFixedLength>False</HasFixedLength>
    <FixedLengthValue>0</FixedLengthValue>
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
</DesktopLabel>
`;
}

/** File name like `label-TCZP-9360281002218.dymo`. */
export function dymoLabelFileName(input: BarcodeLabelInput): string {
  const clean = (v: string) => v.trim().replace(/[^\w-]+/g, "_");
  const ean = normaliseEan13(input.barcode);
  return `label-${clean(input.sku) || "label"}-${ean.ok ? ean.code : "barcode"}.dymo`;
}
