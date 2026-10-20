/** @vitest-environment node */
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName } from "pdf-lib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { invoiceReport, filterInvoices, type ReportSource } from "@/lib/reports/export/documents";
import { renderReportPdf } from "@/lib/reports/export/pdf";
import { logicalPositions } from "@/lib/reports/export/text-layout";
import { blankNumber, safeCellText } from "@/lib/reports/export/safe";
import { renderReportWorkbook } from "@/lib/reports/export/xlsx";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

function line(partial: Partial<PurchaseInvoiceLine> & Pick<PurchaseInvoiceLine, "key" | "rawName">): PurchaseInvoiceLine {
  return {
    quantity: 1,
    unit: "unit",
    unitPrice: 0,
    discount: null,
    lineTotal: 0,
    vatType: "exclusive",
    vatRate: null,
    priceBeforeVat: null,
    vatAmount: null,
    priceIncludingVat: null,
    ...partial,
  };
}

function invoice(partial: Partial<PurchaseInvoice> & Pick<PurchaseInvoice, "id" | "lines">): PurchaseInvoice {
  return {
    supplierName: "SARI Ltd",
    supplierTaxId: "513063636",
    invoiceNumber: "127833",
    invoiceDate: "2026-10-01",
    receivedAt: "2026-10-20T09:00:00.000Z",
    documentType: "invoice",
    status: "draft",
    stockStatus: "none",
    netAmount: 337.27,
    vatAmount: 60.71,
    grossAmount: 398,
    vatRate: 0.18,
    vatMode: "exclusive",
    createdAt: "2026-10-20T09:00:00.000Z",
    createdBy: "admin@mishkat.test",
    archivedAt: "2026-10-20T10:00:00.000Z",
    ...partial,
  };
}

const sari = invoice({
  id: "5VfUGaumcLPNOLxvGc1u",
  lines: [
    line({ key: "l1", rawName: "מוצר ראשון", quantity: 1, unit: "kg", unitPrice: 50, lineTotal: 59, vatAmount: 9, vatRate: 0.18 }),
    line({ key: "line-2", rawName: "אבקת קרם פטיסייר משופרת 5ק״ג-סארי", quantity: 1, unit: "bucket", unitPrice: 168, lineTotal: 168, vatAmount: 30.24, vatRate: 0.18 }),
    line({ key: "l3", rawName: "سكر ناعم", quantity: 1, unit: "kg", unitPrice: 40, lineTotal: 47.2, vatAmount: 7.2, vatRate: 0.18 }),
    line({ key: "l4", rawName: "=CMD|calc", quantity: 1, unit: "unit", unitPrice: 40, lineTotal: 47.2, vatAmount: 7.2, vatRate: 0.18 }),
    line({ key: "l5", rawName: "שורה חמישית", quantity: 1, unit: "liter", unitPrice: 39.27, lineTotal: 46.36, vatAmount: 7.07, vatRate: 0.18 }),
  ],
  sourceFile: {
    storagePath: "invoice-files/2026/10/5VfUGaumcLPNOLxvGc1u/original.jpg",
    downloadUrl: "https://example.invalid/public",
    originalFilename: "original.jpg",
    mimeType: "image/jpeg",
    size: 207268,
    uploadedAt: "2026-10-20T09:05:00.000Z",
    kind: "jpg",
  },
});

const emptySource = {
  invoices: [sari],
  movements: [],
  payments: [],
  suppliers: [],
  ingredients: [],
  offers: [],
  prices: [],
  recipes: [],
  products: [],
  categories: [],
  zReports: [],
  cashEntries: [],
  cashOpening: null,
  fixedCosts: [],
  variableCosts: [],
  orders: [],
} as unknown as ReportSource;

describe("report export", () => {
  it("keeps missing numbers empty and blocks formula injection", () => {
    expect(blankNumber(null)).toBeNull();
    expect(blankNumber(undefined)).toBeNull();
    expect(blankNumber(Number.NaN)).toBeNull();
    expect(blankNumber(0)).toBe(0);
    expect(safeCellText("=1+1")).toBe("'=1+1");
    expect(safeCellText("+cmd")).toBe("'+cmd");
    expect(safeCellText("@sum")).toBe("'@sum");
    expect(safeCellText("SARI")).toBe("SARI");
  });

  it("exports the selected archive invoice and keeps stored totals", () => {
    const active = invoice({ id: "active", lines: [], archivedAt: undefined, invoiceNumber: "1", grossAmount: 10, netAmount: 8, vatAmount: 2 });
    expect(filterInvoices([sari, active], { invoiceScope: "archive" }).map((item) => item.id)).toEqual([sari.id]);
    expect(filterInvoices([sari, active], undefined, [active.id]).map((item) => item.id)).toEqual([active.id]);
    const doc = invoiceReport(emptySource, [sari], "2026-10");
    const summary = doc.sheets.find((sheet) => sheet.name === "סיכום");
    expect(summary?.rows.find((row) => row[0] === "כולל מע״מ")?.[1]).toBe(398);
    expect(summary?.rows.find((row) => row[0] === "לפני מע״מ")?.[1]).toBe(337.27);
    expect(summary?.rows.find((row) => row[0] === "מע״מ")?.[1]).toBe(60.71);
    expect(summary?.rows.find((row) => row[0] === "יתרה")?.[1]).toBeNull();
    const lines = doc.sheets.find((sheet) => sheet.name === "שורות");
    const bucket = lines?.rows.find((row) => row[2] === "אבקת קרם פטיסייר משופרת 5ק״ג-סארי");
    expect(bucket?.[4]).toBe(1);
    expect(bucket?.[5]).toBe("דלי");
    expect(bucket?.[6]).toBe(168);
    const serialized = JSON.stringify(doc);
    expect(serialized.includes("https://example.invalid")).toBe(false);
    expect(serialized.includes("invoice-files/2026/10/5VfUGaumcLPNOLxvGc1u/original.jpg")).toBe(true);
  });

  it("places the first Hebrew letter to the right of the last", async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(Uint8Array.from(readFileSync("src/lib/reports/export/fonts/DejaVuSans.ttf")));
    const placed = logicalPositions("אבג", font, 12, 200);
    expect(placed[0]!.x).toBeGreaterThan(placed[2]!.x);
    expect(placed.map((item) => item.char).join("")).toBe("אבג");
  });

  it("writes a searchable PDF and a numeric workbook", async () => {
    const doc = invoiceReport(emptySource, [sari], "2026-10");
    const pdfBytes = await renderReportPdf(doc);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getTitle()).toContain("127833");
    const resources = pdf.getPage(0).node.Resources();
    expect(resources?.has(PDFName.of("Font"))).toBe(true);
    expect(resources?.has(PDFName.of("XObject"))).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await renderReportWorkbook(doc));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["סיכום", "חשבוניות", "שורות", "ספקים", "מע״מ"]));
    const lines = workbook.getWorksheet("שורות");
    const values = lines?.getSheetValues().flat().map((value) => (value == null ? "" : String(value))).join(" ");
    expect(values).toContain("דלי");
    expect(values).toContain("سكر");
    expect(values).toContain("'=CMD|calc");
    const money = lines?.getRow(8).getCell(7).value;
    expect(typeof money === "number" || (money && typeof money === "object")).toBe(true);
    const list = workbook.getWorksheet("חשבוניות");
    const formulaRow = list ? list.getRow(list.rowCount).getCell(10).value : null;
    const formula = formulaRow && typeof formulaRow === "object" && "formula" in formulaRow ? String(formulaRow.formula) : "";
    expect(formula.startsWith("SUM(")).toBe(true);
    expect(list?.views?.[0]?.rightToLeft).toBe(true);
  });
});
