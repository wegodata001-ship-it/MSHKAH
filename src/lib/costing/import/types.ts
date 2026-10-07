import type { PurchaseUnit } from "@/lib/costing/types";

export type ImportRowStatus =
  | "ready"
  | "review"
  | "missing-qty"
  | "unknown-ingredient"
  | "conflict"
  | "saved"
  | "error";

export type MatchKind = "exact" | "suggest" | "new" | "none";
export type LineChange = "NEW" | "UNCHANGED" | "CHANGED" | "REMOVED";
export type RecipeResolve = "keep" | "compare" | "update";
export type ReviewFilter =
  | "all"
  | "ready"
  | "review"
  | "unknown-ingredient"
  | "missing-qty"
  | "conflict"
  | "saved";

export type ParsedIngredientRow = {
  row: number;
  name: string;
  category: string;
  supplier: string;
  purchasePrice: number | null;
  packageQuantity: number | null;
  purchaseUnitRaw: string;
  purchaseUnit: PurchaseUnit | null;
  errors: string[];
};

export type ParsedRecipeRow = {
  row: number;
  productName: string;
  productId: string;
  menuDescription: string;
  ingredientName: string;
  quantity: number | null;
  unitRaw: string;
  unit: PurchaseUnit | null;
  errors: string[];
};

export type ParsedWorkbook = {
  fileName: string;
  ingredients: ParsedIngredientRow[];
  recipes: ParsedRecipeRow[];
  parseErrors: string[];
};

export type IngredientDraft = {
  key: string;
  name: string;
  category: string;
  supplier: string;
  purchasePrice: number | null;
  packageQuantity: number | null;
  purchaseUnit: PurchaseUnit | null;
  matchId?: string;
  matchName?: string;
  matchKind: MatchKind;
  currentPrice?: number;
  newPrice?: number;
  affectedDishCount: number;
  priceChanged: boolean;
  priceApproved: boolean;
  createApproved: boolean;
  errors: string[];
};

export type RecipeLineDraft = {
  key: string;
  ingredientName: string;
  ingredientId?: string;
  matchName?: string;
  matchKind: MatchKind;
  quantity: number | null;
  unit: PurchaseUnit | null;
  suggested: boolean;
  source: "import" | "menu" | "existing";
  change: LineChange;
  included: boolean;
  errors: string[];
};

export type RecipeDraft = {
  key: string;
  productId?: string;
  productName: string;
  menuDescription: string;
  sellingPrice: number;
  existingRecipeId?: string;
  existingSummary: string[];
  lines: RecipeLineDraft[];
  extras: { name: string; priceDelta: number }[];
  resolve: RecipeResolve | null;
  saved: boolean;
  errors: string[];
};

export type ImportSummary = {
  ingredientCount: number;
  newIngredients: number;
  existingIngredients: number;
  priceUpdates: number;
  dishCount: number;
  readyRecipes: number;
  reviewRecipes: number;
  errorRows: number;
};

export type ImportDraft = {
  fileName: string;
  source: "file" | "menu";
  ingredients: IngredientDraft[];
  recipes: RecipeDraft[];
  summary: ImportSummary;
};

export type CostingImportHistory = {
  id: string;
  fileName: string;
  importedAt: string;
  importedBy?: string;
  rowsProcessed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};
