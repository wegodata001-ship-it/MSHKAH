import { describe, expect, it } from "vitest";
import { openingMovementId, explainStock, queryStockSheet, validateProductPatch } from "@/lib/inventory/stock-sheet";
import type { InventoryMovement } from "@/lib/inventory/types";

function movement(patch: Partial<InventoryMovement>): InventoryMovement {
  return {
    id: "m",
    productId: "flour",
    type: "OPENING",
    quantity: 1,
    unit: "kg",
    quantityBase: 1,
    receivedAt: "2026-10-01",
    createdAt: "2026-10-01",
    ...patch,
  };
}

describe("inventory sheet stock", () => {
  it("explains current stock from opening, purchases, issues, returns, and adjustments", () => {
    const rows = [
      movement({ id: "open", type: "OPENING", quantityBase: 10 }),
      movement({ id: "in", type: "PURCHASE_IN", quantityBase: 5, invoiceId: "inv", invoiceLineKey: "line" }),
      movement({ id: "out", type: "ISSUE_OUT", quantityBase: 3 }),
      movement({ id: "back", type: "ISSUE_OUT", quantityBase: 1, reason: "return" }),
      movement({ id: "adj", type: "ADJUSTMENT", quantityBase: 2 }),
    ];
    const explained = explainStock(rows, "flour");
    expect(explained).toMatchObject({ opening: 10, incoming: 5, consumption: 3, returns: 1, adjustments: 2, current: 13, gap: 0, duplicatePurchases: 0 });
    expect(explained.current).toBe(explained.explained);
  });

  it("flags a repeated invoice line without changing the stored movements", () => {
    const rows = [
      movement({ id: "a", type: "PURCHASE_IN", quantityBase: 2, invoiceId: "inv", invoiceLineKey: "line" }),
      movement({ id: "b", type: "PURCHASE_IN", quantityBase: 2, invoiceId: "inv", invoiceLineKey: "line" }),
    ];
    expect(explainStock(rows, "flour").duplicatePurchases).toBe(1);
    expect(rows).toHaveLength(2);
  });

  it("filters and sorts the sheet without dropping the source rows", () => {
    const rows = [
      { id: "a", name: "קמח", current: 0, price: null, date: "2026-01-01", discrepancy: false },
      { id: "b", name: "סוכר", current: -1, price: 10, date: "2026-02-01", discrepancy: true },
      { id: "c", name: "שמן", current: 4, price: 3, date: "2026-03-01", discrepancy: false },
    ];
    expect(queryStockSheet(rows, { zero: true }).map((row) => row.id)).toEqual(["a"]);
    expect(queryStockSheet(rows, { negative: true }).map((row) => row.id)).toEqual(["b"]);
    expect(queryStockSheet(rows, { missingPrice: true }).map((row) => row.id)).toEqual(["a"]);
    expect(queryStockSheet(rows, { discrepancy: true }).map((row) => row.id)).toEqual(["b"]);
    expect(queryStockSheet(rows, { sort: "price" }).map((row) => row.id)).toEqual(["c", "b", "a"]);
    expect(queryStockSheet(rows, { sort: "date" })[0]?.id).toBe("c");
  });

  it("requires one documented stock edit and a stable opening movement id", () => {
    expect(validateProductPatch({ productId: "flour", category: "יבשים" }).ok).toBe(true);
    expect(validateProductPatch({ productId: "flour", openingQuantity: 4, nextQuantity: 5, reason: "ספירה" }).ok).toBe(false);
    expect(validateProductPatch({ productId: "flour", nextQuantity: 5 }).ok).toBe(false);
    expect(validateProductPatch({ productId: "flour" }).ok).toBe(false);
    expect(openingMovementId("flour", 12.7)).toBe(openingMovementId("flour", 12.7));
    expect(openingMovementId("flour", 12.7)).not.toBe(openingMovementId("flour", 13));
  });
});
