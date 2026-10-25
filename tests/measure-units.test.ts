import { afterEach, describe, expect, it } from "vitest";
import { costPerBaseUnit, costPerPurchaseUnit, purchaseQuantityInBase, resolveUnitFactor, unitsCompatible } from "@/lib/costing/units";
import { costPerBaseFromPack } from "@/lib/inventory/pack-cost";
import {
  BUILTIN_MEASURE_UNITS,
  planMeasureUnitActive,
  planMeasureUnitSave,
  setMeasureUnitCatalog,
  type MeasureUnitRecord,
} from "@/lib/inventory/measure-units";

describe("measure units", () => {
  afterEach(() => setMeasureUnitCatalog(BUILTIN_MEASURE_UNITS));

  it("keeps weight and volume conversions and does not invent a carton size", () => {
    expect(purchaseQuantityInBase(1, "kg")).toBe(1000);
    expect(purchaseQuantityInBase(1, "liter")).toBe(1000);
    expect(purchaseQuantityInBase(2, "dozen")).toBe(24);
    expect(purchaseQuantityInBase(3, "carton")).toBe(0);
    expect(unitsCompatible("kg", "g")).toBe(true);
    expect(unitsCompatible("carton", "unit")).toBe(false);
    expect(unitsCompatible("bucket", "kg")).toBe(false);
  });

  it("saves a new unit, selects the existing name, and does not convert it into kilograms", () => {
    const created = planMeasureUnitSave(BUILTIN_MEASURE_UNITS, {
      nameHe: "דלי גדול",
      abbreviation: "ד״ג",
      kind: "count",
      factorToBase: null,
    }, "2026-10-25T00:00:00.000Z");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.reused).toBe(false);
    setMeasureUnitCatalog([...BUILTIN_MEASURE_UNITS, created.unit]);
    expect(resolveUnitFactor(created.unit.id)).toBeNull();
    expect(purchaseQuantityInBase(4, created.unit.id)).toBe(0);
    expect(unitsCompatible(created.unit.id, "kg")).toBe(false);

    const again = planMeasureUnitSave([...BUILTIN_MEASURE_UNITS, created.unit], {
      nameHe: "דלי גדול",
      abbreviation: "אחר",
      kind: "count",
    }, "2026-10-25T00:00:00.000Z");
    expect(again.ok && again.reused && again.unit.id).toBe(created.unit.id);

    const existingBucket = planMeasureUnitSave(BUILTIN_MEASURE_UNITS, {
      nameHe: "דלי",
      abbreviation: "דלי",
      kind: "count",
    }, "2026-10-25T00:00:00.000Z");
    expect(existingBucket.ok && existingBucket.reused && existingBucket.unit.id).toBe("bucket");
  });

  it("edits the label, refuses a built-in factor change, and disables without deleting", () => {
    const edited = planMeasureUnitSave(BUILTIN_MEASURE_UNITS, {
      id: "kg",
      nameHe: "קילוגרם",
      abbreviation: "ק״ג",
      kind: "weight",
      factorToBase: 1000,
    }, "2026-10-25T00:00:00.000Z");
    expect(edited.ok && edited.unit.nameHe).toBe("קילוגרם");
    expect(edited.ok && edited.unit.factorToBase).toBe(1000);
    const blocked = planMeasureUnitSave(BUILTIN_MEASURE_UNITS, {
      id: "kg",
      nameHe: "ק״ג",
      abbreviation: "ק״ג",
      kind: "weight",
      factorToBase: 500,
    }, "2026-10-25T00:00:00.000Z");
    expect(blocked.ok).toBe(false);
    const bucket = BUILTIN_MEASURE_UNITS.find((unit) => unit.id === "bucket") as MeasureUnitRecord;
    const disabled = planMeasureUnitActive(bucket, false, "2026-10-25T00:00:00.000Z");
    expect(disabled.id).toBe("bucket");
    expect(disabled.active).toBe(false);
    expect(BUILTIN_MEASURE_UNITS.find((unit) => unit.id === "bucket")?.active).toBe(true);
  });

  it("prices a defined conversion once and keeps two cartons independent", () => {
    expect(costPerPurchaseUnit(6, 2)).toBe(3);
    expect(costPerBaseUnit(6, 2, "unit")).toBe(3);
    expect(costPerBaseUnit(24, 1, "dozen")).toBe(2);
    const small = costPerBaseFromPack({ lineTotal: 24, quantity: 1, contentCount: 12, contentUnit: "unit" });
    const large = costPerBaseFromPack({ lineTotal: 24, quantity: 1, contentCount: 24, contentUnit: "unit" });
    expect(small.ok && small.cost).toBe(2);
    expect(large.ok && large.cost).toBe(1);
  });
});
