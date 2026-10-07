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
import { findDuplicateInvoice, matchInventoryProduct, matchSupplier } from "@/lib/inventory/invoice-smart-match";
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
