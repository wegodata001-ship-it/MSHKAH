import { describe, expect, it } from "vitest";
import { splitVat, foodCostAmount, normalizeVatRate } from "@/lib/inventory/vat";
import {
  cheapestOffer,
  comparableOffers,
  currentStockBase,
  latestPurchase,
  offerNormalizedCost,
  unitCostFromPackage,
} from "@/lib/inventory/stock";
import { posDelta, posPeriod, theoreticalConsumption } from "@/lib/inventory/pos";
import { hashPosFile } from "@/lib/inventory/pos-parse";
import { emptyInvoiceLine, finalizeInvoiceLine, invoiceSummary } from "@/lib/inventory/invoice-lines";
import { archiveStatus, invoiceSourcePath, publicScanErrorCode, validateInvoiceTotals } from "@/lib/inventory/invoice-archive";
import { buildReviewedInvoice, findDuplicateInvoice, matchInventoryProduct, matchSupplier, unrecognizedScannedSupplier } from "@/lib/inventory/invoice-smart-match";
import {
  confirmSafeInvoiceMatches,
  invoiceLineMatchesFilter,
  invoiceLineMatchStatus,
  invoiceReviewCounts,
  isConfirmedInvoiceMatch,
} from "@/lib/inventory/invoice-line-review";
import { inventoryCategories, MATCH_SUGGEST_MIN, MATCH_TOP_N, productNameSimilarity, rankProductMatches } from "@/lib/inventory/product-match";
import type { ExtractedInvoice } from "@/lib/inventory/invoice-extract";
import { invoiceFinanceTotals } from "@/lib/inventory/invoice-lines";
import { cheapestLastPurchase, offerNormalizedNet } from "@/lib/inventory/stock";
import { canTransferStock, invoiceMismatch, invoiceStockStatus, transferableLines } from "@/lib/inventory/invoice-finance";
import type { PurchaseInvoice } from "@/lib/inventory/types";
import { buildRecipeSuggestions, matchRecipeSuggestion } from "@/lib/ai/gemini-recipe";
import { parseInvoiceExtraction } from "@/lib/ai/gemini-invoice";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { InventoryMovement, PosSaleLine, PurchasePriceRecord, SupplierOffer } from "@/lib/inventory/types";

const coffee: CostingIngredient = {
  id: "coffee",
  name: "קפה עלית",
  purchasePrice: 70,
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.07,
  active: true,
  createdAt: "",
  updatedAt: "",
};

describe("VAT", () => {
  it("splits inclusive, exclusive, and exempt per line", () => {
    const inc = splitVat({ amount: 118, vatType: "inclusive", vatRate: 0.18 });
    expect(inc.priceBeforeVat).toBeCloseTo(100, 1);
    expect(inc.priceIncludingVat).toBe(118);
    const exc = splitVat({ amount: 100, vatType: "exclusive", vatRate: 0.18 });
    expect(exc.priceIncludingVat).toBeCloseTo(118, 1);
    const free = splitVat({ amount: 50, vatType: "exempt", vatRate: 0.18 });
    expect(free.vatAmount).toBe(0);
    expect(normalizeVatRate(18)).toBeCloseTo(0.18);
  });

  it("keeps food-cost VAT mode explicit", () => {
    expect(foodCostAmount(100, 118, "before")).toBe(100);
    expect(foodCostAmount(100, 118, "including")).toBe(118);
  });
});

describe("multi-supplier unit cost", () => {
  it("compares 5kg/300 vs 2kg/126 as unit cost", () => {
    const a = unitCostFromPackage(300, 5, "kg");
    const b = unitCostFromPackage(126, 2, "kg");
    expect(a).toBeCloseTo(0.06, 5);
    expect(b).toBeCloseTo(0.063, 5);
    const cheap = cheapestOffer([
      { id: "a", productId: "coffee", supplierId: "A", lastUnitCost: a, createdAt: "", updatedAt: "" },
      { id: "b", productId: "coffee", supplierId: "B", lastUnitCost: b, createdAt: "", updatedAt: "" },
    ] as SupplierOffer[]);
    expect(cheap?.supplierId).toBe("A");
  });

  it("normalizes different packages and ignores incompatible units", () => {
    const pastaA = {
      id: "a",
      productId: "pasta",
      supplierId: "A",
      priceIncludingVat: 25,
      packageQuantity: 5,
      purchaseUnit: "kg" as const,
      createdAt: "",
      updatedAt: "",
    };
    const pastaB = {
      id: "b",
      productId: "pasta",
      supplierId: "B",
      priceIncludingVat: 47,
      packageQuantity: 10,
      purchaseUnit: "kg" as const,
      createdAt: "",
      updatedAt: "",
    };
    const oil = {
      id: "c",
      productId: "pasta",
      supplierId: "C",
      priceIncludingVat: 20,
      packageQuantity: 1,
      purchaseUnit: "liter" as const,
      createdAt: "",
      updatedAt: "",
    };
    expect(offerNormalizedCost(pastaA)).toBeCloseTo(0.005, 6);
    expect(offerNormalizedCost(pastaB)).toBeCloseTo(0.0047, 6);
    expect(cheapestOffer([pastaA, pastaB, oil], "g")?.supplierId).toBe("B");
    expect(comparableOffers([pastaA, pastaB, oil], "g").map((item) => item.supplierId)).toEqual(["A", "B"]);
  });

  it("keeps purchase price history instead of overwrite-only", () => {
    const records: PurchasePriceRecord[] = [
      { id: "1", productId: "coffee", purchaseDate: "2026-10-01", quantity: 1, packageQuantity: 1, unit: "kg", priceBeforeVat: 72, vatAmount: 0, priceIncludingVat: 72, vatType: "inclusive", vatRate: 0.18, unitCost: 0.072, createdAt: "2026-10-01" },
      { id: "2", productId: "coffee", purchaseDate: "2026-10-06", quantity: 1, packageQuantity: 1, unit: "kg", priceBeforeVat: 68, vatAmount: 0, priceIncludingVat: 68, vatType: "inclusive", vatRate: 0.18, unitCost: 0.068, createdAt: "2026-10-06" },
    ];
    expect(latestPurchase(records, "coffee")?.unitCost).toBeCloseTo(0.068);
  });
});

describe("inventory ledger", () => {
  it("current stock comes from signed movements", () => {
    const movements: InventoryMovement[] = [
      { id: "1", productId: "coffee", type: "PURCHASE_IN", quantity: 5, unit: "kg", quantityBase: 5000, receivedAt: "2026-10-06", createdAt: "a" },
      { id: "2", productId: "coffee", type: "SALE_OUT", quantity: 180, unit: "g", quantityBase: -180, receivedAt: "2026-10-07", createdAt: "b" },
    ];
    expect(currentStockBase(movements, "coffee")).toBe(4820);
  });
});

describe("POS import", () => {
  it("computes theoretical consumption from the same inventory product", () => {
    const recipes: DishRecipe[] = [
      {
        id: "r1",
        productId: "dish",
        ingredients: [{ ingredientId: "coffee", quantity: 18, unit: "g" }],
        createdAt: "",
        updatedAt: "",
      },
    ];
    const lines: PosSaleLine[] = [
      { key: "1", posCode: "X", posName: "קפה בדיקה מנה", quantity: 10, menuProductId: "dish", matchKind: "exact" },
    ];
    expect(theoreticalConsumption(lines, recipes)[0]).toMatchObject({ productId: "coffee", quantityBase: 180 });
  });

  it("hashes the same file the same way and blocks duplicates", () => {
    const a = hashPosFile(Buffer.from("abc"), "pos.xlsx");
    const b = hashPosFile(Buffer.from("abc"), "pos.xlsx");
    const c = hashPosFile(Buffer.from("abd"), "pos.xlsx");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("computes period delta only", () => {
    const prev: PosSaleLine[] = [
      { key: "1", posCode: "A", posName: "dish", quantity: 10, saleDate: "2026-10-06", matchKind: "exact" },
    ];
    const next: PosSaleLine[] = [
      { key: "1", posCode: "A", posName: "dish", quantity: 12, saleDate: "2026-10-06", matchKind: "exact" },
      { key: "2", posCode: "B", posName: "new", quantity: 1, saleDate: "2026-10-06", matchKind: "none" },
    ];
    expect(posPeriod(next)).toBe("2026-10-06");
    expect(posDelta(prev, next)).toEqual({ added: 1, changed: 1, removed: 0, unchanged: 0 });
  });
});

describe("smart invoice matching", () => {
  it("matches pasta names and previous supplier mappings without merging", () => {
    const pasta = { ...coffee, id: "pasta", name: "פסטה" };
    const suppliers = [
      { id: "a", name: "شركة ABC", phone: "", active: true, createdAt: "", updatedAt: "" },
    ];
    expect(matchSupplier("شركة ABC", null, suppliers).kind).toBe("exact");
    expect(unrecognizedScannedSupplier({ supplierName: "شركة ABC" }, suppliers)).toBeNull();
    expect(unrecognizedScannedSupplier({ supplierName: "ספק חדש מהחשבונית" }, suppliers)).toBe("ספק חדש מהחשבונית");
    expect(unrecognizedScannedSupplier({ supplierId: "a", supplierName: "ספק חדש מהחשבונית" }, suppliers)).toBeNull();
    expect(unrecognizedScannedSupplier({ supplierName: "" }, suppliers)).toBeNull();
    expect(matchInventoryProduct({ name: "פסטה" }, [pasta], [], undefined).kind).toBe("exact");
    expect(matchInventoryProduct({ name: "Pasta Barilla 5KG" }, [pasta], [], undefined).kind).toBe("suggest");
    expect(matchInventoryProduct({ name: "Pasta Barilla 5KG" }, [pasta], [], undefined).item?.id).toBe("pasta");
    expect(matchInventoryProduct({ name: "كريمة" }, [{ ...coffee, id: "cream", name: "שמנת" }], [], undefined).item?.name).toBe("שמנת");
    expect(matchInventoryProduct({ name: "Cream" }, [{ ...coffee, id: "cream", name: "שמנת" }], [], undefined).kind).toBe("suggest");
    expect(
      matchInventoryProduct(
        { name: "PASTA BARILLA 5KG" },
        [pasta],
        [{ id: "m", supplierId: "a", supplierProductName: "PASTA BARILLA 5KG", inventoryProductId: "pasta", createdAt: "", updatedAt: "" }],
        "a"
      ).item?.id
    ).toBe("pasta");
    expect(
      findDuplicateInvoice(
        [{ id: "old", supplierId: "a", invoiceNumber: "100", invoiceDate: "2026-10-07", status: "approved" }],
        { supplierId: "a", invoiceNumber: "100", invoiceDate: "2026-10-07" }
      )
    ).toBe("old");
    expect(
      findDuplicateInvoice(
        [{ id: "old", invoiceNumber: "10275", invoiceDate: "2026-10-05", status: "draft" }],
        { invoiceNumber: "10275", invoiceDate: "2026-10-05" }
      )
    ).toBe("old");
    expect(matchSupplier("BRIOCHE", null, [{ ...suppliers[0], name: "בריאוש", aliases: ["BRIOCHE"] }]).kind).toBe("exact");
  });

  it("suggests fuzzy inventory matches from 60% without auto-confirming them", () => {
    const barilla = { ...coffee, id: "barilla", name: "פסטה ברילה", category: "מזון" };
    const elite = { ...coffee, id: "elite", name: "קפה עלית", category: "קפה" };
    expect(productNameSimilarity("פסטה ברילה 500 גרם", "פסטה ברילה")).toBeGreaterThanOrEqual(MATCH_SUGGEST_MIN);
    expect(productNameSimilarity("קפה עלית 1 ק״ג", "קפה עלית")).toBeGreaterThanOrEqual(MATCH_SUGGEST_MIN);
    const pastaMatch = matchInventoryProduct({ name: "פסטה ברילה 500 גרם" }, [barilla], [], undefined);
    const coffeeMatch = matchInventoryProduct({ name: 'קפה עלית 1 ק"ג' }, [elite], [], undefined);
    expect(pastaMatch.kind).toBe("suggest");
    expect(pastaMatch.item?.id).toBe("barilla");
    expect(coffeeMatch.kind).toBe("suggest");
    expect(coffeeMatch.item?.id).toBe("elite");
    expect(isConfirmedInvoiceMatch({ ...emptyInvoiceLine(), productId: barilla.id, matchKind: "suggest", matchConfirmed: false })).toBe(false);
  });

  it("returns at most three similar products and keeps a 60% suggestion unconfirmed on review", () => {
    const stock: CostingIngredient[] = [
      { ...coffee, id: "c1", name: "קרואסון חמאה", category: "מאפים" },
      { ...coffee, id: "c2", name: "קרואסון גדול", category: "מאפים" },
      { ...coffee, id: "c3", name: "קרואסון", category: "מאפים" },
      { ...coffee, id: "bread", name: "לחם", category: "מאפים" },
    ];
    const ranked = rankProductMatches("קוראסון חמאה גדול", stock);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(MATCH_TOP_N);
    expect(ranked.every((item) => item.score >= MATCH_SUGGEST_MIN)).toBe(true);
    expect(ranked[0].name).toMatch(/קרואסון/);
    const invoice = buildReviewedInvoice({
      extraction: extractedInvoice([
        { name: "קוראסון חמאה גדול", quantity: 2, unit: "יח", unitPrice: 8, lineTotal: 16, vatType: "inclusive", confidence: 0.9 },
      ]),
      ingredients: stock,
      suppliers: [],
      offers: [],
      records: [],
      maps: [],
      fileName: "inv.pdf",
      fileHash: "hash-croissant",
    });
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0].matchConfirmed).toBe(false);
    expect(invoice.lines[0].matchKind).toBe("suggest");
    expect(invoiceLineMatchStatus(invoice.lines[0])).toBe("possible");
    expect((invoice.lines[0].candidates ?? []).length).toBeLessThanOrEqual(3);
  });

  it("reviews a 30-line invoice as one compact row each and only confirms safe matches", () => {
    const stock: CostingIngredient[] = [
      { ...coffee, id: "barilla", name: "פסטה ברילה", category: "מזון" },
      { ...coffee, id: "elite", name: "קפה עלית", category: "קפה" },
      { ...coffee, id: "milk", name: "חלב 3%", category: "חלב" },
    ];
    const names = Array.from({ length: 30 }, (_, index) => {
      if (index === 0) return "פסטה ברילה 500 גרם";
      if (index === 1) return 'קפה עלית 1 ק"ג';
      if (index === 2) return "חלב 3%";
      return `פריט חשבונית ${index + 1}`;
    });
    const invoice = buildReviewedInvoice({
      extraction: extractedInvoice(
        names.map((name, index) => ({
          name,
          quantity: 1,
          unit: "kg",
          unitPrice: 10 + index,
          lineTotal: 10 + index,
          vatType: "inclusive" as const,
          confidence: 0.92,
        }))
      ),
      ingredients: stock,
      suppliers: [{ id: "s1", name: "ספק א", active: true, createdAt: "", updatedAt: "" }],
      offers: [],
      records: [],
      maps: [],
      fileName: "big.pdf",
      fileHash: "hash-30",
    });
    expect(invoice.lines).toHaveLength(30);
    expect(invoice.lines.every((line) => line.rawName && line.key)).toBe(true);
    const fuzzy = invoice.lines.find((line) => line.rawName.includes("פסטה ברילה"));
    expect(fuzzy?.productId).toBe("barilla");
    expect(fuzzy?.matchConfirmed).toBe(false);
    expect(invoiceLineMatchStatus(fuzzy!)).toBe("possible");
    const exact = invoice.lines.find((line) => line.rawName === "חלב 3%");
    expect(exact?.matchConfirmed).toBe(true);
    expect(invoiceLineMatchStatus(exact!)).toBe("confirmed");
    const unknown = invoice.lines.find((line) => line.rawName === "פריט חשבונית 10");
    expect(unknown?.productId).toBeUndefined();
    expect(invoiceLineMatchStatus(unknown!)).toBe("none");
    const counts = invoiceReviewCounts(invoice.lines);
    expect(counts.total).toBe(30);
    expect(counts.confirmed).toBeGreaterThanOrEqual(1);
    expect(counts.none).toBeGreaterThan(0);
    expect(invoice.lines.filter((line) => invoiceLineMatchesFilter(line, "unmapped", "")).length).toBe(counts.none);
    const weak = { ...invoice.lines[5], productId: "barilla", matchKind: "suggest" as const, matchConfirmed: false, matchConfidence: 0.72 };
    expect(confirmSafeInvoiceMatches([weak])[0].matchConfirmed).toBe(false);
    expect(confirmSafeInvoiceMatches([{ ...weak, matchConfidence: 0.94 }])[0].matchConfirmed).toBe(true);
    expect(inventoryCategories(stock)).toEqual(["חלב", "מזון", "קפה"]);
  });
});

function extractedInvoice(
  lines: Array<{
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    lineTotal: number;
    vatType: "inclusive" | "exclusive" | "exempt";
    confidence: number;
  }>
): ExtractedInvoice {
  const field = <T,>(value: T) => ({ value, confidence: 0.95 });
  return {
    supplierName: field("ספק א"),
    businessName: field("ספק א"),
    taxId: field(null),
    invoiceNumber: field("INV-30"),
    invoiceDate: field("2026-10-07"),
    currency: field("ILS"),
    documentType: field("invoice"),
    paymentMethod: field(null),
    headerDiscount: field(null),
    vatRate: field(0.18),
    subtotal: field(100),
    vatTotal: field(18),
    grandTotal: field(118),
    vatStatus: "detected",
    supplierVatNumber: field(null),
    supplierPhone: field(null),
    supplierAddress: field(null),
    dueDate: field(null),
    paymentTerms: field(null),
    subtotalBeforeDiscount: field(null),
    discountTotal: field(null),
    shipping: field(null),
    delivery: field(null),
    serviceCharge: field(null),
    rounding: field(null),
    otherCharges: field(null),
    lines: lines.map((line) => ({
      name: line.name,
      originalDescription: line.name,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      unitPriceNet: line.unitPrice,
      unitPriceGross: null,
      discount: 0,
      discountPercent: null,
      discountAmount: 0,
      priceBeforeVat: null,
      vatAmount: null,
      priceIncludingVat: null,
      lineTotal: line.lineTotal,
      lineNet: null,
      lineGross: null,
      sku: null,
      barcode: null,
      vatType: line.vatType,
      vatRate: null,
      conversionNote: null,
      conversionFactor: null,
      confidence: line.confidence,
    })),
  };
}

describe("invoice archive and VAT honesty", () => {
  it("does not invent 18% when tax mode is unknown", () => {
    const invoice = buildReviewedInvoice({
      extraction: extractedInvoice([
        { name: "פטור", quantity: 1, unit: "unit", unitPrice: 10, lineTotal: 10, vatType: "unknown" as never, confidence: 0.5 },
      ]),
      ingredients: [coffee],
      suppliers: [],
      offers: [],
      records: [],
      maps: [],
      fileName: "a.jpg",
      fileHash: "h",
    });
    expect(invoice.lines[0]?.taxMode ?? invoice.lines[0]?.vatType).toBe("unknown");
    expect(invoice.lines[0]?.vatRate).toBeNull();
    expect(invoice.scanStatus).toBe("needs_review");
  });

  it("surfaces header vs line mismatches and keeps archive statuses", () => {
    const validation = validateInvoiceTotals({
      lines: [{ ...emptyInvoiceLine(), netAmount: 842.37, vatAmount: 151.63, grossAmount: 994 }],
      headerNet: 842.37,
      headerVat: 151.63,
      headerGross: 1004,
    });
    expect(validation.hasMismatch).toBe(true);
    expect(validation.grossDiff).toBeCloseTo(-10, 1);
    expect(archiveStatus({ status: "draft", stockStatus: "none", lines: [], supplierName: "", invoiceNumber: "", invoiceDate: "", receivedAt: "", createdAt: "", id: "1" })).toBe("uploaded");
    expect(invoiceSourcePath("abc", "scan.PDF", new Date("2026-10-11"))).toBe("invoice-files/2026/10/abc/original.pdf");
    expect(publicScanErrorCode("AI_NOT_CONFIGURED")).toBe("PROVIDER_NOT_CONFIGURED");
    expect(publicScanErrorCode("PROVIDER_AUTH_ERROR", 403)).toBe("PROVIDER_FORBIDDEN");
  });
});

describe("dish ingredient matching", () => {
  const stock: CostingIngredient[] = [
    { ...coffee, id: "pasta", name: "פסטה" },
    { ...coffee, id: "cream", name: "שמנת" },
    { ...coffee, id: "mush", name: "פטריות" },
    { ...coffee, id: "parm", name: "פרמזן" },
    { ...coffee, id: "milk", name: "חלב" },
    { ...coffee, id: "sugar", name: "סוכר" },
    { ...coffee, id: "coffee2", name: "קפה" },
  ];

  it("matches Arabic Hebrew and English names to the same inventory product", () => {
    expect(matchRecipeSuggestion("باستا", stock).productId).toBe("pasta");
    expect(matchRecipeSuggestion("Pasta", stock).productId).toBe("pasta");
    expect(matchRecipeSuggestion("פסטה", stock).matchKind).toBe("exact");
    expect(matchRecipeSuggestion("كريمة", stock).productId).toBe("cream");
    expect(matchRecipeSuggestion("Cream", stock).productId).toBe("cream");
  });

  it("does not invent quantities and flags missing products", () => {
    const rows = buildRecipeSuggestions(
      [
        { name: "Pasta", confidence: 0.96 },
        { name: "Mozzarella", confidence: 0.7, needsReview: true },
      ],
      stock
    );
    expect(rows[0]).not.toHaveProperty("quantity");
    expect(rows[0].productId).toBe("pasta");
    expect(rows[1].matchKind).toBe("missing");
    expect(rows[1].needsReview).toBe(true);
  });

  it("leaves unknown invoice fields null instead of inventing them", () => {
    const extracted = parseInvoiceExtraction(JSON.stringify({ supplierName: { value: "ABC", confidence: 0.9 }, lines: [] }));
    expect(extracted.currency.value).toBeNull();
    expect(extracted.invoiceDate.value).toBeNull();
    expect(extracted.grandTotal.value).toBeNull();
  });
});

describe("manual supplier invoice", () => {
  it("computes line totals and invoice summary without OCR", () => {
    const line = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      productId: coffee.id,
      rawName: coffee.name,
      quantity: 5,
      unit: "kg",
      unitPrice: 70,
      discount: 0,
      vatType: "inclusive",
    }, 0.18);
    expect(line.lineTotal).toBe(350);
    expect(line.priceBeforeVat).toBeCloseTo(296.61, 1);
    const summary = invoiceSummary([line], 0.18);
    expect(summary.itemCount).toBe(1);
    expect(summary.includingVat).toBe(350);
  });

  it("ignores incomplete lines so attachment-only drafts do not post stock", () => {
    const summary = invoiceSummary([emptyInvoiceLine(0.18)], 0.18);
    expect(summary.itemCount).toBe(0);
    expect(summary.includingVat).toBe(0);
  });

  it("sums extracted line amounts even when a product match is missing", () => {
    const line = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      rawName: "לחם",
      quantity: 2,
      unit: null,
      unitPrice: null,
      lineNet: 100,
      lineGross: 118,
      vatAmount: 18,
      vatType: "unknown",
    }, 0.18);
    expect(line.unitPrice).toBe(50);
    const summary = invoiceSummary([line], 0.18);
    expect(summary.itemCount).toBe(1);
    expect(summary.beforeVat).toBe(100);
    expect(summary.includingVat).toBe(118);

    const pricedOnly = finalizeInvoiceLine({
      ...emptyInvoiceLine(null),
      rawName: "קרואסון",
      quantity: 12,
      unit: null,
      unitPrice: 14,
      vatType: "unknown",
    }, 0.18);
    expect(pricedOnly.netAmount).toBe(168);
    expect(pricedOnly.vatAmount).toBeCloseTo(30.24, 2);
    expect(invoiceSummary([pricedOnly], 0.18).includingVat).toBeCloseTo(198.24, 2);
  });
});

describe("finance-first invoices", () => {
  it("sums every priced line including non-inventory services", () => {
    const pasta = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      rawName: "Pasta",
      productId: "pasta",
      quantity: 10,
      unit: "kg",
      unitPrice: 5,
      vatType: "exclusive",
    }, 0.18);
    const shipping = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      rawName: "Delivery",
      quantity: 1,
      unit: "unit",
      unitPrice: 10,
      vatType: "exclusive",
    }, 0.18);
    const totals = invoiceFinanceTotals([pasta, shipping], 0.18);
    expect(totals.net).toBeCloseTo(60);
    expect(totals.vat).toBeCloseTo(10.8);
    expect(totals.gross).toBeCloseTo(70.8);
    expect(totals.itemCount).toBe(2);
  });

  it("flags header vs line mismatches and keeps finance save off stock", () => {
    const line = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      rawName: "Pasta",
      quantity: 10,
      unit: "kg",
      unitPrice: 5,
      vatType: "exclusive",
    }, 0.18);
    const invoice: PurchaseInvoice = {
      id: "inv-1",
      supplierName: "A",
      invoiceNumber: "100",
      invoiceDate: "2026-10-07",
      receivedAt: "2026-10-07",
      status: "saved",
      stockStatus: "none",
      netAmount: 100,
      vatAmount: 18,
      grossAmount: 118,
      lines: [line],
      createdAt: "",
    };
    const mismatch = invoiceMismatch(invoice);
    expect(mismatch.hasMismatch).toBe(true);
    expect(invoiceStockStatus(invoice)).toBe("none");
    expect(canTransferStock(invoice)).toBe(true);
    expect(transferableLines([{ ...line, productId: "pasta", skipInventory: true }])).toHaveLength(0);
    expect(transferableLines([{ ...line, productId: "pasta", transferToInventory: true }])).toHaveLength(1);
    expect(
      transferableLines([{ ...line, productId: "pasta", matchKind: "suggest", matchConfirmed: false, transferToInventory: true }])
    ).toHaveLength(0);
  });

  it("compares last purchase net prices across suppliers", () => {
    const cheap = cheapestLastPurchase(
      [
        { id: "a", productId: "pasta", supplierId: "A", lastPriceBeforeVat: 25, lastPackageQuantity: 5, lastUnit: "kg", lastPurchaseDate: "2026-10-07", createdAt: "", updatedAt: "" },
        { id: "b", productId: "pasta", supplierId: "B", lastPriceBeforeVat: 16.5, lastPackageQuantity: 3, lastUnit: "kg", lastPurchaseDate: "2026-10-02", createdAt: "", updatedAt: "" },
      ],
      "net",
      "g"
    );
    expect(cheap?.supplierId).toBe("A");
    expect(offerNormalizedNet({
      id: "a",
      productId: "pasta",
      supplierId: "A",
      lastPriceBeforeVat: 25,
      lastPackageQuantity: 5,
      lastUnit: "kg",
      createdAt: "",
      updatedAt: "",
    })).toBeCloseTo(0.005);
  });
});
