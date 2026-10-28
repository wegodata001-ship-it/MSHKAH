import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";
import { adjustmentMovementId, planInventoryAdjustment } from "@/lib/inventory/last-price";
import { openingMovementId, validateProductPatch, type ProductPatchInput } from "@/lib/inventory/stock-sheet";
import { movementSignedBase } from "@/lib/inventory/stock";
import type { InventoryMovement } from "@/lib/inventory/types";

export const runtime = "nodejs";

type Item = ProductPatchInput & { expectedUpdatedAt?: string };

function storedIso(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { items?: Item[] } | null;
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length || items.length > 100 || new Set(items.map((item) => item.productId)).size !== items.length) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }
  for (const item of items) {
    const valid = validateProductPatch(item);
    if (!valid.ok) return Response.json({ error: valid.code, code: valid.code }, { status: 400 });
  }

  const db = getAdminDb();
  const now = new Date().toISOString();
  try {
    const result = await db.runTransaction(async (tx) => {
      const prepared = [];
      for (const item of items) {
        const productRef = db.collection(COLLECTIONS.ingredients).doc(item.productId);
        const product = await tx.get(productRef);
        if (!product.exists) throw new Error("NOT_FOUND");
        const updatedAt = storedIso(product.get("updatedAt"));
        if (item.expectedUpdatedAt && updatedAt && item.expectedUpdatedAt !== updatedAt) throw new Error("CONFLICT");
        const data = product.data() ?? {};
        const unit = (item.purchaseUnit || data.purchaseUnit || "unit") as PurchaseUnit;
        const baseUnit = (data.baseUnit || "unit") as BaseUnit;
        const movementsSnap = item.openingQuantity != null || item.nextQuantity != null
          ? await tx.get(db.collection(COLLECTIONS.inventoryMovements).where("productId", "==", item.productId))
          : null;
        const movements = movementsSnap?.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<InventoryMovement, "id">) })) ?? [];
        let movementWrite: { id: string; type: "OPENING" | "ADJUSTMENT"; deltaBase: number; available: number } | null = null;
        if (item.openingQuantity != null || item.nextQuantity != null) {
          const basis = item.openingQuantity != null
            ? movements.filter((movement) => movement.type === "OPENING").reduce((sum, movement) => sum + movement.quantityBase, 0)
            : movements.reduce((sum, movement) => sum + movementSignedBase(movement), 0);
          const plan = planInventoryAdjustment({
            currentBase: basis,
            nextQuantity: item.openingQuantity ?? item.nextQuantity ?? 0,
            unit,
            baseUnit,
          });
          if (!plan.noop) {
            const movementId = item.openingQuantity != null
              ? openingMovementId(item.productId, plan.nextBase)
              : adjustmentMovementId(item.productId, plan.nextBase);
            const movementRef = db.collection(COLLECTIONS.inventoryMovements).doc(movementId);
            const balanceRef = db.collection(COLLECTIONS.inventoryBalances).doc(item.productId);
            const existing = await tx.get(movementRef);
            const balance = await tx.get(balanceRef);
            if (!existing.exists) {
              const currentBase = movements.reduce((sum, movement) => sum + movementSignedBase(movement), 0);
              const available = balance.exists ? Number(balance.get("quantityBase") ?? currentBase) : currentBase;
              movementWrite = {
                id: movementId,
                type: item.openingQuantity != null ? "OPENING" : "ADJUSTMENT",
                deltaBase: plan.deltaBase,
                available,
              };
            }
          }
        }
        prepared.push({ item, productRef, unit, movementWrite });
      }

      let written = 0;
      for (const row of prepared) {
        const patch: Record<string, unknown> = { updatedAt: now };
        if (row.item.category !== undefined) patch.category = row.item.category?.trim() || null;
        if (row.item.notes !== undefined) patch.notes = row.item.notes?.trim() || null;
        if (row.item.purchaseUnit !== undefined) patch.purchaseUnit = row.item.purchaseUnit;
        if (row.item.lastSupplierId !== undefined) patch.lastSupplierId = row.item.lastSupplierId?.trim() || null;
        if (row.item.packCount !== undefined) patch.packCount = row.item.packCount;
        if (row.item.packContentUnit !== undefined) patch.packContentUnit = row.item.packContentUnit;
        if (row.item.active !== undefined) patch.active = row.item.active;
        if (row.movementWrite) {
          const movementRef = db.collection(COLLECTIONS.inventoryMovements).doc(row.movementWrite.id);
          const balanceRef = db.collection(COLLECTIONS.inventoryBalances).doc(row.item.productId);
          tx.set(movementRef, sanitizeFirestoreData({
            productId: row.item.productId,
            type: row.movementWrite.type,
            quantity: Math.abs(row.movementWrite.deltaBase),
            unit: row.unit,
            quantityBase: row.movementWrite.deltaBase,
            actor: auth.email,
            note: row.item.reason,
            idempotencyKey: row.movementWrite.id,
            quantityBefore: row.movementWrite.available,
            quantityAfter: row.movementWrite.available + row.movementWrite.deltaBase,
            receivedAt: now,
            createdAt: now,
          }));
          tx.set(balanceRef, sanitizeFirestoreData({
            productId: row.item.productId,
            quantityBase: row.movementWrite.available + row.movementWrite.deltaBase,
            updatedAt: now,
          }), { merge: true });
        }
        tx.set(row.productRef, sanitizeFirestoreData(patch), { merge: true });
        tx.set(db.collection(COLLECTIONS.invoiceAuditLog).doc(), sanitizeFirestoreData({
          action: "inventory-product-patch",
          actor: auth.email,
          at: now,
          productId: row.item.productId,
          reason: row.item.reason || null,
          patch,
        }));
        written += 1;
      }
      return written;
    });
    return Response.json({ ok: true, written: result });
  } catch (error) {
    const code = error instanceof Error && (error.message === "NOT_FOUND" || error.message === "CONFLICT" || error.message === "BAD_UNIT" || error.message === "INVALID_QUANTITY")
      ? error.message
      : "VALIDATION";
    const status = code === "NOT_FOUND" ? 404 : code === "CONFLICT" ? 409 : 400;
    return Response.json({ error: code, code }, { status });
  }
}
