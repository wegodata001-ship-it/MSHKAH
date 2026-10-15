import { describe, expect, it } from "vitest";
import { computeBreakEven, productContribution } from "@/lib/breakeven/compute";
import {
  comboRecipeLines,
  resolveProductCost,
  sellingPriceIsNotCost,
  unitCostFromPack,
} from "@/lib/breakeven/product-cost";
import type { BreakEvenFixedCost, BreakEvenVariableCost, ProductCostLink } from "@/lib/breakeven/types";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { PosImport } from "@/lib/inventory/types";
import type { Order } from "@/types";

function ingredient(id: string, extras: Partial<CostingIngredient> = {}): CostingIngredient {
  return {
    id,
    name: extras.name ?? id,
    purchasePrice: extras.purchasePrice ?? 0,
    purchaseQuantity: extras.purchaseQuantity ?? 0,
    purchaseUnit: extras.purchaseUnit ?? "unit",
    baseUnit: extras.baseUnit ?? "unit",
    costPerBaseUnit: extras.costPerBaseUnit ?? 0,
    active: true,
    createdAt: "",
    updatedAt: "",
    ...extras,
  };
}

function recipe(productId: string, lines: DishRecipe["ingredients"], id = `r-${productId}`): DishRecipe {
  return { id, productId, ingredients: lines, createdAt: "", updatedAt: "" };
}

function order(productId: string, total: number): Order {
  return {
    id: `o-${productId}`,
    orderNumber: "1",
    customerId: "c",
    customerName: "c",
    status: "delivered",
    items: [{ productId, productName: productId, quantity: 1, price: total }],
    total,
    paymentStatus: "paid",
    createdAt: "2026-10-05T10:00:00.000Z",
    paidAt: "2026-10-05T10:00:00.000Z",
  };
}

function fixed(amount: number): BreakEvenFixedCost {
  return {
    id: "f1",
    name: "rent",
    amount,
    frequency: "monthly",
    vatMode: "exempt",
    active: true,
    createdAt: "",
    updatedAt: "",
  };
}

function variable(amount: number): BreakEvenVariableCost {
  return {
    id: "v1",
    name: "var",
    kind: "fixed",
    amount,
    vatMode: "exempt",
    active: true,
    createdAt: "",
    updatedAt: "",
  };
}

const flour = ingredient("flour", { name: "קמח", purchasePrice: 11.2, purchaseQuantity: 1, costPerBaseUnit: 11.2 });
const croissantRecipe = recipe("croissant", [{ ingredientId: "flour", quantity: 1, unit: "unit" }]);

describe("existing links used before asking again", () => {
  it("uses a recipe that already exists", () => {
    const row = resolveProductCost({
      productId: "croissant",
      name: "קרואסון",
      sellingPrice: 39,
      recipes: [croissantRecipe],
      ingredients: [flour],
    });
    expect(row.costMissing).toBe(false);
    expect(row.foodCost).toBeCloseTo(11.2, 8);
    expect(row.costKind).toBe("recipe");
  });

  it("auto-links a purchased packed product by the same name", () => {
    const cola = ingredient("ing-cola", {
      name: "קולה",
      purchasePrice: 30,
      purchaseQuantity: 6,
      costPerBaseUnit: 5,
    });
    const row = resolveProductCost({
      productId: "menu-cola",
      name: "קולה",
      sellingPrice: 12,
      recipes: [],
      ingredients: [cola],
    });
    expect(row.costMissing).toBe(false);
    expect(row.costKind).toBe("resale");
    expect(row.foodCost).toBe(5);
    expect(row.unusedExisting.some((item) => item.id === "ing-cola")).toBe(true);
  });

  it("does not guess pack contents when quantity is missing", () => {
    const cola = ingredient("ing-cola", { name: "קולה", purchasePrice: 30, purchaseQuantity: 0, costPerBaseUnit: 0 });
    const row = resolveProductCost({
      productId: "menu-cola",
      name: "קולה",
      sellingPrice: 12,
      recipes: [],
      ingredients: [cola],
    });
    expect(row.costMissing).toBe(true);
    expect(row.foodCost).toBeNull();
    expect(row.costGaps.some((gap) => gap.code === "missing-pack-qty")).toBe(true);
    expect(row.unusedExisting.some((item) => item.id === "ing-cola")).toBe(true);
  });
});

describe("partial recipe is not a full cost", () => {
  it("keeps cost missing when one ingredient has no purchase price", () => {
    const butter = ingredient("butter", { name: "חמאה", purchasePrice: 0, purchaseQuantity: 1, costPerBaseUnit: 0 });
    const row = resolveProductCost({
      productId: "croissant",
      name: "קרואסון",
      sellingPrice: 39,
      recipes: [recipe("croissant", [
        { ingredientId: "flour", quantity: 1, unit: "unit" },
        { ingredientId: "butter", quantity: 1, unit: "unit" },
      ])],
      ingredients: [flour, butter],
    });
    expect(row.costMissing).toBe(true);
    expect(row.foodCost).toBeNull();
    expect(row.costGaps.some((gap) => gap.code === "missing-purchase-price" && gap.ingredientId === "butter")).toBe(true);
  });
});

describe("combo", () => {
  it("adds component recipes and refuses a missing component", () => {
    const coffee = recipe("coffee", [{ ingredientId: "flour", quantity: 1, unit: "unit" }], "r-coffee");
    const pastry = recipe("pastry", [{ ingredientId: "flour", quantity: 1, unit: "unit" }], "r-pastry");
    const built = comboRecipeLines(
      [
        { productId: "coffee", quantity: 1 },
        { productId: "pastry", quantity: 1 },
      ],
      [coffee, pastry],
      [flour]
    );
    expect(built.gaps).toEqual([]);
    expect(built.lines).toHaveLength(2);

    const combo = recipe("combo", built.lines, "r-combo");
    const row = resolveProductCost({
      productId: "combo",
      name: "קפה ומאפה",
      sellingPrice: 28,
      recipes: [coffee, pastry, combo],
      ingredients: [flour],
    });
    expect(row.costMissing).toBe(false);
    expect(row.foodCost).toBeCloseTo(22.4, 8);

    const missing = comboRecipeLines([{ productId: "unknown", quantity: 1 }], [coffee], [flour]);
    expect(missing.gaps[0]?.code).toBe("no-link");
  });
});

describe("manual estimate and POS source", () => {
  it("uses a marked estimate and keeps POS excel cost separate", () => {
    const link: ProductCostLink = {
      id: "soup",
      productId: "soup",
      kind: "estimate",
      estimateAmount: 8,
      estimateNote: "ספק טלפוני",
      estimateAt: "2026-10-15",
      updatedAt: "2026-10-15",
    };
    const pos: PosImport = {
      id: "ex",
      kind: "excel-info",
      fileName: "pos.xlsx",
      fileHash: "x",
      source: "pos-file",
      period: "2026-10",
      status: "approved",
      lines: [{ key: "1", posCode: "s", posName: "מרק", quantity: 1, menuProductId: "soup", matchKind: "exact", posCost: 3, posProfit: 20 }],
      createdAt: "",
    };
    const row = resolveProductCost({
      productId: "soup",
      name: "מרק",
      sellingPrice: 42,
      recipes: [],
      ingredients: [],
      context: { links: [link], posImports: [pos] },
    });
    expect(row.foodCost).toBe(8);
    expect(row.costBasis).toBe("estimate");
    expect(row.posCost).toBe(3);
    expect(sellingPriceIsNotCost(42, row.foodCost)).toBe(true);
  });

  it("never fills a missing cost with the selling price", () => {
    const row = productContribution("soup", "מרק", 42, [], []);
    expect(row.costMissing).toBe(true);
    expect(row.foodCost).toBeNull();
    expect(row.foodCost).not.toBe(42);
  });
});

describe("pack math", () => {
  it("requires both pack price and pack quantity", () => {
    expect(unitCostFromPack(30, 6)).toBe(5);
    expect(unitCostFromPack(30, 0)).toBeNull();
  });
});

describe("mix with missing costs is partial, not zero", () => {
  it("marks break-even partial when a mix product has no cost", () => {
    const result = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "including", vatRate: 0.18, alertGap: 500 },
      fixed: [fixed(30000)],
      variable: [variable(10000)],
      orders: [order("croissant", 39), order("soup", 42)],
      recipes: [croissantRecipe],
      ingredients: [flour],
      products: [
        { id: "croissant", name: "קרואסון", price: 39 },
        { id: "soup", name: "מרק", price: 42 },
      ],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(result.mixCostIncomplete).toBe(true);
    expect(result.mixAssumptions).toContain("partialMixCosts");
    const soup = productContribution("soup", "מרק", 42, [croissantRecipe], [flour]);
    expect(soup.costMissing).toBe(true);
    expect(soup.foodCost).toBeNull();
  });
});
