import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

export const runtime = "nodejs";

/**
 * Approve / revert a manual dish cost.
 *
 * We split this away from the price endpoint because the two actions have
 * different audit semantics:
 *   • Price changes mutate a number the customer sees in the menu.
 *   • Cost confirmation is an owner acknowledgement — the number may stay
 *     the same but its "status" flips from `imported_unverified` to
 *     `verified_manual`.
 *
 * The spec explicitly forbids auto-flipping an imported cost to verified,
 * so this is the ONLY code path that may write `costVerified: true`.
 */

type Body = {
  productId?: string;
  verified?: boolean;
  cost?: number;
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

  const nextCost = body?.cost != null ? Number(body.cost) : null;
  if (nextCost != null && (!Number.isFinite(nextCost) || nextCost < 0 || nextCost > 100000)) {
    return Response.json(
      { ok: false, code: "INVALID_COST", message: "cost out of range" },
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
  const data = snap.data() as { cost?: number; costVerified?: boolean };
  const previousCost = Number(data.cost ?? 0);
  const previousVerified = data.costVerified === true;
  const costToWrite = nextCost ?? previousCost;
  const verifiedToWrite = body?.verified === true;

  if (previousCost === costToWrite && previousVerified === verifiedToWrite) {
    return Response.json({ ok: true, noop: true });
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.update(ref, {
    cost: costToWrite,
    costVerified: verifiedToWrite,
    costVerifiedBy: verifiedToWrite ? auth.email : null,
    costVerifiedAt: verifiedToWrite ? now : null,
    updatedAt: now,
  });
  const historyRef = db.collection(COLLECTIONS.productChangeHistory).doc();
  batch.set(historyRef, {
    productId,
    field: "cost",
    previousValue: previousCost,
    nextValue: costToWrite,
    previousVerified,
    nextVerified: verifiedToWrite,
    actor: auth.email,
    actorUid: auth.uid,
    reason: body?.reason?.slice(0, 400) ?? null,
    source: "dish-pricing-admin",
    createdAt: now,
  });
  await batch.commit();

  return Response.json({
    ok: true,
    cost: costToWrite,
    costVerified: verifiedToWrite,
    historyId: historyRef.id,
  });
}
