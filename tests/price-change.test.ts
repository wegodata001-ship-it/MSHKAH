import { describe, it, expect } from "vitest";
import {
  approvedPurchasesForIngredient,
  buildIngredientPriceSummary,
  compareApprovedPurchases,
} from "@/lib/costing/price-change";
import type { CostingIngredient } from "@/lib/costing/types";
import type {
  PurchaseInvoice,
  PurchasePriceRecord,
  Supplier,
} from "@/lib/inventory/types";

const SUPPLIER_A: Supplier = { id: "sup-a", name: "סופר כהן", createdAt: "2026-01-01" } as Supplier;
const SUPPLIER_B: Supplier = { id: "sup-b", name: "אבי ג׳אבר", createdAt: "2026-01-01" } as Supplier;

const INV_1: PurchaseInvoice = {
  id: "inv-1",
  supplierId: "sup-a",
  supplierName: "סופר כהן",
  invoiceNumber: "1001",
  invoiceDate: "2026-09-20",
  receivedAt: "2026-09-20",
  lines: [],
  status: "approved",
  totals: {} as never,
  createdAt: "",
  updatedAt: "",
} as unknown as PurchaseInvoice;

const INV_2: PurchaseInvoice = {
  id: "inv-2",
  supplierId: "sup-a",
  supplierName: "סופר כהן",
  invoiceNumber: "1010",
  invoiceDate: "2026-10-05",
  receivedAt: "2026-10-05",
  lines: [],
  status: "approved",
  totals: {} as never,
  createdAt: "",
  updatedAt: "",
} as unknown as PurchaseInvoice;

const INV_DRAFT: PurchaseInvoice = {
  ...INV_2,
  id: "inv-draft",
  invoiceNumber: "9999",
  invoiceDate: "2026-10-15",
  status: "draft",
} as PurchaseInvoice;

function record(partial: Partial<PurchasePriceRecord> & Pick<PurchasePriceRecord, "id" | "productId" | "purchaseDate" | "quantity" | "unit">): PurchasePriceRecord {
  return {
    id: partial.id,
    productId: partial.productId,
    supplierId: partial.supplierId,
    invoiceId: partial.invoiceId,
    purchaseDate: partial.purchaseDate,
    quantity: partial.quantity,
    packageQuantity: partial.packageQuantity ?? partial.quantity,
    purchaseQuantity: partial.purchaseQuantity ?? partial.quantity,
    unit: partial.unit,
    purchaseUnit: partial.purchaseUnit ?? partial.unit,
    unitPriceNet: partial.unitPriceNet,
    unitPriceGross: partial.unitPriceGross,
    lineTotalNet: partial.lineTotalNet,
    lineTotalVat: partial.lineTotalVat,
    lineTotalGross: partial.lineTotalGross,
    priceBeforeVat: partial.priceBeforeVat ?? partial.lineTotalNet ?? 0,
    vatAmount: partial.vatAmount ?? 0,
    priceIncludingVat: partial.priceIncludingVat ?? partial.lineTotalGross ?? 0,
    vatType: partial.vatType ?? "normal",
    vatRate: partial.vatRate ?? 0.18,
    unitCost: partial.unitCost ?? 0,
    createdAt: partial.createdAt ?? partial.purchaseDate,
  } as PurchasePriceRecord;
}

function flour(overrides?: Partial<CostingIngredient>): CostingIngredient {
  return {
    id: "ing-flour",
    name: "קמח",
    purchasePrice: 24,
    purchaseQuantity: 1,
    purchaseUnit: "kg",
    baseUnit: "g",
    costPerBaseUnit: 0.024,
    active: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("buildIngredientPriceSummary", () => {
  it("compares same-supplier purchases after converting kg to g", () => {
    const records = [
      record({
        id: "r1",
        productId: "ing-flour",
        supplierId: "sup-a",
        invoiceId: "inv-1",
        purchaseDate: "2026-09-20",
        quantity: 25,
        unit: "kg",
        priceBeforeVat: 500, // 25 kg → 25000 g → 0.02 /g
      }),
      record({
        id: "r2",
        productId: "ing-flour",
        supplierId: "sup-a",
        invoiceId: "inv-2",
        purchaseDate: "2026-10-05",
        quantity: 25,
        unit: "kg",
        priceBeforeVat: 550, // 0.022 /g → +10%
      }),
    ];
    const summary = buildIngredientPriceSummary(flour({ costPerBaseUnit: 0.02 }), records, [INV_1, INV_2], [SUPPLIER_A], "before");
    expect(summary.pricePerBase).toBeCloseTo(0.022, 5);
    expect(summary.supplierId).toBe("sup-a");
    expect(summary.priceDate).toBe("2026-10-05");
    expect(summary.comparison.kind).toBe("same-supplier");
    if (summary.comparison.kind === "same-supplier") {
      expect(summary.comparison.direction).toBe("up");
      expect(summary.comparison.deltaIls).toBeCloseTo(0.002, 5);
      expect(summary.comparison.deltaPct).toBeCloseTo(0.1, 3);
    }
    expect(summary.suggestion?.hasUpdate).toBe(true);
    expect(summary.suggestion?.nextCostPerBase).toBeCloseTo(0.022, 5);
  });

  it("marks cross-supplier comparison distinctly", () => {
    const records = [
      record({
        id: "r1",
        productId: "ing-flour",
        supplierId: "sup-b",
        invoiceId: "inv-1",
        purchaseDate: "2026-09-20",
        quantity: 1000,
        unit: "g",
        priceBeforeVat: 25,
      }),
      record({
        id: "r2",
        productId: "ing-flour",
        supplierId: "sup-a",
        invoiceId: "inv-2",
        purchaseDate: "2026-10-05",
        quantity: 1000,
        unit: "g",
        priceBeforeVat: 23.75,
      }),
    ];
    const summary = buildIngredientPriceSummary(flour(), records, [INV_1, INV_2], [SUPPLIER_A, SUPPLIER_B], "before");
    expect(summary.comparison.kind).toBe("cross-supplier");
    if (summary.comparison.kind === "cross-supplier") {
      expect(summary.comparison.direction).toBe("down");
      expect(summary.comparison.deltaPct).toBeCloseTo(-0.05, 3);
    }
  });

  it("ignores draft and unapproved invoice records", () => {
    const records = [
      record({
        id: "r1",
        productId: "ing-flour",
        supplierId: "sup-a",
        invoiceId: "inv-1",
        purchaseDate: "2026-09-20",
        quantity: 1,
        unit: "kg",
        priceBeforeVat: 24,
      }),
      record({
        id: "r2",
        productId: "ing-flour",
        supplierId: "sup-a",
        invoiceId: "inv-draft",
        purchaseDate: "2026-10-15",
        quantity: 1,
        unit: "kg",
        priceBeforeVat: 48,
      }),
    ];
    const approved = approvedPurchasesForIngredient(records, [INV_1, INV_DRAFT], [SUPPLIER_A], "ing-flour");
    expect(approved).toHaveLength(1);
    expect(approved[0].record.id).toBe("r1");
  });

  it("returns missing-data when there is no previous purchase", () => {
    const records = [
      record({
        id: "r1",
        productId: "ing-flour",
        supplierId: "sup-a",
        invoiceId: "inv-2",
        purchaseDate: "2026-10-05",
        quantity: 1,
        unit: "kg",
        priceBeforeVat: 24,
      }),
    ];
    const summary = buildIngredientPriceSummary(flour({ costPerBaseUnit: 0.024 }), records, [INV_2], [SUPPLIER_A], "before");
    expect(summary.comparison.kind).toBe("missing-data");
    if (summary.comparison.kind === "missing-data") {
      expect(summary.comparison.reason).toBe("no-previous");
    }
    // Suggestion should not fire when the price is already synced with the ingredient.
    expect(summary.suggestion).toBeNull();
  });

  it("flags a manual override instead of silently replacing it", () => {
    const manual = flour({
      id: "ing-manual",
      originKind: "manual",
      purchasePrice: 24,
      purchaseQuantity: 1,
      purchaseUnit: "kg",
      costPerBaseUnit: 0.024,
    });
    const records = [
      record({
        id: "r1",
        productId: "ing-manual",
        supplierId: "sup-a",
        invoiceId: "inv-2",
        purchaseDate: "2026-10-05",
        quantity: 1,
        unit: "kg",
        priceBeforeVat: 30,
      }),
    ];
    const summary = buildIngredientPriceSummary(manual, records, [INV_2], [SUPPLIER_A], "before");
    expect(summary.suggestion?.hasUpdate).toBe(true);
    expect(summary.suggestion?.isManualOverride).toBe(true);
  });

  it("supports VAT basis conversion when comparing", () => {
    const current = {
      record: {} as PurchasePriceRecord,
      pricePerBaseBefore: 10,
      pricePerBaseIncluding: 11.8,
      purchaseDate: "2026-10-05",
      supplierId: "sup-a",
    };
    const previous = {
      record: {} as PurchasePriceRecord,
      pricePerBaseBefore: 10,
      pricePerBaseIncluding: 11.8,
      purchaseDate: "2026-09-01",
      supplierId: "sup-a",
    };
    const same = compareApprovedPurchases(current, previous, "before");
    expect(same.kind).toBe("same-supplier");
    if (same.kind === "same-supplier") expect(same.direction).toBe("flat");
  });
});
