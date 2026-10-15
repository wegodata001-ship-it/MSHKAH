export type CostFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type BreakEvenVatMode = "before" | "including" | "exempt";
export type BreakEvenVatBasis = "before" | "including";
export type VariableCostKind = "percent" | "per_order" | "per_dish" | "fixed";
export type VariableAppliesTo = "all" | "card";
export type BreakEvenMixSource = "approved" | "actual" | "estimate" | "none";
export type BreakEvenSnapshotKind = "saved" | "scenario";

export type BreakEvenFixedCost = {
  id: string;
  name: string;
  amount: number;
  frequency: CostFrequency;
  category?: string;
  vatMode: BreakEvenVatMode;
  vatRate?: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BreakEvenVariableCost = {
  id: string;
  name: string;
  kind: VariableCostKind;
  amount: number;
  frequency?: CostFrequency;
  appliesTo?: VariableAppliesTo;
  vatMode: BreakEvenVatMode;
  vatRate?: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BreakEvenSettings = {
  operatingDays: number;
  vatBasis: BreakEvenVatBasis;
  vatRate: number;
  alertGap: number;
  createdAt?: string;
  updatedAt?: string;
};

export type BreakEvenSnapshot = {
  id: string;
  monthKey: string;
  kind?: BreakEvenSnapshotKind;
  revenue: number | null;
  fixedCosts: number | null;
  variableCosts: number | null;
  foodCost: number | null;
  contributionMargin: number | null;
  breakEvenRevenue: number | null;
  actualProfit: number | null;
  orders: number | null;
  averageOrderValue: number | null;
  createdAt: string;
};

export type BreakEvenMissing = "fixed" | "variable" | "sales" | "margin" | "mix";

export type DailyRevenuePoint = {
  date: string;
  revenue: number;
  cumulative: number;
};

export type ProductCostKind = "recipe" | "resale" | "combo" | "estimate";
export type ProductCostBasis = "latest" | "weighted" | "estimate";
export type ProductCostGapCode =
  | "no-link"
  | "missing-purchase-price"
  | "missing-pack-qty"
  | "missing-recipe-qty"
  | "incompatible-units"
  | "partial-recipe";

export type ProductCostGap = {
  code: ProductCostGapCode;
  ingredientId?: string;
  name?: string;
};

export type ProductCostUnused = {
  kind: "recipe" | "ingredient" | "purchase" | "pos-cost";
  id: string;
  name: string;
  detail?: string;
};

export type ProductCostLink = {
  id: string;
  productId: string;
  kind: ProductCostKind;
  recipeId?: string;
  ingredientId?: string;
  packQuantity?: number | null;
  packUnit?: import("@/lib/costing/types").PurchaseUnit;
  estimateAmount?: number | null;
  estimateNote?: string;
  estimateAt?: string;
  updatedAt: string;
};

export type ProductContribution = {
  productId: string;
  name: string;
  sellingPrice: number;
  foodCost: number | null;
  extraVariable: number | null;
  contribution: number | null;
  contributionRatio: number | null;
  costMissing: boolean;
  costKind?: ProductCostKind | null;
  costBasis?: ProductCostBasis | null;
  costGaps?: ProductCostGap[];
  unusedExisting?: ProductCostUnused[];
  posCost?: number | null;
  posProfit?: number | null;
};

export type BreakEvenCatalogProduct = {
  id: string;
  name: string;
  price: number;
};

export type BreakEvenResult = {
  canCompute: boolean;
  missing: BreakEvenMissing[];
  vatBasis: BreakEvenVatBasis;
  operatingDays: number;
  elapsedDays: number;
  remainingDays: number;
  revenue: number | null;
  orders: number | null;
  averageOrderValue: number | null;
  productsSold: number | null;
  cardRevenue: number | null;
  salesSources: Array<"website" | "z">;
  fixedMonthly: number | null;
  variableTotal: number | null;
  foodCost: number | null;
  contribution: number | null;
  contributionRatio: number | null;
  mixSource: BreakEvenMixSource;
  mixAssumptions: string[];
  mixCostIncomplete: boolean;
  cardFeeSkipped: boolean;
  hasApprovedZeroFixed: boolean;
  hasApprovedZeroVariable: boolean;
  breakEvenMonthly: number | null;
  breakEvenWeekly: number | null;
  breakEvenDaily: number | null;
  ordersRequiredDaily: number | null;
  gap: number | null;
  progress: number | null;
  aboveBreakEven: number | null;
  achieved: boolean;
  dailyAverage: number | null;
  forecast: number | null;
  forecastGap: number | null;
  requiredDailyFromNow: number | null;
  crossedOn: string | null;
  daily: DailyRevenuePoint[];
  alerts: string[];
};

export const DEFAULT_BREAK_EVEN_SETTINGS: BreakEvenSettings = {
  operatingDays: 26,
  vatBasis: "before",
  vatRate: 0.18,
  alertGap: 500,
};

export const FIXED_COST_PRESETS = [
  "rent",
  "arnona",
  "electric",
  "water",
  "internet",
  "software",
  "insurance",
  "accounting",
  "salaries",
  "maintenance",
  "licenses",
  "marketing",
  "loans",
  "other",
] as const;

export const VARIABLE_COST_PRESETS = [
  "cardPercent",
  "clearingFee",
  "delivery",
  "packaging",
  "bags",
  "cups",
  "napkins",
  "platform",
  "other",
] as const;
