import type { DishCostRow } from "@/lib/costing/model";
import type { CostingSettings } from "@/lib/costing/types";
import type { Product } from "@/types";

/**
 * Dish pricing & profitability helpers.
 *
 * The owner-level spec is explicit:
 *   • "אין להניח שזוהי העלות האמיתית" when an imported cost equals the price
 *   • "אל תחשוף ללקוח עלויות" — these helpers are admin-only input
 *   • "אל תציג עלות חסרה כאפס"
 *   • "לחשב רווחיות על בסיס אחיד" — we always compute on **net** prices,
 *      using the business VAT policy configured in costing settings.
 *
 * This module is pure (no I/O, no React) so it can be unit-tested and shared
 * between the admin UI and the server-side price-update route.
 */

export type DishCostState =
  | "computed_recipe"
  | "verified_manual"
  | "imported_unverified"
  | "missing";

export type DishPricingRow = {
  productId: string;
  product: Product;
  costState: DishCostState;
  /**
   * The "effective" cost used for profit math, net of VAT when the business
   * runs the "deduct VAT before profit" policy. `null` when the cost state
   * is `missing` or the cost is explicitly unverified — never silently 0.
   */
  effectiveCostNet: number | null;
  priceNet: number;
  grossProfit: number | null;
  grossMarginPercent: number | null;
  foodCostPercent: number | null;
  foodCostStatus: ProfitTone;
  recipeLineCount: number;
};

export type ProfitTone = "good" | "watch" | "loss" | "unknown";

export type DishPricingSummary = {
  total: number;
  visible: number;
  hidden: number;
  priced: number;
  withPositiveProfit: number;
  withZeroProfit: number;
  withLoss: number;
  missingCost: number;
  importedUnverified: number;
  noCategory: number;
  noImage: number;
  averagePriceIls: number | null;
  averageCostIls: number | null;
  averageFoodCostPercent: number | null;
};

export type DishDiagnostic =
  | "loss"
  | "zero_profit"
  | "missing_cost"
  | "imported_unverified"
  | "positive"
  | "no_category"
  | "no_image"
  | "hidden"
  | "unusual_price"
  | "possible_duplicate";

export type DishDiagnosticsCount = Record<DishDiagnostic, number>;

const DEFAULT_VAT_RATE = 0.18;

/** Round to 2 decimals in a way that doesn't accumulate float drift. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Convert a stored price into its net (ex-VAT) value when the business VAT
 * policy says the stored number already includes VAT. We honour the per-row
 * `product.includesVat` flag first and only fall back to the global setting.
 */
export function toNet(amount: number, product: Product, settings: CostingSettings): number {
  if (!Number.isFinite(amount)) return 0;
  const vatRate = settings.vatRate ?? DEFAULT_VAT_RATE;
  const includesVat = product.includesVat ?? true;
  const mode = settings.foodCostVatMode ?? "including";
  // If the price already includes VAT and the business reports on net, strip it.
  // Otherwise it's already net.
  if (includesVat && mode === "before" && vatRate > 0) {
    return money(amount / (1 + vatRate));
  }
  return money(amount);
}

/**
 * Decide which of the four cost states applies to a product.
 *
 * The order of precedence matches the spec:
 *   1. If a recipe exists with a meaningful ingredient cost, that's the
 *      authoritative cost ("computed_recipe").
 *   2. Else if the owner explicitly flagged `costVerified`, use the manual
 *      cost ("verified_manual").
 *   3. Else if a cost number exists but isn't verified, mark it as
 *      "imported_unverified" so the dashboards don't treat it as truth.
 *   4. Else the product has no cost at all ("missing").
 *
 * Note: a product whose imported `cost === price` is NEVER promoted to
 * "verified_manual" even if cost > 0 — the spec explicitly calls out that
 * cost = price in the HTML dump is suspect, not authoritative.
 */
export function resolveDishCostState(input: {
  product: Product;
  hasRecipe: boolean;
  recipeIngredientCost: number;
}): DishCostState {
  if (input.hasRecipe && input.recipeIngredientCost > 0) return "computed_recipe";
  if (input.product.costVerified === true && input.product.cost > 0) return "verified_manual";
  if (input.product.cost > 0) return "imported_unverified";
  return "missing";
}

function toneFromFoodCost(
  foodCost: number | null,
  targetFoodCostPercent: number
): ProfitTone {
  if (foodCost == null || !Number.isFinite(foodCost)) return "unknown";
  if (foodCost >= 100) return "loss";
  if (foodCost > targetFoodCostPercent) return "watch";
  return "good";
}

/**
 * Convert a `DishCostRow` (which already joined product+recipe+ingredients)
 * plus the raw product into a view-ready `DishPricingRow`. The decision
 * about which cost to use is centralised here so UI and server share logic.
 */
export function toPricingRow(
  dishRow: DishCostRow,
  settings: CostingSettings
): DishPricingRow {
  const product = dishRow.product;
  const state = resolveDishCostState({
    product,
    hasRecipe: Boolean(dishRow.recipe),
    recipeIngredientCost: dishRow.ingredientCost,
  });
  const priceNet = toNet(product.price, product, settings);

  let effectiveCostNet: number | null = null;
  if (state === "computed_recipe") {
    // The recipe cost is already computed on the base purchase price, which
    // follows the global `foodCostVatMode`. We trust it as-is.
    effectiveCostNet = dishRow.ingredientCost;
  } else if (state === "verified_manual") {
    effectiveCostNet = toNet(product.cost, product, settings);
  } else {
    effectiveCostNet = null;
  }

  const grossProfit =
    effectiveCostNet == null ? null : money(priceNet - effectiveCostNet);
  const grossMarginPercent =
    grossProfit == null || priceNet <= 0 ? null : (grossProfit / priceNet) * 100;
  const foodCostPercent =
    effectiveCostNet == null || priceNet <= 0 ? null : (effectiveCostNet / priceNet) * 100;
  const target = dishRow.recipe?.targetFoodCostPercent ?? settings.targetFoodCostPercent;

  return {
    productId: product.id,
    product,
    costState: state,
    effectiveCostNet,
    priceNet,
    grossProfit,
    grossMarginPercent,
    foodCostPercent,
    foodCostStatus: toneFromFoodCost(foodCostPercent, target),
    recipeLineCount: dishRow.lineCount,
  };
}

/**
 * Count-based summary that drives the top KPI cards and the "control" tab.
 *
 * We NEVER show "missing cost" as "zero profit" — a row with no cost is
 * excluded from the profit buckets entirely and bumps `missingCost`.
 */
export function dishPricingSummary(rows: DishPricingRow[]): DishPricingSummary {
  const visible = rows.filter((row) => !row.product.hidden && row.product.active !== false);
  const hidden = rows.filter((row) => row.product.hidden || row.product.active === false);

  let positive = 0;
  let zero = 0;
  let loss = 0;
  let priced = 0;
  let missingCost = 0;
  let importedUnverified = 0;
  let noCategory = 0;
  let noImage = 0;
  let priceSum = 0;
  let costSum = 0;
  let costSamples = 0;
  let foodCostSum = 0;
  let foodCostSamples = 0;

  for (const row of rows) {
    if (row.product.price > 0) {
      priceSum += row.product.price;
      priced += 1;
    }
    if (!row.product.categoryId || row.product.categoryId.trim() === "") noCategory += 1;
    if (!row.product.image || row.product.image.trim() === "") noImage += 1;

    if (row.costState === "missing") {
      missingCost += 1;
      continue;
    }
    if (row.costState === "imported_unverified") {
      importedUnverified += 1;
      // We do not count unverified rows in the profit buckets — the spec is
      // explicit that these should not pretend to be authoritative.
      continue;
    }

    if (row.effectiveCostNet != null) {
      costSum += row.effectiveCostNet;
      costSamples += 1;
    }
    if (row.foodCostPercent != null) {
      foodCostSum += row.foodCostPercent;
      foodCostSamples += 1;
    }
    if (row.grossProfit == null) continue;
    if (row.grossProfit > 0.001) positive += 1;
    else if (Math.abs(row.grossProfit) <= 0.001) zero += 1;
    else loss += 1;
  }

  return {
    total: rows.length,
    visible: visible.length,
    hidden: hidden.length,
    priced,
    withPositiveProfit: positive,
    withZeroProfit: zero,
    withLoss: loss,
    missingCost,
    importedUnverified,
    noCategory,
    noImage,
    averagePriceIls: priced ? money(priceSum / priced) : null,
    averageCostIls: costSamples ? money(costSum / costSamples) : null,
    averageFoodCostPercent: foodCostSamples ? money(foodCostSum / foodCostSamples) : null,
  };
}

/**
 * Compute a per-row set of diagnostic flags so the filter chips in the
 * profitability tab line up with the rows one-to-one. We don't dedupe at the
 * row level — a product can be both `no_image` and `hidden`, for example.
 */
export function diagnoseRow(row: DishPricingRow): DishDiagnostic[] {
  const flags: DishDiagnostic[] = [];
  if (row.costState === "missing") flags.push("missing_cost");
  if (row.costState === "imported_unverified") flags.push("imported_unverified");
  if (row.grossProfit != null) {
    if (row.grossProfit < -0.001) flags.push("loss");
    else if (Math.abs(row.grossProfit) <= 0.001) flags.push("zero_profit");
    else flags.push("positive");
  }
  if (!row.product.categoryId || row.product.categoryId.trim() === "") flags.push("no_category");
  if (!row.product.image || row.product.image.trim() === "") flags.push("no_image");
  if (row.product.hidden || row.product.active === false) flags.push("hidden");
  // "Unusual price" = price not a round multiple of 0.5₪ AND > 0. The owner
  // asked for this specifically ("3 מוצרים עם מחיר לא עגול") — informational,
  // not blocking.
  if (row.product.price > 0 && Math.abs((row.product.price * 2) % 1) > 0.001) {
    flags.push("unusual_price");
  }
  return flags;
}

/** Aggregate `diagnoseRow` across a list for the filter chips. */
export function dishDiagnosticsCount(rows: DishPricingRow[]): DishDiagnosticsCount {
  const counts: DishDiagnosticsCount = {
    loss: 0,
    zero_profit: 0,
    missing_cost: 0,
    imported_unverified: 0,
    positive: 0,
    no_category: 0,
    no_image: 0,
    hidden: 0,
    unusual_price: 0,
    possible_duplicate: 0,
  };
  for (const row of rows) {
    for (const flag of diagnoseRow(row)) counts[flag] += 1;
  }
  return counts;
}

/**
 * Return a stable key used by the price-update API to detect a stale change
 * from a browser that saw a different sale price. The server can reject the
 * mutation if `expectedPrice !== currentPrice`.
 */
export function pricingChangeKey(product: Product): string {
  return `${product.id}:${product.price.toFixed(2)}`;
}

/**
 * Validate a sale-price change request before writing. Shared between the
 * admin API route and the test suite so the business rules (positive,
 * finite, within a sane window) can't drift between code paths.
 */
export function validateSalePriceChange(input: {
  nextPrice: number;
  product: Product;
}): { ok: true; nextPrice: number } | { ok: false; code: PriceChangeError } {
  const price = Number(input.nextPrice);
  if (!Number.isFinite(price)) return { ok: false, code: "INVALID_NUMBER" };
  if (price < 0) return { ok: false, code: "NEGATIVE" };
  if (price > 100000) return { ok: false, code: "TOO_LARGE" };
  const rounded = Math.round(price * 100) / 100;
  return { ok: true, nextPrice: rounded };
}

export type PriceChangeError = "INVALID_NUMBER" | "NEGATIVE" | "TOO_LARGE";
