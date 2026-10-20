import { readFileSync } from "node:fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { ReportDocument, ReportSheet, ReportValue } from "@/lib/reports/export/types";
import { drawLogicalText, textWidth, wrapText, type Rgb } from "@/lib/reports/export/text-layout";

const BROWN: Rgb = { r: 61 / 255, g: 43 / 255, b: 36 / 255 };
const TEAL: Rgb = { r: 0, g: 122 / 255, b: 128 / 255 };
const CREAM: Rgb = { r: 248 / 255, g: 243 / 255, b: 237 / 255 };
const INK: Rgb = { r: 42 / 255, g: 28 / 255, b: 23 / 255 };
const MUTED: Rgb = { r: 107 / 255, g: 83 / 255, b: 72 / 255 };
const LINE = { r: 212 / 255, g: 196 / 255, b: 180 / 255 };

const MARGIN = 36;
const HEADER = 78;
const FOOTER = 28;

function formatCell(value: ReportValue, kind?: string): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (kind === "money") return `₪${value.toFixed(2)}`;
    if (kind === "percent") return `${value.toFixed(1)}%`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function fontBytes(file: string): Uint8Array {
  return Uint8Array.from(readFileSync(path.join(process.cwd(), "src/lib/reports/export/fonts", file)));
}

export async function renderReportPdf(doc: ReportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fontBytes("DejaVuSans.ttf"), { subset: true });
  const bold = await pdf.embedFont(fontBytes("DejaVuSans-Bold.ttf"), { subset: true });
  let logo: PDFImage | null = null;
  try {
    logo = await pdf.embedPng(Uint8Array.from(readFileSync(path.join(process.cwd(), "public/logo-transparent.png"))));
  } catch {
    logo = null;
  }
  const wide = doc.landscape ?? doc.sheets.some((sheet) => sheet.columns.length > 6);
  const pageWidth = wide ? 841.89 : 595.28;
  const pageHeight = wide ? 595.28 : 841.89;
  const pages: PDFPage[] = [];
  let y = pageHeight - MARGIN - HEADER;
  let page: PDFPage;

  function addPage() {
    const next = pdf.addPage([pageWidth, pageHeight]);
    pages.push(next);
    drawHeader(next);
    y = pageHeight - MARGIN - HEADER;
    return next;
  }

  page = addPage();

  function drawHeader(target: PDFPage) {
    target.drawRectangle({ x: 0, y: pageHeight - 8, width: pageWidth, height: 8, color: rgb(TEAL.r, TEAL.g, TEAL.b) });
    if (logo) {
      const height = 32;
      const width = (logo.width / logo.height) * height;
      target.drawImage(logo, { x: pageWidth - MARGIN - width, y: pageHeight - MARGIN - height + 4, width, height });
    }
    drawLogicalText(target, bold, "MISHKAT CAFÉ — משקאת", pageWidth - MARGIN - 46, pageHeight - MARGIN - 14, 11, BROWN);
    drawLogicalText(target, bold, doc.title, pageWidth - MARGIN, pageHeight - MARGIN - 32, 14, BROWN);
    drawLogicalText(target, regular, `הופק: ${doc.generatedAt}`, pageWidth - MARGIN, pageHeight - MARGIN - 48, 8, MUTED);
    drawLogicalText(target, regular, `תקופה: ${doc.period}    מזהה: ${doc.reportId}`, pageWidth - MARGIN, pageHeight - MARGIN - 60, 8, MUTED);
  }

  function ensure(height: number) {
    if (y - height < MARGIN + FOOTER) page = addPage();
  }

  function drawSheet(sheet: ReportSheet) {
    ensure(22);
    drawLogicalText(page, bold, sheet.name, pageWidth - MARGIN, y, 12, TEAL);
    y -= 16;
    const widths = columnWidths(sheet, pageWidth - MARGIN * 2);
    const drawHead = () => {
      ensure(18);
      page.drawRectangle({ x: MARGIN, y: y - 14, width: pageWidth - MARGIN * 2, height: 16, color: rgb(BROWN.r, BROWN.g, BROWN.b) });
      let cursor = pageWidth - MARGIN;
      sheet.columns.forEach((column, index) => {
        const width = widths[index] ?? 40;
        drawLogicalText(page, bold, column.header, cursor - 3, y - 10, 8, { r: 1, g: 1, b: 1 });
        cursor -= width;
      });
      y -= 18;
    };
    drawHead();
    sheet.rows.forEach((row, rowIndex) => {
      const wrapped = sheet.columns.map((column, index) => wrapText(regular, formatCell(row[index] ?? null, column.kind), 8, Math.max(12, (widths[index] ?? 40) - 6)));
      const lines = Math.max(1, ...wrapped.map((item) => item.length));
      const height = lines * 11 + 4;
      if (y - height < MARGIN + FOOTER) {
        page = addPage();
        drawLogicalText(page, bold, sheet.name, pageWidth - MARGIN, y, 12, TEAL);
        y -= 16;
        drawHead();
      }
      if (rowIndex % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - height + 2, width: pageWidth - MARGIN * 2, height, color: rgb(CREAM.r, CREAM.g, CREAM.b) });
      }
      let cursor = pageWidth - MARGIN;
      wrapped.forEach((cellLines, index) => {
        const width = widths[index] ?? 40;
        cellLines.forEach((line, lineIndex) => {
          const numeric = sheet.columns[index]?.kind === "money" || sheet.columns[index]?.kind === "number" || sheet.columns[index]?.kind === "percent";
          const anchor = numeric ? cursor - width + 4 + textWidth(regular, line, 8) : cursor - 3;
          drawLogicalText(page, regular, line, anchor, y - 11 - lineIndex * 11, 8, INK);
        });
        cursor -= width;
      });
      y -= height;
    });
    if (!sheet.rows.length) {
      drawLogicalText(page, regular, "אין רשומות שמורות.", pageWidth - MARGIN, y, 9, MUTED);
      y -= 16;
    }
    y -= 12;
  }

  for (const sheet of doc.sheets) drawSheet(sheet);
  pages.forEach((item, index) => {
    drawLogicalText(item, regular, `${index + 1} / ${pages.length}`, MARGIN + 40, MARGIN - 4, 8, MUTED);
    item.drawLine({ start: { x: MARGIN, y: MARGIN + 10 }, end: { x: pageWidth - MARGIN, y: MARGIN + 10 }, thickness: 0.4, color: rgb(LINE.r, LINE.g, LINE.b) });
  });
  pdf.setTitle(doc.title);
  pdf.setAuthor("MISHKAT CAFÉ");
  return pdf.save();
}

export async function appendInvoiceSource(report: Uint8Array, source: Uint8Array, mime: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(report);
  const type = mime.toLowerCase();
  if (type.includes("pdf")) {
    const original = await PDFDocument.load(source);
    const copied = await pdf.copyPages(original, original.getPageIndices());
    copied.forEach((page) => pdf.addPage(page));
  } else if (type.includes("png") || type.includes("jpeg") || type.includes("jpg")) {
    const image = type.includes("png") ? await pdf.embedPng(source) : await pdf.embedJpg(source);
    const page = pdf.addPage([595.28, 841.89]);
    const scale = Math.min(520 / image.width, 760 / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: (595.28 - width) / 2, y: (841.89 - height) / 2, width, height });
  }
  return pdf.save();
}

function columnWidths(sheet: ReportSheet, total: number): number[] {
  const requested = sheet.columns.map((column) => column.width ?? 1);
  const sum = requested.reduce((acc, width) => acc + width, 0) || 1;
  return requested.map((width) => Math.max(28, (width / sum) * total));
}
