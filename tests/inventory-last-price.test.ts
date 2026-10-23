import { describe, expect, it } from "vitest";
import { attributedPurchaseQty, displayedLastPrice, planInventoryAdjustment, shownRecordUnitPrices, verifiedLastPurchase } from "@/lib/inventory/last-price";
import { currentStockBase } from "@/lib/inventory/stock";
import { latestUnitCost } from "@/services/inventoryService";
import type { CostingIngredient } from "@/lib/costing/types";
import type { InventoryMovement, PurchasePriceRecord } from "@/lib/inventory/types";

const product = {
  id: "kinder",
  name: "גלידה קינדר",
  purchasePrice: 0,
  purchaseQuantity: 1,
  purchaseUnit: "unit",
  baseUnit: "unit",
  costPerBaseUnit: 0,
  active: true,
  createdAt: "",
  updatedAt: "",
} satisfies CostingIngredient;

function record(patch: Partial<PurchasePriceRecord> & Pick<PurchasePriceRecord, "id" | "purchaseDate">): PurchasePriceRecord {
  return {
    productId: "kinder",
    quantity: 1,
    packageQuantity: 1,
    unit: "unit",
    priceBeforeVat: 0,
    vatAmount: 0,
    priceIncludingVat: 0,
    vatType: "exclusive",
    vatRate: 0.18,
    unitCost: 0,
    createdAt: patch.purchaseDate,
    ...patch,
  };
}

const invoice = record({
  id: "invoice-price",
  purchaseDate: "2026-08-28",
  invoiceId: "OflJ2WBRfQVYkFPKCGUw",
  source: "PURCHASE_INVOICE",
  quantity: 6.7,
  packageQuantity: 6.7,
  priceBeforeVat: 160.8,
  priceIncludingVat: 189.74,
  vatAmount: 28.94,
  unitPriceNet: 24,
  unitPriceGross: 28.32,
  lineTotalNet: 160.8,
  lineTotalGross: 189.74,
  unitCost: 24,
});

const manual = record({
  id: "manual-price",
  purchaseDate: "2026-10-21",
  source: "MANUAL",
  quantity: 12.7,
  packageQuantity: 12.7,
  priceBeforeVat: 20.34,
  priceIncludingVat: 24,
  vatAmount: 3.66,
  unitCost: 24 / 12.7,
});

describe("kinder stock and last price", () => {
  const movements = [
    movement("in-946-kinder", 6, "Ld803DT5wPKu0ONQJZhh", "kinder"),
    movement("in-946-cherry", 5.6, "Ld803DT5wPKu0ONQJZhh", "cherry"),
    movement("in-1962-kinder", 6.7, "OflJ2WBRfQVYkFPKCGUw", "kinder-2"),
  ];

  it("explains 18.30 as kinder 12.70 plus another product 5.60", () => {
    expect(currentStockBase(movements, "kinder")).toBeCloseTo(18.3, 5);
    const names = attributedPurchaseQty({
      productId: "kinder",
      movements,
      lines: [
        { invoiceId: "Ld803DT5wPKu0ONQJZhh", lineKey: "kinder", name: "גלידה קינדר", quantity: 6 },
        { invoiceId: "Ld803DT5wPKu0ONQJZhh", lineKey: "cherry", name: "גלידה דובדבן", quantity: 5.6 },
        { invoiceId: "OflJ2WBRfQVYkFPKCGUw", lineKey: "kinder-2", name: "גלידה קינדר", quantity: 6.7 },
      ],
    });
    expect(names.byName.find((row) => row.name === "גלידה קינדר")?.quantity).toBeCloseTo(12.7, 5);
    expect(names.byName.find((row) => row.name === "גלידה דובדבן")?.quantity).toBeCloseTo(5.6, 5);
  });

  it("uses the invoice unit price of 24 excluding VAT, not 1.60", () => {
    expect(verifiedLastPurchase([manual, invoice], "kinder")?.id).toBe("invoice-price");
    const shown = displayedLastPrice(product, [manual, invoice]);
    expect(shown?.excludingVat).toBe(24);
    expect(shown?.includingVat).toBe(28.32);
    expect(shown?.source).toBe("invoice");
    expect(shownRecordUnitPrices(manual, [manual, invoice]).excludingVat).toBe(24);
    expect(manual.priceBeforeVat / manual.quantity).toBeCloseTo(1.6, 2);
  });

  it("keeps an approved quantity change as an adjustment and an approved price separate from the invoice", () => {
    const plan = planInventoryAdjustment({ currentBase: 18.3, nextQuantity: 12.7, unit: "unit", baseUnit: "unit" });
    expect(plan.deltaBase).toBeCloseTo(-5.6, 5);
    const after = [...movements, { ...movement("stock-adj", plan.deltaBase, "", ""), type: "ADJUSTMENT" as const }];
    expect(currentStockBase(after, "kinder")).toBeCloseTo(12.7, 5);
    expect(after.filter((row) => row.type === "PURCHASE_IN")).toHaveLength(3);
    const corrected = displayedLastPrice({
      ...product,
      adminPriceCorrection: {
        unitPriceExcludingVat: 24,
        unitPriceIncludingVat: 28.32,
        basis: "excluding",
        reason: "invoice 01/001962",
        at: "2026-10-23",
      },
    }, [manual, invoice]);
    expect(corrected?.source).toBe("admin");
    expect(corrected?.excludingVat).toBe(24);
    expect(invoice.unitPriceNet).toBe(24);
  });

  it("costs one purchase unit from the invoice price", () => {
    const cost = latestUnitCost(product, [manual, invoice], "latest");
    expect(cost.before).toBeCloseTo(24, 2);
    expect(cost.including).toBeCloseTo(28.32, 2);
  });
});

function movement(id: string, quantityBase: number, invoiceId: string, lineKey: string): InventoryMovement {
  return {
    id,
    productId: "kinder",
    type: "PURCHASE_IN",
    quantity: Math.abs(quantityBase),
    unit: "unit",
    quantityBase,
    invoiceId,
    invoiceLineKey: lineKey,
    receivedAt: "",
    createdAt: "",
  } as InventoryMovement;
}
