import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import {
  planMeasureUnitActive,
  planMeasureUnitSave,
  setMeasureUnitCatalog,
  type MeasureUnitInput,
  type UnitKind,
} from "@/lib/inventory/measure-units";
import { countUnitUsage, loadMeasureUnitCatalog, seedMissingMeasureUnits } from "@/lib/inventory/measure-units-admin";

export const runtime = "nodejs";

type Body = MeasureUnitInput & {
  action?: "list" | "save" | "disable" | "enable";
  usage?: boolean;
  active?: boolean;
};

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.action) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  const db = getAdminDb();
  const now = new Date().toISOString();

  if (body.action === "list") {
    const units = await seedMissingMeasureUnits(db);
    const usage = body.usage ? Object.fromEntries(await countUnitUsage(db)) : undefined;
    return Response.json({ ok: true, units, usage });
  }

  if (body.action === "disable" || body.action === "enable") {
    const units = await loadMeasureUnitCatalog(db);
    const current = units.find((unit) => unit.id === body.id);
    if (!current) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    const next = planMeasureUnitActive(current, body.action === "enable", now);
    await db.collection(COLLECTIONS.measureUnits).doc(current.id).set(sanitizeFirestoreData(next));
    setMeasureUnitCatalog(units.map((unit) => (unit.id === next.id ? next : unit)));
    return Response.json({ ok: true, unit: next });
  }

  const units = await seedMissingMeasureUnits(db);
  const plan = planMeasureUnitSave(units, {
    id: body.id,
    nameHe: String(body.nameHe || ""),
    abbreviation: String(body.abbreviation || ""),
    kind: body.kind as UnitKind,
    factorToBase: body.factorToBase == null || body.factorToBase === ("" as unknown as number) ? null : Number(body.factorToBase),
    baseUnitId: body.baseUnitId,
  }, now);
  if (!plan.ok) {
    const status = plan.code === "DUPLICATE" ? 409 : 400;
    return Response.json({ error: plan.code, code: plan.code, existingId: plan.existingId }, { status });
  }
  if (!plan.reused) {
    await db.collection(COLLECTIONS.measureUnits).doc(plan.unit.id).set(sanitizeFirestoreData(plan.unit));
    setMeasureUnitCatalog([...units.filter((unit) => unit.id !== plan.unit.id), plan.unit]);
  }
  return Response.json({ ok: true, unit: plan.unit, reused: plan.reused });
}
