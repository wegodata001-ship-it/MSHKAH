import { describe, expect, it } from "vitest";
import type { CostingIngredient } from "@/lib/costing/types";
import { emptyInvoiceLine } from "@/lib/inventory/invoice-lines";
import {
  invoiceAssignmentPlan,
  isExistingIngredientAssignment,
  isPlannedNewIngredient,
  planNewIngredientPatch,
  plannedCreateGroups,
  plannedIngredientName,
  preferredSupplierAssignments,
} from "@/lib/inventory/invoice-line-review";
import { invoiceLineBlockers } from "@/lib/inventory/invoice-line-status";
import { matchInventoryProduct } from "@/lib/inventory/invoice-smart-match";
import type { PurchaseInvoiceLine, SupplierItemMap } from "@/lib/inventory/types";

function ingredient(patch: Partial<CostingIngredient> & Pick<CostingIngredient, "id" | "name">): CostingIngredient {
  return {
    purchasePrice: 0,
    purchaseQuantity: 1,
    purchaseUnit: "unit",
    baseUnit: "unit",
    costPerBaseUnit: 0,
    active: true,
    createdAt: "",
    updatedAt: "",
    ...patch,
  };
}

function line(patch: Partial<PurchaseInvoiceLine>): PurchaseInvoiceLine {
  return { ...emptyInvoiceLine(0.18), rawName: "עגבניה", quantity: 2, unit: "kg", unitPrice: 5, ...patch };
}

describe("invoice ingredient assignment", () => {
  it("keeps a new product as a draft name until intake", () => {
    const row = line({ matchKind: "none", matchConfirmed: false, productId: undefined });
    expect(isPlannedNewIngredient(row)).toBe(true);
    expect(plannedIngredientName(row)).toBe("עגבניה");
    const renamed = { ...row, ...planNewIngredientPatch(row), plannedProductName: "עגבניות שרי" };
    expect(renamed.rawName).toBe("עגבניה");
    expect(plannedIngredientName(renamed)).toBe("עגבניות שרי");
    expect(renamed.productId).toBeUndefined();
    expect(invoiceLineBlockers([renamed])).toEqual([]);
  });

  it("switches a planned product to an existing ingredient and drops the planned create", () => {
    const tomato = ingredient({ id: "tomato", name: "עגבניה" });
    const planned = line({ matchKind: "new", matchConfirmed: true, plannedProductName: "עגבניה חדשה" });
    expect(invoiceAssignmentPlan([planned], [tomato]).createCount).toBe(1);
    const chosen = {
      ...planned,
      productId: tomato.id,
      matchKind: "exact" as const,
      matchConfirmed: true,
      plannedProductName: undefined,
    };
    expect(isExistingIngredientAssignment(chosen)).toBe(true);
    expect(isPlannedNewIngredient(chosen)).toBe(false);
    expect(invoiceAssignmentPlan([chosen], [tomato])).toEqual({ createCount: 0, existingRows: 1 });
  });

  it("reuses one ingredient for the same supplier product and does not duplicate a known name", () => {
    const existing = ingredient({ id: "flour", name: "קמח" });
    const rows = [
      line({ key: "a", rawName: "קמח לבן", sku: "100", plannedProductName: "קמח", matchKind: "new" }),
      line({ key: "b", rawName: "קמח לבן", sku: "100", plannedProductName: "קמח אחר", matchKind: "new" }),
      line({ key: "c", rawName: "סוכר", plannedProductName: "סוכר", matchKind: "new" }),
      line({ key: "d", rawName: "סוכר חום", plannedProductName: "סוכר", matchKind: "new" }),
    ];
    const groups = plannedCreateGroups(rows);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.key === "sku:100")?.lineKeys).toEqual(["a", "b"]);
    expect(invoiceAssignmentPlan(rows, [existing])).toEqual({ createCount: 1, existingRows: 2 });
  });

  it("remembers a supplier sku when the price changes and flags a conflicting unit", () => {
    const flour = ingredient({ id: "flour", name: "קמח", purchaseUnit: "kg" });
    const map: SupplierItemMap = {
      id: "map",
      supplierId: "sup",
      supplierProductName: "קמח שק",
      supplierSku: "55",
      inventoryProductId: "flour",
      purchaseUnit: "kg",
      createdAt: "",
      updatedAt: "",
    };
    const samePrice = matchInventoryProduct({ name: "קמח שק", sku: "55", unit: "kg", quantity: 3 }, [flour], [map], "sup");
    const otherPrice = matchInventoryProduct({ name: "שם אחר לגמרי", sku: "55", unit: "kg", quantity: 9 }, [flour], [map], "sup");
    const otherUnit = matchInventoryProduct({ name: "קמח שק", sku: "55", unit: "unit", quantity: 3 }, [flour], [map], "sup");
    expect(samePrice.kind).toBe("mapped");
    expect(otherPrice).toMatchObject({ kind: "mapped", item: { id: "flour" }, packConflict: false });
    expect(otherUnit.packConflict).toBe(true);
    const saved = line({
      productId: "flour",
      matchKind: "mapped",
      matchConfirmed: true,
      priceChangePercent: 40,
      conversionNote: "pack-conflict",
    });
    expect(isExistingIngredientAssignment(saved)).toBe(true);
    const preferred = preferredSupplierAssignments([
      line({ key: "a", sku: "55", productId: "new-flour", matchKind: "new" }),
      line({ key: "b", sku: "55", productId: "flour", matchKind: "exact" }),
    ]);
    expect(preferred.map((row) => row.productId)).toEqual(["flour"]);
  });
});
