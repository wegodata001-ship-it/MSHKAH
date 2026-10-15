import { describe, expect, it } from "vitest";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import {
  assignLinesToIngredient,
  buildOfferCompareRow,
  cheapestComparableOffer,
  consumptionAlreadyRecorded,
  expandRecipeMaterials,
  filterUnifiedIngredients,
  ingredientHasCost,
  invoiceLineQuantityBase,
  packNeedsCompletion,
  planIngredientMerge,
  recipeHasCycle,
  recipeIngredientCostReport,
  stockCountAdjustment,
} from "@/lib/inventory/ingredient-core";
import { MATCH_SUGGEST_MIN, productNameSimilarity } from "@/lib/inventory/product-match";
import { matchInventoryProduct } from "@/lib/inventory/invoice-smart-match";
import type { InventoryMovement, PurchaseInvoiceLine, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";

const leben: CostingIngredient = {
  id: "leben",
  name: "לבנה",
  category: "חלבי",
  purchasePrice: 20,
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.02,
  minStock: 2000,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const flour: CostingIngredient = {
  id: "flour",
  name: "קמח",
  category: "יבש",
  purchasePrice: 0,
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0,
  active: true,
  createdAt: "",
  updatedAt: "",
};

function line(partial: Partial<PurchaseInvoiceLine>): PurchaseInvoiceLine {
  return {
    key: partial.key ?? "l1",
    rawName: partial.rawName ?? "לבנה 25",
    quantity: partial.quantity ?? 2,
    unit: partial.unit ?? "unit",
    unitPrice: partial.unitPrice ?? 12,
    discount: null,
    lineTotal: partial.lineTotal ?? 24,
    vatType: "inclusive",
    vatRate: 0.18,
    priceBeforeVat: 20,
    vatAmount: 4,
    priceIncludingVat: 24,
    ...partial,
  };
}

describe("unified material + two suppliers", () => {
  it("does not auto-merge by name similarity alone", () => {
    expect(productNameSimilarity("לבנה 25", "לבנה אסלית")).toBeGreaterThan(MATCH_SUGGEST_MIN);
    const maps: SupplierItemMap[] = [];
    const match = matchInventoryProduct({ name: "לבנה אסלית" }, [leben], maps);
    expect(match.kind === "suggest" || match.kind === "none" || match.kind === "new").toBe(true);
    if (match.kind === "suggest") expect(match.item?.id).toBe("leben");
  });

  it("remembers an approved supplier name map for the next invoice", () => {
    const maps: SupplierItemMap[] = [
      {
        id: "m1",
        supplierId: "sup-a",
        supplierProductName: "לבנה 25",
        inventoryProductId: "leben",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const next = matchInventoryProduct({ name: "לבנה 25" }, [leben], maps, "sup-a");
    expect(next.item?.id).toBe("leben");
    expect(next.kind).toBe("mapped");
  });

  it("bulk-assigns selected lines without losing source names", () => {
    const rows = assignLinesToIngredient(
      [line({ key: "a", rawName: "לבנה 25" }), line({ key: "b", rawName: "לבנה אסלית" }), line({ key: "c", rawName: "קמח" })],
      ["a", "b"],
      leben
    );
    expect(rows[0].productId).toBe("leben");
    expect(rows[0].rawName).toBe("לבנה 25");
    expect(rows[1].rawName).toBe("לבנה אסלית");
    expect(rows[1].matchConfirmed).toBe(true);
    expect(rows[2].productId).toBeUndefined();
  });
});

describe("pack conversion and compare", () => {
  it("adds 24 base units for two packs of 12", () => {
    expect(invoiceLineQuantityBase(line({ quantity: 2, conversionFactor: 12, unit: "unit" }))).toBe(24);
    expect(invoiceLineQuantityBase(line({ quantity: 2, unit: "kg", conversionFactor: null }))).toBe(2000);
  });

  it("asks for pack size instead of guessing cheapest", () => {
    expect(packNeedsCompletion(line({ unit: "unit", conversionFactor: null }), "g")).toBe(true);
    const incomplete = buildOfferCompareRow({
      id: "o1",
      productId: "leben",
      supplierId: "a",
      createdAt: "",
      updatedAt: "",
    });
    const complete = buildOfferCompareRow({
      id: "o2",
      productId: "leben",
      supplierId: "b",
      packageQuantity: 1,
      purchaseUnit: "kg",
      priceIncludingVat: 20,
      createdAt: "",
      updatedAt: "",
    });
    expect(incomplete.canRank).toBe(false);
    expect(complete.canRank).toBe(true);
    expect(cheapestComparableOffer([incomplete, complete])?.offerId).toBe("o2");
  });
});

describe("stock count, merge, recipes, costing", () => {
  it("treats empty count as skip and zero as a real count", () => {
    expect(stockCountAdjustment({ countedBase: null, snapshotBase: 10, movementsDuringBase: 2 })).toEqual({ skip: true });
    const zero = stockCountAdjustment({ countedBase: 0, snapshotBase: 10, movementsDuringBase: -2 });
    expect(zero.skip).toBe(false);
    if (!zero.skip) expect(zero.adjustment).toBe(-8);
  });

  it("merges balances without doubling and blocks incompatible units", () => {
    const ok = planIngredientMerge({
      survivor: leben,
      loser: { ...leben, id: "leben-old" },
      survivorBalance: 1000,
      loserBalance: 500,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.mergedBalance).toBe(1500);
      expect(ok.survivorDelta + ok.loserDelta).toBe(0);
    }
    const blocked = planIngredientMerge({
      survivor: leben,
      loser: { ...flour, id: "oil", baseUnit: "ml", purchaseUnit: "liter" },
      survivorBalance: 1,
      loserBalance: 1,
    });
    expect(blocked.ok).toBe(false);
  });

  it("expands sub-recipes, blocks cycles, and flags missing prices", () => {
    const sauce: DishRecipe = {
      id: "sauce",
      productId: "sauce-dish",
      yieldPortions: 2,
      ingredients: [{ ingredientId: "leben", quantity: 200, unit: "g" }],
      createdAt: "",
      updatedAt: "",
    };
    const plate: DishRecipe = {
      id: "plate",
      productId: "plate-dish",
      yieldPortions: 1,
      ingredients: [{ ingredientId: "", subRecipeId: "sauce", quantity: 1, unit: "unit" }],
      createdAt: "",
      updatedAt: "",
    };
    const materials = expandRecipeMaterials(plate, 2, [sauce, plate]);
    expect(materials[0]?.productId).toBe("leben");
    expect(materials[0]?.quantity).toBe(200);
    const cyclic: DishRecipe = {
      ...plate,
      ingredients: [{ ingredientId: "", subRecipeId: "plate", quantity: 1, unit: "unit" }],
    };
    expect(recipeHasCycle([cyclic], "plate")).toBe(true);
    const lookup = new Map<string, Pick<CostingIngredient, "costPerBaseUnit" | "active">>([
      ["leben", leben],
      ["flour", flour],
    ]);
    const missing = recipeIngredientCostReport([{ ingredientId: "flour", quantity: 100, unit: "g" }], lookup);
    expect(missing.total).toBeNull();
    expect(missing.missingIds).toContain("flour");
    expect(ingredientHasCost(flour)).toBe(false);
  });

  it("does not deduct the same order consumption twice", () => {
    const movements: InventoryMovement[] = [
      {
        id: "m1",
        productId: "leben",
        type: "SALE_OUT",
        quantity: 1,
        unit: "kg",
        quantityBase: 200,
        orderId: "ord-1",
        receivedAt: "",
        createdAt: "",
      },
    ];
    expect(consumptionAlreadyRecorded(movements, { productId: "leben", orderId: "ord-1" })).toBe(true);
    expect(consumptionAlreadyRecorded(movements, { productId: "leben", orderId: "ord-2" })).toBe(false);
  });

  it("searches unified and supplier product names", () => {
    const found = filterUnifiedIngredients({
      ingredients: [leben, flour],
      maps: [{ id: "m", supplierId: "a", supplierProductName: "לבנה אסלית", inventoryProductId: "leben", createdAt: "", updatedAt: "" }],
      query: "אסלית",
    });
    expect(found.map((item) => item.id)).toEqual(["leben"]);
  });
});
