import { jsPDF } from 'jspdf';
import { auditSupabase } from '../client';

interface PdfDocumentData {
  title: string;
  clause: string;
  generatedContent: string;
}

interface CompanyProfileData {
  companyName?: string;
  logoUrl?: string | null;
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  phone?: string;
  email?: string;
  website?: string;
  abn?: string;
  contactName?: string;
  contactTitle?: string;
  signatureDataUrl?: string | null;
}

interface HeaderConfig {
  logo_position: string;
  logo_size: number;
  company_name_size: number;
  show_address: boolean;
  show_phone: boolean;
  show_email: boolean;
  show_website: boolean;
  show_abn: boolean;
  accent_color: string;
}

const DEFAULT_HEADER_CONFIG: HeaderConfig = {
  logo_position: 'left',
  logo_size: 60,
  company_name_size: 18,
  show_address: true,
  show_phone: true,
  show_email: true,
  show_website: false,
  show_abn: false,
  accent_color: '#1a1a2e',
};

function getImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    // crossOrigin only needed for external URLs, not data URLs
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

function detectImageFormat(url: string): string {
  if (url.startsWith('data:image/png')) return 'PNG';
  if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) return 'JPEG';
  if (url.startsWith('data:image/webp')) return 'WEBP';
  if (url.startsWith('data:image/gif')) return 'GIF';
  return 'JPEG'; // default for canvas-compressed logos
}

export async function loadHeaderConfig(): Promise<HeaderConfig> {
  const { data } = await auditSupabase.from('header_config').select('*').limit(1).maybeSingle();
  return (data as HeaderConfig) || DEFAULT_HEADER_CONFIG;
}

// ── Markdown-aware content rendering ──

interface ParsedBlock {
  type: 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'numbered' | 'paragraph' | 'blank' | 'table' | 'blockquote';
  text: string;
  number?: number;
  tableRows?: string[][];
  tableHeader?: string[];
}

function parseMarkdownBlocks(content: string): ParsedBlock[] {
  const lines = content.split('\n');
  const blocks: ParsedBlock[] = [];
  let numberedCounter = 0;
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Check for table: line starts with | and contains at least one more |
    if (line.trim().startsWith('|') && line.trim().indexOf('|', 1) > 0) {
      const tableRows: string[][] = [];
      let headerRow: string[] | undefined;
      let hasHeader = false;

      while (i < lines.length) {
        const tLine = lines[i].trimEnd();
        if (!tLine.trim().startsWith('|')) break;

        // Check if this is a separator line (|---|---|)
        if (/^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?\s*$/.test(tLine.trim())) {
          hasHeader = true;
          i++;
          continue;
        }

        // Parse cells
        const cells = tLine
          .split('|')
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - (tLine.trim().endsWith('|') ? 1 : arr.length))
          .map(c => stripInlineMarkdown(c.trim()));

        // Cleaner parse: split by | and remove empty first/last from leading/trailing |
        const rawCells = tLine.split('|');
        const parsedCells: string[] = [];
        for (let ci = 0; ci < rawCells.length; ci++) {
          const cell = rawCells[ci].trim();
          if (ci === 0 && cell === '') continue;
          if (ci === rawCells.length - 1 && cell === '') continue;
          parsedCells.push(stripInlineMarkdown(cell));
        }

        if (!hasHeader && tableRows.length === 0) {
          headerRow = parsedCells;
        }
        tableRows.push(parsedCells);
        i++;
      }

      if (hasHeader && tableRows.length > 0) {
        // First row was the header
        blocks.push({
          type: 'table',
          text: '',
          tableHeader: tableRows[0],
          tableRows: tableRows.slice(1),
        });
      } else {
        blocks.push({
          type: 'table',
          text: '',
          tableRows,
        });
      }
      numberedCounter = 0;
      continue;
    }

    if (line.trim() === '') {
      blocks.push({ type: 'blank', text: '' });
      numberedCounter = 0;
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const text = line.replace(/^\s*>\s?/, '').trim();
      blocks.push({ type: 'blockquote', text: stripInlineMarkdown(text) });
      numberedCounter = 0;
    // Headings (handle #### as h3 since PDF only supports 3 levels)
    } else if (line.startsWith('#### ')) {
      blocks.push({ type: 'heading3', text: stripInlineMarkdown(line.slice(5).trim()) });
      numberedCounter = 0;
    } else if (line.startsWith('### ')) {
      blocks.push({ type: 'heading3', text: stripInlineMarkdown(line.slice(4).trim()) });
      numberedCounter = 0;
    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'heading2', text: stripInlineMarkdown(line.slice(3).trim()) });
      numberedCounter = 0;
    } else if (line.startsWith('# ')) {
      blocks.push({ type: 'heading1', text: stripInlineMarkdown(line.slice(2).trim()) });
      numberedCounter = 0;
    // Horizontal rule / separator lines
    } else if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      // Skip --- or *** separator lines
      numberedCounter = 0;
    // Bullet points
    } else if (/^\s*[-*•]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*•]\s+/, '').trim();
      blocks.push({ type: 'bullet', text: stripInlineMarkdown(text) });
    // Numbered lists
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      numberedCounter++;
      const text = line.replace(/^\s*\d+[.)]\s+/, '').trim();
      blocks.push({ type: 'numbered', text: stripInlineMarkdown(text), number: numberedCounter });
    // Bold-only lines treated as sub-headings
    } else if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      blocks.push({ type: 'heading3', text: stripInlineMarkdown(line.trim()) });
      numberedCounter = 0;
    } else {
      blocks.push({ type: 'paragraph', text: stripInlineMarkdown(line.trim()) });
      numberedCounter = 0;
    }
    i++;
  }

  return blocks;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

// ── Footer ──

function drawFooter(
  pdf: jsPDF,
  docTitle: string,
  clause: string,
  pageNum: number,
  totalPages: number,
  companyName: string,
  accentR: number,
  accentG: number,
  accentB: number
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const footerY = pageHeight - 14;

  // Separator line
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.line(margin, footerY - 4, pageWidth - margin, footerY - 4);

  pdf.setFontSize(7);
  pdf.setTextColor(140, 140, 140);
  pdf.setFont('helvetica', 'normal');

  // Left: Document title + clause
  pdf.text(`Document: ${docTitle}  |  Clause ${clause}`, margin, footerY);

  // Center: company
  pdf.text(`© ${companyName}`, pageWidth / 2, footerY, { align: 'center' });

  // Right: page
  pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, footerY, { align: 'right' });
}

// ── Main PDF generation ──

export async function generatePdf(
  doc: PdfDocumentData,
  companyProfile: CompanyProfileData | null,
  hc: HeaderConfig
): Promise<jsPDF> {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const footerBuffer = 22; // space reserved for footer
  let y = 15;

  const accentColor = hc.accent_color || '#1a1a2e';
  const r = parseInt(accentColor.slice(1, 3), 16);
  const g = parseInt(accentColor.slice(3, 5), 16);
  const b = parseInt(accentColor.slice(5, 7), 16);

  const companyName = companyProfile?.companyName || 'Company';

  // ── Page header ──
  y += 8;

  // Logo
  if (companyProfile?.logoUrl) {
    try {
      // Load image to get natural aspect ratio
      const imgDims = await getImageDimensions(companyProfile.logoUrl);
      const logoHeight = Math.min((hc.logo_size || 60) * 0.4, 25);
      const logoWidth = imgDims ? logoHeight * (imgDims.width / imgDims.height) : logoHeight;

      const logoX = hc.logo_position === 'right' ? pageWidth - margin - logoWidth
        : hc.logo_position === 'center' ? (pageWidth - logoWidth) / 2
        : margin;
      pdf.addImage(companyProfile.logoUrl, detectImageFormat(companyProfile.logoUrl), logoX, y, logoWidth, logoHeight);

      // Place company name + details next to logo (matching header preview)
      const textX = hc.logo_position === 'right' ? pageWidth - margin - logoWidth - 4
        : hc.logo_position === 'center' ? pageWidth / 2
        : margin + logoWidth + 4;
      const textAlign = hc.logo_position === 'right' ? 'right' as const
        : hc.logo_position === 'center' ? 'center' as const
        : 'left' as const;

      pdf.setFontSize(Math.min(hc.company_name_size || 18, 14));
      pdf.setTextColor(r, g, b);
      pdf.setFont('helvetica', 'bold');
      pdf.text(companyName, textX, y + 6, { align: textAlign });

      // Contact details below name
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(120, 120, 120);
      let detailY = y + 11;
      if (hc.show_address && companyProfile.address) {
        const addr = `${companyProfile.address}${companyProfile.suburb ? `, ${companyProfile.suburb}` : ''} ${companyProfile.state || ''} ${companyProfile.postcode || ''}`;
        pdf.text(addr, textX, detailY, { align: textAlign });
        detailY += 4;
      }
      const contactParts: string[] = [];
      if (hc.show_phone && companyProfile.phone) contactParts.push(`Ph: ${companyProfile.phone}`);
      if (hc.show_email && companyProfile.email) contactParts.push(companyProfile.email);
      if (hc.show_website && companyProfile.website) contactParts.push(companyProfile.website);
      if (hc.show_abn && companyProfile.abn) contactParts.push(`ABN: ${companyProfile.abn}`);
      if (contactParts.length) {
        pdf.text(contactParts.join('  |  '), textX, detailY, { align: textAlign });
        detailY += 4;
      }

      y += logoHeight + 6;
    } catch {
      // skip logo
    }
  } else {
    pdf.setFontSize(hc.company_name_size || 18);
    pdf.setTextColor(r, g, b);
    pdf.setFont('helvetica', 'bold');
    const nameX = hc.logo_position === 'center' ? pageWidth / 2 : hc.logo_position === 'right' ? pageWidth - margin : margin;
    const align = hc.logo_position === 'center' ? 'center' : hc.logo_position === 'right' ? 'right' : 'left';
    pdf.text(companyName, nameX, y, { align });
    y += 7;

    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.setFont('helvetica', 'normal');
    const details: string[] = [];
    if (hc.show_address && companyProfile?.address) {
      details.push(`${companyProfile.address}${companyProfile.suburb ? `, ${companyProfile.suburb}` : ''} ${companyProfile.state || ''} ${companyProfile.postcode || ''}`);
    }
    const contactParts: string[] = [];
    if (hc.show_phone && companyProfile?.phone) contactParts.push(`Ph: ${companyProfile.phone}`);
    if (hc.show_email && companyProfile?.email) contactParts.push(companyProfile.email);
    if (hc.show_website && companyProfile?.website) contactParts.push(companyProfile.website);
    if (hc.show_abn && companyProfile?.abn) contactParts.push(`ABN: ${companyProfile.abn}`);
    if (contactParts.length) details.push(contactParts.join('  |  '));
    details.forEach((line) => {
      pdf.text(line, margin, y);
      y += 4;
    });
  }

  // Separator
  y += 2;
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ── Document title (like "3.5 Participation and Consultation Policy") ──
  pdf.setFontSize(15);
  pdf.setTextColor(30, 30, 30);
  pdf.setFont('helvetica', 'bold');
  const titleLines = pdf.splitTextToSize(`${doc.clause}  ${doc.title}`, contentWidth);
  for (const tl of titleLines) {
    pdf.text(tl, margin, y);
    y += 7;
  }
  y += 6;

  // ── Content blocks ──
  const blocks = parseMarkdownBlocks(doc.generatedContent);

  function checkNewPage(needed: number) {
    if (y + needed > pageHeight - footerBuffer) {
      pdf.addPage();
      y = 20;
    }
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'blank':
        y += 3;
        break;

      case 'heading1': {
        checkNewPage(14);
        y += 4;
        pdf.setFontSize(13);
        pdf.setTextColor(r, g, b);
        pdf.setFont('helvetica', 'bold');
        const h1Lines = pdf.splitTextToSize(block.text.toUpperCase(), contentWidth);
        for (const hl of h1Lines) {
          checkNewPage(7);
          pdf.text(hl, margin, y);
          y += 7;
        }
        y += 2;
        break;
      }

      case 'heading2': {
        checkNewPage(12);
        y += 3;
        pdf.setFontSize(11);
        pdf.setTextColor(30, 30, 30);
        pdf.setFont('helvetica', 'bold');
        const h2Lines = pdf.splitTextToSize(block.text, contentWidth);
        for (const hl of h2Lines) {
          checkNewPage(6);
          pdf.text(hl, margin, y);
          y += 6;
        }
        y += 2;
        break;
      }

      case 'heading3': {
        checkNewPage(10);
        y += 2;
        pdf.setFontSize(10);
        pdf.setTextColor(50, 50, 50);
        pdf.setFont('helvetica', 'bold');
        const h3Lines = pdf.splitTextToSize(block.text, contentWidth);
        for (const hl of h3Lines) {
          checkNewPage(5.5);
          pdf.text(hl, margin, y);
          y += 5.5;
        }
        y += 1.5;
        break;
      }

      case 'bullet': {
        checkNewPage(6);
        pdf.setFontSize(10);
        pdf.setTextColor(40, 40, 40);
        pdf.setFont('helvetica', 'normal');
        const bulletIndent = margin + 6;
        const bulletTextWidth = contentWidth - 10;
        const bLines = pdf.splitTextToSize(block.text, bulletTextWidth);
        // Draw bullet character
        pdf.text('•', margin + 2, y);
        for (let i = 0; i < bLines.length; i++) {
          checkNewPage(5);
          pdf.text(bLines[i], bulletIndent, y);
          y += 5;
        }
        y += 1;
        break;
      }

      case 'numbered': {
        checkNewPage(6);
        pdf.setFontSize(10);
        pdf.setTextColor(40, 40, 40);
        pdf.setFont('helvetica', 'normal');
        const numIndent = margin + 8;
        const numTextWidth = contentWidth - 12;
        const nLines = pdf.splitTextToSize(block.text, numTextWidth);
        pdf.text(`${block.number}.`, margin + 1, y);
        for (let i = 0; i < nLines.length; i++) {
          checkNewPage(5);
          pdf.text(nLines[i], numIndent, y);
          y += 5;
        }
        y += 1;
        break;
      }

      case 'table': {
        const allRows = block.tableHeader
          ? [block.tableHeader, ...(block.tableRows || [])]
          : (block.tableRows || []);
        if (allRows.length === 0) break;

        const numCols = Math.max(...allRows.map(r => r.length));
        const colWidth = contentWidth / numCols;
        const cellPadding = 2;
        const rowHeight = 7;

        // Check if full table fits, else at least ensure header + 1 row
        checkNewPage(rowHeight * Math.min(allRows.length, 3) + 4);

        for (let ri = 0; ri < allRows.length; ri++) {
          const row = allRows[ri];
          const isHeader = block.tableHeader && ri === 0;

          checkNewPage(rowHeight + 2);

          // Draw row background for header
          if (isHeader) {
            pdf.setFillColor(r, g, b);
            pdf.rect(margin, y - 4.5, contentWidth, rowHeight, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.setFont('helvetica', 'bold');
          } else {
            // Alternating row shading
            if (ri % 2 === 0) {
              pdf.setFillColor(245, 245, 245);
              pdf.rect(margin, y - 4.5, contentWidth, rowHeight, 'F');
            }
            pdf.setTextColor(40, 40, 40);
            pdf.setFont('helvetica', 'normal');
          }

          pdf.setFontSize(9);

          // Draw cell borders
          pdf.setDrawColor(200, 200, 200);
          pdf.setLineWidth(0.2);
          for (let ci = 0; ci < numCols; ci++) {
            const cellX = margin + ci * colWidth;
            pdf.rect(cellX, y - 4.5, colWidth, rowHeight);
            const cellText = row[ci] || '';
            // Truncate if too long for cell
            const maxCellWidth = colWidth - cellPadding * 2;
            const truncated = pdf.splitTextToSize(cellText, maxCellWidth);
            pdf.text(truncated[0] || '', cellX + cellPadding, y);
          }

          y += rowHeight;
        }

        y += 4;
        break;
      }

      case 'blockquote': {
        checkNewPage(8);
        const bqIndent = margin + 5;
        const bqWidth = contentWidth - 10;
        pdf.setFillColor(245, 245, 245);
        pdf.setDrawColor(r, g, b);
        pdf.setLineWidth(1.5);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'italic');
        pdf.setTextColor(80, 80, 80);
        const bqLines = pdf.splitTextToSize(block.text, bqWidth);
        const bqHeight = bqLines.length * 5 + 4;
        pdf.rect(margin, y - 4, contentWidth, bqHeight, 'F');
        pdf.line(margin, y - 4, margin, y - 4 + bqHeight);
        for (const bl of bqLines) {
          checkNewPage(5);
          pdf.text(bl, bqIndent, y);
          y += 5;
        }
        y += 4;
        break;
      }

      case 'paragraph': {
        pdf.setFontSize(10);
        pdf.setTextColor(40, 40, 40);
        pdf.setFont('helvetica', 'normal');
        const pLines = pdf.splitTextToSize(block.text, contentWidth);
        for (const pl of pLines) {
          checkNewPage(5);
          pdf.text(pl, margin, y);
          y += 5;
        }
        y += 2;
        break;
      }
    }
  }

  // ── Signature block ──
  const sigHeight = 52;
  checkNewPage(sigHeight);
  y += 8;

  // Separator line above signature block
  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 10;

  const sigName = companyProfile?.contactName || 'Director';
  const sigTitle = companyProfile?.contactTitle || 'Director';
  const now = new Date();
  const sigDate = now.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
  const reviewDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
    .toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });

  // Label
  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);
  pdf.setFont('helvetica', 'normal');
  pdf.text('AUTHORISED BY', margin, y);
  y += 5;

  // Drawn signature image or italic fallback
  const sigImgWidth = 80;
  const sigImgHeight = 22;
  if (companyProfile?.signatureDataUrl) {
    try {
      pdf.addImage(companyProfile.signatureDataUrl, 'PNG', margin, y, sigImgWidth, sigImgHeight);
    } catch {
      // fallback to styled text if image fails
      pdf.setFontSize(20);
      pdf.setTextColor(r, g, b);
      pdf.setFont('times', 'bolditalic');
      pdf.text(sigName, margin, y + sigImgHeight - 4);
    }
  } else {
    pdf.setFontSize(20);
    pdf.setTextColor(r, g, b);
    pdf.setFont('times', 'bolditalic');
    pdf.text(sigName, margin, y + sigImgHeight - 4);
  }
  y += sigImgHeight + 1;

  // Signature underline
  pdf.setDrawColor(60, 60, 60);
  pdf.setLineWidth(0.4);
  pdf.line(margin, y, margin + sigImgWidth, y);
  y += 5;

  // Printed name + title
  pdf.setFontSize(9);
  pdf.setTextColor(40, 40, 40);
  pdf.setFont('helvetica', 'bold');
  pdf.text(sigName, margin, y);
  y += 4.5;

  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text(sigTitle, margin, y);
  y += 4.5;

  // Dates
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  pdf.text(`Issue Date: ${sigDate}`, margin, y);
  y += 4.5;
  pdf.text(`Review Date: ${reviewDate}`, margin, y);

  // ── Add footers to all pages ──
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    drawFooter(pdf, doc.title, doc.clause, i, totalPages, companyName, r, g, b);
  }

  return pdf;
}

export function savePdf(pdf: jsPDF, title: string, clause: string) {
  const safeName = title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
  pdf.save(`${safeName}_Clause_${clause}.pdf`);
}
