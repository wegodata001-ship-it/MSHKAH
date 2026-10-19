import { describe, expect, it } from "vitest";
import { componentRecipeLines, parseUnitCost, previewCostParts } from "@/lib/breakeven/product-cost";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";

function ingredient(patch: Partial<CostingIngredient> & Pick<CostingIngredient, "id" | "name" | "costPerBaseUnit">): CostingIngredient {
  return {
    purchasePrice: patch.costPerBaseUnit,
    purchaseQuantity: 1,
    purchaseUnit: "unit",
    baseUnit: "unit",
    active: true,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...patch,
  };
}

function recipe(id: string, productId: string, ingredientId: string, quantity = 1): DishRecipe {
  return {
    id,
    productId,
    ingredients: [{ ingredientId, quantity, unit: "unit" }],
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
  };
}

const beans = ingredient({ id: "beans", name: "פולי קפה", costPerBaseUnit: 2 });
const flour = ingredient({ id: "flour", name: "קמח", costPerBaseUnit: 0 });
const dough = ingredient({ id: "dough", name: "בצק", costPerBaseUnit: 4 });

describe("cost completion preview", () => {
  it("does not treat an empty cost or quantity as zero", () => {
    expect(parseUnitCost("")).toBeNull();
    expect(parseUnitCost("0")).toBeNull();
    expect(parseUnitCost("3.5")).toBe(3.5);
    const preview = previewCostParts(
      [{ source: "ingredient", refId: "beans", quantity: "", unit: "unit" }],
      [beans],
      [],
      []
    );
    expect(preview.total).toBeNull();
    expect(preview.rows[0]?.cost).toBeNull();
    expect(preview.rows[0]?.problem).toBe("qty");
  });

  it("names the component that has no cost and hides the total", () => {
    const preview = previewCostParts(
      [
        { source: "ingredient", refId: "beans", quantity: "2", unit: "unit" },
        { source: "ingredient", refId: "flour", quantity: "1", unit: "unit" },
      ],
      [beans, flour],
      [],
      []
    );
    expect(preview.total).toBeNull();
    expect(preview.rows.find((row) => row.name === "קמח")?.problem).toBe("cost");
    expect(preview.rows.find((row) => row.name === "פולי קפה")?.cost).toBe(4);
  });

  it("names a purchased product that has no cost and hides the total", () => {
    const preview = previewCostParts(
      [
        { source: "recipe", refId: "recipe-coffee", quantity: "1", unit: "unit" },
        { source: "product", refId: "cake", quantity: "1", unit: "unit" },
      ],
      [beans],
      [recipe("recipe-coffee", "coffee", "beans", 1)],
      [
        { id: "coffee", name: "קפה" },
        { id: "cake", name: "עוגה" },
      ]
    );
    expect(preview.total).toBeNull();
    expect(preview.rows.find((row) => row.problem === "cost")?.name).toBe("עוגה");
  });

  it("builds coffee and a purchased pastry without a pack price", () => {
    const bought = ingredient({ id: "pastry-buy", name: "מאפה קנוי", costPerBaseUnit: 5 });
    const preview = previewCostParts(
      [
        { source: "recipe", refId: "recipe-coffee", quantity: "1", unit: "unit" },
        { source: "product", refId: "pastry-buy", quantity: "1", unit: "unit" },
      ],
      [beans, bought],
      [recipe("recipe-coffee", "coffee", "beans", 1)],
      [
        { id: "coffee", name: "קפה" },
        { id: "pastry-buy", name: "מאפה קנוי" },
      ]
    );
    expect(preview.total).toBe(7);
    const lines = componentRecipeLines(
      [
        { source: "recipe", refId: "recipe-coffee", quantity: "1", unit: "unit" },
        { source: "product", refId: "pastry-buy", quantity: "1", unit: "unit" },
      ],
      {
        recipes: [recipe("recipe-coffee", "coffee", "beans", 1)],
        ingredients: [beans, bought],
        products: [
          { id: "coffee", name: "קפה" },
          { id: "pastry-buy", name: "מאפה קנוי" },
        ],
      }
    );
    expect(lines.map((line) => line.subRecipeId || line.ingredientId)).toEqual(["recipe-coffee", "pastry-buy"]);
    expect(lines.every((line) => !("packPrice" in line))).toBe(true);
  });

  it("sums a coffee and a pastry from two existing recipes", () => {
    const preview = previewCostParts(
      [
        { source: "recipe", refId: "recipe-coffee", quantity: "1", unit: "unit" },
        { source: "recipe", refId: "recipe-pastry", quantity: "1", unit: "unit" },
      ],
      [beans, dough],
      [recipe("recipe-coffee", "coffee", "beans", 1), recipe("recipe-pastry", "pastry", "dough", 1)],
      [
        { id: "coffee", name: "קפה" },
        { id: "pastry", name: "מאפה" },
      ]
    );
    expect(preview.total).toBe(6);
    expect(preview.rows.map((row) => row.name)).toEqual(["קפה", "מאפה"]);
    const lines = componentRecipeLines([
      { source: "recipe", refId: "recipe-coffee", quantity: "1", unit: "unit" },
      { source: "recipe", refId: "recipe-pastry", quantity: "1", unit: "unit" },
    ]);
    expect(lines.every((line) => line.subRecipeId && !("packPrice" in line))).toBe(true);
  });
});
