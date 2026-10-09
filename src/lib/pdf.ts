import "server-only";
import PDFDocument from "pdfkit";

export function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export function newDoc(title: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: title, Author: "Consent" } });
  return doc;
}

export const INK = "#111111";
export const SOFT = "#52525b";
export const FAINT = "#a1a1aa";

export function heading(doc: PDFKit.PDFDocument, text: string) {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(text);
  doc.moveDown(0.3);
}

export function sub(doc: PDFKit.PDFDocument, text: string) {
  doc.fillColor(SOFT).font("Helvetica").fontSize(10).text(text);
  doc.moveDown(0.8);
}

export function sectionTitle(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.6);
  doc.fillColor(FAINT).font("Helvetica-Bold").fontSize(8).text(text.toUpperCase(), { characterSpacing: 1.2 });
  doc.moveDown(0.25);
  doc
    .strokeColor("#e4e4e7")
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.4);
}

export function kv(doc: PDFKit.PDFDocument, k: string, v: string) {
  const x = doc.page.margins.left;
  doc.fillColor(SOFT).font("Helvetica").fontSize(9).text(k, x, doc.y, { continued: false });
  doc.moveUp();
  doc.fillColor(INK).font("Helvetica").fontSize(9).text(v, x + 150, doc.y, {
    width: doc.page.width - doc.page.margins.right - x - 150,
  });
  doc.moveDown(0.35);
}

export function para(doc: PDFKit.PDFDocument, text: string, size = 9) {
  doc.fillColor(INK).font("Helvetica").fontSize(size).text(text, doc.page.margins.left, doc.y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  });
  doc.moveDown(0.4);
}
