import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  BUILTIN_MEASURE_UNITS,
  mergeUnitCatalog,
  setMeasureUnitCatalog,
  type MeasureUnitRecord,
} from "@/lib/inventory/measure-units";

function mapUnit(id: string, data: Record<string, unknown>): MeasureUnitRecord {
  return {
    id,
    nameHe: String(data.nameHe || ""),
    abbreviation: String(data.abbreviation || data.nameHe || ""),
    kind: data.kind === "weight" || data.kind === "volume" || data.kind === "count" || data.kind === "other" ? data.kind : "other",
    baseUnitId: data.baseUnitId === "g" || data.baseUnitId === "ml" || data.baseUnitId === "unit" ? data.baseUnitId : null,
    factorToBase: data.factorToBase == null || data.factorToBase === "" ? null : Number(data.factorToBase),
    active: data.active !== false,
    builtin: data.builtin === true || BUILTIN_MEASURE_UNITS.some((unit) => unit.id === id),
    nameNormalized: String(data.nameNormalized || ""),
    createdAt: String(data.createdAt || ""),
    updatedAt: String(data.updatedAt || ""),
  };
}

export async function loadMeasureUnitCatalog(db: Firestore): Promise<MeasureUnitRecord[]> {
  const snap = await db.collection(COLLECTIONS.measureUnits).get();
  const stored = snap.docs.map((doc) => mapUnit(doc.id, doc.data() as Record<string, unknown>));
  const merged = mergeUnitCatalog(stored);
  setMeasureUnitCatalog(merged);
  return merged;
}

export async function seedMissingMeasureUnits(db: Firestore): Promise<MeasureUnitRecord[]> {
  const snap = await db.collection(COLLECTIONS.measureUnits).get();
  const have = new Set(snap.docs.map((doc) => doc.id));
  const batch = db.batch();
  let writes = 0;
  for (const unit of BUILTIN_MEASURE_UNITS) {
    if (have.has(unit.id)) continue;
    batch.set(db.collection(COLLECTIONS.measureUnits).doc(unit.id), unit);
    writes += 1;
  }
  if (writes > 0) await batch.commit();
  return loadMeasureUnitCatalog(db);
}

export async function countUnitUsage(db: Firestore): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const add = (id: unknown) => {
    const key = String(id || "");
    if (!key) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const ingredients = await db.collection(COLLECTIONS.ingredients).get();
  for (const doc of ingredients.docs) {
    const data = doc.data();
    const seen = new Set<string>();
    for (const value of [data.purchaseUnit, data.packContentUnit]) {
      const key = String(value || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      add(key);
    }
  }
  return counts;
}
