// Extração client-side: converte um PDF em HTML simples (parágrafos por página).
// Roda só no navegador (usa pdfjs-dist com worker). Isolado — não é usado em
// nenhum fluxo existente. Chamado apenas pelo diálogo de templates.
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - Vite resolve o worker como URL string
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function pdfFileToHtml(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const text = await page.getTextContent();
    let currentY: number | null = null;
    let line = "";
    const paragraphs: string[] = [];
    for (const item of text.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]);
      if (currentY === null) currentY = y;
      if (Math.abs(y - currentY) > 3) {
        if (line.trim()) paragraphs.push(line.trim());
        line = "";
        currentY = y;
      }
      line += item.str + " ";
    }
    if (line.trim()) paragraphs.push(line.trim());
    for (const par of paragraphs) parts.push(`<p>${escapeHtml(par)}</p>`);
    if (p < doc.numPages) parts.push("<p></p>");
  }
  return parts.join("\n");
}
