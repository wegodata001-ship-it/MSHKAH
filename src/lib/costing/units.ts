import type { BaseUnit, PackUnit, PurchaseUnit } from "@/lib/costing/types";

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

export function baseUnitFor(purchaseUnit: PurchaseUnit): BaseUnit {
  return UNIT_TO_BASE[purchaseUnit].base;
}

export function purchaseQuantityInBase(
  purchaseQuantity: number,
  purchaseUnit: PurchaseUnit
): number {
  if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) return 0;
  const factor = UNIT_TO_BASE[purchaseUnit]?.factor ?? 0;
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
  const baseUnit = baseUnitFor(purchaseUnit);
  return {
    purchaseUnitCost: costPerPurchaseUnit(purchasePrice, purchaseQuantity),
    purchaseUnit,
    baseUnitCost: costPerBaseUnit(purchasePrice, purchaseQuantity, purchaseUnit),
    baseUnit,
    showBase: purchaseUnit !== baseUnit,
  };
}

export function asPurchaseUnit(unit: string | undefined): PurchaseUnit {
  return PURCHASE_UNITS.includes(unit as PurchaseUnit) ? (unit as PurchaseUnit) : "g";
}

export function defaultRecipeUnit(purchaseUnit: PurchaseUnit): PurchaseUnit {
  const base = baseUnitFor(purchaseUnit);
  if (base === "g") return "g";
  if (base === "ml") return "ml";
  return "unit";
}

export function compatibleRecipeUnits(unit: PurchaseUnit | BaseUnit): PurchaseUnit[] {
  const base = UNIT_TO_BASE[asPurchaseUnit(unit)].base;
  if (base === "g") return ["g", "kg"];
  if (base === "ml") return ["ml", "liter"];
  return ["unit"];
}

export function unitsCompatible(from: PurchaseUnit, to: PurchaseUnit): boolean {
  return UNIT_TO_BASE[from].base === UNIT_TO_BASE[to].base;
}

export function convertRecipeQuantity(
  quantity: number,
  from: PurchaseUnit,
  to: PurchaseUnit
): number {
  if (!unitsCompatible(from, to)) return quantity;
  const baseQty = purchaseQuantityInBase(quantity, from);
  const factor = UNIT_TO_BASE[to].factor;
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
