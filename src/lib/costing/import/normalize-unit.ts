import { asPurchaseUnit, unitsCompatible } from "@/lib/costing/units";
import type { PurchaseUnit } from "@/lib/costing/types";

const UNIT_ALIASES: Record<string, PurchaseUnit> = {
  kg: "kg",
  kilo: "kg",
  kilogram: "kg",
  kilograms: "kg",
  كيلو: "kg",
  كغم: "kg",
  كغ: "kg",
  קג: "kg",
  "ק״ג": "kg",
  "ק\"ג": "kg",
  g: "g",
  gram: "g",
  grams: "g",
  gr: "g",
  جرام: "g",
  غرام: "g",
  غ: "g",
  גרם: "g",
  liter: "liter",
  litre: "liter",
  liters: "liter",
  l: "liter",
  lt: "liter",
  لتر: "liter",
  ليتر: "liter",
  ליטר: "liter",
  ml: "ml",
  milliliter: "ml",
  millilitre: "ml",
  مل: "ml",
  "מ״ל": "ml",
  "מ\"ל": "ml",
  unit: "unit",
  units: "unit",
  piece: "unit",
  pieces: "unit",
  pcs: "unit",
  pc: "unit",
  ea: "unit",
  each: "unit",
  وحدة: "unit",
  وحدةة: "unit",
  قطعة: "unit",
  حبة: "unit",
  יח: "unit",
  "יח׳": "unit",
  יחידה: "unit",
};

export function normalizeImportUnit(raw: string | null | undefined): PurchaseUnit | null {
  if (!raw) return null;
  const key = raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[.\s]+/g, "");
  if (!key) return null;
  return UNIT_ALIASES[key] ?? (["kg", "g", "liter", "ml", "unit"].includes(key) ? asPurchaseUnit(key) : null);
}

export function recipeUnitsCompatible(
  recipeUnit: PurchaseUnit | null,
  purchaseUnit: PurchaseUnit | null
): boolean {
  if (!recipeUnit || !purchaseUnit) return true;
  return unitsCompatible(recipeUnit, purchaseUnit);
}
