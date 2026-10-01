/**
 * PDF export.
 *
 * exportPdf / exportPdfBatch build a real vector PDF (pdf-lib + the CJK font, see vectorPdf.ts): text stays
 * crisp and selectable, and it works the same in the browser and the native app. Several documents are
 * zipped, one PDF per class. exportTranscriptionAsPdf is the older print-dialog path.
 */
import { saveBlob, safeFileName } from './download';

export interface PdfLine {
  ts: string;
  speaker: string;
  text: string;
  kind?: 'key' | 'define' | null;
}

export interface PdfQuestion {
  type: string;
  question: string;
  answer: string;
  point?: string;
}

export interface PdfDoc {
  title: string;
  subtitle?: string;
  summary?: string;
  keyPoints?: string[];
  corrections?: string[];
  lines?: PdfLine[];
  questions?: PdfQuestion[];   // mock exam paper
}

export async function exportPdf(doc: PdfDoc): Promise<void> {
  const { makeSessionPdf } = await import('./vectorPdf');
  const bytes = await makeSessionPdf(doc);
  await saveBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${safeFileName(doc.title)}.pdf`);
}

/** Several classes: one PDF each, packaged into a zip (a single one downloads directly). */
export async function exportPdfBatch(docs: PdfDoc[], title = '批量导出'): Promise<void> {
  if (!docs.length) return;
  if (docs.length === 1) return exportPdf(docs[0]);
  const [{ default: JSZip }, { makeSessionPdf }] = await Promise.all([import('jszip'), import('./vectorPdf')]);
  const zip = new JSZip();
  const used = new Set<string>();
  for (const doc of docs) {
    const bytes = await makeSessionPdf(doc);
    const base = safeFileName(doc.title);
    let name = base, k = 2;
    while (used.has(name)) name = `${base}(${k++})`;   // avoid name collisions
    used.add(name);
    zip.file(`${name}.pdf`, bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  await saveBlob(blob, `${safeFileName(title, '批量导出')}.zip`);
}

export function exportTranscriptionAsPdf(sessionTitle: string, lines: { ts: string; speaker: string; text: string }[], summary?: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const now = new Date().toLocaleString('zh-CN');
  const linesHtml = lines.map((l) =>
    `<div class="line"><span class="ts">${l.ts}</span><span class="speaker">${l.speaker}</span><span class="text">${l.text}</span></div>`
  ).join('\n');

  const summaryHtml = summary
    ? `<div class="summary"><h2>AI 摘要</h2><p>${summary}</p></div>`
    : '';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${sessionTitle}</title>
      <style>
        @page { margin: 2cm; size: A4; }
        body { font-family: -apple-system, "Noto Sans SC", sans-serif; font-size: 12px; line-height: 1.8; color: #333; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { color: #888; font-size: 11px; margin-bottom: 24px; }
        .line { margin-bottom: 4px; display: flex; gap: 8px; }
        .ts { color: #999; font-family: monospace; min-width: 70px; }
        .speaker { color: #555; font-weight: 600; min-width: 50px; }
        .text { flex: 1; }
        .summary { margin-top: 32px; padding-top: 16px; border-top: 2px solid #eee; }
        .summary h2 { font-size: 14px; margin-bottom: 8px; }
      </style>
    </head>
    <body>
      <h1>${sessionTitle}</h1>
      <p class="meta">导出时间：${now}</p>
      ${summaryHtml}
      <div class="lines">${linesHtml}</div>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
}