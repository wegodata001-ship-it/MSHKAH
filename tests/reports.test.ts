import { describe, expect, it } from "vitest";
import type { CostingIngredient } from "@/lib/costing/types";
import type { InventoryMovement, PurchasePriceRecord, Supplier } from "@/lib/inventory/types";
import {
  buildInventoryRows,
  buildPriceCompare,
  buildPurchaseRows,
  classifyExceptions,
  purchaseSummary,
  varianceTone,
} from "@/lib/reports/compute";
import { formatReportDate, formatReportIls, inDateRange } from "@/lib/reports/format";

const coffee: CostingIngredient = {
  id: "coffee",
  name: "קפה עלית",
  category: "יבש",
  purchasePrice: 70,
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.07,
  minStock: 2000,
  recommendedStock: 5000,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const milk: CostingIngredient = {
  ...coffee,
  id: "milk",
  name: "חלב",
  purchasePrice: 0,
  costPerBaseUnit: 0,
  minStock: 12,
  supplier: undefined,
  lastSupplierId: undefined,
};

const movements: InventoryMovement[] = [
  { id: "o", productId: "coffee", type: "OPENING", quantity: 10, unit: "kg", quantityBase: 10000, receivedAt: "2026-10-01", createdAt: "2026-10-01" },
  { id: "p", productId: "coffee", type: "PURCHASE_IN", quantity: 5, unit: "kg", quantityBase: 5000, receivedAt: "2026-10-06", createdAt: "2026-10-06", unitCost: 0.07 },
  { id: "s", productId: "coffee", type: "SALE_OUT", quantity: 4, unit: "kg", quantityBase: -4000, receivedAt: "2026-10-08", createdAt: "2026-10-08", unitCost: 0.07 },
];

const records: PurchasePriceRecord[] = [
  { id: "1", productId: "coffee", supplierId: "A", purchaseDate: "2026-10-01", quantity: 1, packageQuantity: 1, unit: "kg", priceBeforeVat: 72, vatAmount: 0, priceIncludingVat: 72, vatType: "inclusive", vatRate: 0.18, unitCost: 0.072, createdAt: "a", invoiceId: "inv1" },
  { id: "2", productId: "coffee", supplierId: "B", purchaseDate: "2026-10-06", quantity: 1, packageQuantity: 1, unit: "kg", priceBeforeVat: 68, vatAmount: 0, priceIncludingVat: 68, vatType: "inclusive", vatRate: 0.18, unitCost: 0.068, createdAt: "b", invoiceId: "inv2" },
];

const suppliers: Supplier[] = [
  { id: "A", name: "Supplier A", active: true, createdAt: "", updatedAt: "" },
  { id: "B", name: "Supplier B", active: true, createdAt: "", updatedAt: "" },
];

describe("report SSOT inventory", () => {
  it("computes current stock from movements, not a hardcoded number", () => {
    const rows = buildInventoryRows([coffee], movements, [], records, suppliers, {});
    expect(rows[0]?.opening).toBe(10000);
    expect(rows[0]?.incoming).toBe(5000);
    expect(rows[0]?.consumption).toBe(4000);
    expect(rows[0]?.current).toBe(11000);
    expect(rows[0]?.stockValue).toBeCloseTo(11000 * 0.068);
  });

  it("shows em dash formatting when a money value is missing", () => {
    expect(formatReportIls(null)).toBe("—");
    expect(formatReportIls(12.5)).toContain("12.50");
  });
});

describe("exceptions", () => {
  it("flags missing supplier/price and below-min only", () => {
    const rows = buildInventoryRows([milk], [], [], [], [], {});
    const exceptions = classifyExceptions(rows, []);
    expect(exceptions.map((row) => row.kind)).toEqual(expect.arrayContaining(["out", "no-supplier", "no-price"]));
    expect(exceptions.some((row) => row.kind === "below-min")).toBe(false);
  });
});

describe("purchases and comparison", () => {
  it("summarizes VAT totals from real records", () => {
    const rows = buildPurchaseRows(records, [coffee], suppliers, [], {});
    const summary = purchaseSummary(rows);
    expect(summary.totalIncluding).toBe(140);
    expect(summary.invoiceCount).toBe(2);
  });

  it("marks the cheapest supplier by unit cost", () => {
    const compare = buildPriceCompare(records, [coffee], suppliers, {});
    expect(compare[0]?.cheapestSupplierId).toBe("B");
    expect(compare[0]?.cheapest).toBeCloseTo(0.068);
  });

  it("returns empty purchase summary as nulls, not zero", () => {
    expect(purchaseSummary([])).toEqual({
      totalIncluding: null,
      totalBefore: null,
      totalVat: null,
      invoiceCount: null,
      productCount: null,
    });
  });
});

describe("report format", () => {
  it("uses DD/MM/YYYY and date-range filters", () => {
    expect(formatReportDate("2026-10-07")).toBe("07/10/2026");
    expect(inDateRange("2026-10-07", "2026-10-01", "2026-10-31")).toBe(true);
    expect(inDateRange("2026-09-30", "2026-10-01", "2026-10-31")).toBe(false);
  });

  it("colors variance from a configurable threshold", () => {
    expect(varianceTone(2, 5)).toBe("ok");
    expect(varianceTone(7, 5)).toBe("watch");
    expect(varianceTone(12, 5)).toBe("critical");
    expect(varianceTone(null, 5)).toBe("none");
  });
});
