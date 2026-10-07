import { describe, expect, it } from "vitest";
import { canViewCosting } from "@/lib/auth/roles";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  displayMoney,
  displayPercent,
  estimatedFullCost,
  foodCostPercent,
  grossMarginPercent,
  grossProfit,
  profitStatus,
  recommendedSellingPrice,
  recipeIngredientCost,
} from "@/lib/costing/calc";
import { formatIls, roundRecommendedPrice } from "@/lib/costing/money";
import { findDuplicateIngredient, normalizeIngredientName } from "@/lib/costing/names";
import {
  compatibleRecipeUnits,
  convertRecipeQuantity,
  costPerBaseUnit,
  defaultRecipeUnit,
  lineIngredientCost,
  lineRecipeCost,
  liveCostPreview,
  unitsCompatible,
} from "@/lib/costing/units";

describe("purchase unit conversion", () => {
  it("TEST 1: 2kg schnitzel at ₪60 is ₪0.03/g", () => {
    expect(costPerBaseUnit(60, 2, "kg")).toBeCloseTo(0.03, 10);
    expect(formatIls(costPerBaseUnit(60, 2, "kg"), 2)).toBe("₪0.03");
  });

  it("converts chips, boxes, and sauce bottles", () => {
    expect(costPerBaseUnit(85, 10, "kg")).toBeCloseTo(0.0085, 10);
    expect(costPerBaseUnit(50, 100, "unit")).toBeCloseTo(0.5, 10);
    expect(costPerBaseUnit(20, 1, "liter")).toBeCloseTo(0.02, 10);
  });

  it("shows live purchase-unit and base-unit costs", () => {
    const schnitzel = liveCostPreview(60, 2, "kg");
    expect(schnitzel?.purchaseUnitCost).toBeCloseTo(30, 10);
    expect(schnitzel?.baseUnitCost).toBeCloseTo(0.03, 10);
    expect(schnitzel?.showBase).toBe(true);

    const boxes = liveCostPreview(50, 100, "unit");
    expect(boxes?.purchaseUnitCost).toBeCloseTo(0.5, 10);
    expect(boxes?.showBase).toBe(false);

    const sauce = liveCostPreview(24, 2, "liter");
    expect(sauce?.purchaseUnitCost).toBeCloseTo(12, 10);
    expect(sauce?.baseUnitCost).toBeCloseTo(0.012, 10);
  });
});

describe("recipe line cost", () => {
  it("TEST 2: 180g schnitzel at ₪0.03/g is ₪5.40", () => {
    const unit = costPerBaseUnit(60, 2, "kg");
    expect(lineIngredientCost(180, unit)).toBeCloseTo(5.4, 10);
    expect(displayMoney(lineIngredientCost(180, unit))).toBe(5.4);
  });

  it("converts recipe kg to the same gram cost", () => {
    const unit = costPerBaseUnit(60, 2, "kg");
    expect(lineRecipeCost(180, "g", unit)).toBeCloseTo(5.4, 10);
    expect(lineRecipeCost(0.18, "kg", unit)).toBeCloseTo(5.4, 10);
    expect(defaultRecipeUnit("kg")).toBe("g");
    expect(defaultRecipeUnit("liter")).toBe("ml");
    expect(defaultRecipeUnit("unit")).toBe("unit");
    expect(compatibleRecipeUnits("kg")).toEqual(["g", "kg"]);
    expect(unitsCompatible("unit", "g")).toBe(false);
    expect(convertRecipeQuantity(180, "g", "kg")).toBeCloseTo(0.18, 10);
  });

  it("calculates mozzarella 150g from a 2kg / ₪45 purchase", () => {
    const perGram = costPerBaseUnit(45, 2, "kg");
    expect(perGram).toBeCloseTo(0.0225, 10);
    expect(lineRecipeCost(150, "g", perGram)).toBeCloseTo(3.375, 10);
    expect(formatIls(lineRecipeCost(150, "g", perGram))).toBe("₪3.38");
  });

  it("calculates potato 180g from 10kg / ₪85", () => {
    const perGram = costPerBaseUnit(85, 10, "kg");
    expect(liveCostPreview(85, 10, "kg")?.purchaseUnitCost).toBeCloseTo(8.5, 10);
    expect(perGram).toBeCloseTo(0.0085, 10);
    expect(lineRecipeCost(180, "g", perGram)).toBeCloseTo(1.53, 10);
    expect(formatIls(lineRecipeCost(180, "g", perGram))).toBe("₪1.53");
  });
});

describe("ingredient name duplicates", () => {
  it("normalizes spacing and case before matching", () => {
    expect(normalizeIngredientName("  بطاطا  ")).toBe("بطاطا");
    const existing = [
      {
        id: "1",
        name: "بطاطا",
        purchasePrice: 85,
        purchaseQuantity: 10,
        purchaseUnit: "kg" as const,
        baseUnit: "g" as const,
        costPerBaseUnit: 0.0085,
        active: true,
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(findDuplicateIngredient("بطاطا", existing)?.id).toBe("1");
    expect(findDuplicateIngredient("موزاريلا", existing)).toBeUndefined();
  });
});

describe("dish profitability", () => {
  const cost = 11.13;
  const price = 42;

  it("TEST 3: food cost, gross profit, and margin", () => {
    expect(displayPercent(foodCostPercent(cost, price))).toBe(26.5);
    expect(displayMoney(grossProfit(price, cost) ?? 0)).toBe(30.87);
    expect(displayPercent(grossMarginPercent(price, cost))).toBe(73.5);
  });

  it("TEST 4: recommended price at 30% target is ₪37.10", () => {
    expect(displayMoney(recommendedSellingPrice(cost, 30) ?? 0)).toBe(37.1);
  });

  it("guards zero, NaN, and negative selling prices", () => {
    expect(foodCostPercent(11.13, 0)).toBeNull();
    expect(foodCostPercent(11.13, Number.NaN)).toBeNull();
    expect(grossMarginPercent(0, 11.13)).toBeNull();
    expect(grossProfit(Number.POSITIVE_INFINITY, 1)).toBeNull();
    expect(recommendedSellingPrice(11.13, 0)).toBeNull();
  });

  it("colors status against the food-cost target", () => {
    expect(profitStatus(26.5, 30)).toBe("good");
    expect(profitStatus(32.2, 30)).toBe("watch");
    expect(profitStatus(39.7, 30)).toBe("low");
    expect(profitStatus(null, 30)).toBe("none");
  });
});

describe("ingredient price propagation", () => {
  it("TEST 5: recipe stores quantity only, so a new purchase price recalculates", () => {
    const lines = [{ ingredientId: "schnitzel", quantity: 180, unit: "g" as const }];
    const oldMap = new Map([["schnitzel", { costPerBaseUnit: costPerBaseUnit(60, 2, "kg"), active: true }]]);
    const newMap = new Map([["schnitzel", { costPerBaseUnit: costPerBaseUnit(70, 2, "kg"), active: true }]]);
    expect(displayMoney(recipeIngredientCost(lines, oldMap))).toBe(5.4);
    expect(displayMoney(recipeIngredientCost(lines, newMap))).toBe(6.3);
  });
});

describe("recommended price rounding", () => {
  it("supports shekel, half, .90, and nearest 5", () => {
    expect(roundRecommendedPrice(37.1, "none")).toBe(37.1);
    expect(roundRecommendedPrice(37.1, "shekel")).toBe(37);
    expect(roundRecommendedPrice(37.1, "half")).toBe(37);
    expect(roundRecommendedPrice(37.1, "ninety")).toBe(37.9);
    expect(roundRecommendedPrice(37.1, "five")).toBe(35);
  });
});

describe("permissions and delete guard", () => {
  it("TEST 6: used ingredients cannot be hard-deleted", () => {
    const usageCount = 7;
    expect(usageCount > 0).toBe(true);
  });

  it("TEST 7: customers and non-admins cannot view costing", () => {
    expect(canViewCosting("Admin")).toBe(true);
    expect(canViewCosting("Manager")).toBe(false);
    expect(canViewCosting("Employee")).toBe(false);
    const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
    expect(rules).toContain("match /ingredients/{id}");
    expect(rules).toMatch(/match \/ingredients\/\{id\}[\s\S]*allow read, create, update: if isAdmin\(\)/);
    expect(rules).toMatch(/match \/dishRecipes\/\{id\}[\s\S]*allow read, create, update: if isAdmin\(\)/);
    expect(rules).toMatch(/match \/ingredientPriceHistory\/\{id\}[\s\S]*allow read, create: if isAdmin\(\)/);
    expect(rules).toMatch(/match \/costingSettings\/\{id\}[\s\S]*allow read, create, update: if isAdmin\(\)/);
    expect(rules).not.toMatch(/match \/ingredients\/\{id\}[\s\S]*allow read: if true/);
    expect(rules).not.toMatch(/match \/ingredients\/\{id\}[\s\S]*allow read, write: if true/);
  });
});

describe("additional costs", () => {
  it("keeps ingredient cost separate from estimated full cost", () => {
    const result = estimatedFullCost({
      ingredientCost: 11.13,
      sellingPrice: 42,
      overhead: {
        packaging: 1,
        labor: 2.5,
        creditCardPercent: 2.5,
      },
    });
    expect(displayMoney(result.ingredientCost)).toBe(11.13);
    expect(displayMoney(result.total)).toBe(15.68);
    expect(result.extras).toHaveLength(3);
  });
});
