export type CostFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type BreakEvenVatMode = "before" | "including" | "exempt";
export type BreakEvenVatBasis = "before" | "including";
export type VariableCostKind = "percent" | "per_order" | "fixed";

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

export type BreakEvenMissing = "fixed" | "variable" | "sales" | "margin";

export type DailyRevenuePoint = {
  date: string;
  revenue: number;
  cumulative: number;
};

export type ProductContribution = {
  productId: string;
  name: string;
  sellingPrice: number;
  foodCost: number;
  extraVariable: number;
  contribution: number;
  contributionRatio: number | null;
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
  fixedMonthly: number | null;
  variableTotal: number | null;
  foodCost: number | null;
  contribution: number | null;
  contributionRatio: number | null;
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
