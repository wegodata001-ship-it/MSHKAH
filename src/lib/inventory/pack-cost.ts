import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";
import { baseUnitFor, isPackUnit, purchaseQuantityInBase } from "@/lib/costing/units";

export type PackSpec = {
  contentCount: number;
  contentUnit: PurchaseUnit;
};

export type PackFactor =
  | { ok: true; factor: number; base: BaseUnit }
  | { ok: false; reason: "invalid" | "nested-pack" | "incompatible" };

/** Base units inside one pack. A carton of 12 liters is 12000 ml, not 12 grams. */
export function packFactor(spec: PackSpec, expectedBase?: BaseUnit | null): PackFactor {
  if (!Number.isFinite(spec.contentCount) || spec.contentCount <= 0) return { ok: false, reason: "invalid" };
  if (isPackUnit(spec.contentUnit)) return { ok: false, reason: "nested-pack" };
  const base = baseUnitFor(spec.contentUnit);
  if (expectedBase && expectedBase !== base) return { ok: false, reason: "incompatible" };
  const factor = purchaseQuantityInBase(spec.contentCount, spec.contentUnit);
  if (factor <= 0) return { ok: false, reason: "invalid" };
  return { ok: true, factor, base };
}

export function costPerBaseFromPack(input: {
  lineTotal: number;
  quantity: number;
  contentCount: number;
  contentUnit: PurchaseUnit;
  expectedBase?: BaseUnit | null;
}): { ok: true; cost: number; base: BaseUnit; factor: number } | { ok: false; reason: PackFactor extends { ok: false; reason: infer R } ? R : string } {
  const packed = packFactor(
    { contentCount: input.contentCount, contentUnit: input.contentUnit },
    input.expectedBase
  );
  if (!packed.ok) return packed;
  if (!Number.isFinite(input.lineTotal) || input.lineTotal < 0) return { ok: false, reason: "invalid" };
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return { ok: false, reason: "invalid" };
  const totalBase = input.quantity * packed.factor;
  if (totalBase <= 0) return { ok: false, reason: "invalid" };
  return { ok: true, cost: input.lineTotal / totalBase, base: packed.base, factor: packed.factor };
}

export const SUGGESTED_INGREDIENT_CATEGORIES = [
  "מוצרי חלב",
  "ירקות ופירות",
  "בשר ועופות",
  "מאפים ולחמים",
  "קפה ותה",
  "משקאות",
  "סירופים ורטבים",
  "חומרי גלם לבישול",
  "מוצרים קפואים",
  "אריזות וחד־פעמי",
  "חומרי ניקוי",
  "ציוד ואביזרים",
  "אחר",
] as const;

export function pendingCategorySuggestions(existingNames: string[], normalize: (value: string) => string): string[] {
  const known = new Set(existingNames.map((name) => normalize(name)).filter(Boolean));
  return SUGGESTED_INGREDIENT_CATEGORIES.filter((name) => !known.has(normalize(name)));
}
