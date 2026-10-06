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
import { roundRecommendedPrice } from "@/lib/costing/money";
import type {
  CostingIngredient,
  CostingSettings,
  DishRecipe,
  ProfitStatus,
} from "@/lib/costing/types";
import type { Category, Product } from "@/types";
import type { ModifierOption } from "@/types/modifiers";

export type DishCostRow = {
  product: Product;
  recipe?: DishRecipe;
  ingredientCost: number;
  sellingPrice: number;
  foodCost: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  recommended: number | null;
  status: ProfitStatus;
  lineCount: number;
};

export function ingredientLookup(items: CostingIngredient[]): Map<string, CostingIngredient> {
  return new Map(items.map((item) => [item.id, item]));
}

export function recipeForProduct(
  recipes: DishRecipe[],
  productId: string,
  variantId?: string
): DishRecipe | undefined {
  if (variantId) {
    return (
      recipes.find((recipe) => recipe.productId === productId && recipe.variantId === variantId) ??
      recipes.find((recipe) => recipe.productId === productId && !recipe.variantId)
    );
  }
  return recipes.find((recipe) => recipe.productId === productId && !recipe.variantId)
    ?? recipes.find((recipe) => recipe.productId === productId);
}

export function buildDishRow(
  product: Product,
  recipes: DishRecipe[],
  ingredients: Map<string, CostingIngredient>,
  settings: CostingSettings,
  variantId?: string
): DishCostRow {
  const recipe = recipeForProduct(recipes, product.id, variantId);
  const ingredientCost = recipe ? recipeIngredientCost(recipe.ingredients, ingredients) : 0;
  const sellingPrice = product.price;
  const target = recipe?.targetFoodCostPercent ?? settings.targetFoodCostPercent;
  const foodCost = recipe ? foodCostPercent(ingredientCost, sellingPrice) : null;
  const recommendedRaw = recipe && ingredientCost > 0
    ? recommendedSellingPrice(ingredientCost, target)
    : null;
  return {
    product,
    recipe,
    ingredientCost,
    sellingPrice,
    foodCost,
    grossProfit: recipe ? grossProfit(sellingPrice, ingredientCost) : null,
    grossMargin: recipe ? grossMarginPercent(sellingPrice, ingredientCost) : null,
    recommended:
      recommendedRaw == null ? null : roundRecommendedPrice(recommendedRaw, settings.priceRoundMode),
    status: recipe ? profitStatus(foodCost, target) : "none",
    lineCount: recipe?.ingredients.length ?? 0,
  };
}

export function buildDishRows(
  products: Product[],
  recipes: DishRecipe[],
  ingredients: CostingIngredient[],
  settings: CostingSettings
): DishCostRow[] {
  const lookup = ingredientLookup(ingredients);
  return products.map((product) => buildDishRow(product, recipes, lookup, settings));
}

export function categoryName(categories: Category[], categoryId: string, locale: "he" | "ar" | "en"): string {
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return "";
  if (locale === "ar") return category.name_ar || category.name_he;
  if (locale === "en") return category.name_en || category.name_he;
  return category.name_he || category.name_en;
}

export function dashboardStats(rows: DishCostRow[]) {
  const priced = rows.filter((row) => row.recipe);
  const foodCosts = priced
    .map((row) => row.foodCost)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const over = priced.filter((row) => row.status === "watch" || row.status === "low");
  const missing = rows.filter((row) => !row.recipe);
  const avg = foodCosts.length
    ? foodCosts.reduce((sum, value) => sum + value, 0) / foodCosts.length
    : null;
  return {
    priced: priced.length,
    averageFoodCost: avg == null ? null : displayPercent(avg),
    overTarget: over.length,
    missing: missing.length,
  };
}

export function attentionRows(rows: DishCostRow[]): DishCostRow[] {
  return rows
    .filter((row) => row.status === "low" || row.status === "watch" || row.status === "none")
    .sort((a, b) => {
      const rank = { low: 0, watch: 1, none: 2, good: 3 };
      return rank[a.status] - rank[b.status];
    })
    .slice(0, 8);
}

export function fullCostForRow(row: DishCostRow) {
  return estimatedFullCost({
    ingredientCost: row.ingredientCost,
    sellingPrice: row.sellingPrice,
    overhead: row.recipe?.overheadSettings,
  });
}

export function extraRows(options: ModifierOption[]) {
  return options
    .filter((option) => option.active && !option.archived && option.priceDelta !== 0)
    .map((option) => ({
      option,
      price: option.priceDelta,
      cost: option.cost || 0,
      profit: option.priceDelta - (option.cost || 0),
    }));
}

export { displayMoney, displayPercent };
