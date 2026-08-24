// Geração de PDF simples a partir do HTML do template (strip → texto).
// Roda no Worker (pdf-lib é 100% JS).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapLine(line: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string[] {
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      out.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

export async function renderContractPdf(params: { title: string; body: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28; // A4
  const pageH = 841.89;
  const margin = 56;
  const size = 11;
  const lineH = size * 1.4;
  const maxWidth = pageW - margin * 2;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  page.drawText(params.title, { x: margin, y, size: 16, font: bold, color: rgb(0, 0, 0) });
  y -= 24;

  const text = stripHtml(params.body);
  const paragraphs = text.split(/\n/);

  for (const p of paragraphs) {
    const lines = wrapLine(p, font, size, maxWidth);
    for (const l of lines) {
      if (y < margin) {
        page = pdf.addPage([pageW, pageH]);
        y = pageH - margin;
      }
      page.drawText(l, { x: margin, y, size, font, color: rgb(0, 0, 0) });
      y -= lineH;
    }
    y -= lineH * 0.3;
  }

  return pdf.save();
}
