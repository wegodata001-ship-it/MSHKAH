import { estimatedFullCost, recipeIngredientCost } from "@/lib/costing/calc";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import { recipeForProduct } from "@/lib/costing/model";
import { detectedVatRate } from "@/lib/inventory/vat";
import type { Order } from "@/types";
import type {
  BreakEvenFixedCost,
  BreakEvenMissing,
  BreakEvenResult,
  BreakEvenSettings,
  BreakEvenSnapshot,
  BreakEvenVariableCost,
  BreakEvenVatBasis,
  BreakEvenVatMode,
  CostFrequency,
  DailyRevenuePoint,
  ProductContribution,
} from "@/lib/breakeven/types";
import { DEFAULT_BREAK_EVEN_SETTINGS } from "@/lib/breakeven/types";

const MS_DAY = 86_400_000;

export function monthlyEquivalent(amount: number, frequency: CostFrequency, operatingDays: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  const days = Math.max(1, operatingDays || 26);
  if (frequency === "daily") return amount * days;
  if (frequency === "weekly") return (amount * 52) / 12;
  if (frequency === "yearly") return amount / 12;
  return amount;
}

export function amountOnVatBasis(
  amount: number,
  vatMode: BreakEvenVatMode,
  basis: BreakEvenVatBasis,
  vatRate?: number | null
): number {
  if (!Number.isFinite(amount)) return 0;
  if (vatMode === "exempt") return amount;
  const rate = detectedVatRate(vatRate) ?? 0.18;
  if (vatMode === basis) return amount;
  if (basis === "before" && vatMode === "including") return rate > 0 ? amount / (1 + rate) : amount;
  if (basis === "including" && vatMode === "before") return amount * (1 + (rate || 0));
  return amount;
}

export function orderBusinessDate(order: Order): string {
  return (order.paidAt || order.completedAt || order.createdAt || "").slice(0, 10);
}

export function isCountableSale(order: Order): boolean {
  if (order.isTestOrder) return false;
  if (order.status === "cancelled") return false;
  if (order.paymentStatus === "failed" || order.paymentStatus === "refunded") return false;
  return true;
}

export function salesInRange(orders: Order[], from: string, to: string) {
  const rows = orders.filter((order) => {
    if (!isCountableSale(order)) return false;
    const day = orderBusinessDate(order);
    return day && day >= from && day <= to;
  });
  const revenue = rows.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const count = rows.length;
  const productsSold = rows.reduce(
    (sum, order) => sum + order.items.reduce((inner, item) => inner + (Number(item.quantity) || 0), 0),
    0
  );
  return {
    revenue: rows.length ? revenue : null,
    orders: rows.length ? count : null,
    averageOrderValue: count > 0 ? revenue / count : null,
    productsSold: productsSold || null,
    rows,
  };
}

export function dailyRevenueSeries(orders: Order[], from: string, to: string): DailyRevenuePoint[] {
  const map = new Map<string, number>();
  for (const order of salesInRange(orders, from, to).rows) {
    const day = orderBusinessDate(order);
    map.set(day, (map.get(day) ?? 0) + (Number(order.total) || 0));
  }
  const points: DailyRevenuePoint[] = [];
  let cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let cumulative = 0;
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    const revenue = map.get(key) ?? 0;
    cumulative += revenue;
    points.push({ date: key, revenue, cumulative });
    cursor = new Date(cursor.getTime() + MS_DAY);
  }
  return points;
}

export function foodCostFromSales(
  orders: Order[],
  recipes: DishRecipe[],
  ingredients: CostingIngredient[]
): number | null {
  const lookup = new Map(ingredients.map((item) => [item.id, item]));
  let total = 0;
  let used = false;
  for (const order of orders) {
    for (const item of order.items) {
      const recipe = recipeForProduct(recipes, item.productId);
      if (!recipe) continue;
      used = true;
      total += recipeIngredientCost(recipe.ingredients, lookup) * (Number(item.quantity) || 0);
    }
  }
  return used ? total : null;
}

export function productContribution(
  productId: string,
  name: string,
  sellingPrice: number,
  recipes: DishRecipe[],
  ingredients: CostingIngredient[]
): ProductContribution | null {
  const recipe = recipeForProduct(recipes, productId);
  if (!recipe || !(sellingPrice > 0)) return null;
  const lookup = new Map(ingredients.map((item) => [item.id, item]));
  const food = recipeIngredientCost(recipe.ingredients, lookup);
  const extras = estimatedFullCost({
    ingredientCost: food,
    sellingPrice,
    overhead: recipe.overheadSettings,
  });
  const extraVariable = extras.extras
    .filter((line) => line.name !== "labor" && line.name !== "laborPercent" && line.name !== "overhead")
    .reduce((sum, line) => sum + line.amount, 0);
  const contribution = sellingPrice - food - extraVariable;
  return {
    productId,
    name,
    sellingPrice,
    foodCost: food,
    extraVariable,
    contribution,
    contributionRatio: sellingPrice > 0 ? contribution / sellingPrice : null,
  };
}

export function fixedMonthlyTotal(
  costs: BreakEvenFixedCost[],
  settings: BreakEvenSettings
): number | null {
  const active = (costs ?? []).filter((item) => item.active && item.amount > 0);
  if (!active.length) return null;
  return active.reduce((sum, item) => {
    const monthly = monthlyEquivalent(item.amount, item.frequency, settings.operatingDays);
    return sum + amountOnVatBasis(monthly, item.vatMode, settings.vatBasis, item.vatRate ?? settings.vatRate);
  }, 0);
}

export function variableTotalForRevenue(
  costs: BreakEvenVariableCost[],
  settings: BreakEvenSettings,
  revenue: number | null,
  orders: number | null
): number | null {
  const active = (costs ?? []).filter((item) => item.active && item.amount > 0);
  if (!active.length) return null;
  return active.reduce((sum, item) => {
    let raw = 0;
    if (item.kind === "percent") raw = (revenue ?? 0) * (item.amount > 1 ? item.amount / 100 : item.amount);
    else if (item.kind === "per_order") raw = (orders ?? 0) * item.amount;
    else raw = monthlyEquivalent(item.amount, item.frequency ?? "monthly", settings.operatingDays);
    return sum + amountOnVatBasis(raw, item.vatMode, settings.vatBasis, item.vatRate ?? settings.vatRate);
  }, 0);
}

export function monthBounds(now = new Date()): { from: string; to: string; key: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    key,
  };
}

export function operatingElapsed(from: string, to: string, operatingDays: number, now = new Date()): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  const today = Math.min(now.getTime(), new Date(`${to}T23:59:59`).getTime());
  const calendar = Math.max(1, Math.floor((today - start) / MS_DAY) + 1);
  return Math.min(Math.max(1, operatingDays), calendar);
}

export function salesOnVatBasis(
  amount: number,
  basis: BreakEvenVatBasis,
  vatRate: number
): number {
  return amountOnVatBasis(amount, "including", basis, vatRate);
}

export function computeBreakEven(input: {
  settings?: BreakEvenSettings;
  fixed: BreakEvenFixedCost[];
  variable: BreakEvenVariableCost[];
  orders: Order[];
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  from: string;
  to: string;
  now?: Date;
}): BreakEvenResult {
  const settings = { ...DEFAULT_BREAK_EVEN_SETTINGS, ...input.settings };
  const rawSales = salesInRange(input.orders, input.from, input.to);
  const revenue =
    rawSales.revenue == null ? null : salesOnVatBasis(rawSales.revenue, settings.vatBasis, settings.vatRate);
  const sales = {
    ...rawSales,
    revenue,
    averageOrderValue:
      rawSales.orders && rawSales.orders > 0 && revenue != null ? revenue / rawSales.orders : null,
  };
  const food = foodCostFromSales(sales.rows, input.recipes, input.ingredients);
  const fixed = fixedMonthlyTotal(input.fixed, settings);
  const variableBase = variableTotalForRevenue(input.variable, settings, sales.revenue, sales.orders);
  const variable =
    variableBase == null && food == null ? null : (variableBase ?? 0) + (food ?? 0);
  const missing: BreakEvenMissing[] = [];
  if (fixed == null) missing.push("fixed");
  if (variableBase == null && food == null) missing.push("variable");
  if (sales.revenue == null) missing.push("sales");

  const contribution = sales.revenue != null && variable != null ? sales.revenue - variable : null;
  const contributionRatio =
    contribution != null && sales.revenue != null && sales.revenue > 0 ? contribution / sales.revenue : null;
  if (contributionRatio == null || contributionRatio <= 0) missing.push("margin");

  const breakEvenMonthly =
    fixed != null && contributionRatio != null && contributionRatio > 0 ? fixed / contributionRatio : null;
  const days = Math.max(1, settings.operatingDays);
  const elapsed = operatingElapsed(input.from, input.to, days, input.now);
  const remaining = Math.max(0, days - elapsed);
  const daily = dailyRevenueSeries(input.orders, input.from, input.to).map((point, index, all) => {
    const revenue = salesOnVatBasis(point.revenue, settings.vatBasis, settings.vatRate);
    const cumulative = all
      .slice(0, index + 1)
      .reduce((sum, item) => sum + salesOnVatBasis(item.revenue, settings.vatBasis, settings.vatRate), 0);
    return { ...point, revenue, cumulative };
  });
  const crossed = daily.find((point) => breakEvenMonthly != null && point.cumulative >= breakEvenMonthly);
  const dailyAverage = sales.revenue != null && elapsed > 0 ? sales.revenue / elapsed : null;
  const forecast = dailyAverage != null ? dailyAverage * days : null;
  const gap = breakEvenMonthly != null && sales.revenue != null ? breakEvenMonthly - sales.revenue : null;
  const canCompute = breakEvenMonthly != null;

  const alerts: string[] = [];
  if (canCompute && gap != null && gap <= 0) alerts.push("achieved");
  else if (canCompute && remaining <= 7 && (gap ?? 0) > settings.alertGap) alerts.push("weekLeft");
  if (canCompute && remaining > 0 && (gap ?? 0) > 0) alerts.push("requiredDaily");

  return {
    canCompute,
    missing: canCompute ? [] : [...new Set(missing)],
    vatBasis: settings.vatBasis,
    operatingDays: days,
    elapsedDays: elapsed,
    remainingDays: remaining,
    revenue: sales.revenue,
    orders: sales.orders,
    averageOrderValue: sales.averageOrderValue,
    productsSold: sales.productsSold,
    fixedMonthly: fixed,
    variableTotal: variable,
    foodCost: food,
    contribution,
    contributionRatio,
    breakEvenMonthly,
    breakEvenWeekly: breakEvenMonthly != null ? (breakEvenMonthly * 7) / days : null,
    breakEvenDaily: breakEvenMonthly != null ? breakEvenMonthly / days : null,
    ordersRequiredDaily:
      breakEvenMonthly != null && sales.averageOrderValue && sales.averageOrderValue > 0
        ? (breakEvenMonthly / days) / sales.averageOrderValue
        : null,
    gap,
    progress:
      breakEvenMonthly != null && sales.revenue != null && breakEvenMonthly > 0
        ? Math.min(1, sales.revenue / breakEvenMonthly)
        : null,
    aboveBreakEven: gap != null && gap < 0 ? Math.abs(gap) : null,
    achieved: Boolean(canCompute && gap != null && gap <= 0),
    dailyAverage,
    forecast,
    forecastGap: forecast != null && breakEvenMonthly != null ? forecast - breakEvenMonthly : null,
    requiredDailyFromNow:
      gap != null && gap > 0 && remaining > 0 ? gap / remaining : gap != null && gap > 0 ? gap : null,
    crossedOn: crossed?.date ?? null,
    daily,
    alerts,
  };
}

export function simulateBreakEven(
  base: BreakEvenResult,
  patch: Partial<{
    sellingLift: number;
    foodCostLift: number;
    rent: number;
    salaries: number;
    cardPercent: number;
    operatingDays: number;
    averageOrderValue: number;
  }>
): BreakEvenResult {
  const days = Math.max(1, patch.operatingDays ?? base.operatingDays);
  const revenue = base.revenue;
  const food = base.foodCost == null ? null : base.foodCost * (1 + (patch.foodCostLift ?? 0));
  const extraFixed = (patch.rent ?? 0) + (patch.salaries ?? 0);
  const fixed = base.fixedMonthly == null ? null : base.fixedMonthly + extraFixed;
  const card = revenue != null && patch.cardPercent != null ? revenue * (patch.cardPercent / 100) : 0;
  const variable =
    base.variableTotal == null && food == null
      ? null
      : (base.variableTotal ?? 0) - (base.foodCost ?? 0) + (food ?? 0) + card + (base.revenue != null && patch.sellingLift ? 0 : 0);
  const adjustedRevenue = revenue == null ? null : revenue * (1 + (patch.sellingLift ?? 0));
  const contribution = adjustedRevenue != null && variable != null ? adjustedRevenue - variable : null;
  const ratio = contribution != null && adjustedRevenue && adjustedRevenue > 0 ? contribution / adjustedRevenue : null;
  const breakEvenMonthly = fixed != null && ratio != null && ratio > 0 ? fixed / ratio : null;
  const aov = patch.averageOrderValue ?? base.averageOrderValue;
  return {
    ...base,
    operatingDays: days,
    revenue: adjustedRevenue,
    foodCost: food,
    fixedMonthly: fixed,
    variableTotal: variable,
    contribution,
    contributionRatio: ratio,
    breakEvenMonthly,
    breakEvenWeekly: breakEvenMonthly != null ? (breakEvenMonthly * 7) / days : null,
    breakEvenDaily: breakEvenMonthly != null ? breakEvenMonthly / days : null,
    ordersRequiredDaily: breakEvenMonthly != null && aov && aov > 0 ? breakEvenMonthly / days / aov : null,
    averageOrderValue: aov,
    canCompute: breakEvenMonthly != null,
    gap: breakEvenMonthly != null && adjustedRevenue != null ? breakEvenMonthly - adjustedRevenue : null,
    progress:
      breakEvenMonthly != null && adjustedRevenue != null && breakEvenMonthly > 0
        ? Math.min(1, adjustedRevenue / breakEvenMonthly)
        : null,
    achieved: Boolean(breakEvenMonthly != null && adjustedRevenue != null && adjustedRevenue >= breakEvenMonthly),
  };
}

export function snapshotFromResult(monthKey: string, result: BreakEvenResult): Omit<BreakEvenSnapshot, "id" | "createdAt"> {
  return {
    monthKey,
    revenue: result.revenue,
    fixedCosts: result.fixedMonthly,
    variableCosts: result.variableTotal,
    foodCost: result.foodCost,
    contributionMargin: result.contribution,
    breakEvenRevenue: result.breakEvenMonthly,
    actualProfit: result.contribution != null && result.fixedMonthly != null ? result.contribution - result.fixedMonthly : null,
    orders: result.orders,
    averageOrderValue: result.averageOrderValue,
  };
}

export function snapshotChange(current?: number | null, previous?: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}
