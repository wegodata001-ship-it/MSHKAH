import { matchIngredient, matchProduct } from "@/lib/costing/import/match";
import { recipeUnitsCompatible } from "@/lib/costing/import/normalize-unit";
import { suggestIngredientsFromMenuText } from "@/lib/costing/import/suggest";
import type {
  ImportDraft,
  ImportSummary,
  IngredientDraft,
  ParsedWorkbook,
  RecipeDraft,
  RecipeLineDraft,
  ReviewFilter,
} from "@/lib/costing/import/types";
import { lineRecipeCost } from "@/lib/costing/units";
import type { CostingIngredient, DishRecipe, PurchaseUnit } from "@/lib/costing/types";
import type { Product } from "@/types";
import { getLocalizedDescription, getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Locale } from "@/lib/i18n/types";
import { normalizeIngredientName } from "@/lib/costing/names";

function key(prefix: string, value: string, index: number) {
  return `${prefix}-${normalizeIngredientName(value) || "row"}-${index}`;
}

function lineCost(line: RecipeLineDraft, ingredients: CostingIngredient[]): number {
  if (!line.ingredientId || line.quantity == null || !line.unit) return 0;
  const item = ingredients.find((ingredient) => ingredient.id === line.ingredientId);
  if (!item) return 0;
  return lineRecipeCost(line.quantity, line.unit, item.costPerBaseUnit);
}

export function recipeDraftStatus(recipe: RecipeDraft): Exclude<ReviewFilter, "all"> {
  if (recipe.saved) return "saved";
  if (recipe.errors.length) return "review";
  if (recipe.existingRecipeId && recipe.resolve !== "update" && recipe.resolve !== "keep") return "conflict";
  const included = recipe.lines.filter((line) => line.included);
  if (included.some((line) => !line.ingredientId)) return "unknown-ingredient";
  if (included.some((line) => line.quantity == null || line.quantity <= 0 || !line.unit)) return "missing-qty";
  if (included.some((line) => line.errors.length || line.matchKind === "suggest")) return "review";
  if (!recipe.productId || included.length === 0) return "review";
  return "ready";
}

export function isRecipeBulkReady(recipe: RecipeDraft): boolean {
  return recipeDraftStatus(recipe) === "ready" && (!recipe.existingRecipeId || recipe.resolve === "update");
}

export function knownRecipeCost(recipe: RecipeDraft, ingredients: CostingIngredient[]): number {
  return recipe.lines.reduce((sum, line) => sum + (line.included ? lineCost(line, ingredients) : 0), 0);
}

export function missingQuantityCount(recipe: RecipeDraft): number {
  return recipe.lines.filter((line) => line.included && (line.quantity == null || line.quantity <= 0)).length;
}

function summarize(ingredients: IngredientDraft[], recipes: RecipeDraft[]): ImportSummary {
  return {
    ingredientCount: ingredients.length,
    newIngredients: ingredients.filter((item) => item.matchKind === "new").length,
    existingIngredients: ingredients.filter((item) => item.matchKind === "exact" || item.matchKind === "suggest").length,
    priceUpdates: ingredients.filter((item) => item.priceChanged).length,
    dishCount: recipes.length,
    readyRecipes: recipes.filter((item) => isRecipeBulkReady(item)).length,
    reviewRecipes: recipes.filter((item) => !isRecipeBulkReady(item) && !item.saved).length,
    errorRows:
      ingredients.filter((item) => item.errors.length).length +
      recipes.filter((item) => item.errors.length || item.lines.some((line) => line.errors.length)).length,
  };
}

function toIngredientDraft(
  row: ParsedWorkbook["ingredients"][number],
  catalog: CostingIngredient[],
  recipes: DishRecipe[],
  index: number
): IngredientDraft {
  const match = matchIngredient(row.name, catalog);
  const current = match.item;
  const priceChanged = Boolean(
    current &&
      row.purchasePrice != null &&
      (current.purchasePrice !== row.purchasePrice ||
        current.purchaseQuantity !== (row.packageQuantity ?? current.purchaseQuantity) ||
        current.purchaseUnit !== (row.purchaseUnit ?? current.purchaseUnit))
  );
  return {
    key: key("ing", row.name, index),
    name: row.name,
    category: row.category,
    supplier: row.supplier,
    purchasePrice: row.purchasePrice,
    packageQuantity: row.packageQuantity,
    purchaseUnit: row.purchaseUnit,
    matchId: current?.id,
    matchName: current?.name,
    matchKind: current ? match.kind : row.name ? "new" : "none",
    currentPrice: current?.purchasePrice,
    newPrice: row.purchasePrice ?? undefined,
    affectedDishCount: current
      ? recipes.filter((recipe) => recipe.ingredients.some((line) => line.ingredientId === current.id)).length
      : 0,
    priceChanged,
    priceApproved: false,
    createApproved: false,
    errors: row.errors,
  };
}

function groupRecipeRows(rows: ParsedWorkbook["recipes"]): Map<string, ParsedWorkbook["recipes"]> {
  const groups = new Map<string, ParsedWorkbook["recipes"]>();
  rows.forEach((row) => {
    const groupKey = row.productId || normalizeIngredientName(row.productName) || `row-${row.row}`;
    const list = groups.get(groupKey) ?? [];
    list.push(row);
    groups.set(groupKey, list);
  });
  return groups;
}

function existingLineSummary(recipe: DishRecipe, catalog: CostingIngredient[]): string[] {
  return recipe.ingredients.map((line) => {
    const name = catalog.find((item) => item.id === line.ingredientId)?.name ?? line.ingredientId;
    return `${name} ${line.quantity} ${line.unit}`;
  });
}

export function buildFileDraft(input: {
  parsed: ParsedWorkbook;
  products: Product[];
  ingredients: CostingIngredient[];
  recipes: DishRecipe[];
  locale: Locale;
}): ImportDraft {
  const ingredientDrafts = input.parsed.ingredients.map((row, index) =>
    toIngredientDraft(row, input.ingredients, input.recipes, index)
  );
  const seenProducts = new Set<string>();
  const recipeDrafts: RecipeDraft[] = [];
  for (const [, rows] of groupRecipeRows(input.parsed.recipes)) {
    const first = rows[0];
    const productMatch = matchProduct(first.productId, first.productName, input.products);
    const product = productMatch.item;
    const productKey = product?.id || first.productId || normalizeIngredientName(first.productName);
    if (seenProducts.has(productKey) && product) {
      recipeDrafts.push({
        key: key("dup", productKey, recipeDrafts.length),
        productId: product.id,
        productName: getProductDisplayName(product, input.locale),
        menuDescription: first.menuDescription,
        sellingPrice: product.price,
        existingSummary: [],
        lines: [],
        extras: [],
        resolve: null,
        saved: false,
        errors: ["duplicate-product"],
      });
      continue;
    }
    if (product) seenProducts.add(product.id);
    const existing = product
      ? input.recipes.find((recipe) => recipe.productId === product.id && !recipe.variantId)
      : undefined;
    const lines: RecipeLineDraft[] = rows.map((row, index) => {
      const match = matchIngredient(row.ingredientName, input.ingredients);
      const unit = row.unit;
      const errors = [...row.errors];
      if (match.alternatives.length > 1) errors.push("ambiguous-ingredient");
      if (match.item && unit && !recipeUnitsCompatible(unit, match.item.purchaseUnit)) {
        errors.push("incompatible-unit");
      }
      const existingLine = existing?.ingredients.find((line) => line.ingredientId === match.item?.id);
      let change: RecipeLineDraft["change"] = "NEW";
      if (existingLine && match.item) {
        const same = existingLine.quantity === (row.quantity ?? 0) && existingLine.unit === (unit ?? existingLine.unit);
        change = same ? "UNCHANGED" : "CHANGED";
      }
      return {
        key: key("line", row.ingredientName, index),
        ingredientName: row.ingredientName,
        ingredientId: match.item?.id,
        matchName: match.item?.name,
        matchKind: match.item ? match.kind : row.ingredientName ? "new" : "none",
        quantity: row.quantity,
        unit,
        suggested: false,
        source: "import",
        change,
        included: true,
        errors,
      };
    });
    if (existing) {
      for (const line of existing.ingredients) {
        if (lines.some((item) => item.ingredientId === line.ingredientId)) continue;
        const name = input.ingredients.find((item) => item.id === line.ingredientId)?.name ?? line.ingredientId;
        lines.push({
          key: key("removed", line.ingredientId, lines.length),
          ingredientName: name,
          ingredientId: line.ingredientId,
          matchName: name,
          matchKind: "exact",
          quantity: line.quantity,
          unit: line.unit as PurchaseUnit,
          suggested: false,
          source: "existing",
          change: "REMOVED",
          included: true,
          errors: [],
        });
      }
    }
    const errors: string[] = [];
    if (!product) errors.push(productMatch.alternatives.length > 1 ? "ambiguous-product" : "unknown-product");
    recipeDrafts.push({
      key: key("dish", productKey, recipeDrafts.length),
      productId: product?.id,
      productName: product ? getProductDisplayName(product, input.locale) : first.productName,
      menuDescription:
        first.menuDescription ||
        (product ? getLocalizedDescription(product, input.locale) : ""),
      sellingPrice: product?.price ?? 0,
      existingRecipeId: existing?.id,
      existingSummary: existing ? existingLineSummary(existing, input.ingredients) : [],
      lines,
      extras: [],
      resolve: existing ? null : "update",
      saved: false,
      errors,
    });
  }
  return {
    fileName: input.parsed.fileName,
    source: "file",
    ingredients: ingredientDrafts,
    recipes: recipeDrafts,
    summary: summarize(ingredientDrafts, recipeDrafts),
  };
}

/** Reserved for a future connected AI/import path. Not exposed in admin UI. */
export function buildMenuDraft(input: {
  products: Product[];
  ingredients: CostingIngredient[];
  recipes: DishRecipe[];
  extrasByProduct?: Map<string, { name: string; priceDelta: number }[]>;
  locale: Locale;
}): ImportDraft {
  const recipes: RecipeDraft[] = input.products
    .filter((product) => product.active && !product.isTestProduct)
    .map((product, index) => {
      const existing = input.recipes.find((recipe) => recipe.productId === product.id && !recipe.variantId);
      const description = [
        getProductDisplayName(product, input.locale),
        getLocalizedDescription(product, input.locale),
      ]
        .filter(Boolean)
        .join("، ");
      const suggestions = suggestIngredientsFromMenuText(description);
      const lines: RecipeLineDraft[] = suggestions.map((name, lineIndex) => {
        const match = matchIngredient(name, input.ingredients);
        return {
          key: key("suggest", name, lineIndex),
          ingredientName: name,
          ingredientId: match.item?.id,
          matchName: match.item?.name,
          matchKind: match.item ? match.kind : "new",
          quantity: null,
          unit: match.item ? (match.item.baseUnit === "g" ? "g" : match.item.baseUnit === "ml" ? "ml" : "unit") : null,
          suggested: true,
          source: "menu",
          change: "NEW",
          included: true,
          errors: ["missing-qty"],
        };
      });
      return {
        key: key("menu", product.id, index),
        productId: product.id,
        productName: getProductDisplayName(product, input.locale),
        menuDescription: getLocalizedDescription(product, input.locale),
        sellingPrice: product.price,
        existingRecipeId: existing?.id,
        existingSummary: existing ? existingLineSummary(existing, input.ingredients) : [],
        lines,
        extras: input.extrasByProduct?.get(product.id) ?? [],
        resolve: existing ? null : "update",
        saved: false,
        errors: [],
      };
    });
  return {
    fileName: "menu-draft",
    source: "menu",
    ingredients: [],
    recipes,
    summary: summarize([], recipes),
  };
}

export function refreshSummary(draft: ImportDraft): ImportDraft {
  return { ...draft, summary: summarize(draft.ingredients, draft.recipes) };
}
