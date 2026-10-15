import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { posPriceUpdatePreview } from "@/lib/inventory/pos-excel";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    productId?: string;
    currentPrice?: number | null;
    newPrice?: number | null;
    confirmAverage?: boolean;
  };
  const productId = String(body.productId || "").trim();
  const newPrice = Number(body.newPrice);
  if (!productId || !Number.isFinite(newPrice) || newPrice < 0) {
    return Response.json({ ok: false, error: "invalid-price" }, { status: 400 });
  }
  if (!body.confirmAverage) {
    return Response.json({ ok: false, error: "confirm-required" }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.products).doc(productId);
  const snap = await ref.get();
  if (!snap.exists) return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  const current = Number(snap.data()?.price);
  const preview = posPriceUpdatePreview(Number.isFinite(current) ? current : null, newPrice);
  await ref.set(
    {
      price: newPrice,
      updatedAt: FieldValue.serverTimestamp(),
      posPriceUpdatedBy: auth.uid,
      posPriceUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return Response.json({ ok: true, ...preview, savedPrice: newPrice });
}
