export type MeasureUnit = "kg" | "g" | "liter" | "ml" | "unit";
export type PackUnit = "pack" | "carton" | "bottle" | "bag" | "bundle" | "tray";
export type PurchaseUnit = MeasureUnit | PackUnit | "bucket";
export type BaseUnit = "g" | "ml" | "unit";
export type PriceRoundMode = "none" | "shekel" | "half" | "ninety" | "five";
export type ProfitStatus = "good" | "watch" | "low" | "none";
export type CustomCostType = "fixed" | "percent";

export type IngredientOriginKind = "manual" | "invoice" | "purchase-file" | "other";

export type CostingIngredient = {
  id: string;
  name: string;
  originKind?: IngredientOriginKind;
  category?: string;
  purchasePrice: number;
  purchaseQuantity: number;
  purchaseUnit: PurchaseUnit;
  packCount?: number;
  packContentUnit?: PurchaseUnit;
  categoryId?: string;
  baseUnit: BaseUnit;
  costPerBaseUnit: number;
  supplier?: string;
  notes?: string;
  barcode?: string;
  minStock?: number;
  recommendedStock?: number;
  lastSupplierId?: string;
  lastReceivedAt?: string;
  adminPriceCorrection?: {
    unitPriceExcludingVat: number;
    unitPriceIncludingVat: number | null;
    basis: "including" | "excluding" | "exempt";
    supplierId?: string | null;
    reason: string;
    at: string;
    actor?: string | null;
    invoiceId?: string | null;
  } | null;
  compareGroupId?: string;
  compareGroupName?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RecipeLine = {
  ingredientId: string;
  /** Optional nested dish recipe. Empty ingredientId when this is a sub-recipe. */
  subRecipeId?: string;
  quantity: number;
  /** Recipe quantity unit. Existing rows use base units (g / ml / unit). */
  unit: PurchaseUnit | BaseUnit;
};

export type CustomCost = {
  name: string;
  type: CustomCostType;
  value: number;
};

export type OverheadSettings = {
  packaging?: number;
  labor?: number;
  laborPercent?: number;
  creditCardPercent?: number;
  platformPercent?: number;
  overheadPercent?: number;
  customCosts?: CustomCost[];
};

export type DishRecipe = {
  id: string;
  productId: string;
  variantId?: string;
  ingredients: RecipeLine[];
  yieldPortions?: number;
  overheadSettings?: OverheadSettings;
  targetFoodCostPercent?: number;
  createdAt: string;
  updatedAt: string;
};

export type IngredientPriceHistory = {
  id: string;
  ingredientId: string;
  previousPrice: number;
  newPrice: number;
  previousQuantity: number;
  newQuantity: number;
  changedAt: string;
  changedBy?: string;
};

export type CostingSettings = {
  targetFoodCostPercent: number;
  priceRoundMode: PriceRoundMode;
  vatRate?: number;
  foodCostVatMode?: "before" | "including";
  costBasis?: "latest" | "weighted";
};

export type CostingSnapshot = {
  id: string;
  productId: string;
  variantId?: string;
  ingredientCost: number;
  sellingPrice: number;
  foodCostPercent: number | null;
  createdAt: string;
};

export const DEFAULT_TARGET_FOOD_COST = 30;

export const DEFAULT_COSTING_SETTINGS: CostingSettings = {
  targetFoodCostPercent: DEFAULT_TARGET_FOOD_COST,
  priceRoundMode: "none",
  vatRate: 0.18,
  foodCostVatMode: "before",
  costBasis: "latest",
};
