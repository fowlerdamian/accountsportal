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
 * Returns null if rendering fails (logged) — the audit then proceeds text-only.
 */
export async function renderMarkdownToImage(markdown: string): Promise<RenderedImage | null> {
  if (!markdown || typeof document === 'undefined') return null;
  let container: HTMLDivElement | null = null;
  try {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown as any, { remarkPlugins: [remarkGfm] }, markdown)
    );

    container = document.createElement('div');
    // Self-contained inline styles (don't depend on app CSS that html2canvas may choke on).
    container.innerHTML =
      `<style>
        .__doc * { box-sizing: border-box; color: #111; font-family: Arial, Helvetica, sans-serif; }
        .__doc { font-size: 13px; line-height: 1.5; }
        .__doc h1 { font-size: 22px; margin: 0 0 8px; } .__doc h2 { font-size: 18px; margin: 16px 0 6px; }
        .__doc h3 { font-size: 15px; margin: 12px 0 4px; }
        .__doc table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .__doc th, .__doc td { border: 1px solid #999; padding: 4px 8px; text-align: left; vertical-align: top; }
        .__doc th { background: #eee; }
        .__doc code, .__doc pre { font-family: monospace; background: #f3f3f3; }
        .__doc pre { padding: 8px; overflow: hidden; white-space: pre-wrap; }
      </style>
      <div class="__doc">${html}</div>`;
    // On-screen but behind everything (off-screen `fixed` elements often capture blank).
    Object.assign(container.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      zIndex: '-1',
      width: '794px', // ~A4 width @ 96dpi
      padding: '32px',
      background: '#ffffff',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(container);

    const canvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 1,
      logging: false,
      width: container.offsetWidth,
      height: container.offsetHeight,
      windowWidth: 794,
      scrollX: 0,
      scrollY: 0,
    });

    if (!canvas.width || !canvas.height) {
      console.error('[render-preview] empty canvas', canvas.width, canvas.height);
      return null;
    }

    // Cap height so very long docs don't produce an oversized payload.
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
    const data = dataUrl.split(',')[1] || '';
    if (data.length < 100) {
      console.error('[render-preview] image too small', data.length);
      return null;
    }
    console.log('[render-preview] captured', out.width + 'x' + out.height, Math.round(data.length / 1024) + 'KB');
    return { mime: 'image/jpeg', data };
  } catch (e) {
    console.error('[render-preview] failed:', e);
    return null;
  } finally {
    if (container && container.parentNode) container.parentNode.removeChild(container);
  }
}
