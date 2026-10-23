import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import type { PurchaseUnit } from "@/lib/costing/types";
import { adjustmentMovementId, planInventoryAdjustment } from "@/lib/inventory/last-price";
import { currentStockBase, movementSignedBase } from "@/lib/inventory/stock";
import type { InventoryMovement } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    productId?: string;
    nextQuantity?: number;
    unit?: PurchaseUnit;
    reason?: string;
  } | null;
  const productId = String(body?.productId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const nextQuantity = Number(body?.nextQuantity);
  if (!productId || !reason || !Number.isFinite(nextQuantity)) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }
  const db = getAdminDb();
  const product = await db.collection(COLLECTIONS.ingredients).doc(productId).get();
  if (!product.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
  const unit = (body?.unit || product.get("purchaseUnit") || "unit") as PurchaseUnit;
  const movementsSnap = await db.collection(COLLECTIONS.inventoryMovements).where("productId", "==", productId).get();
  const movements = movementsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<InventoryMovement, "id">) }));
  const currentBase = movements.reduce((sum, movement) => sum + movementSignedBase(movement), 0);
  let plan: ReturnType<typeof planInventoryAdjustment>;
  try {
    plan = planInventoryAdjustment({
      currentBase,
      nextQuantity,
      unit,
      baseUnit: product.get("baseUnit") || "unit",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }
  if (plan.noop) return Response.json({ ok: true, noop: true, currentBase, nextBase: plan.nextBase });
  const movementId = adjustmentMovementId(productId, plan.nextBase);
  const existing = await db.collection(COLLECTIONS.inventoryMovements).doc(movementId).get();
  if (existing.exists) return Response.json({ ok: true, reused: true, currentBase: currentStockBase(movements, productId) });
  const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const movementRef = db.collection(COLLECTIONS.inventoryMovements).doc(movementId);
    const balanceRef = db.collection(COLLECTIONS.inventoryBalances).doc(productId);
    const movement = await tx.get(movementRef);
    if (movement.exists) return;
    const balance = await tx.get(balanceRef);
    const available = balance.exists ? Number(balance.get("quantityBase") ?? currentBase) : currentBase;
    const next = available + plan.deltaBase;
    tx.set(movementRef, sanitizeFirestoreData({
      productId,
      type: "ADJUSTMENT",
      quantity: Math.abs(plan.deltaBase),
      unit,
      quantityBase: plan.deltaBase,
      actor: auth.email,
      note: reason,
      idempotencyKey: movementId,
      quantityBefore: available,
      quantityAfter: next,
      receivedAt: now,
      createdAt: now,
    }));
    tx.set(balanceRef, sanitizeFirestoreData({ productId, quantityBase: next, updatedAt: now }), { merge: true });
    tx.set(db.collection(COLLECTIONS.invoiceAuditLog).doc(), sanitizeFirestoreData({
      action: "stock-adjustment",
      actor: auth.email,
      at: now,
      productId,
      before: available,
      after: next,
      reason,
    }));
  });
  return Response.json({ ok: true, before: currentBase, after: plan.nextBase, delta: plan.deltaBase });
}
