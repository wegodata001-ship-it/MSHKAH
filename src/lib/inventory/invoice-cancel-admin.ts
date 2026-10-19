import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import type { InventoryMovement, PurchaseInvoice } from "@/lib/inventory/types";
import {
  planInvoiceCancellation,
  type CancelPlan,
} from "@/lib/inventory/invoice-cancel";

/**
 * Server-side cancel implementation. Called from
 * `/api/admin/inventory/invoice/cancel` after admin verification.
 *
 * Contract:
 * - Idempotent: counter-movement doc id is derived from the source movement id,
 *   so Firestore uniqueness (via tx.get → set) prevents duplicates even on
 *   retries, double clicks, or network partition.
 * - Only touches movements whose `invoiceId` matches this invoice. No guessing
 *   by product, date, or amount.
 * - Allows the resulting balance to go negative; surfaces the warning via
 *   the plan returned to the client, but doesn't block the transaction.
 * - Keeps the invoice document and audit, flags it `status === "cancelled"`.
 * - Marks the invoice's `purchasePriceRecords` as cancelled (soft) so price
 *   comparisons can exclude them without losing history.
 * - Doesn't delete supplier payments. Allocations persist; the ledger math
 *   will naturally stop crediting the cancelled invoice because the status
 *   is no longer in APPROVED.
 * - Doesn't touch ingredient costs, recipes, or dish prices.
 */

export class InvoiceCancelError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, detail?: unknown) {
    super(code);
    this.code = code;
    this.detail = detail;
    this.name = "InvoiceCancelError";
  }
}

type MovementDoc = InventoryMovement;

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function loadInvoiceMovements(
  db: Firestore,
  invoiceId: string
): Promise<MovementDoc[]> {
  const snap = await db
    .collection(COLLECTIONS.inventoryMovements)
    .where("invoiceId", "==", invoiceId)
    .get();
  return snap.docs.map((doc) => mapMovement(doc.id, doc.data() as Record<string, unknown>));
}

/**
 * Also pull every REVERSAL doc that references our source movements, in case
 * a prior cancel attempt crashed halfway and the REVERSAL rows are missing
 * the `invoiceId` denormalization.
 */
async function loadReversalsFor(
  db: Firestore,
  sourceIds: string[]
): Promise<MovementDoc[]> {
  if (!sourceIds.length) return [];
  const results: MovementDoc[] = [];
  // Firestore `in` queries are limited to 10 values → batch.
  for (let i = 0; i < sourceIds.length; i += 10) {
    const batch = sourceIds.slice(i, i + 10);
    const snap = await db
      .collection(COLLECTIONS.inventoryMovements)
      .where("reversesId", "in", batch)
      .get();
    for (const doc of snap.docs) {
      results.push(mapMovement(doc.id, doc.data() as Record<string, unknown>));
    }
  }
  return results;
}

async function loadProductBalances(
  db: Firestore,
  productIds: string[]
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  const seen = new Set<string>();
  for (const id of productIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const snap = await db.collection(COLLECTIONS.inventoryBalances).doc(id).get();
    balances.set(id, snap.exists ? asNumber(snap.data()?.quantityBase) : 0);
  }
  return balances;
}

function mapMovement(id: string, data: Record<string, unknown>): MovementDoc {
  return {
    id,
    productId: String(data.productId ?? ""),
    type: data.type as InventoryMovement["type"],
    quantity: asNumber(data.quantity),
    unit: (data.unit as InventoryMovement["unit"]) || "unit",
    quantityBase: asNumber(data.quantityBase),
    supplierId: data.supplierId ? String(data.supplierId) : undefined,
    invoiceId: data.invoiceId ? String(data.invoiceId) : undefined,
    invoiceLineId: data.invoiceLineId ? String(data.invoiceLineId) : undefined,
    invoiceLineKey: data.invoiceLineKey ? String(data.invoiceLineKey) : undefined,
    conversionFactor: data.conversionFactor != null ? asNumber(data.conversionFactor) : undefined,
    reversesId: data.reversesId ? String(data.reversesId) : undefined,
    receivedAt: data.receivedAt ? String(data.receivedAt) : "",
    createdAt: data.createdAt ? String(data.createdAt) : "",
  };
}

export async function cancelInvoice(
  db: Firestore,
  invoiceId: string,
  options: { actor?: string; reason?: string }
): Promise<{ invoice: PurchaseInvoice; plan: CancelPlan; reversedIds: string[] }> {
  if (!invoiceId) throw new InvoiceCancelError("INVOICE_REQUIRED");
  const invoiceRef = db.collection(COLLECTIONS.purchaseInvoices).doc(invoiceId);
  const invoiceSnap = await invoiceRef.get();
  if (!invoiceSnap.exists) throw new InvoiceCancelError("NOT_FOUND");
  const invoice = { id: invoiceSnap.id, ...invoiceSnap.data() } as PurchaseInvoice;
  const now = new Date().toISOString();

  // Short-circuit: already-cancelled invoices are returned as-is so retries
  // after a flaky network don't flip the audit or re-run work.
  if (invoice.status === "cancelled") {
    const movements = await loadInvoiceMovements(db, invoiceId);
    const extras = await loadReversalsFor(
      db,
      movements.filter((m) => m.type === "PURCHASE_IN").map((m) => m.id)
    );
    const plan = planInvoiceCancellation({ invoice, movements: [...movements, ...extras] });
    return { invoice, plan, reversedIds: invoice.cancelReversedMovementIds ?? [] };
  }

  const invoiceMovements = await loadInvoiceMovements(db, invoiceId);
  const sourceIds = invoiceMovements.filter((m) => m.type === "PURCHASE_IN").map((m) => m.id);
  const linkedReversals = await loadReversalsFor(db, sourceIds);
  const allMovements = [...invoiceMovements, ...linkedReversals];
  const plan = planInvoiceCancellation({ invoice, movements: allMovements });

  if (plan.status === "broken-link") {
    throw new InvoiceCancelError("BROKEN_LINK", { brokenLinks: plan.brokenLinks });
  }

  const reversedIds: string[] = [...(invoice.cancelReversedMovementIds ?? [])];
  const cancellationId = invoice.cancellationId || `cancel-${invoiceId}-${Date.now()}`;

  // Load current product balances so we can keep the balance doc in sync
  // without racing anyone else: each counter-movement writes its target
  // balance inside its own transaction.
  const uniqueProducts = Array.from(
    new Set(plan.movements.map((m) => m.productId).filter((v): v is string => Boolean(v)))
  );
  const balanceCache = await loadProductBalances(db, uniqueProducts);

  // Per-source transaction: tx.get on the counter-movement doc id gives us
  // Firestore-level dedup; concurrent runs or retries pick the existing row.
  for (const movement of plan.movements) {
    if (movement.remainingBaseQty <= 0.0001) continue;
    const counterRef = db
      .collection(COLLECTIONS.inventoryMovements)
      .doc(movement.counterMovementId);
    const balRef = db.collection(COLLECTIONS.inventoryBalances).doc(movement.productId);

    let committed = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(counterRef);
      if (existing.exists) {
        committed = false;
        return;
      }
      const balSnap = await tx.get(balRef);
      const currentBase = balSnap.exists
        ? asNumber(balSnap.data()?.quantityBase)
        : balanceCache.get(movement.productId) ?? movement.currentBalance;
      const nextBase = currentBase - movement.remainingBaseQty;
      tx.set(
        counterRef,
        sanitizeFirestoreData({
          productId: movement.productId,
          type: "REVERSAL",
          quantity: movement.remainingBaseQty,
          unit: movement.baseUnit,
          quantityBase: -movement.remainingBaseQty,
          reversesId: movement.sourceId,
          invoiceId,
          invoiceLineKey: movement.invoiceLineKey ?? null,
          invoiceLineId: movement.invoiceLineKey ?? null,
          cancellationId,
          actor: options.actor ?? null,
          note: `cancel:${invoiceId}`,
          quantityIn: -movement.remainingBaseQty,
          quantityBefore: currentBase,
          quantityAfter: nextBase,
          receivedAt: now,
          createdAt: now,
        })
      );
      tx.set(
        balRef,
        sanitizeFirestoreData({
          productId: movement.productId,
          quantityBase: nextBase,
          updatedAt: now,
        }),
        { merge: true }
      );
      balanceCache.set(movement.productId, nextBase);
      committed = true;
    });
    if (committed) reversedIds.push(movement.counterMovementId);
  }

  // Soft-cancel the price records so future comparisons ignore them, but
  // the history document stays intact for audit.
  const priceRecords = await db
    .collection(COLLECTIONS.purchasePriceRecords)
    .where("invoiceId", "==", invoiceId)
    .get();
  const writer = db.batch();
  priceRecords.docs.forEach((doc) => {
    writer.set(
      doc.ref,
      sanitizeFirestoreData({
        cancelledAt: now,
        cancelledBy: options.actor ?? null,
      }),
      { merge: true }
    );
  });
  if (!priceRecords.empty) await writer.commit();

  // Recompute lastPurchase on supplier offers that pointed at this invoice.
  if (invoice.supplierId) {
    const touchedProducts = new Set<string>();
    for (const line of invoice.lines ?? []) {
      if (line.productId) touchedProducts.add(line.productId);
    }
    for (const productId of touchedProducts) {
      await recomputeSupplierOfferLastPurchase(db, {
        productId,
        supplierId: invoice.supplierId,
        cancelledInvoiceId: invoiceId,
      });
    }
  }

  const updated: PurchaseInvoice = {
    ...invoice,
    status: "cancelled",
    scanStatus: "cancelled",
    stockStatus: "none",
    cancelledAt: now,
    cancelledBy: options.actor ?? invoice.cancelledBy,
    cancelReason: options.reason ?? invoice.cancelReason,
    cancellationId,
    cancelReversedMovementIds: Array.from(new Set(reversedIds)),
    audit: [
      ...(invoice.audit ?? []),
      { at: now, actor: options.actor, action: "INVOICE_CANCELLED", detail: options.reason },
    ].slice(-20),
    updatedAt: now,
  };
  await invoiceRef.set(sanitizeFirestoreData(updated), { merge: true });

  return { invoice: updated, plan, reversedIds };
}

/**
 * After cancellation we want supplier offers to reflect the next-most-recent
 * **non-cancelled** purchase for this product+supplier pair. We only touch
 * `lastPurchase*` fields when they currently point at the cancelled invoice,
 * so manual edits or newer purchases keep their state.
 */
async function recomputeSupplierOfferLastPurchase(
  db: Firestore,
  input: { productId: string; supplierId: string; cancelledInvoiceId: string }
): Promise<void> {
  const offerSnap = await db
    .collection(COLLECTIONS.supplierOffers)
    .where("productId", "==", input.productId)
    .where("supplierId", "==", input.supplierId)
    .limit(1)
    .get();
  const offerDoc = offerSnap.docs[0];
  if (!offerDoc) return;
  const data = offerDoc.data() as Record<string, unknown>;
  const linkedInvoice = data.lastInvoiceId ? String(data.lastInvoiceId) : null;
  if (linkedInvoice !== input.cancelledInvoiceId) return;

  // Find the next-latest non-cancelled approved purchase.
  const recordsSnap = await db
    .collection(COLLECTIONS.purchasePriceRecords)
    .where("productId", "==", input.productId)
    .where("supplierId", "==", input.supplierId)
    .get();
  const candidates = recordsSnap.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return { id: doc.id, ...data } as Record<string, unknown> & { id: string };
    })
    .filter((row) => {
      if (row.cancelledAt) return false;
      if (row.invoiceId === input.cancelledInvoiceId) return false;
      return true;
    })
    .sort((a, b) => {
      const bDate = String(b.purchaseDate ?? "");
      const aDate = String(a.purchaseDate ?? "");
      return bDate.localeCompare(aDate);
    });
  const next = candidates[0];
  if (!next) {
    await offerDoc.ref.set(
      sanitizeFirestoreData({
        lastInvoiceId: null,
        lastInvoiceNumber: null,
        lastInvoiceLineId: null,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
    return;
  }
  const packageQuantity = asNumber(next.packageQuantity ?? next.quantity, 1);
  const unit = (next.unit as InventoryMovement["unit"]) || "unit";
  const normalized = asNumber(next.priceIncludingVat ?? next.unitCost, 0);
  await offerDoc.ref.set(
    sanitizeFirestoreData({
      lastPurchasedAt: next.purchaseDate ?? null,
      lastPurchaseDate: next.purchaseDate ?? null,
      lastPurchasePrice: normalized,
      lastPriceIncludingVat: next.priceIncludingVat ?? null,
      lastPriceBeforeVat: next.priceBeforeVat ?? null,
      lastPackageQuantity: packageQuantity,
      lastUnit: unit,
      lastInvoiceId: next.invoiceId ?? null,
      lastInvoiceLineId: next.invoiceLineKey ?? null,
      lastUnitPriceNet: next.unitPriceNet ?? null,
      lastUnitPriceGross: next.unitPriceGross ?? null,
      updatedAt: new Date().toISOString(),
    }),
    { merge: true }
  );
}
