import { lineRecipeCost } from "@/lib/costing/units";
import { roundMoney } from "@/lib/costing/money";
import type {
  CostingIngredient,
  CustomCost,
  OverheadSettings,
  ProfitStatus,
  RecipeLine,
} from "@/lib/costing/types";

export function recipeIngredientCost(
  lines: RecipeLine[],
  ingredients: Map<string, Pick<CostingIngredient, "costPerBaseUnit" | "active">>
): number {
  let total = 0;
  for (const line of lines) {
    const ingredient = ingredients.get(line.ingredientId);
    if (!ingredient) continue;
    total += lineRecipeCost(line.quantity, line.unit, ingredient.costPerBaseUnit);
  }
  return total;
}

export function grossProfit(sellingPrice: number, ingredientCost: number): number | null {
  if (!Number.isFinite(sellingPrice) || !Number.isFinite(ingredientCost)) return null;
  if (sellingPrice < 0 || ingredientCost < 0) return null;
  return sellingPrice - ingredientCost;
}

export function foodCostPercent(ingredientCost: number, sellingPrice: number): number | null {
  if (!Number.isFinite(ingredientCost) || !Number.isFinite(sellingPrice)) return null;
  if (sellingPrice <= 0 || ingredientCost < 0) return null;
  return (ingredientCost / sellingPrice) * 100;
}

export function grossMarginPercent(sellingPrice: number, ingredientCost: number): number | null {
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return null;
  const profit = grossProfit(sellingPrice, ingredientCost);
  if (profit == null) return null;
  return (profit / sellingPrice) * 100;
}

export function recommendedSellingPrice(
  ingredientCost: number,
  targetFoodCostPercent: number
): number | null {
  if (!Number.isFinite(ingredientCost) || ingredientCost < 0) return null;
  if (!Number.isFinite(targetFoodCostPercent) || targetFoodCostPercent <= 0) return null;
  return ingredientCost / (targetFoodCostPercent / 100);
}

export function profitStatus(
  foodCost: number | null,
  targetFoodCostPercent: number
): ProfitStatus {
  if (foodCost == null || !Number.isFinite(foodCost) || !Number.isFinite(targetFoodCostPercent)) {
    return "none";
  }
  if (foodCost <= targetFoodCostPercent) return "good";
  if (foodCost <= targetFoodCostPercent + 5) return "watch";
  return "low";
}

export type ExtraCostLine = { name: string; amount: number };

export function estimatedFullCost(input: {
  ingredientCost: number;
  sellingPrice: number;
  overhead?: OverheadSettings;
}): { ingredientCost: number; extras: ExtraCostLine[]; total: number } {
  const ingredientCost = Number.isFinite(input.ingredientCost) ? Math.max(0, input.ingredientCost) : 0;
  const sellingPrice = Number.isFinite(input.sellingPrice) ? Math.max(0, input.sellingPrice) : 0;
  const overhead = input.overhead ?? {};
  const extras: ExtraCostLine[] = [];

  const addFixed = (name: string, value?: number) => {
    if (value == null || !Number.isFinite(value) || value <= 0) return;
    extras.push({ name, amount: value });
  };
  const addPercent = (name: string, percent?: number) => {
    if (percent == null || !Number.isFinite(percent) || percent <= 0 || sellingPrice <= 0) return;
    extras.push({ name, amount: sellingPrice * (percent / 100) });
  };

  addFixed("packaging", overhead.packaging);
  addFixed("labor", overhead.labor);
  addPercent("laborPercent", overhead.laborPercent);
  addPercent("creditCard", overhead.creditCardPercent);
  addPercent("platform", overhead.platformPercent);
  addPercent("overhead", overhead.overheadPercent);

  for (const custom of overhead.customCosts ?? []) {
    pushCustomCost(extras, custom, sellingPrice);
  }

  const extraTotal = extras.reduce((sum, line) => sum + line.amount, 0);
  return {
    ingredientCost,
    extras,
    total: ingredientCost + extraTotal,
  };
}

function pushCustomCost(extras: ExtraCostLine[], custom: CustomCost, sellingPrice: number) {
  if (!custom.name.trim() || !Number.isFinite(custom.value) || custom.value <= 0) return;
  if (custom.type === "percent") {
    if (sellingPrice <= 0) return;
    extras.push({ name: custom.name.trim(), amount: sellingPrice * (custom.value / 100) });
    return;
  }
  extras.push({ name: custom.name.trim(), amount: custom.value });
}

export function displayMoney(value: number): number {
  return roundMoney(value, 2);
}

export function displayPercent(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return roundMoney(value, 1);
}
