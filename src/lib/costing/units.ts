import type { BaseUnit, PackUnit, PurchaseUnit } from "@/lib/costing/types";
import { findMeasureUnit, getMeasureUnitCatalog } from "@/lib/inventory/measure-units";

export const MEASURE_UNITS: PurchaseUnit[] = ["kg", "g", "liter", "ml", "unit"];
export const PACK_UNITS: PackUnit[] = ["pack", "carton", "bottle", "bag", "bundle", "tray"];
export const LINE_UNITS: PurchaseUnit[] = [...MEASURE_UNITS, "bucket", ...PACK_UNITS];
export const PURCHASE_UNITS: PurchaseUnit[] = LINE_UNITS;

const UNIT_TO_BASE: Record<PurchaseUnit, { base: BaseUnit; factor: number }> = {
  kg: { base: "g", factor: 1000 },
  g: { base: "g", factor: 1 },
  liter: { base: "ml", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  unit: { base: "unit", factor: 1 },
  bucket: { base: "unit", factor: 1 },
  pack: { base: "unit", factor: 0 },
  carton: { base: "unit", factor: 0 },
  bottle: { base: "unit", factor: 0 },
  bag: { base: "unit", factor: 0 },
  bundle: { base: "unit", factor: 0 },
  tray: { base: "unit", factor: 0 },
};

export function isPackUnit(unit: string | null | undefined): unit is PackUnit {
  return PACK_UNITS.includes(unit as PackUnit);
}

export function resolveUnitFactor(unit: string | null | undefined): { base: BaseUnit; factor: number } | null {
  if (!unit) return null;
  const known = UNIT_TO_BASE[unit as keyof typeof UNIT_TO_BASE];
  if (known) return known.factor > 0 ? known : null;
  const custom = getMeasureUnitCatalog().find((item) => item.id === unit);
  if (!custom?.baseUnitId || custom.factorToBase == null || custom.factorToBase <= 0) return null;
  return { base: custom.baseUnitId, factor: custom.factorToBase };
}

export function baseUnitFor(purchaseUnit: PurchaseUnit): BaseUnit {
  const known = UNIT_TO_BASE[purchaseUnit as keyof typeof UNIT_TO_BASE];
  if (known) return known.base;
  const resolved = resolveUnitFactor(purchaseUnit);
  if (resolved) return resolved.base;
  const custom = findMeasureUnit(purchaseUnit);
  if (custom?.kind === "weight") return "g";
  if (custom?.kind === "volume") return "ml";
  return "unit";
}

export function purchaseQuantityInBase(
  purchaseQuantity: number,
  purchaseUnit: PurchaseUnit
): number {
  if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) return 0;
  const factor = resolveUnitFactor(purchaseUnit)?.factor ?? 0;
  if (factor <= 0) return 0;
  return purchaseQuantity * factor;
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

export function costPerPurchaseUnit(purchasePrice: number, purchaseQuantity: number): number {
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return 0;
  if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) return 0;
  return purchasePrice / purchaseQuantity;
}

export type LiveCostPreview = {
  purchaseUnitCost: number;
  purchaseUnit: PurchaseUnit;
  baseUnitCost: number;
  baseUnit: BaseUnit;
  showBase: boolean;
};

export function liveCostPreview(
  purchasePrice: number,
  purchaseQuantity: number,
  purchaseUnit: PurchaseUnit
): LiveCostPreview | null {
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return null;
  if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) return null;
  const resolved = resolveUnitFactor(purchaseUnit);
  const baseUnit = resolved?.base ?? baseUnitFor(purchaseUnit);
  return {
    purchaseUnitCost: costPerPurchaseUnit(purchasePrice, purchaseQuantity),
    purchaseUnit,
    baseUnitCost: resolved ? costPerBaseUnit(purchasePrice, purchaseQuantity, purchaseUnit) : 0,
    baseUnit,
    showBase: Boolean(resolved && purchaseUnit !== resolved.base),
  };
}

export function asPurchaseUnit(unit: string | undefined): PurchaseUnit {
  if (!unit || !unit.trim()) return "g";
  if (PURCHASE_UNITS.includes(unit as PurchaseUnit) || findMeasureUnit(unit)) return unit as PurchaseUnit;
  return "g";
}

export function defaultRecipeUnit(purchaseUnit: PurchaseUnit): PurchaseUnit {
  const base = baseUnitFor(purchaseUnit);
  if (base === "g") return "g";
  if (base === "ml") return "ml";
  return "unit";
}

export function compatibleRecipeUnits(unit: PurchaseUnit | BaseUnit): PurchaseUnit[] {
  const current = asPurchaseUnit(unit);
  const source = resolveUnitFactor(current);
  if (!source) return [current];
  const preferred: Record<BaseUnit, PurchaseUnit[]> = {
    g: ["g", "kg"],
    ml: ["ml", "liter"],
    unit: ["unit"],
  };
  const extras = getMeasureUnitCatalog()
    .filter((item) => item.active && resolveUnitFactor(item.id)?.base === source.base && !preferred[source.base].includes(item.id as PurchaseUnit))
    .map((item) => item.id as PurchaseUnit);
  const list = [...preferred[source.base], ...extras];
  if (!list.includes(current)) list.unshift(current);
  return list;
}

export function unitsCompatible(from: string, to: string): boolean {
  if (from === to) return true;
  const left = resolveUnitFactor(from);
  const right = resolveUnitFactor(to);
  if (!left || !right) return false;
  return left.base === right.base;
}

export function convertRecipeQuantity(
  quantity: number,
  from: PurchaseUnit,
  to: PurchaseUnit
): number {
  if (!unitsCompatible(from, to)) return quantity;
  const baseQty = purchaseQuantityInBase(quantity, from);
  const factor = resolveUnitFactor(to)?.factor ?? 0;
  return factor > 0 ? baseQty / factor : quantity;
}

/** Recipe qty may be g or kg (or ml/liter). Convert to base before applying costPerBaseUnit. */
export function lineRecipeCost(
  quantity: number,
  recipeUnit: PurchaseUnit | string | undefined,
  costPerBase: number
): number {
  return lineIngredientCost(purchaseQuantityInBase(quantity, asPurchaseUnit(recipeUnit)), costPerBase);
}
