import { recipeIngredientCost, recipeIngredientCostReport } from "@/lib/costing/calc";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import { recipeForProduct } from "@/lib/costing/model";
import { detectedVatRate } from "@/lib/inventory/vat";
import type { Order } from "@/types";
import type { PosFinanceEntry, PosImport, PosZReport } from "@/lib/inventory/types";
import type {
  BreakEvenCatalogProduct,
  BreakEvenFixedCost,
  BreakEvenMissing,
  BreakEvenMixSource,
  BreakEvenResult,
  BreakEvenSettings,
  BreakEvenSnapshot,
  BreakEvenVariableCost,
  BreakEvenVatBasis,
  BreakEvenVatMode,
  CostFrequency,
  DailyRevenuePoint,
  ProductContribution,
  ProductCostLink,
  VariableAppliesTo,
} from "@/lib/breakeven/types";
import { DEFAULT_BREAK_EVEN_SETTINGS } from "@/lib/breakeven/types";
import { resolveProductCost, type ProductCostContext } from "@/lib/breakeven/product-cost";

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

export function isCardPaymentLabel(label?: string | null): boolean {
  const value = (label ?? "").trim().toLowerCase();
  if (!value) return false;
  return /אשראי|credit|visa|mastercard|master\s*card|\bcard\b|כ\.?\s*א|isracard|\bcal\b|\bmax\b/.test(value);
}

export function inferredAppliesTo(item: Pick<BreakEvenVariableCost, "appliesTo" | "kind" | "name">): VariableAppliesTo {
  if (item.appliesTo === "card" || item.appliesTo === "all") return item.appliesTo;
  if (item.kind === "percent" && /אשראי|card|credit|סליקה/.test(item.name)) return "card";
  return "all";
}

export function hasApprovedCostRows(costs: Array<{ active: boolean }> | null | undefined): boolean {
  return (costs ?? []).some((item) => item.active);
}

function postedZWindows(reports: PosZReport[] | undefined): { id: string; from: string; to: string }[] {
  return (reports ?? [])
    .filter((report) => report.status === "posted")
    .map((report) => ({
      id: report.id,
      from: (report.periodFrom ?? report.businessDate ?? "").slice(0, 10),
      to: (report.periodTo ?? report.businessDate ?? "").slice(0, 10),
    }))
    .filter((window) => window.from && window.to);
}

function dayCoveredByZ(day: string, windows: { from: string; to: string }[]): boolean {
  return windows.some((window) => day >= window.from && day <= window.to);
}

function zPostedAmount(report: PosZReport): number | null {
  const sales = report.salesIncludingVat ?? report.salesTotal;
  if (sales == null || !Number.isFinite(sales)) return null;
  return sales;
}

function periodsOverlap(aFrom?: string | null, aTo?: string | null, bFrom?: string | null, bTo?: string | null): boolean {
  const leftFrom = aFrom ?? aTo;
  const leftTo = aTo ?? aFrom;
  const rightFrom = bFrom ?? bTo;
  const rightTo = bTo ?? bFrom;
  if (!leftFrom || !leftTo || !rightFrom || !rightTo) return false;
  return leftFrom <= rightTo && rightFrom <= leftTo;
}

export function approvedPeriodSales(input: {
  orders: Order[];
  from: string;
  to: string;
  financeEntries?: PosFinanceEntry[];
  zReports?: PosZReport[];
}): {
  revenue: number | null;
  orders: number | null;
  averageOrderValue: number | null;
  productsSold: number | null;
  cardRevenue: number | null;
  sources: Array<"website" | "z">;
  rows: Order[];
  daily: Map<string, number>;
} {
  const windows = postedZWindows(input.zReports);
  const overlappingWindows = windows.filter((window) => periodsOverlap(window.from, window.to, input.from, input.to));
  const website = salesInRange(input.orders, input.from, input.to);
  const websiteRows = website.rows.filter((order) => !dayCoveredByZ(orderBusinessDate(order), overlappingWindows));
  const websiteRevenue = websiteRows.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const websiteOrders = websiteRows.length;
  const websiteProducts = websiteRows.reduce(
    (sum, order) => sum + order.items.reduce((inner, item) => inner + (Number(item.quantity) || 0), 0),
    0
  );
  const websiteCard = websiteRows
    .filter((order) => isCardPaymentLabel(order.paymentMethod))
    .reduce((sum, order) => sum + (Number(order.total) || 0), 0);

  const entries = (input.financeEntries ?? []).filter((entry) => {
    const day = (entry.businessDate ?? "").slice(0, 10);
    return day >= input.from && day <= input.to;
  });
  const entryReportIds = new Set(entries.map((entry) => entry.zReportId));
  const orphanReports = (input.zReports ?? []).filter(
    (report) =>
      report.status === "posted" &&
      !entryReportIds.has(report.id) &&
      periodsOverlap(report.periodFrom ?? report.businessDate, report.periodTo ?? report.businessDate, input.from, input.to)
  );

  const zFromEntries = entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const zFromOrphans = orphanReports.reduce((sum, report) => sum + (zPostedAmount(report) ?? 0), 0);
  const zRevenue = zFromEntries + zFromOrphans;

  const zPayments = [
    ...entries.flatMap((entry) => entry.payments ?? []),
    ...orphanReports.flatMap((report) => report.payments ?? []),
  ];
  const zHasBreakdown = entries.every((entry) => (entry.payments ?? []).length > 0) && orphanReports.every((report) => (report.payments ?? []).length > 0);
  const zCard = zPayments
    .filter((payment) => isCardPaymentLabel(payment.sourceLabel || payment.method))
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

  const daily = new Map<string, number>();
  for (const order of websiteRows) {
    const day = orderBusinessDate(order);
    daily.set(day, (daily.get(day) ?? 0) + (Number(order.total) || 0));
  }
  for (const entry of entries) {
    const day = entry.businessDate.slice(0, 10);
    daily.set(day, (daily.get(day) ?? 0) + (Number(entry.amount) || 0));
  }
  for (const report of orphanReports) {
    const day = (report.businessDate ?? report.periodFrom ?? "").slice(0, 10);
    const amount = zPostedAmount(report) ?? 0;
    if (day) daily.set(day, (daily.get(day) ?? 0) + amount);
  }

  const sources: Array<"website" | "z"> = [];
  if (websiteOrders > 0) sources.push("website");
  if (zRevenue > 0) sources.push("z");

  const revenue = sources.length ? websiteRevenue + zRevenue : null;
  const websiteMethodsKnown = websiteRows.every((order) => Boolean(order.paymentMethod));
  const cardKnown = zRevenue > 0 ? zHasBreakdown : websiteRows.length === 0 || websiteMethodsKnown;
  const cardRevenue = cardKnown ? websiteCard + (zRevenue > 0 ? zCard : 0) : null;

  return {
    revenue,
    orders: websiteOrders || null,
    averageOrderValue: websiteOrders > 0 ? websiteRevenue / websiteOrders : null,
    productsSold: websiteProducts || null,
    cardRevenue: revenue == null ? null : cardRevenue,
    sources,
    rows: websiteRows,
    daily,
  };
}

export function mixFromApprovedExcel(
  imports: PosImport[] | undefined,
  from: string,
  to: string
): { productId: string; quantity: number }[] {
  const qty = new Map<string, number>();
  for (const item of imports ?? []) {
    if (item.kind && item.kind !== "excel-info") continue;
    if (item.status !== "approved") continue;
    const periodFrom = (item.periodFrom ?? item.sourcePeriodFrom ?? item.period ?? "").slice(0, 10);
    const periodTo = (item.periodTo ?? item.sourcePeriodTo ?? item.period ?? "").slice(0, 10);
    if (periodFrom && periodTo && !periodsOverlap(periodFrom, periodTo, from, to)) continue;
    for (const line of item.lines ?? []) {
      if (line.excluded || !line.menuProductId || !(Number(line.quantity) > 0)) continue;
      qty.set(line.menuProductId, (qty.get(line.menuProductId) ?? 0) + Number(line.quantity));
    }
  }
  return [...qty.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export function mixFromOrders(orders: Order[]): { productId: string; quantity: number }[] {
  const qty = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items ?? []) {
      if (!item.productId || !(Number(item.quantity) > 0)) continue;
      qty.set(item.productId, (qty.get(item.productId) ?? 0) + Number(item.quantity));
    }
  }
  return [...qty.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function mergeMix(
  ...lists: { productId: string; quantity: number }[][]
): { productId: string; quantity: number }[] {
  const qty = new Map<string, number>();
  for (const list of lists) {
    for (const row of list) {
      qty.set(row.productId, (qty.get(row.productId) ?? 0) + row.quantity);
    }
  }
  return [...qty.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export function weightedContributionRatio(
  mix: { productId: string; quantity: number }[],
  products: BreakEvenCatalogProduct[],
  recipes: DishRecipe[],
  ingredients: CostingIngredient[],
  context?: ProductCostContext
): { ratio: number | null; coveredQty: number; totalQty: number; missingCostQty: number } {
  const catalog = new Map(products.map((item) => [item.id, item]));
  let contribution = 0;
  let revenue = 0;
  let coveredQty = 0;
  let totalQty = 0;
  let missingCostQty = 0;
  for (const row of mix) {
    totalQty += row.quantity;
    const product = catalog.get(row.productId);
    if (!product || !(product.price > 0)) continue;
    const cm = productContribution(product.id, product.name, product.price, recipes, ingredients, context);
    if (cm.costMissing || cm.contribution == null) {
      missingCostQty += row.quantity;
      continue;
    }
    contribution += cm.contribution * row.quantity;
    revenue += product.price * row.quantity;
    coveredQty += row.quantity;
  }
  return {
    ratio: revenue > 0 ? contribution / revenue : null,
    coveredQty,
    totalQty,
    missingCostQty,
  };
}

export function estimateContributionRatio(
  products: BreakEvenCatalogProduct[],
  recipes: DishRecipe[],
  ingredients: CostingIngredient[],
  context?: ProductCostContext
): { ratio: number | null; dishCount: number } {
  const rows = products
    .map((product) => productContribution(product.id, product.name, product.price, recipes, ingredients, context))
    .filter((row) => !row.costMissing && row.contributionRatio != null && row.sellingPrice > 0);
  if (!rows.length) return { ratio: null, dishCount: 0 };
  const ratio = rows.reduce((sum, row) => sum + (row.contributionRatio ?? 0), 0) / rows.length;
  return { ratio, dishCount: rows.length };
}

export function dailyRevenueSeries(orders: Order[], from: string, to: string): DailyRevenuePoint[] {
  const map = new Map<string, number>();
  for (const order of salesInRange(orders, from, to).rows) {
    const day = orderBusinessDate(order);
    map.set(day, (map.get(day) ?? 0) + (Number(order.total) || 0));
  }
  return seriesFromDailyMap(map, from, to);
}

function seriesFromDailyMap(map: Map<string, number>, from: string, to: string): DailyRevenuePoint[] {
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
  ingredients: CostingIngredient[],
  context?: ProductCostContext
): number | null {
  const lookup = new Map(ingredients.map((item) => [item.id, item]));
  let total = 0;
  let used = false;
  for (const order of orders) {
    for (const item of order.items) {
      const resolved = resolveProductCost({
        productId: item.productId,
        name: item.productName,
        sellingPrice: Number(item.price) || 0,
        recipes,
        ingredients,
        context,
      });
      if (!resolved.costMissing && resolved.foodCost != null) {
        used = true;
        total += resolved.foodCost * (Number(item.quantity) || 0);
        continue;
      }
      const recipe = recipeForProduct(recipes, item.productId);
      if (!recipe) continue;
      const report = recipeIngredientCostReport(recipe.ingredients, lookup);
      if (report.missingIds.length || report.total == null) continue;
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
  ingredients: CostingIngredient[],
  context?: ProductCostContext
): ProductContribution {
  return resolveProductCost({ productId, name, sellingPrice, recipes, ingredients, context });
}

export function fixedMonthlyTotal(
  costs: BreakEvenFixedCost[],
  settings: BreakEvenSettings
): number | null {
  const active = (costs ?? []).filter((item) => item.active);
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
  orders: number | null,
  extras?: { productsSold?: number | null; cardRevenue?: number | null }
): { total: number | null; skippedCardFee: boolean } {
  const active = (costs ?? []).filter((item) => item.active);
  if (!active.length) return { total: null, skippedCardFee: false };
  let skippedCardFee = false;
  let applied = 0;
  let used = false;
  for (const item of active) {
    if (!(item.amount > 0) && item.amount !== 0) continue;
    const appliesTo = inferredAppliesTo(item);
    let raw: number | null = 0;
    if (item.kind === "percent") {
      const base = appliesTo === "card" ? extras?.cardRevenue : revenue;
      if (appliesTo === "card" && extras?.cardRevenue == null) {
        skippedCardFee = true;
        raw = null;
      } else {
        raw = (base ?? 0) * (item.amount > 1 ? item.amount / 100 : item.amount);
      }
    } else if (item.kind === "per_order") {
      raw = (orders ?? 0) * item.amount;
    } else if (item.kind === "per_dish") {
      raw = (extras?.productsSold ?? 0) * item.amount;
    } else {
      raw = monthlyEquivalent(item.amount, item.frequency ?? "monthly", settings.operatingDays);
    }
    if (raw == null) continue;
    used = true;
    applied += amountOnVatBasis(raw, item.vatMode, settings.vatBasis, item.vatRate ?? settings.vatRate);
  }
  if (!used && skippedCardFee) return { total: null, skippedCardFee: true };
  return { total: used || active.some((item) => item.amount === 0) ? applied : null, skippedCardFee };
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
  products?: BreakEvenCatalogProduct[];
  financeEntries?: PosFinanceEntry[];
  zReports?: PosZReport[];
  posImports?: PosImport[];
  costLinks?: ProductCostLink[];
  from: string;
  to: string;
  now?: Date;
}): BreakEvenResult {
  const settings = { ...DEFAULT_BREAK_EVEN_SETTINGS, ...input.settings };
  const products = input.products ?? [];
  const costContext: ProductCostContext = {
    products,
    links: input.costLinks,
    posImports: input.posImports,
  };
  const periodSales = approvedPeriodSales({
    orders: input.orders,
    from: input.from,
    to: input.to,
    financeEntries: input.financeEntries,
    zReports: input.zReports,
  });
  const revenue =
    periodSales.revenue == null ? null : salesOnVatBasis(periodSales.revenue, settings.vatBasis, settings.vatRate);
  const cardRevenue =
    periodSales.cardRevenue == null ? null : salesOnVatBasis(periodSales.cardRevenue, settings.vatBasis, settings.vatRate);
  const sales = {
    ...periodSales,
    revenue,
    cardRevenue,
    averageOrderValue:
      periodSales.orders && periodSales.orders > 0 && revenue != null
        ? revenue * ((periodSales.averageOrderValue ?? 0) / (periodSales.revenue || 1))
        : periodSales.averageOrderValue,
  };

  const food = foodCostFromSales(sales.rows, input.recipes, input.ingredients, costContext);
  const fixed = fixedMonthlyTotal(input.fixed, settings);
  const variablePart = variableTotalForRevenue(input.variable, settings, sales.revenue, sales.orders, {
    productsSold: sales.productsSold,
    cardRevenue: sales.cardRevenue,
  });
  const variableBase = variablePart.total;
  const variable =
    variableBase == null && food == null ? null : (variableBase ?? 0) + (food ?? 0);

  const mix = mergeMix(mixFromOrders(sales.rows), mixFromApprovedExcel(input.posImports, input.from, input.to));
  const weighted = weightedContributionRatio(mix, products, input.recipes, input.ingredients, costContext);
  const estimate = estimateContributionRatio(products, input.recipes, input.ingredients, costContext);
  const actualRatio =
    sales.revenue != null && sales.revenue > 0 && variable != null ? (sales.revenue - variable) / sales.revenue : null;

  let mixSource: BreakEvenMixSource = "none";
  let contributionRatio: number | null = null;
  const mixAssumptions: string[] = [];
  if (weighted.ratio != null && weighted.coveredQty > 0) {
    mixSource = "approved";
    contributionRatio = weighted.ratio;
    if (weighted.coveredQty < weighted.totalQty || weighted.missingCostQty > 0) mixAssumptions.push("partialMixCosts");
  } else if (actualRatio != null) {
    mixSource = "actual";
    contributionRatio = actualRatio;
  } else if (estimate.ratio != null) {
    mixSource = "estimate";
    contributionRatio = estimate.ratio;
    mixAssumptions.push("equalDishWeight");
    mixAssumptions.push("knownCostDishesOnly");
  }

  const missing: BreakEvenMissing[] = [];
  if (fixed == null) missing.push("fixed");
  if (variableBase == null && food == null) missing.push("variable");
  if (sales.revenue == null) missing.push("sales");
  if (mixSource === "none" || mixSource === "estimate") missing.push("mix");
  if (contributionRatio != null && contributionRatio <= 0) missing.push("margin");

  const breakEvenMonthly =
    fixed != null && contributionRatio != null && contributionRatio > 0 ? fixed / contributionRatio : null;
  const days = Math.max(1, settings.operatingDays);
  const elapsed = operatingElapsed(input.from, input.to, days, input.now);
  const remaining = Math.max(0, days - elapsed);
  const daily = seriesFromDailyMap(periodSales.daily, input.from, input.to).map((point, index, all) => {
    const dayRevenue = salesOnVatBasis(point.revenue, settings.vatBasis, settings.vatRate);
    const cumulative = all
      .slice(0, index + 1)
      .reduce((sum, item) => sum + salesOnVatBasis(item.revenue, settings.vatBasis, settings.vatRate), 0);
    return { ...point, revenue: dayRevenue, cumulative };
  });
  const crossed = daily.find((point) => breakEvenMonthly != null && point.cumulative >= breakEvenMonthly);
  const dailyAverage = sales.revenue != null && elapsed > 0 ? sales.revenue / elapsed : null;
  const forecast = dailyAverage != null ? dailyAverage * days : null;
  const gap = breakEvenMonthly != null && sales.revenue != null ? breakEvenMonthly - sales.revenue : null;
  const canCompute = breakEvenMonthly != null;
  const contribution = sales.revenue != null && variable != null ? sales.revenue - variable : null;

  const alerts: string[] = [];
  if (canCompute && gap != null && gap <= 0) alerts.push("achieved");
  else if (canCompute && remaining <= 7 && (gap ?? 0) > settings.alertGap) alerts.push("weekLeft");
  if (canCompute && remaining > 0 && (gap ?? 0) > 0) alerts.push("requiredDaily");

  return {
    canCompute,
    missing: [...new Set(missing)],
    vatBasis: settings.vatBasis,
    operatingDays: days,
    elapsedDays: elapsed,
    remainingDays: remaining,
    revenue: sales.revenue,
    orders: sales.orders,
    averageOrderValue: sales.averageOrderValue,
    productsSold: sales.productsSold,
    cardRevenue: sales.cardRevenue,
    salesSources: sales.sources,
    fixedMonthly: fixed,
    variableTotal: variable,
    foodCost: food,
    contribution,
    contributionRatio,
    mixSource,
    mixAssumptions,
    mixCostIncomplete: weighted.missingCostQty > 0,
    cardFeeSkipped: variablePart.skippedCardFee,
    hasApprovedZeroFixed: hasApprovedCostRows(input.fixed) && (fixed ?? 0) === 0,
    hasApprovedZeroVariable: hasApprovedCostRows(input.variable) && (variableBase ?? 0) === 0,
    breakEvenMonthly,
    breakEvenWeekly: breakEvenMonthly != null ? (breakEvenMonthly * 7) / days : null,
    breakEvenDaily: breakEvenMonthly != null ? breakEvenMonthly / days : null,
    ordersRequiredDaily:
      breakEvenMonthly != null && sales.averageOrderValue && sales.averageOrderValue > 0 && mixSource !== "estimate"
        ? breakEvenMonthly / days / sales.averageOrderValue
        : null,
    gap,
    progress:
      breakEvenMonthly != null && sales.revenue != null && breakEvenMonthly > 0
        ? sales.revenue / breakEvenMonthly
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
  const cardBase = base.cardRevenue ?? null;
  const card =
    patch.cardPercent != null && cardBase != null ? cardBase * (patch.cardPercent / 100) : 0;
  const variable =
    base.variableTotal == null && food == null
      ? null
      : (base.variableTotal ?? 0) - (base.foodCost ?? 0) + (food ?? 0) + card;
  const adjustedRevenue = revenue == null ? null : revenue * (1 + (patch.sellingLift ?? 0));
  const contribution = adjustedRevenue != null && variable != null ? adjustedRevenue - variable : null;
  const ratio =
    contribution != null && adjustedRevenue && adjustedRevenue > 0
      ? contribution / adjustedRevenue
      : base.contributionRatio != null && patch.sellingLift
        ? (base.contributionRatio + patch.sellingLift) / (1 + patch.sellingLift)
        : base.contributionRatio;
  const breakEvenMonthly = fixed != null && ratio != null && ratio > 0 ? fixed / ratio : null;
  const aov = patch.averageOrderValue ?? base.averageOrderValue;
  const gap = breakEvenMonthly != null && adjustedRevenue != null ? breakEvenMonthly - adjustedRevenue : null;
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
    gap,
    progress:
      breakEvenMonthly != null && adjustedRevenue != null && breakEvenMonthly > 0
        ? adjustedRevenue / breakEvenMonthly
        : null,
    aboveBreakEven: gap != null && gap < 0 ? Math.abs(gap) : null,
    achieved: Boolean(breakEvenMonthly != null && adjustedRevenue != null && adjustedRevenue >= breakEvenMonthly),
    cardFeeSkipped: Boolean(patch.cardPercent && cardBase == null),
  };
}

export function snapshotFromResult(
  monthKey: string,
  result: BreakEvenResult,
  kind: BreakEvenSnapshot["kind"] = "saved"
): Omit<BreakEvenSnapshot, "id" | "createdAt"> {
  return {
    monthKey,
    kind,
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
