import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import { planMergedProductSplit, type SplitLineRef } from "@/lib/inventory/product-split";
import { movementSignedBase } from "@/lib/inventory/stock";
import type { InventoryMovement, PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

export const runtime = "nodejs";

type Row = { invoiceId: string; lineKey: string; targetProductId?: string };

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    sourceProductId?: string;
    rows?: Row[];
    createName?: string;
    category?: string;
  } | null;
  const sourceProductId = String(body?.sourceProductId ?? "").trim();
  const rows = (body?.rows ?? []).filter((row) => row.invoiceId && row.lineKey);
  if (!sourceProductId || !rows.length) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }

  const db = getAdminDb();
  const source = await db.collection(COLLECTIONS.ingredients).doc(sourceProductId).get();
  if (!source.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });

  const createName = String(body?.createName ?? "").trim();
  const createdRef = createName ? db.collection(COLLECTIONS.ingredients).doc() : null;
  const createdId = createdRef?.id ?? "";

  const selections = rows.map((row) => ({
    invoiceId: row.invoiceId,
    lineKey: row.lineKey,
    targetProductId: row.targetProductId?.trim() || createdId,
  }));
  if (selections.some((row) => !row.targetProductId || row.targetProductId === sourceProductId)) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const lines: SplitLineRef[] = [];
  const movements: InventoryMovement[] = [];
  for (const selection of selections) {
    let ref = db.collection(COLLECTIONS.purchaseInvoices).doc(selection.invoiceId);
    let snap = await ref.get();
    if (!snap.exists) {
      ref = db.collection(COLLECTIONS.archivePurchaseInvoices).doc(selection.invoiceId);
      snap = await ref.get();
    }
    if (!snap.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    const invoice = { id: snap.id, ...(snap.data() as Omit<PurchaseInvoice, "id">) } as PurchaseInvoice;
    const line = (invoice.lines ?? []).find((item) => item.key === selection.lineKey);
    if (!line || line.productId !== sourceProductId) {
      return Response.json({ error: "LINE_NOT_FOUND", code: "LINE_NOT_FOUND" }, { status: 404 });
    }
    lines.push({
      invoiceId: selection.invoiceId,
      lineKey: selection.lineKey,
      name: line.correctedInvoiceName || line.rawName,
      quantity: line.quantity,
      productId: line.productId,
    });
    const movementId = invoicePurchaseMovementId(selection.invoiceId, selection.lineKey);
    const movementSnap = await db.collection(COLLECTIONS.inventoryMovements).doc(movementId).get();
    if (movementSnap.exists) {
      movements.push({ id: movementSnap.id, ...(movementSnap.data() as Omit<InventoryMovement, "id">) });
    }
  }

  const plan = planMergedProductSplit({ sourceProductId, lines, movements, selections });
  const priceRefs: Array<{ ref: ReturnType<ReturnType<typeof db.collection>["doc"]>; targetProductId: string }> = [];
  for (const selection of selections) {
    const prices = await db.collection(COLLECTIONS.purchasePriceRecords).where("invoiceId", "==", selection.invoiceId).get();
    for (const doc of prices.docs) {
      const key = String(doc.get("invoiceLineKey") || doc.get("invoiceLineId") || "");
      if (key === selection.lineKey) priceRefs.push({ ref: doc.ref, targetProductId: selection.targetProductId });
    }
  }
  await db.runTransaction(async (tx) => {
    const invoiceRefs = new Map<string, { ref: ReturnType<ReturnType<typeof db.collection>["doc"]>; lines: PurchaseInvoiceLine[] }>();
    for (const selection of selections) {
      let ref = db.collection(COLLECTIONS.purchaseInvoices).doc(selection.invoiceId);
      let snap = await tx.get(ref);
      if (!snap.exists) {
        ref = db.collection(COLLECTIONS.archivePurchaseInvoices).doc(selection.invoiceId);
        snap = await tx.get(ref);
      }
      if (!invoiceRefs.has(ref.path)) {
        invoiceRefs.set(ref.path, { ref, lines: ((snap.data() as PurchaseInvoice | undefined)?.lines ?? []).map((line) => ({ ...line })) });
      }
      const stored = invoiceRefs.get(ref.path);
      if (!stored) continue;
      stored.lines = stored.lines.map((line) => line.key === selection.lineKey
        ? { ...line, productId: selection.targetProductId, matchKind: "exact" as const, matchConfirmed: true }
        : line);
    }
    const priceSnaps = [];
    for (const price of priceRefs) priceSnaps.push({ snap: await tx.get(price.ref), targetProductId: price.targetProductId, ref: price.ref });
    const balances = new Map<string, { ref: FirebaseFirestore.DocumentReference; quantityBase: number }>();
    for (const delta of plan.balanceDelta) {
      const ref = db.collection(COLLECTIONS.inventoryBalances).doc(delta.productId);
      const snap = await tx.get(ref);
      balances.set(delta.productId, { ref, quantityBase: snap.exists ? Number(snap.get("quantityBase") ?? 0) : 0 });
    }
    if (createdRef) {
      tx.set(createdRef, sanitizeFirestoreData({
        name: createName,
        category: body?.category?.trim() || source.get("category") || null,
        purchasePrice: 0,
        purchaseQuantity: 1,
        purchaseUnit: source.get("purchaseUnit") || "unit",
        baseUnit: source.get("baseUnit") || "unit",
        costPerBaseUnit: 0,
        active: true,
        originKind: "invoice",
        createdAt: now,
        updatedAt: now,
      }));
    }
    for (const invoice of invoiceRefs.values()) {
      tx.set(invoice.ref, sanitizeFirestoreData({ lines: invoice.lines, updatedAt: now }), { merge: true });
    }
    for (const move of plan.movementMoves) {
      tx.set(db.collection(COLLECTIONS.inventoryMovements).doc(move.id), sanitizeFirestoreData({ productId: move.toProductId, updatedAt: now }), { merge: true });
    }
    for (const delta of plan.balanceDelta) {
      const current = balances.get(delta.productId);
      if (!current) continue;
      tx.set(current.ref, sanitizeFirestoreData({ productId: delta.productId, quantityBase: current.quantityBase + delta.delta, updatedAt: now }), { merge: true });
    }
    for (const price of priceSnaps) {
      if (!price.snap.exists) continue;
      tx.set(price.ref, sanitizeFirestoreData({ productId: price.targetProductId, updatedAt: now }), { merge: true });
    }
    tx.set(db.collection(COLLECTIONS.invoiceAuditLog).doc(), sanitizeFirestoreData({
      action: "split-merged-product",
      actor: auth.email,
      at: now,
      sourceProductId,
      createdProductId: createdId || null,
      selections,
      movementIds: plan.movementMoves.map((move) => move.id),
    }));
  });

  return Response.json({
    ok: true,
    createdProductId: createdId || null,
    plan,
    priceMoves: priceRefs.map((price) => price.ref.id),
    movementSigned: movements.map((movement) => movementSignedBase(movement)),
  });
}
