import { describe, expect, it } from "vitest";
import { emptyInvoiceLine, finalizeInvoiceLine } from "@/lib/inventory/invoice-lines";
import { plannedCreateGroups } from "@/lib/inventory/invoice-line-review";
import { isSafeInvoiceMatch, MATCH_SUGGEST_MIN, productNameSimilarity, qualifiersConflict } from "@/lib/inventory/product-match";
import { planMergedProductSplit, sharedProductQualifierConflicts } from "@/lib/inventory/product-split";
import { currentStockBase } from "@/lib/inventory/stock";
import { normalizeIngredientName } from "@/lib/costing/names";
import type { InventoryMovement, PurchaseInvoiceLine } from "@/lib/inventory/types";

function line(patch: Partial<PurchaseInvoiceLine>): PurchaseInvoiceLine {
  return { ...emptyInvoiceLine(0.18), matchKind: "new", matchConfirmed: true, unit: "unit", ...patch };
}

describe("distinct cookie products", () => {
  it("keeps regular cookies and sugar-free cookies as two products", () => {
    const regular = line({ key: "regular", rawName: "עוגיות", quantity: 8, unitPrice: 28, productId: "regular-id" });
    const sugarFree = line({ key: "sugar", rawName: "עוגיות ללא סוכר", quantity: 4, unitPrice: 30, productId: "sugar-id" });
    expect(regular.productId).not.toBe(sugarFree.productId);
    expect(plannedCreateGroups([
      line({ key: "regular", rawName: "עוגיות", plannedProductName: "עוגיות" }),
      line({ key: "sugar", rawName: "עוגיות ללא סוכר", plannedProductName: "עוגיות ללא סוכר" }),
    ])).toHaveLength(2);
    expect(qualifiersConflict("עוגיות", "עוגיות ללא סוכר")).toBe(true);
    expect(sharedProductQualifierConflicts([
      { productId: "same", name: "עוגיות" },
      { productId: "same", name: "עוגיות ללא סוכר" },
    ])).toHaveLength(1);
    expect(sharedProductQualifierConflicts([
      { productId: "same", name: "עוגיות" },
      { productId: "same", name: "עוגיות" },
    ])).toHaveLength(0);
    expect(sharedProductQualifierConflicts([
      { productId: "ice", name: "גלידה קינדר" },
      { productId: "ice", name: "גלידה דובדבן" },
    ])).toHaveLength(1);
    expect(sharedProductQualifierConflicts([
      { productId: "pasta", name: "פסטה ברילה" },
      { productId: "pasta", name: "פסטה ברילה 500 גרם" },
    ])).toHaveLength(0);
    const movements = [
      movement("m1", "regular-id", 8),
      movement("m2", "sugar-id", 4),
    ];
    expect(currentStockBase(movements, "regular-id")).toBe(8);
    expect(currentStockBase(movements, "sugar-id")).toBe(4);
    expect(currentStockBase(movements, "regular-id") + currentStockBase(movements, "sugar-id")).toBe(12);
  });

  it("adds two purchases of the same product and keeps both prices", () => {
    const first = movement("a", "sugar-id", 4);
    const second = movement("b", "sugar-id", 2);
    expect(currentStockBase([first, second], "sugar-id")).toBe(6);
    const prices = [
      { productId: "sugar-id", unitPrice: 30 },
      { productId: "sugar-id", unitPrice: 31 },
    ];
    expect(prices.filter((row) => row.productId === "sugar-id")).toHaveLength(2);
    expect(prices.filter((row) => row.productId === "regular-id")).toHaveLength(0);
  });

  it("suggests a similar name and does not auto-assign it", () => {
    const score = productNameSimilarity("עוגיות ללא סוכר", "עוגיות");
    expect(score).toBeGreaterThanOrEqual(MATCH_SUGGEST_MIN);
    expect(score).toBeLessThan(0.9);
    expect(isSafeInvoiceMatch(score, "suggest")).toBe(false);
    expect(normalizeIngredientName("עוגיות ללא סוכר")).toContain("ללא סוכר");
  });

  it("moves one invoice line to another product without a second movement", () => {
    const plan = planMergedProductSplit({
      sourceProductId: "merged",
      lines: [
        { invoiceId: "inv", lineKey: "sugar", name: "עוגיות ללא סוכר", quantity: 4, productId: "merged" },
        { invoiceId: "inv", lineKey: "regular", name: "עוגיות", quantity: 8, productId: "merged" },
      ],
      movements: [
        { ...movement("in-inv-sugar", "merged", 4), invoiceId: "inv", invoiceLineKey: "sugar" },
        { ...movement("in-inv-regular", "merged", 8), invoiceId: "inv", invoiceLineKey: "regular" },
      ],
      selections: [{ invoiceId: "inv", lineKey: "sugar", targetProductId: "sugar-id" }],
    });
    expect(plan.movementMoves).toEqual([
      { id: "in-inv-sugar", fromProductId: "merged", toProductId: "sugar-id", quantityBase: 4 },
    ]);
    expect(plan.createsDuplicateMovement).toBe(false);
    expect(plan.balanceDelta).toEqual(expect.arrayContaining([
      { productId: "merged", delta: -4 },
      { productId: "sugar-id", delta: 4 },
    ]));
  });

  it("keeps the two products separate after save and reload", () => {
    const saved = [
      finalizeInvoiceLine(line({ key: "regular", rawName: "עוגיות", productId: "regular-id", quantity: 8, unitPrice: 28 }), 0.18),
      finalizeInvoiceLine(line({ key: "sugar", rawName: "עוגיות ללא סוכר", productId: "sugar-id", quantity: 4, unitPrice: 30 }), 0.18),
    ];
    const reloaded = JSON.parse(JSON.stringify(saved)) as PurchaseInvoiceLine[];
    expect(new Set(reloaded.map((item) => item.productId)).size).toBe(2);
    expect(reloaded.map((item) => item.quantity)).toEqual([8, 4]);
  });
});

function movement(id: string, productId: string, quantityBase: number): InventoryMovement {
  return {
    id,
    productId,
    type: "PURCHASE_IN",
    quantity: quantityBase,
    unit: "unit",
    quantityBase,
    createdAt: "",
  } as InventoryMovement;
}
