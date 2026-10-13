import type { CostingIngredient, DishRecipe, PurchaseUnit } from "@/lib/costing/types";
import { asPurchaseUnit, purchaseQuantityInBase, unitsCompatible } from "@/lib/costing/units";
import { currentStockBase } from "@/lib/inventory/stock";
import type { InventoryIssueReason, InventoryMovement } from "@/lib/inventory/types";

export type IssueDraftLine = {
  key: string;
  productId: string;
  quantity: number | null;
  unit: PurchaseUnit;
};

export type IssueValidationError = "empty" | "zeroQty" | "badUnit" | "overStock" | "duplicateLine";

export type ValidatedIssueLine = {
  productId: string;
  quantity: number;
  unit: PurchaseUnit;
  quantityBase: number;
  quantityBefore: number;
  quantityAfter: number;
};

export function stockInDisplayUnit(
  quantityBase: number,
  ingredient: Pick<CostingIngredient, "baseUnit" | "purchaseUnit">
): number {
  const display = ingredient.purchaseUnit;
  if (!unitsCompatible(ingredient.baseUnit, display)) return quantityBase;
  const factor = purchaseQuantityInBase(1, display);
  return factor > 0 ? quantityBase / factor : quantityBase;
}

export function validateIssueLines(
  lines: IssueDraftLine[],
  ingredients: CostingIngredient[],
  movements: InventoryMovement[]
): { ok: true; lines: ValidatedIssueLine[] } | { ok: false; error: IssueValidationError; productId?: string } {
  const usable = lines.filter((line) => line.productId);
  if (!usable.length) return { ok: false, error: "empty" };
  const seen = new Set<string>();
  const validated: ValidatedIssueLine[] = [];
  const reserved = new Map<string, number>();
  for (const line of usable) {
    if (seen.has(line.productId)) return { ok: false, error: "duplicateLine", productId: line.productId };
    seen.add(line.productId);
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "zeroQty", productId: line.productId };
    const ingredient = ingredients.find((item) => item.id === line.productId);
    if (!ingredient || !unitsCompatible(line.unit, ingredient.baseUnit)) {
      return { ok: false, error: "badUnit", productId: line.productId };
    }
    const quantityBase = purchaseQuantityInBase(qty, line.unit);
    if (quantityBase <= 0) return { ok: false, error: "zeroQty", productId: line.productId };
    const before = currentStockBase(movements, line.productId) - (reserved.get(line.productId) ?? 0);
    if (quantityBase - before > 0.0001) return { ok: false, error: "overStock", productId: line.productId };
    reserved.set(line.productId, (reserved.get(line.productId) ?? 0) + quantityBase);
    validated.push({
      productId: line.productId,
      quantity: qty,
      unit: line.unit,
      quantityBase,
      quantityBefore: before,
      quantityAfter: before - quantityBase,
    });
  }
  return { ok: true, lines: validated };
}

export function recipeIssueDraft(
  recipe: DishRecipe,
  portions: number,
  _ingredients: CostingIngredient[] = []
): IssueDraftLine[] {
  const count = Number(portions);
  if (!Number.isFinite(count) || count <= 0) return [];
  return recipe.ingredients
    .filter((line) => line.ingredientId && line.quantity > 0)
    .map((line) => {
      const unit = asPurchaseUnit(line.unit);
      const raw = line.quantity * count;
      const readable = raw >= 1000 && unit === "g" ? { quantity: raw / 1000, unit: "kg" as const } : raw >= 1000 && unit === "ml" ? { quantity: raw / 1000, unit: "liter" as const } : { quantity: raw, unit };
      return {
        key: `recipe-${line.ingredientId}`,
        productId: line.ingredientId,
        quantity: readable.quantity,
        unit: readable.unit,
      };
    });
}

export function movementAlreadyReversed(movements: InventoryMovement[], movementId: string): boolean {
  return movements.some((row) => row.reversesId === movementId);
}

export function canReverseMovement(movement: InventoryMovement, movements: InventoryMovement[]): boolean {
  if (movement.type === "REVERSAL") return false;
  return !movementAlreadyReversed(movements, movement.id);
}

export const ISSUE_REASONS: InventoryIssueReason[] = ["kitchen", "waste", "return", "recipe", "other"];
