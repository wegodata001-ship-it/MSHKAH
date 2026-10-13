import { describe, expect, it } from "vitest";
import { purchaseQuantityInBase } from "@/lib/costing/units";
import { recipeIssueDraft, stockInDisplayUnit, validateIssueLines } from "@/lib/inventory/issue";
import { currentStockBase, movementSignedBase, unitCostFromPackage } from "@/lib/inventory/stock";
import { matchInventoryProduct } from "@/lib/inventory/invoice-smart-match";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { InventoryMovement, SupplierItemMap } from "@/lib/inventory/types";

const bun: CostingIngredient = {
  id: "bun",
  name: "לחם בורגר",
  purchasePrice: 2,
  purchaseQuantity: 1,
  purchaseUnit: "unit",
  baseUnit: "unit",
  costPerBaseUnit: 2,
  minStock: 20,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const meat: CostingIngredient = {
  id: "meat",
  name: "בשר",
  purchasePrice: 50,
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.05,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const opening: InventoryMovement[] = [
  { id: "o1", productId: "bun", type: "PURCHASE_IN", quantity: 100, unit: "unit", quantityBase: 100, receivedAt: "2026-10-01", createdAt: "2026-10-01" },
  { id: "o2", productId: "meat", type: "PURCHASE_IN", quantity: 5, unit: "kg", quantityBase: 5000, receivedAt: "2026-10-01", createdAt: "2026-10-01" },
];

describe("two suppliers one ingredient", () => {
  it("maps different supplier names to the same ingredient card", () => {
    const maps: SupplierItemMap[] = [
      { id: "m1", supplierId: "A", supplierProductName: "לחמניית המבורגר", inventoryProductId: "bun", createdAt: "", updatedAt: "" },
      { id: "m2", supplierId: "B", supplierProductName: "לחמנייה עגולה גדולה", inventoryProductId: "bun", createdAt: "", updatedAt: "" },
    ];
    const first = matchInventoryProduct({ name: "לחמניית המבורגר" }, [bun], maps, "A");
    const second = matchInventoryProduct({ name: "לחמנייה עגולה גדולה" }, [bun], maps, "B");
    expect(first.item?.id).toBe("bun");
    expect(second.item?.id).toBe("bun");
    expect(first.kind).toBe("mapped");
    expect(second.kind).toBe("mapped");
  });

  it("compares pack prices on one base unit", () => {
    expect(unitCostFromPackage(30, 10, "unit")).toBeCloseTo(3);
    expect(unitCostFromPackage(50, 20, "unit")).toBeCloseTo(2.5);
  });
});

describe("issue inventory", () => {
  it("issues 12 from 100 and leaves 88", () => {
    const checked = validateIssueLines(
      [{ key: "1", productId: "bun", quantity: 12, unit: "unit" }],
      [bun],
      opening
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.lines[0]?.quantityBefore).toBe(100);
    expect(checked.lines[0]?.quantityAfter).toBe(88);
    const after: InventoryMovement[] = [
      ...opening,
      { id: "i1", productId: "bun", type: "ISSUE_OUT", quantity: 12, unit: "unit", quantityBase: 12, receivedAt: "2026-10-13", createdAt: "2026-10-13" },
    ];
    expect(currentStockBase(after, "bun")).toBe(88);
  });

  it("issues a recipe of 10 portions as 10 buns and 1.8kg meat", () => {
    const recipe: DishRecipe = {
      id: "burger",
      productId: "dish-1",
      ingredients: [
        { ingredientId: "bun", quantity: 1, unit: "unit" },
        { ingredientId: "meat", quantity: 180, unit: "g" },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const draft = recipeIssueDraft(recipe, 10, [bun, meat]);
    expect(draft[0]?.quantity).toBe(10);
    expect(draft[0]?.unit).toBe("unit");
    expect(draft[1]?.quantity).toBe(1.8);
    expect(draft[1]?.unit).toBe("kg");
    const checked = validateIssueLines(draft, [bun, meat], opening);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.lines[1]?.quantityBase).toBe(1800);
    expect(purchaseQuantityInBase(1.8, "kg")).toBe(1800);
  });

  it("rejects zero, overstock, and mismatched units", () => {
    expect(validateIssueLines([{ key: "1", productId: "bun", quantity: 0, unit: "unit" }], [bun], opening).ok).toBe(false);
    expect(validateIssueLines([{ key: "1", productId: "bun", quantity: 200, unit: "unit" }], [bun], opening).ok).toBe(false);
    expect(validateIssueLines([{ key: "1", productId: "bun", quantity: 1, unit: "kg" }], [bun], opening).ok).toBe(false);
  });

  it("restores stock with a reversing movement", () => {
    const issued: InventoryMovement = {
      id: "i1",
      productId: "bun",
      type: "ISSUE_OUT",
      quantity: 12,
      unit: "unit",
      quantityBase: 12,
      receivedAt: "2026-10-13",
      createdAt: "2026-10-13",
    };
    const reversal: InventoryMovement = {
      id: "r1",
      productId: "bun",
      type: "REVERSAL",
      quantity: 12,
      unit: "unit",
      quantityBase: -movementSignedBase(issued),
      reversesId: "i1",
      receivedAt: "2026-10-13",
      createdAt: "2026-10-13",
    };
    expect(currentStockBase([...opening, issued], "bun")).toBe(88);
    expect(currentStockBase([...opening, issued, reversal], "bun")).toBe(100);
  });

  it("shows stock in the purchase unit", () => {
    expect(stockInDisplayUnit(5000, meat)).toBe(5);
    expect(stockInDisplayUnit(100, bun)).toBe(100);
  });
});
