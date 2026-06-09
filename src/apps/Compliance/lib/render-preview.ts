import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import html2canvas from 'html2canvas';

export interface RenderedImage {
  mime: string;
  data: string; // base64, no data: prefix
}

/**
 * Render a document's Markdown to a JPEG image of how it actually displays, so the
 * auditor (Gemini, multimodal) can visually inspect for broken/misrendered formatting:
 * raw HTML tags shown as text, broken tables, overflow, encoding artifacts, etc.
 *
 * Rendered exactly as the app shows it (react-markdown + remark-gfm, NO raw-HTML plugin),
 * so anything that displays wrong on screen also displays wrong in this image.
 * Returns null if rendering fails — the audit then proceeds text-only.
 */
export async function renderMarkdownToImage(markdown: string): Promise<RenderedImage | null> {
  if (!markdown || typeof document === 'undefined') return null;
  let container: HTMLDivElement | null = null;
  try {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown as any, { remarkPlugins: [remarkGfm] }, markdown)
    );

    container = document.createElement('div');
    // 'prose' gives the same typographic styling the app uses; the explicit table
    // borders mirror the document view so broken tables look broken here too.
    container.className =
      'prose prose-sm max-w-none [&_table]:w-full [&_table]:border-collapse ' +
      '[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1';
    Object.assign(container.style, {
      position: 'fixed',
      left: '-99999px',
      top: '0',
      width: '794px', // ~A4 width @ 96dpi
      padding: '32px',
      background: '#ffffff',
      color: '#111111',
      fontFamily: 'system-ui, sans-serif',
    } as Partial<CSSStyleDeclaration>);
    container.innerHTML = html;
    document.body.appendChild(container);

    const canvas = await html2canvas(container, { backgroundColor: '#ffffff', scale: 1, logging: false });

    // Cap height so very long docs don't produce an oversized payload — the top of a
    // document is where headers/metadata tables (most prone to breakage) live.
    const maxH = 5000;
    let out = canvas;
    if (canvas.height > maxH) {
      const cropped = document.createElement('canvas');
      cropped.width = canvas.width;
      cropped.height = maxH;
      cropped.getContext('2d')?.drawImage(canvas, 0, 0);
      out = cropped;
    }

    const dataUrl = out.toDataURL('image/jpeg', 0.72);
    return { mime: 'image/jpeg', data: dataUrl.split(',')[1] };
  } catch {
    return null;
  } finally {
    if (container && container.parentNode) container.parentNode.removeChild(container);
  }
}
