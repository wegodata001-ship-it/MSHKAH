import { describe, expect, it } from "vitest";
import type { DishCostRow } from "@/lib/costing/model";
import type { CostingSettings, DishRecipe } from "@/lib/costing/types";
import type { Product } from "@/types";
import {
  diagnoseRow,
  dishDiagnosticsCount,
  dishPricingSummary,
  resolveDishCostState,
  toNet,
  toPricingRow,
  validateSalePriceChange,
} from "@/lib/costing/dish-pricing";

const SETTINGS: CostingSettings = {
  targetFoodCostPercent: 30,
  priceRoundMode: "none",
  vatRate: 0.18,
  foodCostVatMode: "before",
  costBasis: "latest",
};

const BASE_PRODUCT: Product = {
  id: "p1",
  name_he: "קפה הפוך",
  name_ar: "",
  name_en: "Latte",
  description_he: "",
  description_ar: "",
  description_en: "",
  categoryId: "hot-drinks",
  price: 12,
  cost: 0,
  profit: 0,
  businessType: "food" as const,
  image: "https://example.com/latte.jpg",
  includesVat: true,
  isPopular: false,
  isNew: false,
  available: true,
  active: true,
  sortOrder: 0,
  hidden: false,
};

function makeDishRow(overrides: Partial<DishCostRow>): DishCostRow {
  const base: DishCostRow = {
    product: BASE_PRODUCT,
    recipe: undefined,
    ingredientCost: 0,
    sellingPrice: BASE_PRODUCT.price,
    foodCost: null,
    grossProfit: null,
    grossMargin: null,
    recommended: null,
    status: "none",
    lineCount: 0,
  };
  return { ...base, ...overrides };
}

describe("resolveDishCostState", () => {
  it("prefers a recipe cost when a non-zero ingredient cost is present", () => {
    expect(
      resolveDishCostState({
        product: { ...BASE_PRODUCT, cost: 5, costVerified: true },
        hasRecipe: true,
        recipeIngredientCost: 3.4,
      })
    ).toBe("computed_recipe");
  });

  it("falls back to the manual cost only when the owner approved it", () => {
    expect(
      resolveDishCostState({
        product: { ...BASE_PRODUCT, cost: 5, costVerified: true },
        hasRecipe: false,
        recipeIngredientCost: 0,
      })
    ).toBe("verified_manual");
  });

  it("marks an unverified non-zero cost as imported_unverified, not authoritative", () => {
    expect(
      resolveDishCostState({
        product: { ...BASE_PRODUCT, cost: 12, costVerified: false },
        hasRecipe: false,
        recipeIngredientCost: 0,
      })
    ).toBe("imported_unverified");
  });

  it("returns 'missing' when nothing is known", () => {
    expect(
      resolveDishCostState({
        product: BASE_PRODUCT,
        hasRecipe: false,
        recipeIngredientCost: 0,
      })
    ).toBe("missing");
  });

  it("recipe with no cost (ingredients without prices) is NOT 'computed_recipe'", () => {
    // Prevents us from presenting an unresolved recipe as truth. The caller
    // should still fall through to any manual cost or 'missing'.
    expect(
      resolveDishCostState({
        product: { ...BASE_PRODUCT, cost: 0 },
        hasRecipe: true,
        recipeIngredientCost: 0,
      })
    ).toBe("missing");
  });
});

describe("toNet (VAT handling)", () => {
  it("strips VAT when price includes VAT and reporting mode is 'before'", () => {
    expect(toNet(118, BASE_PRODUCT, SETTINGS)).toBeCloseTo(100, 2);
  });

  it("returns the raw amount when reporting mode is 'including'", () => {
    const settings: CostingSettings = { ...SETTINGS, foodCostVatMode: "including" };
    expect(toNet(118, BASE_PRODUCT, settings)).toBe(118);
  });

  it("respects product.includesVat=false (price is already net)", () => {
    const product: Product = { ...BASE_PRODUCT, includesVat: false };
    expect(toNet(100, product, SETTINGS)).toBe(100);
  });
});

describe("toPricingRow", () => {
  it("computes net profit for a recipe-costed dish", () => {
    const row = toPricingRow(
      makeDishRow({
        recipe: { id: "r1", productId: BASE_PRODUCT.id, ingredients: [], createdAt: "", updatedAt: "" } as DishRecipe,
        ingredientCost: 3,
      }),
      SETTINGS
    );
    expect(row.costState).toBe("computed_recipe");
    expect(row.priceNet).toBeCloseTo(12 / 1.18, 2);
    expect(row.effectiveCostNet).toBe(3);
    expect(row.grossProfit).toBeCloseTo(12 / 1.18 - 3, 2);
    expect(row.foodCostPercent).toBeCloseTo((3 / (12 / 1.18)) * 100, 1);
  });

  it("hides cost + profit for an unverified imported cost", () => {
    const row = toPricingRow(
      makeDishRow({
        product: { ...BASE_PRODUCT, cost: 12, costVerified: false },
        recipe: undefined,
        ingredientCost: 0,
      }),
      SETTINGS
    );
    expect(row.costState).toBe("imported_unverified");
    expect(row.effectiveCostNet).toBeNull();
    expect(row.grossProfit).toBeNull();
    expect(row.foodCostPercent).toBeNull();
    expect(row.foodCostStatus).toBe("unknown");
  });

  it("returns 'loss' status when food cost >= 100%", () => {
    const row = toPricingRow(
      makeDishRow({
        product: { ...BASE_PRODUCT, price: 10, cost: 15, costVerified: true, includesVat: false },
        ingredientCost: 0,
      }),
      SETTINGS
    );
    expect(row.foodCostStatus).toBe("loss");
    expect(row.grossProfit).toBeLessThan(0);
  });
});

describe("dishPricingSummary", () => {
  it("buckets rows correctly and never counts missing cost as zero profit", () => {
    const rows = [
      toPricingRow(
        makeDishRow({
          product: { ...BASE_PRODUCT, id: "a", price: 10 },
          recipe: { id: "ra", productId: "a", ingredients: [], createdAt: "", updatedAt: "" } as DishRecipe,
          ingredientCost: 2,
        }),
        SETTINGS
      ),
      toPricingRow(
        makeDishRow({
          product: { ...BASE_PRODUCT, id: "b", price: 10, cost: 10, costVerified: false },
        }),
        SETTINGS
      ),
      toPricingRow(
        makeDishRow({
          product: { ...BASE_PRODUCT, id: "c", price: 0, cost: 0 },
        }),
        SETTINGS
      ),
      toPricingRow(
        makeDishRow({
          product: { ...BASE_PRODUCT, id: "d", price: 10, cost: 15, costVerified: true, includesVat: false },
        }),
        SETTINGS
      ),
    ];
    const summary = dishPricingSummary(rows);
    expect(summary.total).toBe(4);
    expect(summary.withPositiveProfit).toBe(1);
    expect(summary.importedUnverified).toBe(1);
    expect(summary.missingCost).toBe(1);
    expect(summary.withLoss).toBe(1);
    // The unverified row is NOT counted as zero-profit even though cost = price.
    expect(summary.withZeroProfit).toBe(0);
  });

  it("ignores rows with price=0 for the average-price calculation", () => {
    const rows = [
      toPricingRow(
        makeDishRow({ product: { ...BASE_PRODUCT, id: "a", price: 10 } }),
        SETTINGS
      ),
      toPricingRow(
        makeDishRow({ product: { ...BASE_PRODUCT, id: "b", price: 0 } }),
        SETTINGS
      ),
    ];
    const summary = dishPricingSummary(rows);
    expect(summary.averagePriceIls).toBe(10);
    expect(summary.priced).toBe(1);
  });
});

describe("diagnoseRow + dishDiagnosticsCount", () => {
  it("flags hidden products with text, not colour alone", () => {
    const row = toPricingRow(
      makeDishRow({ product: { ...BASE_PRODUCT, hidden: true } }),
      SETTINGS
    );
    expect(diagnoseRow(row)).toContain("hidden");
  });

  it("flags missing images and categories separately", () => {
    const row = toPricingRow(
      makeDishRow({
        product: { ...BASE_PRODUCT, image: "", categoryId: "" },
      }),
      SETTINGS
    );
    const flags = diagnoseRow(row);
    expect(flags).toContain("no_image");
    expect(flags).toContain("no_category");
  });

  it("rolls up totals across many rows", () => {
    const rows = [
      toPricingRow(makeDishRow({ product: { ...BASE_PRODUCT, id: "a", image: "" } }), SETTINGS),
      toPricingRow(makeDishRow({ product: { ...BASE_PRODUCT, id: "b", hidden: true } }), SETTINGS),
      toPricingRow(
        makeDishRow({ product: { ...BASE_PRODUCT, id: "c", cost: 5, costVerified: false } }),
        SETTINGS
      ),
    ];
    const counts = dishDiagnosticsCount(rows);
    expect(counts.no_image).toBe(1);
    expect(counts.hidden).toBe(1);
    expect(counts.imported_unverified).toBe(1);
  });
});

describe("validateSalePriceChange", () => {
  it("rejects non-finite numbers", () => {
    expect(
      validateSalePriceChange({ nextPrice: Number.NaN, product: BASE_PRODUCT }).ok
    ).toBe(false);
  });

  it("rejects negative prices", () => {
    expect(
      validateSalePriceChange({ nextPrice: -1, product: BASE_PRODUCT }).ok
    ).toBe(false);
  });

  it("rejects implausibly huge prices", () => {
    expect(
      validateSalePriceChange({ nextPrice: 1_000_000, product: BASE_PRODUCT }).ok
    ).toBe(false);
  });

  it("accepts a plain positive price and rounds to 2dp", () => {
    const result = validateSalePriceChange({ nextPrice: 12.345, product: BASE_PRODUCT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nextPrice).toBe(12.35);
  });
});
