import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";

export const PURCHASE_UNITS: PurchaseUnit[] = ["kg", "g", "liter", "ml", "unit"];

const UNIT_TO_BASE: Record<PurchaseUnit, { base: BaseUnit; factor: number }> = {
  kg: { base: "g", factor: 1000 },
  g: { base: "g", factor: 1 },
  liter: { base: "ml", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  unit: { base: "unit", factor: 1 },
};

export function baseUnitFor(purchaseUnit: PurchaseUnit): BaseUnit {
  return UNIT_TO_BASE[purchaseUnit].base;
}

export function purchaseQuantityInBase(
  purchaseQuantity: number,
  purchaseUnit: PurchaseUnit
): number {
  if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) return 0;
  return purchaseQuantity * UNIT_TO_BASE[purchaseUnit].factor;
}

/** Price of one base unit (g / ml / unit). */
export function costPerBaseUnit(
  purchasePrice: number,
  purchaseQuantity: number,
  purchaseUnit: PurchaseUnit
): number {
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) return 0;
  const baseQty = purchaseQuantityInBase(purchaseQuantity, purchaseUnit);
  if (baseQty <= 0) return 0;
  return purchasePrice / baseQty;
}

export function lineIngredientCost(quantity: number, unitCost: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) return 0;
  if (!Number.isFinite(unitCost) || unitCost < 0) return 0;
  return quantity * unitCost;
}
