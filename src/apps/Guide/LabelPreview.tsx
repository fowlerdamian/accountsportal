import { QRCodeCanvas } from "qrcode.react";
import { computeLabelLayout, codeLines, labelLogoUrl, resolveLabelLogoKey, SCAN_LINES, type Box } from "@guide/lib/dymoLabel";

interface Props {
  size: string | null | undefined;
  /** Logo key from LABEL_LOGOS, or "none". */
  logo: string | null | undefined;
  url: string;
  productCode: string;
  title?: string | null;
  /** Screen pixels per inch of label. */
  ppi?: number;
  className?: string;
}

/**
 * On-screen rendering of the DYMO label, drawn from the same layout boxes the
 * .dymo file uses, so what you see in settings is what comes off the printer.
 */
export default function LabelPreview({ size, logo, url, productCode, title, ppi = 110, className = "" }: Props) {
  const logoKey = resolveLabelLogoKey(logo);
  const logoSrc = labelLogoUrl(logoKey);
  const lay = computeLabelLayout(size, !!logoSrc);
  const px = (n: number) => Math.round(n * ppi);
  const pt = (p: number) => (p * ppi) / 72; // points → px at this scale
  const abs = (b: Box): React.CSSProperties => ({ position: "absolute", left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
  const lines = codeLines(lay.size, productCode, title);

  return (
    <div
      className={`relative bg-white text-black rounded-sm shadow-sm overflow-hidden select-none ${className}`}
      style={{ width: px(lay.spec.label.w), height: px(lay.spec.label.h), fontFamily: "Arial, Helvetica, sans-serif" }}
      aria-label="Label preview"
    >
      {lay.logo && logoSrc && (
        <div style={abs(lay.logo)} className="flex items-center justify-center">
          <img src={logoSrc} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
        </div>
      )}
      {lay.scan && (
        <div style={{ ...abs(lay.scan), fontSize: pt(lay.spec.fonts.scan), lineHeight: 1.15 }} className="flex flex-col items-center justify-center font-bold text-center whitespace-nowrap">
          {SCAN_LINES.map(l => <span key={l}>{l}</span>)}
        </div>
      )}
      <div style={{ ...abs(lay.code), lineHeight: 1.2 }} className="flex flex-col items-center justify-center text-center overflow-hidden">
        {lines.map((l, i) => (
          <span key={i} style={{ fontSize: pt(l.size), fontWeight: l.bold ? 700 : 400 }} className="whitespace-nowrap max-w-full truncate">{l.text}</span>
        ))}
      </div>
      <div style={abs(lay.qr)} className="flex items-center justify-center">
        <QRCodeCanvas value={url} size={px(lay.qr.w)} level="M" includeMargin={false} fgColor="#000000" />
      </div>
    </div>
  );
}
