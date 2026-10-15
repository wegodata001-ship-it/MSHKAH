import { estimatedFullCost } from "@/lib/costing/calc";
import { catalogNames, matchIngredient } from "@/lib/costing/import/match";
import { recipeForProduct } from "@/lib/costing/model";
import { normalizeIngredientName } from "@/lib/costing/names";
import {
  asPurchaseUnit,
  lineRecipeCost,
  PURCHASE_UNITS,
  unitsCompatible,
} from "@/lib/costing/units";
import { ingredientHasCost } from "@/lib/inventory/ingredient-core";
import type { CostingIngredient, DishRecipe, PurchaseUnit, RecipeLine } from "@/lib/costing/types";
import type { PosImport } from "@/lib/inventory/types";
import type { Product } from "@/types";
import type {
  ProductContribution,
  ProductCostBasis,
  ProductCostGap,
  ProductCostKind,
  ProductCostLink,
  ProductCostUnused,
} from "@/lib/breakeven/types";

export type ProductCostContext = {
  products?: Array<{ id: string; name: string; price: number } | Product>;
  links?: ProductCostLink[];
  posImports?: PosImport[];
  costBasis?: Exclude<ProductCostBasis, "estimate">;
};

export type ResolvedProductCost = ProductContribution & {
  costKind: ProductCostKind | null;
  costBasis: ProductCostBasis | null;
  costGaps: ProductCostGap[];
  unusedExisting: ProductCostUnused[];
  posCost: number | null;
  posProfit: number | null;
};

function recipeUnit(unit: string | undefined): PurchaseUnit | null {
  if (!unit) return null;
  return PURCHASE_UNITS.includes(unit as PurchaseUnit) ? (unit as PurchaseUnit) : null;
}

export function packCostKnown(item: Pick<CostingIngredient, "purchasePrice" | "purchaseQuantity" | "costPerBaseUnit">): boolean {
  return ingredientHasCost(item) && Number(item.purchaseQuantity) > 0 && Number(item.purchasePrice) > 0;
}

export function unitCostFromPack(packPrice: number, packQuantity: number): number | null {
  if (!(packPrice > 0) || !(packQuantity > 0)) return null;
  return packPrice / packQuantity;
}

export function posSourceForProduct(productId: string, imports?: PosImport[]): { posCost: number | null; posProfit: number | null } {
  let posCost: number | null = null;
  let posProfit: number | null = null;
  for (const item of imports ?? []) {
    if (item.status !== "approved") continue;
    for (const line of item.lines ?? []) {
      if (line.excluded || line.menuProductId !== productId) continue;
      if (line.posCost != null && Number.isFinite(line.posCost)) posCost = line.posCost;
      if (line.posProfit != null && Number.isFinite(line.posProfit)) posProfit = line.posProfit;
    }
  }
  return { posCost, posProfit };
}

export function findResaleCandidates(
  productId: string,
  productName: string,
  ingredients: CostingIngredient[],
  product?: { id: string; name: string } | Product
): { exact: CostingIngredient[]; suggest: CostingIngredient[] } {
  const byId = ingredients.filter((item) => item.id === productId && item.active !== false);
  const names = product ? catalogNames(product) : [normalizeIngredientName(productName)].filter(Boolean);
  const exact = new Map<string, CostingIngredient>();
  for (const item of byId) exact.set(item.id, item);
  for (const name of names.length ? names : [productName]) {
    const match = matchIngredient(name, ingredients.filter((item) => item.active !== false));
    if (match.kind === "exact" && match.item) exact.set(match.item.id, match.item);
    if (match.kind === "exact" && match.alternatives.length) {
      for (const alt of match.alternatives) exact.set(alt.id, alt);
    }
  }
  const suggest = new Map<string, CostingIngredient>();
  for (const name of names.length ? names : [productName]) {
    const match = matchIngredient(name, ingredients.filter((item) => item.active !== false));
    if (match.kind === "suggest") {
      if (match.item) suggest.set(match.item.id, match.item);
      for (const alt of match.alternatives) suggest.set(alt.id, alt);
    }
  }
  for (const id of exact.keys()) suggest.delete(id);
  return { exact: [...exact.values()], suggest: [...suggest.values()] };
}

function extrasFromRecipe(recipe: DishRecipe | undefined, food: number, sellingPrice: number): number {
  if (!recipe) return 0;
  const extras = estimatedFullCost({
    ingredientCost: food,
    sellingPrice,
    overhead: recipe.overheadSettings,
  });
  return extras.extras
    .filter((line) => line.name !== "labor" && line.name !== "laborPercent" && line.name !== "overhead")
    .reduce((sum, line) => sum + line.amount, 0);
}

function walkRecipeCost(
  recipe: DishRecipe,
  recipes: DishRecipe[],
  ingredients: Map<string, CostingIngredient>,
  seen: Set<string>
): { total: number | null; gaps: ProductCostGap[] } {
  if (seen.has(recipe.id)) return { total: null, gaps: [{ code: "partial-recipe", name: recipe.id }] };
  seen.add(recipe.id);
  const gaps: ProductCostGap[] = [];
  let total = 0;
  const lines = recipe.ingredients ?? [];
  if (!lines.length) return { total: null, gaps: [{ code: "no-link" }] };

  for (const line of lines) {
    if (line.subRecipeId) {
      const nested = recipes.find((item) => item.id === line.subRecipeId);
      if (!nested) {
        gaps.push({ code: "partial-recipe", name: line.subRecipeId });
        continue;
      }
      const inner = walkRecipeCost(nested, recipes, ingredients, seen);
      gaps.push(...inner.gaps);
      if (inner.total == null || !(Number(line.quantity) > 0)) {
        if (!(Number(line.quantity) > 0)) gaps.push({ code: "missing-recipe-qty", name: nested.productId });
        continue;
      }
      total += inner.total * Number(line.quantity);
      continue;
    }
    if (!(Number(line.quantity) > 0)) {
      gaps.push({ code: "missing-recipe-qty", ingredientId: line.ingredientId, name: line.ingredientId });
      continue;
    }
    const unit = recipeUnit(line.unit);
    const ingredient = ingredients.get(line.ingredientId);
    if (!ingredient) {
      gaps.push({ code: "partial-recipe", ingredientId: line.ingredientId, name: line.ingredientId });
      continue;
    }
    if (!unit || !unitsCompatible(unit, asPurchaseUnit(ingredient.purchaseUnit))) {
      gaps.push({ code: "incompatible-units", ingredientId: ingredient.id, name: ingredient.name });
      continue;
    }
    if (!ingredientHasCost(ingredient)) {
      const code = Number(ingredient.purchaseQuantity) > 0 ? "missing-purchase-price" : "missing-pack-qty";
      gaps.push({ code, ingredientId: ingredient.id, name: ingredient.name });
      continue;
    }
    total += lineRecipeCost(line.quantity, unit, ingredient.costPerBaseUnit);
  }
  return { total: gaps.length ? null : total, gaps };
}

function unusedFromCandidates(
  exact: CostingIngredient[],
  suggest: CostingIngredient[],
  pos: { posCost: number | null; posProfit: number | null },
  productId: string
): ProductCostUnused[] {
  const unused: ProductCostUnused[] = [];
  for (const item of [...exact, ...suggest]) {
    unused.push({
      kind: packCostKnown(item) ? "purchase" : "ingredient",
      id: item.id,
      name: item.name,
      detail: packCostKnown(item) ? String(item.costPerBaseUnit) : undefined,
    });
  }
  if (pos.posCost != null) {
    unused.push({ kind: "pos-cost", id: productId, name: "pos", detail: String(pos.posCost) });
  }
  return unused;
}

function finished(
  base: Omit<ResolvedProductCost, "contribution" | "contributionRatio" | "extraVariable"> & {
    extraVariable?: number | null;
  }
): ResolvedProductCost {
  const extraVariable = base.extraVariable ?? 0;
  const contribution =
    !base.costMissing && base.foodCost != null && base.sellingPrice > 0 ? base.sellingPrice - base.foodCost - extraVariable : null;
  return {
    ...base,
    extraVariable: base.costMissing ? null : extraVariable,
    contribution,
    contributionRatio: contribution != null && base.sellingPrice > 0 ? contribution / base.sellingPrice : null,
  };
}

export function resolveProductCost(input: {
  productId: string;
  name: string;
  sellingPrice: number;
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  context?: ProductCostContext;
  seen?: Set<string>;
}): ResolvedProductCost {
  const { productId, name, sellingPrice, recipes, ingredients } = input;
  const context = input.context ?? {};
  const seen = input.seen ?? new Set<string>();
  const pos = posSourceForProduct(productId, context.posImports);
  const link = (context.links ?? []).find((item) => item.productId === productId);
  const product = (context.products ?? []).find((item) => item.id === productId);
  const lookup = new Map(ingredients.map((item) => [item.id, item]));
  const candidates = findResaleCandidates(productId, name, ingredients, product);
  const unusedExisting = unusedFromCandidates(candidates.exact, candidates.suggest, pos, productId);
  const empty = {
    productId,
    name,
    sellingPrice,
    foodCost: null as number | null,
    extraVariable: null as number | null,
    costMissing: true,
    costKind: null as ProductCostKind | null,
    costBasis: null as ProductCostBasis | null,
    costGaps: [] as ProductCostGap[],
    unusedExisting,
    posCost: pos.posCost,
    posProfit: pos.posProfit,
  };

  if (link?.kind === "estimate" && link.estimateAmount != null && link.estimateAmount > 0) {
    return finished({
      ...empty,
      foodCost: link.estimateAmount,
      extraVariable: 0,
      costMissing: false,
      costKind: "estimate",
      costBasis: "estimate",
    });
  }

  const recipe =
    (link?.recipeId ? recipes.find((item) => item.id === link.recipeId) : undefined) ??
    recipeForProduct(recipes, productId);

  if (recipe) {
    const walked = walkRecipeCost(recipe, recipes, lookup, new Set(seen));
    if (walked.gaps.length || walked.total == null) {
      return finished({
        ...empty,
        costKind: link?.kind ?? (recipe.ingredients.some((line) => line.subRecipeId) ? "combo" : "recipe"),
        costGaps: walked.gaps.length ? walked.gaps : [{ code: "partial-recipe" }],
        unusedExisting: [
          { kind: "recipe", id: recipe.id, name, detail: "linked-incomplete" },
          ...unusedExisting.filter((item) => item.kind !== "recipe"),
        ],
      });
    }
    const kind: ProductCostKind =
      link?.kind ?? (recipe.ingredients.some((line) => line.subRecipeId) ? "combo" : "recipe");
    return finished({
      ...empty,
      foodCost: walked.total,
      extraVariable: extrasFromRecipe(recipe, walked.total, sellingPrice),
      costMissing: false,
      costKind: kind,
      costBasis: context.costBasis ?? "latest",
    });
  }

  if (link?.kind === "resale" && link.ingredientId) {
    const ingredient = lookup.get(link.ingredientId);
    if (!ingredient) {
      return finished({ ...empty, costKind: "resale", costGaps: [{ code: "no-link", ingredientId: link.ingredientId }] });
    }
    const packQty = link.packQuantity;
    const fromPack = packQty != null ? unitCostFromPack(ingredient.purchasePrice, packQty) : null;
    if (fromPack != null) {
      return finished({
        ...empty,
        foodCost: fromPack,
        extraVariable: 0,
        costMissing: false,
        costKind: "resale",
        costBasis: context.costBasis ?? "latest",
      });
    }
    if (!ingredientHasCost(ingredient)) {
      return finished({
        ...empty,
        costKind: "resale",
        costGaps: [
          {
            code: Number(ingredient.purchaseQuantity) > 0 ? "missing-purchase-price" : "missing-pack-qty",
            ingredientId: ingredient.id,
            name: ingredient.name,
          },
        ],
      });
    }
    return finished({
      ...empty,
      foodCost: ingredient.costPerBaseUnit,
      extraVariable: 0,
      costMissing: false,
      costKind: "resale",
      costBasis: context.costBasis ?? "latest",
    });
  }

  if (candidates.exact.length === 1 && packCostKnown(candidates.exact[0]!)) {
    const ingredient = candidates.exact[0]!;
    return finished({
      ...empty,
      foodCost: ingredient.costPerBaseUnit,
      extraVariable: 0,
      costMissing: false,
      costKind: "resale",
      costBasis: context.costBasis ?? "latest",
    });
  }

  const gaps: ProductCostGap[] = [];
  if (candidates.exact.length === 1) {
    const ingredient = candidates.exact[0]!;
    gaps.push({
      code: Number(ingredient.purchasePrice) > 0 ? "missing-pack-qty" : "missing-purchase-price",
      ingredientId: ingredient.id,
      name: ingredient.name,
    });
  } else if (candidates.exact.length > 1) {
    gaps.push({ code: "no-link" });
  } else {
    gaps.push({ code: "no-link" });
  }

  return finished({ ...empty, costGaps: gaps });
}

export function resaleRecipeLine(ingredientId: string, quantity = 1, unit: PurchaseUnit = "unit"): RecipeLine {
  return { ingredientId, quantity, unit };
}

export function comboRecipeLines(
  components: { productId: string; quantity: number }[],
  recipes: DishRecipe[],
  ingredients: CostingIngredient[]
): { lines: RecipeLine[]; gaps: ProductCostGap[] } {
  const lines: RecipeLine[] = [];
  const gaps: ProductCostGap[] = [];
  for (const component of components) {
    if (!(component.quantity > 0)) {
      gaps.push({ code: "missing-recipe-qty", name: component.productId });
      continue;
    }
    const recipe = recipeForProduct(recipes, component.productId);
    if (recipe) {
      lines.push({ ingredientId: "", subRecipeId: recipe.id, quantity: component.quantity, unit: "unit" });
      continue;
    }
    const match = ingredients.find((item) => item.id === component.productId);
    if (match) {
      lines.push({ ingredientId: match.id, quantity: component.quantity, unit: match.purchaseUnit || "unit" });
      continue;
    }
    gaps.push({ code: "no-link", name: component.productId });
  }
  return { lines, gaps };
}

export function sellingPriceIsNotCost(sellingPrice: number, foodCost: number | null): boolean {
  return foodCost == null || foodCost !== sellingPrice;
}
