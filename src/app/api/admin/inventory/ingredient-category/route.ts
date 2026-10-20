import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { categoryDocId, normalizeCategoryName } from "@/lib/inventory/category-name";
import { mapCategoryRecord } from "@/lib/inventory/category-record";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";

export const runtime = "nodejs";

type Body = {
  id?: string;
  name?: string;
  nameHe?: string;
  nameAr?: string;
  nameEn?: string;
  description?: string;
  archived?: boolean;
};

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as Body | null;
  const name = String(body?.nameHe ?? body?.name ?? "").trim();
  const db = getAdminDb();
  const collection = db.collection(COLLECTIONS.ingredientCategories);

  if (body?.id) {
    const ref = collection.doc(body.id);
    const snap = await ref.get();
    if (!snap.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    if (body.archived === true) {
      await ref.set(sanitizeFirestoreData({ archived: true, updatedAt: new Date().toISOString() }), { merge: true });
      return Response.json({ ok: true, category: mapCategoryRecord(ref.id, { ...snap.data(), archived: true }) });
    }
    if (!name) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
    const normalized = normalizeCategoryName(name);
    if (!normalized) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
    const clash = await collection.where("nameNormalized", "==", normalized).limit(2).get();
    if (clash.docs.some((doc) => doc.id !== ref.id)) {
      return Response.json({ error: "DUPLICATE", code: "DUPLICATE" }, { status: 409 });
    }
    const patch = sanitizeFirestoreData({
      name,
      nameHe: name,
      nameAr: String(body.nameAr ?? "").trim() || null,
      nameEn: String(body.nameEn ?? "").trim() || null,
      description: String(body.description ?? "").trim() || null,
      nameNormalized: normalized,
      archived: false,
      updatedAt: new Date().toISOString(),
    });
    await ref.set(patch, { merge: true });
    return Response.json({ ok: true, category: mapCategoryRecord(ref.id, { ...snap.data(), ...patch }) });
  }

  if (!name) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  const normalized = normalizeCategoryName(name);
  if (!normalized) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  const existing = await collection.where("nameNormalized", "==", normalized).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0]!;
    return Response.json({ ok: true, name: String(doc.data().name || name), category: mapCategoryRecord(doc.id, doc.data()), reused: true });
  }
  const id = categoryDocId(normalized);
  const ref = collection.doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    return Response.json({ ok: true, name: String(snap.data()?.name || name), category: mapCategoryRecord(ref.id, snap.data() ?? {}), reused: true });
  }
  const created = sanitizeFirestoreData({
    name,
    nameHe: name,
    nameAr: String(body?.nameAr ?? "").trim() || null,
    nameEn: String(body?.nameEn ?? "").trim() || null,
    description: String(body?.description ?? "").trim() || null,
    nameNormalized: normalized,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: auth.email,
  });
  await ref.set(created);
  return Response.json({ ok: true, name, id, category: mapCategoryRecord(id, created) });
}
