import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { normalizeCategoryName } from "@/lib/inventory/category-name";
import { packFactor } from "@/lib/inventory/pack-cost";
import type { PurchaseUnit } from "@/lib/costing/types";
import { isPackUnit, purchaseQuantityInBase } from "@/lib/costing/units";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";

export const runtime = "nodejs";

type Body = {
  label?: string;
  labelAr?: string;
  labelEn?: string;
  kind?: "measure" | "pack";
  contentCount?: number;
  contentUnit?: PurchaseUnit;
  measureQuantity?: number;
  measureUnit?: PurchaseUnit;
};

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as Body | null;
  const db = getAdminDb();
  if (body && (body as { list?: boolean }).list) {
    const snap = await db.collection(COLLECTIONS.purchaseUnits).get();
    return Response.json({
      ok: true,
      units: snap.docs.map((item) => ({ id: item.id, ...item.data() })),
    });
  }
  const label = String(body?.label ?? "").trim();
  const normalized = normalizeCategoryName(label);
  if (!label || !normalized) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });

  let factor = 0;
  let baseUnit: "g" | "ml" | "unit" = "unit";
  let contentCount: number | null = null;
  let contentUnit: PurchaseUnit | null = null;
  const kind = body?.kind === "pack" ? "pack" : "measure";
  if (kind === "pack") {
    const packed = packFactor({
      contentCount: Number(body?.contentCount),
      contentUnit: (body?.contentUnit || "unit") as PurchaseUnit,
    });
    if (!packed.ok) return Response.json({ error: packed.reason, code: packed.reason }, { status: 400 });
    factor = packed.factor;
    baseUnit = packed.base;
    contentCount = Number(body?.contentCount);
    contentUnit = body?.contentUnit || "unit";
    if (isPackUnit(contentUnit)) return Response.json({ error: "nested-pack", code: "nested-pack" }, { status: 400 });
  } else {
    const measureUnit = (body?.measureUnit || "unit") as PurchaseUnit;
    if (isPackUnit(measureUnit)) return Response.json({ error: "invalid", code: "invalid" }, { status: 400 });
    const quantity = Number(body?.measureQuantity);
    factor = purchaseQuantityInBase(quantity, measureUnit);
    if (factor <= 0) return Response.json({ error: "invalid", code: "invalid" }, { status: 400 });
    baseUnit = measureUnit === "kg" || measureUnit === "g" ? "g" : measureUnit === "liter" || measureUnit === "ml" ? "ml" : "unit";
    contentCount = quantity;
    contentUnit = measureUnit;
  }

  const existing = await db.collection(COLLECTIONS.purchaseUnits).where("nameNormalized", "==", normalized).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0]!;
    return Response.json({ ok: true, id: doc.id, reused: true, unit: { id: doc.id, ...doc.data() } });
  }
  const ref = db.collection(COLLECTIONS.purchaseUnits).doc();
  const payload = sanitizeFirestoreData({
    label,
    labelAr: String(body?.labelAr ?? "").trim() || null,
    labelEn: String(body?.labelEn ?? "").trim() || null,
    nameNormalized: normalized,
    kind,
    baseUnit,
    factor,
    contentCount,
    contentUnit,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: auth.email,
  });
  await ref.set(payload);
  return Response.json({ ok: true, id: ref.id, unit: { id: ref.id, ...payload } });
}
