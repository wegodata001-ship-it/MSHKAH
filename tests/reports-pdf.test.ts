import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportA4Pages } from "@/features/admin/reports/pdf/report-pages";
import {
  buildInventoryRows,
  buildPurchaseRows,
  classifyExceptions,
  groupPurchasesBySupplier,
  purchaseSummary,
} from "@/lib/reports/compute";
import { buildReportCopy } from "@/lib/reports/pdf/copy";
import { reportOrientation, reportPdfFilename } from "@/lib/reports/pdf/filename";
import { paginateReport } from "@/lib/reports/pdf/paginate";
import type {
  InventoryReportRow,
  ReportKpis,
  ReportPayload,
  ReportType,
} from "@/lib/reports/types";
import type { CostingIngredient } from "@/lib/costing/types";
import type { PurchasePriceRecord, Supplier } from "@/lib/inventory/types";

const kpis: ReportKpis = {
  itemCount: 2,
  stockValue: 12,
  inStockCount: 1,
  belowMinCount: 0,
  missingSupplierCount: 1,
  monthPurchases: 20,
  monthConsumption: 4,
};

function inventoryRow(index: number, extras: Partial<InventoryReportRow> = {}): InventoryReportRow {
  return {
    productId: `p${index}`,
    category: "יבש",
    name: `מוצר ${index + 1}`,
    unit: "kg",
    opening: 10,
    incoming: 5,
    consumption: 3,
    adjustments: 0,
    current: 12,
    minStock: 4,
    recommended: 8,
    toOrder: 0,
    lastSupplier: "ספק א",
    lastPrice: 5,
    normalizedPrice: 5,
    lastPurchaseDate: "2026-10-01",
    stockValue: 60,
    missingSupplier: false,
    invalidUnit: false,
    status: "ok",
    supplierLines: index % 4 === 0
      ? [
          { supplierId: "A", supplierName: "ספק א", price: 5, lastPurchaseDate: "2026-10-05", cheapest: true },
          { supplierId: "B", supplierName: "Supplier B", price: 6, lastPurchaseDate: "2026-10-01" },
        ]
      : [],
    ...extras,
  };
}

function payload(type: ReportType, extra: Partial<ReportPayload> = {}): ReportPayload {
  return {
    type,
    generatedAt: "2026-10-07T12:30:00.000Z",
    periodFrom: "2026-10-01",
    periodTo: "2026-10-31",
    orientation: reportOrientation(type),
    branchName: "Mishkat Cafe",
    kpis,
    categories: [],
    suppliers: [],
    products: [],
    ...extra,
  };
}

const t = (key: string) => key;

describe("report PDF filenames and orientation", () => {
  it("uses professional dated filenames and portrait by default", () => {
    expect(reportPdfFilename("inventory", new Date("2026-10-07T10:00:00.000Z"))).toBe(
      "mishkat-inventory-report-2026-10-07.pdf"
    );
    expect(reportPdfFilename("exceptions", new Date("2026-10-07T10:00:00.000Z"))).toBe(
      "mishkat-inventory-exceptions-2026-10-07.pdf"
    );
    expect(reportPdfFilename("blank-count", new Date("2026-10-07T10:00:00.000Z"))).toBe(
      "mishkat-stock-count-2026-10-07.pdf"
    );
    expect(reportPdfFilename("count-consumption", new Date("2026-10-07T10:00:00.000Z"))).toBe(
      "mishkat-consumption-report-2026-10-07.pdf"
    );
    expect(reportPdfFilename("purchases", new Date("2026-10-07T10:00:00.000Z"))).toBe(
      "mishkat-supplier-purchases-2026-10-07.pdf"
    );
    expect(reportPdfFilename("breakeven", new Date("2026-10-07T10:00:00.000Z"))).toBe(
      "mishkat-break-even-2026-10-07.pdf"
    );
    expect(reportOrientation("inventory")).toBe("portrait");
    expect(reportOrientation("purchases")).toBe("landscape");
  });
});

describe("A4 pagination 2 / 20 / 100", () => {
  it("keeps 2 products on one portrait page with KPIs", () => {
    const doc = payload("inventory", { inventory: [inventoryRow(0), inventoryRow(1)] });
    const pages = paginateReport(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.orientation).toBe("portrait");
    expect(pages[0]?.showKpis).toBe(true);
    expect(pages[0]?.total).toBe(1);
  });

  it("paginates 20 products without an empty first page", () => {
    const doc = payload("inventory", { inventory: Array.from({ length: 20 }, (_, i) => inventoryRow(i)) });
    const pages = paginateReport(doc);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]?.blocks[0]?.kind).toBe("inventory");
    expect(pages.every((page) => page.total === pages.length)).toBe(true);
    expect(pages.every((page, index) => page.index === index)).toBe(true);
  });

  it("splits 100 products across pages with repeated document chrome", () => {
    const rows = Array.from({ length: 100 }, (_, i) => inventoryRow(i));
    const doc = payload("inventory", { inventory: rows });
    const pages = paginateReport(doc);
    expect(pages.length).toBeGreaterThan(8);
    const rendered = rows.length;
    const placed = pages.reduce((sum, page) => {
      const block = page.blocks[0];
      return sum + (block?.kind === "inventory" ? block.rows.length : 0);
    }, 0);
    expect(placed).toBe(rendered);
    const html = renderToStaticMarkup(
      ReportA4Pages({ pages, payload: doc, copy: buildReportCopy(doc, {}, t) })
    );
    expect(html).toContain("210mm");
    expect(html).toContain("297mm");
    expect(html).not.toContain("portal.mishkatcafe.dev");
    expect(html).toContain("MISHKAT CAFE");
    expect(html).toContain("مشكاة كافيه");
    expect(html).toContain("מוצר 1");
    expect(html).toContain("admin.reports.pageOf");
    expect(html.match(/data-report-page/g)?.length).toBe(pages.length);
  });
});

describe("purchase VAT grouping", () => {
  it("keeps net / VAT / gross separate per supplier", () => {
    const coffee: CostingIngredient = {
      id: "coffee",
      name: "קפה",
      purchasePrice: 70,
      purchaseQuantity: 1,
      purchaseUnit: "kg",
      baseUnit: "g",
      costPerBaseUnit: 0.07,
      active: true,
      createdAt: "",
      updatedAt: "",
    };
    const records: PurchasePriceRecord[] = [
      {
        id: "1",
        productId: "coffee",
        supplierId: "A",
        purchaseDate: "2026-10-01",
        quantity: 2,
        packageQuantity: 2,
        unit: "kg",
        priceBeforeVat: 100,
        vatAmount: 18,
        priceIncludingVat: 118,
        vatType: "exclusive",
        vatRate: 0.18,
        unitCost: 0.05,
        createdAt: "a",
        invoiceId: "inv1",
      },
    ];
    const suppliers: Supplier[] = [
      { id: "A", name: "ספק א", phone: "0500000000", taxId: "512345678", active: true, createdAt: "", updatedAt: "" },
    ];
    const rows = buildPurchaseRows(records, [coffee], suppliers, [], {});
    expect(rows[0]?.netUnitPrice).toBe(50);
    expect(rows[0]?.vatUnit).toBe(9);
    expect(rows[0]?.grossUnitPrice).toBe(59);
    const groups = groupPurchasesBySupplier(rows, suppliers);
    expect(groups[0]?.totalBefore).toBe(100);
    expect(groups[0]?.totalVat).toBe(18);
    expect(groups[0]?.totalIncluding).toBe(118);
    expect(groups[0]?.phone).toBe("0500000000");
    expect(purchaseSummary(rows).totalVat).toBe(18);
  });
});

describe("inventory detail and exceptions", () => {
  it("attaches supplier lines and flags stale stock", () => {
    const pasta: CostingIngredient = {
      id: "pasta",
      name: "פסטה",
      category: "יבש",
      purchasePrice: 5,
      purchaseQuantity: 1,
      purchaseUnit: "kg",
      baseUnit: "g",
      costPerBaseUnit: 0.005,
      active: true,
      lastSupplierId: "A",
      createdAt: "",
      updatedAt: "",
    };
    const rows = buildInventoryRows(
      [pasta],
      [
        {
          id: "o",
          productId: "pasta",
          type: "OPENING",
          quantity: 3,
          unit: "kg",
          quantityBase: 3000,
          receivedAt: "2026-01-01",
          createdAt: "2026-01-01",
        },
      ],
      [],
      [
        {
          id: "old",
          productId: "pasta",
          supplierId: "A",
          purchaseDate: "2026-01-01",
          quantity: 1,
          packageQuantity: 1,
          unit: "kg",
          priceBeforeVat: 5,
          vatAmount: 0,
          priceIncludingVat: 5,
          vatType: "inclusive",
          vatRate: 0.18,
          unitCost: 0.005,
          createdAt: "a",
        },
        {
          id: "new",
          productId: "pasta",
          supplierId: "B",
          purchaseDate: "2026-10-05",
          quantity: 1,
          packageQuantity: 1,
          unit: "kg",
          priceBeforeVat: 6,
          vatAmount: 0,
          priceIncludingVat: 6,
          vatType: "inclusive",
          vatRate: 0.18,
          unitCost: 0.006,
          createdAt: "b",
        },
      ],
      [
        { id: "A", name: "ספק א", active: true, createdAt: "", updatedAt: "" },
        { id: "B", name: "ספק ב", active: true, createdAt: "", updatedAt: "" },
      ],
      {}
    );
    expect(rows[0]?.supplierLines.map((line) => line.supplierName)).toEqual(["ספק א", "ספק ב"]);
    expect(rows[0]?.supplierLines.find((line) => line.cheapest)?.supplierId).toBe("A");
    const stale = classifyExceptions(rows, [], 5, 0.2, new Date("2026-10-07"));
    expect(stale.some((row) => row.kind === "stale")).toBe(false);
    const oldOnly = classifyExceptions(
      [{ ...rows[0]!, lastPurchaseDate: "2026-01-01" }],
      [],
      5,
      0.2,
      new Date("2026-10-07")
    );
    expect(oldOnly.some((row) => row.kind === "stale")).toBe(true);
  });
});

describe("blank count form pages", () => {
  it("leaves handwritten rows and signature footer on the last page", () => {
    const blank = Array.from({ length: 12 }, (_, i) => ({
      productId: `b${i}`,
      category: "יבש",
      name: `פריט ${i + 1}`,
      unit: "kg",
      systemQty: 2,
    }));
    const doc = payload("blank-count", { blank });
    const pages = paginateReport(doc);
    expect(pages[0]?.showFormMeta).toBe(true);
    expect(pages[pages.length - 1]?.showFormFooter).toBe(true);
  });
});

describe("break-even PDF", () => {
  it("renders one A4 portrait page from computed figures, not invented ones", () => {
    const doc = payload("breakeven", {
      breakEven: {
        canCompute: true,
        missing: [],
        vatBasis: "before",
        operatingDays: 26,
        revenue: 41250,
        orders: 800,
        averageOrderValue: 50,
        productsSold: 900,
        fixedMonthly: 30000,
        variableTotal: 16500,
        foodCost: 12000,
        contribution: 24750,
        contributionRatio: 0.6,
        breakEvenMonthly: 50000,
        breakEvenWeekly: 13461.54,
        breakEvenDaily: 1923.08,
        ordersRequiredDaily: 38.46,
        gap: 8750,
        progress: 0.825,
        aboveBreakEven: null,
        achieved: false,
        forecast: 47800,
        forecastGap: -2200,
        requiredDailyFromNow: 2000,
      },
    });
    const pages = paginateReport(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.orientation).toBe("portrait");
    expect(pages[0]?.blocks[0]?.kind).toBe("breakeven");
    const html = renderToStaticMarkup(ReportA4Pages({ pages, payload: doc, copy: buildReportCopy(doc, {}, t) }));
    expect(html).toContain("50000");
    expect(html).toContain("41250");
  });
});
