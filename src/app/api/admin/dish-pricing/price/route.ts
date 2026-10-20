import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { validateSalePriceChange } from "@/lib/costing/dish-pricing";
import type { Product } from "@/types";

export const runtime = "nodejs";

/**
 * Server-side price update for the dish-pricing admin tab.
 *
 * Hard requirements from the brief:
 *   • "יש לבצע את כל בדיקות ההרשאה בצד השרת" — the admin check is enforced
 *     here. The UI must NOT be the only gatekeeper.
 *   • "אם השמירה נכשלת, לא להציג הצלחה" — we return a structured error code
 *     so the client surfaces the real reason, not a false success toast.
 *   • "לשמור היסטוריית שינוי" — every change writes a row to
 *     `productChangeHistory`.
 *   • "אין לשנות הזמנות היסטוריות. אין לשנות סכומי תשלום שכבר נוצרו" —
 *     this route only touches `products.price` and never writes into
 *     orders / payments.
 *   • Optimistic-concurrency check: the client sends `expectedCurrentPrice`
 *     so a stale tab can't overwrite a newer price change by mistake.
 */

type Body = {
  productId?: string;
  nextPrice?: number;
  expectedCurrentPrice?: number;
  reason?: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json().catch(() => null)) as Body | null;
  const productId = body?.productId?.trim();
  if (!productId) {
    return Response.json(
      { ok: false, code: "VALIDATION", message: "productId required" },
      { status: 400 }
    );
  }
  if (body?.nextPrice == null) {
    return Response.json(
      { ok: false, code: "VALIDATION", message: "nextPrice required" },
      { status: 400 }
    );
  }

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.products).doc(productId);
  const snap = await ref.get();
  if (!snap.exists) {
    return Response.json(
      { ok: false, code: "NOT_FOUND", message: "product not found" },
      { status: 404 }
    );
  }
  const current = snap.data() as Partial<Product> & { price?: number };
  const currentPrice = Number(current.price ?? 0);

  const validation = validateSalePriceChange({
    nextPrice: Number(body.nextPrice),
    product: { ...(current as Product), id: productId, price: currentPrice },
  });
  if (!validation.ok) {
    return Response.json(
      { ok: false, code: validation.code, message: `invalid price (${validation.code})` },
      { status: 400 }
    );
  }

  // Optimistic concurrency: if the caller passed `expectedCurrentPrice` and
  // it doesn't match what's in Firestore, reject so the UI can refresh.
  if (
    body.expectedCurrentPrice != null &&
    Number.isFinite(Number(body.expectedCurrentPrice)) &&
    Math.abs(Number(body.expectedCurrentPrice) - currentPrice) > 0.001
  ) {
    return Response.json(
      {
        ok: false,
        code: "STALE",
        message: "price changed since the page was loaded",
        currentPrice,
      },
      { status: 409 }
    );
  }

  if (Math.abs(validation.nextPrice - currentPrice) <= 0.001) {
    // No-op save; return success without touching the DB or audit log so the
    // owner's "undo" doesn't leave a stale history row behind.
    return Response.json({ ok: true, noop: true, price: currentPrice });
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.update(ref, {
    price: validation.nextPrice,
    updatedAt: now,
  });
  const historyRef = db.collection(COLLECTIONS.productChangeHistory).doc();
  batch.set(historyRef, {
    productId,
    field: "price",
    previousValue: currentPrice,
    nextValue: validation.nextPrice,
    actor: auth.email,
    actorUid: auth.uid,
    reason: body.reason?.slice(0, 400) ?? null,
    source: "dish-pricing-admin",
    createdAt: now,
  });
  await batch.commit();

  return Response.json({
    ok: true,
    price: validation.nextPrice,
    previousPrice: currentPrice,
    historyId: historyRef.id,
  });
}
