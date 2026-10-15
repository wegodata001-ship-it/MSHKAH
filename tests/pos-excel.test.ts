import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  canConfirmExcelImport,
  dateLooksLikeEpoch,
  excelImportPayload,
  isValidSalesPeriod,
  periodReviewCleared,
  excelMayAffectFinance,
  excelMayAffectStock,
  posPriceUpdatePreview,
  priorExcelFinanceWrites,
  priorExcelStockWrites,
} from "@/lib/inventory/pos-excel";
import { computedUnitPrice } from "@/lib/inventory/pos-apply";
import {
  detectHeaderRow,
  extractPosPeriod,
  fieldForHeader,
  isSummaryRow,
  parsePosBuffer,
  summarizePosExcel,
  unwrapCell,
} from "@/lib/inventory/pos-parse";
import { salesInRange } from "@/lib/breakeven/compute";
import type { InventoryMovement, PosImport } from "@/lib/inventory/types";
import type { Product } from "@/types";

const product: Product = {
  id: "hummus",
  name_he: "חומוס",
  name_ar: "حمص",
  name_en: "Hummus",
  description_he: "",
  description_ar: "",
  description_en: "",
  categoryId: "cat",
  price: 28,
  cost: 8,
  profit: 20,
  businessType: "food",
  image: "",
  isPopular: false,
  isNew: false,
  available: true,
  active: true,
  sortOrder: 1,
  createdAt: "",
  updatedAt: "",
};

async function sampleWorkbook(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("sales");
  rows.forEach((row) => sheet.addRow(row));
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return buffer;
}

describe("POS excel header mapping", () => {
  it("maps Hebrew, Arabic, and English headers by meaning", () => {
    expect(fieldForHeader("שם המוצר")).toBe("posName");
    expect(fieldForHeader("שם מוצר")).toBe("posName");
    expect(fieldForHeader("ברקוד")).toBe("posCode");
    expect(fieldForHeader("כמות מכירה")).toBe("quantity");
    expect(fieldForHeader("סה״כ הכנסות")).toBe("reportedRevenue");
    expect(fieldForHeader("מחיר מכירה ממוצע")).toBe("unitPrice");
    expect(fieldForHeader("מספר עסקאות")).toBe("transactionCount");
    expect(fieldForHeader("עלות מוצר")).toBe("posCost");
    expect(fieldForHeader("רווח מדווח")).toBe("posProfit");
    expect(fieldForHeader("اسم المنتج")).toBe("posName");
    expect(fieldForHeader("كمية المبيعات")).toBe("quantity");
    expect(fieldForHeader("إجمالي الإيرادات")).toBe("reportedRevenue");
    expect(fieldForHeader("product name")).toBe("posName");
  });

  it("finds headers below the business preamble and skips summary rows", () => {
    const header = detectHeaderRow([
      ["משקאה"],
      ["תקופה 01/09/2026 - 30/09/2026"],
      [],
      [],
      [],
      ["שם המוצר", "ברקוד", "כמות מכירה", "סה״כ הכנסות", "מחיר ממוצע"],
    ]);
    expect(header?.index).toBe(5);
    expect(isSummaryRow("סה״כ", ["סה״כ", 2414, 62246])).toBe(true);
    expect(isSummaryRow("סה״כ פריטים", ["סה״כ פריטים", 115])).toBe(true);
    expect(isSummaryRow("סה כ כמות נמכרה", ["סה כ כמות נמכרה", 2414])).toBe(true);
    expect(isSummaryRow("סה\"כ הכנסות", ["סה\"כ הכנסות", 62246])).toBe(true);
    expect(isSummaryRow("סה״כ עלויות", ["סה״כ עלויות", 10])).toBe(true);
    expect(isSummaryRow("סה״כ רווח", ["סה״כ רווח", 5])).toBe(true);
    expect(isSummaryRow("חומוס", ["חומוס", "123", 2, 56])).toBe(false);
    expect(isSummaryRow("מנה עם סהכ בפנים", ["מנה עם סהכ בפנים", 2, 56])).toBe(false);
  });
});

describe("POS excel trailing summary footer", () => {
  it("keeps product rows and reads footer totals without treating summary labels as products", async () => {
    const itemCount = 8;
    const quantity = 24;
    const revenue = 360;
    const rows: unknown[][] = [
      ["משקאה"],
      ["תקופה 01/09/2026 - 18/09/2026"],
      [],
      [],
      [],
      ["שם המוצר", "ברקוד", "כמות מכירה", "סה״כ הכנסות", "מחיר ממוצע"],
    ];
    for (let i = 0; i < itemCount; i += 1) {
      rows.push([`פריט ${i + 1}`, i % 2 === 0 ? "" : `729${i}`, 3, 45, 15]);
    }
    rows.push(["מנה עם סהכ בפנים", "", 3, 45, 15]);
    rows.push(["סה״כ פריטים", itemCount + 1]);
    rows.push(["סה״כ כמות נמכרה", quantity + 3]);
    rows.push(["סה״כ הכנסות", revenue + 45]);
    rows.push(["סה״כ עלויות", 80]);
    rows.push(["סה״כ רווח", 200]);
    const parsed = await parsePosBuffer(await sampleWorkbook(rows), "footer.xlsx", [], []);
    expect(parsed.lines.some((line) => /סה["״]?כ/.test(line.posName) && /פריטים|כמות|הכנסות|עלויות|רווח/.test(line.posName))).toBe(false);
    expect(parsed.lines).toHaveLength(itemCount + 1);
    expect(parsed.lines.some((line) => line.posName === "מנה עם סהכ בפנים")).toBe(true);
    expect(parsed.sourceTotals?.itemCount).toBe(itemCount + 1);
    expect(parsed.sourceTotals?.quantitySum).toBe(quantity + 3);
    expect(parsed.sourceTotals?.reportedRevenueSum).toBe(revenue + 45);
    expect(parsed.summary.itemCount).toBe(parsed.lines.length);
  });
});

describe("POS excel parse", () => {
  it("reads item rows, empty barcodes, and source totals without inventing daily lines", async () => {
    const bytes = await sampleWorkbook([
      ["משקאה בע״מ"],
      ["הופק 02/10/2026"],
      ["תקופה 01/09/2026 - 30/09/2026"],
      [],
      [],
      ["שם המוצר", "ברקוד", "כמות מכירה", "סה״כ הכנסות", "מחיר ממוצע", "מספר עסקאות", "עלות מוצר", "רווח"],
      ["חומוס", "7290001", 10, 280, 28, 8, 80, 200],
      [" millane", "", 4, 48, 12, 3, 16, 32],
      ["شاورما", "7290002", 6, 180, 30, 5, 90, 90],
      ["סה״כ", "", 20, 508, "", "", "", ""],
    ]);
    const parsed = await parsePosBuffer(bytes, "pos-sep.xlsx", [product], []);
    expect(parsed.lines).toHaveLength(3);
    expect(computedUnitPrice(1500, 30)).toBe(50);
    expect(parsed.lines.some((line) => !line.posCode)).toBe(true);
    expect(parsed.summary.itemCount).toBe(3);
    expect(parsed.summary.quantitySum).toBe(20);
    expect(parsed.summary.reportedRevenueSum).toBe(508);
    expect(parsed.period.periodFrom).toBe("2026-09-01");
    expect(parsed.period.periodTo).toBe("2026-09-30");
    expect(parsed.period.reportGeneratedAt).toBeTruthy();
    expect(parsed.lines.every((line) => !line.saleDate)).toBe(true);
    expect(canConfirmExcelImport({ lineCount: parsed.lines.length }).ok).toBe(true);
  });

  it("blocks empty extraction and flags a 1970 period", async () => {
    const empty = await parsePosBuffer(
      await sampleWorkbook([
        ["תקופה 01/01/1970 - 31/01/1970"],
        ["שם מוצר", "כמות מכירה", "סה״כ הכנסות"],
        ["סה״כ", 0, 0],
      ]),
      "empty.xlsx",
      [],
      []
    );
    expect(empty.lines).toHaveLength(0);
    expect(canConfirmExcelImport({ lineCount: empty.lines.length }).ok).toBe(false);
    expect(extractPosPeriod(["מ־01/01/1970 עד 31/01/1970"]).periodNeedsReview).toBe(true);
    expect(dateLooksLikeEpoch("1970-01-01")).toBe(true);
    expect(isValidSalesPeriod("1970-01-01", "1970-01-31")).toBe(false);
    expect(isValidSalesPeriod("2026-10-01", "2026-10-31")).toBe(true);
    expect(periodReviewCleared({ periodNeedsReview: true, periodConfirmed: true, periodFrom: "1970-01-01", periodTo: "1970-01-31" })).toBe(false);
    expect(periodReviewCleared({ periodNeedsReview: true, periodConfirmed: true, periodFrom: "2026-10-01", periodTo: "2026-10-31" })).toBe(true);
    const saved = excelImportPayload({
      fileName: "a.xlsx",
      fileHash: "abc",
      period: "2026-10-01:2026-10-31",
      periodFrom: "2026-10-01",
      periodTo: "2026-10-31",
      sourcePeriodFrom: "1970-01-01",
      sourcePeriodTo: "1970-01-31",
      periodNeedsReview: true,
      periodConfirmed: true,
      lines: [{ key: "1", posCode: "", posName: "חומוס", quantity: 2, matchKind: "none" }],
    });
    expect(saved.sourcePeriodFrom).toBe("1970-01-01");
    expect(saved.periodFrom).toBe("2026-10-01");
    expect(saved.periodConfirmed).toBe(true);
    expect(canConfirmExcelImport({ lineCount: 1, periodNeedsReview: true, periodConfirmed: true, periodFrom: "2026-10-01", periodTo: "2026-10-31" }).ok).toBe(true);
  });
});

describe("POS excel is information only", () => {
  it("never treats reported revenue as finance, stock, menu price, or breakeven sales", () => {
    const payload = excelImportPayload({
      fileName: "a.xlsx",
      fileHash: "abc",
      period: "2026-09-01:2026-09-30",
      lines: [{ key: "1", posCode: "", posName: "חומוס", quantity: 2, reportedRevenue: 62246, matchKind: "none" }],
      reportedRevenueSum: 62246,
    });
    expect(payload.infoOnly).toBe(true);
    expect(payload.financeStatus).toBe("none");
    expect(payload.kind).toBe("excel-info");
    expect(excelMayAffectFinance()).toBe(false);
    expect(excelMayAffectStock()).toBe(false);
    expect(posPriceUpdatePreview(28, 30).isAverageNotList).toBe(true);
    const sales = salesInRange([], "2026-09-01", "2026-09-30");
    expect(sales.revenue).toBeNull();
    expect(sales.rows).toHaveLength(0);
  });

  it("reports prior stock or finance impact without deleting it", () => {
    const movements: InventoryMovement[] = [
      {
        id: "m1",
        productId: "flour",
        type: "SALE_OUT",
        quantity: 1,
        unit: "g",
        quantityBase: 1,
        posImportId: "old-excel",
        receivedAt: "2026-09-01",
        createdAt: "2026-09-01",
        note: "POS theoretical consumption",
      },
    ];
    const imports: PosImport[] = [
      {
        id: "old-excel",
        fileName: "old.xlsx",
        fileHash: "x",
        source: "pos-file",
        period: "2026-09",
        status: "approved",
        financeStatus: "posted",
        lines: [],
        createdAt: "2026-09-01",
      },
    ];
    expect(priorExcelStockWrites(movements).map((row) => row.posImportId)).toEqual(["old-excel"]);
    expect(priorExcelFinanceWrites(imports).map((row) => row.id)).toEqual(["old-excel"]);
  });
});

describe("POS excel matching does not crash on missing catalog names", () => {
  it("keeps excel rows unmatched when a system product has no names", async () => {
    const broken = {
      ...product,
      id: "ghost",
      name_he: undefined as unknown as string,
      name_ar: undefined as unknown as string,
      name_en: undefined as unknown as string,
    };
    const parsed = await parsePosBuffer(
      await sampleWorkbook([
        ["שם המוצר", "ברקود", "כמות מכירה", "סה״כ הכנסות"],
        ["חומוס", "", 2, 56],
        ["شاورما", "729", 1, 30],
      ]),
      "names.xlsx",
      [broken],
      []
    );
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.every((line) => line.matchKind === "none")).toBe(true);
    expect(parsed.lines[0]?.posName).toBe("חומוס");
  });

  it("matches camelCase catalog names and flags a missing source name with its row", async () => {
    const liveShape = {
      id: "live-hummus",
      nameHe: "חומוס",
      nameAr: "حمص",
      nameEn: "Hummus",
      aliases: [undefined, ""],
    } as unknown as Product;
    const parsed = await parsePosBuffer(
      await sampleWorkbook([
        ["שם המוצר", "ברקוד", "כמות מכירה", "סה״כ הכנסות", "מחיר ממוצע"],
        ["חומוס", "", 2, 56, 28],
        ["", "729", 1, 30, 30],
        ["شاورما", "7290002", 3, 90, 30],
      ]),
      "live-names.xlsx",
      [liveShape],
      []
    );
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines[0]?.menuProductId).toBe("live-hummus");
    expect(parsed.lines[1]?.reviewReason).toBe("missing-source-name");
    expect(parsed.lines[1]?.sourceRow).toBeGreaterThan(1);
    expect(parsed.lines[1]?.menuProductId).toBeUndefined();
    expect(parsed.lines[2]?.matchKind).toBe("none");
    expect(parsed.lines[2]?.posName).toBe("شاورما");
  });
});

describe("POS excel name in first column", () => {
  it("does not treat column index 0 as a missing name field", async () => {
    const parsed = await parsePosBuffer(
      await sampleWorkbook([
        ["שם המוצר", "כמות מכירה", "סה״כ הכנסות"],
        ["חומוס", 2, 56],
      ]),
      "first-col.xlsx",
      [],
      []
    );
    expect(parsed.headerDetected).toBe(true);
    expect(parsed.columnMap.posName).toBe(0);
    expect(parsed.needsMapping).toBe(false);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.posName).toBe("חומוס");
  });
});

describe("POS excel cell and mapping fallbacks", () => {
  it("unwraps rich text and formula results", () => {
    expect(unwrapCell({ richText: [{ text: "שם" }, { text: " המוצר" }] })).toBe("שם המוצר");
    expect(unwrapCell({ formula: "A1+B1", result: 2414 })).toBe(2414);
    expect(unwrapCell(null)).toBeNull();
  });

  it("keeps unmatched products in the table and reads a mapped sheet", async () => {
    const bytes = await sampleWorkbook([
      ["עסק", "משקאה"],
      ["תקופה", "01/09/2026", "18/09/2026"],
      [],
      [],
      [],
      ["ColA", "ColB", "ColC", "ColD"],
      ["חומוס", "", 10, 280],
      ["شاورما", "729", 5, 150],
      ["סה״כ", "", 15, 430],
    ]);
    const failed = await parsePosBuffer(bytes, "odd.xlsx", [product], []);
    expect(failed.needsMapping).toBe(true);
    expect(failed.rawPreview.length).toBeGreaterThan(0);
    const mapped = await parsePosBuffer(bytes, "odd.xlsx", [product], [], {
      headerRow: 6,
      columnMap: { posName: 0, posCode: 1, quantity: 2, reportedRevenue: 3 },
    });
    expect(mapped.lines).toHaveLength(2);
    expect(mapped.lines.some((line) => !line.menuProductId || line.matchKind === "none" || line.posName === "شاورما")).toBe(true);
    expect(mapped.summary.quantitySum).toBe(15);
    expect(mapped.sourceTotals?.quantitySum).toBe(15);
    expect(mapped.lines.every((line) => line.sourceRow && line.sourceRow > 6)).toBe(true);
  });

  it("reads a generated item-sales report without hardcoding photographed totals", async () => {
    const items = 12;
    const qty = 24;
    const revenue = 360;
    const rows: unknown[][] = [
      ["משקאה"],
      ["תקופה 01/09/2026 - 18/09/2026"],
      [],
      [],
      [],
      ["שם המוצר", "ברקוד", "כמות מכירה", "סה״כ הכנסות", "מחיר ממוצע", "מספר עסקאות", "עלות מוצר", "רווח"],
    ];
    for (let i = 0; i < items; i += 1) {
      rows.push([`פריט ${i + 1}`, i % 3 === 0 ? "" : `729${i}`, 2, 30, 15, 1, 10, 20]);
    }
    rows.push(["סה״כ", "", qty, revenue, "", "", "", ""]);
    const parsed = await parsePosBuffer(await sampleWorkbook(rows), "item_sales_report.xlsx", [], []);
    expect(parsed.lines).toHaveLength(items);
    expect(parsed.summary.quantitySum).toBe(qty);
    expect(parsed.summary.reportedRevenueSum).toBe(revenue);
    expect(parsed.gaps.quantity).toBe(0);
    expect(parsed.headerDetected).toBe(true);
    expect(parsed.headerRow).toBeGreaterThanOrEqual(6);
  });
});

describe("POS excel summary helper", () => {
  it("does not hardcode photographed totals", () => {
    const source = summarizePosExcel([
      { quantity: 10, reportedRevenue: 100, netTotal: 100 },
      { quantity: 5, reportedRevenue: 40, netTotal: 40 },
    ]);
    expect(source).toEqual({ itemCount: 2, quantitySum: 15, reportedRevenueSum: 140 });
    expect(source.itemCount).not.toBe(115);
  });
});
