import { normalizeCategoryName } from "@/lib/inventory/category-name";

export type UnitKind = "weight" | "volume" | "count" | "other";

export type MeasureUnitRecord = {
  id: string;
  nameHe: string;
  abbreviation: string;
  kind: UnitKind;
  baseUnitId: "g" | "ml" | "unit" | null;
  factorToBase: number | null;
  active: boolean;
  builtin: boolean;
  nameNormalized: string;
  createdAt: string;
  updatedAt: string;
};

const SEED_TIME = "2026-01-01T00:00:00.000Z";

function seed(
  id: string,
  nameHe: string,
  abbreviation: string,
  kind: UnitKind,
  baseUnitId: MeasureUnitRecord["baseUnitId"],
  factorToBase: number | null
): MeasureUnitRecord {
  return {
    id,
    nameHe,
    abbreviation,
    kind,
    baseUnitId,
    factorToBase,
    active: true,
    builtin: true,
    nameNormalized: normalizeCategoryName(nameHe),
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  };
}

/** Built-in units keep their existing ids so old invoices and products stay valid. */
export const BUILTIN_MEASURE_UNITS: MeasureUnitRecord[] = [
  seed("kg", "ק״ג", "ק״ג", "weight", "g", 1000),
  seed("g", "גרם", "גרם", "weight", "g", 1),
  seed("liter", "ליטר", "ליטר", "volume", "ml", 1000),
  seed("ml", "מ״ל", "מ״ל", "volume", "ml", 1),
  seed("unit", "יחידה", "יח׳", "count", "unit", 1),
  seed("units", "יחידות", "יח׳", "count", "unit", 1),
  seed("package", "אריזה", "ארז", "count", null, null),
  seed("bundle", "חבילה", "חב׳", "count", null, null),
  seed("carton", "קרטון", "קר׳", "count", null, null),
  seed("pack", "מארז", "מארז", "count", null, null),
  seed("bucket", "דלי", "דלי", "count", "unit", 1),
  seed("bottle", "בקבוק", "בק׳", "count", null, null),
  seed("sack", "שק", "שק", "count", null, null),
  seed("bag", "שקית", "שקית", "count", null, null),
  seed("tray", "מגש", "מגש", "count", null, null),
  seed("box", "קופסה", "קופ׳", "count", null, null),
  seed("roll", "גליל", "גליל", "other", null, null),
  seed("meter", "מטר", "מ׳", "other", null, null),
  seed("dozen", "תריסר", "תריסר", "count", "unit", 12),
];

let activeCatalog: MeasureUnitRecord[] = BUILTIN_MEASURE_UNITS;

export function setMeasureUnitCatalog(units: MeasureUnitRecord[]) {
  activeCatalog = mergeUnitCatalog(units);
}

export function getMeasureUnitCatalog(): MeasureUnitRecord[] {
  return activeCatalog;
}

export function findMeasureUnit(id: string | null | undefined): MeasureUnitRecord | undefined {
  if (!id) return undefined;
  return activeCatalog.find((unit) => unit.id === id);
}

export function measureUnitLabel(id: string | null | undefined): string | null {
  const unit = findMeasureUnit(id);
  if (!unit) return null;
  return unit.abbreviation || unit.nameHe;
}

export function mergeUnitCatalog(stored: MeasureUnitRecord[]): MeasureUnitRecord[] {
  const byId = new Map<string, MeasureUnitRecord>();
  for (const unit of BUILTIN_MEASURE_UNITS) byId.set(unit.id, unit);
  for (const unit of stored) {
    if (!unit?.id) continue;
    const builtin = byId.get(unit.id);
    byId.set(unit.id, builtin ? { ...builtin, ...unit, id: unit.id, builtin: true } : { ...unit, builtin: false });
  }
  return [...byId.values()];
}

export function normalizeUnitName(value: string): string {
  return normalizeCategoryName(value);
}

export function unitSlug(name: string): string {
  const slug = normalizeUnitName(name).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `u-${slug || "unit"}`;
}

export type MeasureUnitInput = {
  id?: string;
  nameHe: string;
  abbreviation: string;
  kind: UnitKind;
  factorToBase?: number | null;
  baseUnitId?: "g" | "ml" | "unit" | null;
};

export type MeasureUnitPlan =
  | { ok: false; code: "VALIDATION" | "DUPLICATE" | "BUILTIN_FACTOR"; existingId?: string }
  | { ok: true; unit: MeasureUnitRecord; reused: boolean };

function baseForKind(kind: UnitKind, requested: MeasureUnitInput["baseUnitId"]): MeasureUnitRecord["baseUnitId"] {
  if (kind === "weight") return "g";
  if (kind === "volume") return "ml";
  if (kind === "count") return "unit";
  if (requested === "g" || requested === "ml" || requested === "unit") return requested;
  return "unit";
}

export function planMeasureUnitSave(existing: MeasureUnitRecord[], input: MeasureUnitInput, now: string): MeasureUnitPlan {
  const nameHe = input.nameHe.trim();
  const abbreviation = input.abbreviation.trim();
  const normalized = normalizeUnitName(nameHe);
  if (!nameHe || !abbreviation || !normalized) return { ok: false, code: "VALIDATION" };
  if (!["weight", "volume", "count", "other"].includes(input.kind)) return { ok: false, code: "VALIDATION" };
  const factor = input.factorToBase == null || input.factorToBase === ("" as unknown) ? null : Number(input.factorToBase);
  if (factor != null && (!Number.isFinite(factor) || factor <= 0)) return { ok: false, code: "VALIDATION" };
  const duplicate = existing.find((unit) => unit.nameNormalized === normalized && unit.id !== input.id);
  if (duplicate && !input.id) return { ok: true, unit: duplicate, reused: true };
  if (duplicate) return { ok: false, code: "DUPLICATE", existingId: duplicate.id };

  const current = input.id ? existing.find((unit) => unit.id === input.id) : undefined;
  if (input.id && !current) return { ok: false, code: "VALIDATION" };
  if (current?.builtin && factor != null && factor !== current.factorToBase) return { ok: false, code: "BUILTIN_FACTOR" };
  const factorToBase = current?.builtin ? current.factorToBase : factor;
  const baseUnitId = factorToBase != null && factorToBase > 0
    ? (current?.builtin ? current.baseUnitId : baseForKind(input.kind, input.baseUnitId))
    : null;
  if (!current?.builtin && factorToBase != null && !baseUnitId) return { ok: false, code: "VALIDATION" };

  let id = current?.id;
  if (!id) {
    id = unitSlug(nameHe);
    let n = 2;
    while (existing.some((unit) => unit.id === id)) id = `${unitSlug(nameHe)}-${n++}`;
  }
  return {
    ok: true,
    reused: false,
    unit: {
      id,
      nameHe,
      abbreviation,
      kind: input.kind,
      baseUnitId,
      factorToBase,
      active: current?.active !== false,
      builtin: Boolean(current?.builtin),
      nameNormalized: normalized,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    },
  };
}

export function planMeasureUnitActive(unit: MeasureUnitRecord, active: boolean, now: string): MeasureUnitRecord {
  return { ...unit, active, updatedAt: now };
}

export function conversionText(unit: Pick<MeasureUnitRecord, "abbreviation" | "factorToBase" | "baseUnitId">): string | null {
  if (unit.factorToBase == null || unit.factorToBase <= 0 || !unit.baseUnitId) return null;
  const base = BUILTIN_MEASURE_UNITS.find((item) => item.id === unit.baseUnitId);
  return `1 ${unit.abbreviation} = ${unit.factorToBase} ${base?.abbreviation || unit.baseUnitId}`;
}
