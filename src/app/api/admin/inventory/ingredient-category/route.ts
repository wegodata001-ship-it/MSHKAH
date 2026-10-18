import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { categoryDocId, normalizeCategoryName } from "@/lib/inventory/category-name";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = String(body?.name ?? "").trim();
  if (!name) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  const normalized = normalizeCategoryName(name);
  if (!normalized) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  const db = getAdminDb();
  const existing = await db.collection(COLLECTIONS.ingredientCategories).where("nameNormalized", "==", normalized).limit(1).get();
  if (!existing.empty) {
    return Response.json({ ok: true, name: String(existing.docs[0]?.data().name || name), reused: true });
  }
  const id = categoryDocId(normalized);
  const ref = db.collection(COLLECTIONS.ingredientCategories).doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    return Response.json({ ok: true, name: String(snap.data()?.name || name), reused: true });
  }
  await ref.set(
    sanitizeFirestoreData({
      name,
      nameNormalized: normalized,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: auth.email,
    })
  );
  return Response.json({ ok: true, name, id });
}
