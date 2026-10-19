import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { ServiceError, failure, success, type ServiceResult } from "@/lib/errors";
import type { CashFlowEntry } from "@/lib/cashflow/engine";
import {
  cashEntryId,
  mergeAliasNames,
  openingDocId,
  paymentCashEntries,
  paymentDocId,
  supplierIdentityMatch,
  type SupplierLedgerHistory,
  type SupplierOpening,
  type SupplierPayment,
  type SupplierPaymentAllocation,
  type SupplierPaymentMethod,
  type SupplierPaymentStatus,
} from "@/lib/inventory/supplier-ledger";
import type { PurchaseInvoice, Supplier } from "@/lib/inventory/types";
import { nowTimestamp, timestampToIso } from "@/types/firestore";

function asNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function historyOf(value: unknown): SupplierLedgerHistory[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [{ at: String(row.at ?? ""), actor: row.actor ? String(row.actor) : undefined, change: String(row.change ?? "") }];
  });
}

function mapPayment(id: string, data: Record<string, unknown>): SupplierPayment {
  const allocations = Array.isArray(data.allocations)
    ? data.allocations.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (!row.invoiceId) return [];
        return [{ invoiceId: String(row.invoiceId), amount: asNumber(row.amount) }];
      })
    : [];
  const status: SupplierPaymentStatus = data.status === "planned" || data.status === "cancelled" ? data.status : "executed";
  const method = data.method;
  return {
    id,
    supplierId: String(data.supplierId ?? ""),
    amount: asNumber(data.amount),
    paidAt: String(data.paidAt ?? "").slice(0, 10),
    dueAt: data.dueAt ? String(data.dueAt).slice(0, 10) : undefined,
    method: method === "cash" || method === "bank" || method === "check" || method === "card" || method === "other" ? method : "other",
    reference: data.reference ? String(data.reference) : undefined,
    account: data.account ? String(data.account) : undefined,
    note: data.note ? String(data.note) : undefined,
    status,
    allocations,
    idempotencyKey: data.idempotencyKey ? String(data.idempotencyKey) : undefined,
    cashEntryIds: Array.isArray(data.cashEntryIds) ? data.cashEntryIds.map((item) => String(item)) : undefined,
    actor: data.actor ? String(data.actor) : undefined,
    createdAt: timestampToIso(data.createdAt as never),
    updatedAt: data.updatedAt ? timestampToIso(data.updatedAt as never) : undefined,
    history: historyOf(data.history),
  };
}

function mapOpening(id: string, data: Record<string, unknown>): SupplierOpening {
  return {
    id,
    supplierId: String(data.supplierId ?? ""),
    amount: asNumber(data.amount),
    date: String(data.date ?? "").slice(0, 10),
    note: data.note ? String(data.note) : undefined,
    actor: data.actor ? String(data.actor) : undefined,
    createdAt: timestampToIso(data.createdAt as never),
    history: historyOf(data.history),
  };
}

export function subscribeSupplierPayments(onData: (items: SupplierPayment[]) => void, onError?: (message: string) => void): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.supplierPayments),
    (snap) => onData(snap.docs.map((item) => mapPayment(item.id, item.data() as Record<string, unknown>))),
    (error) => onError?.(error.message)
  );
}

export function subscribeSupplierOpenings(onData: (items: SupplierOpening[]) => void, onError?: (message: string) => void): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.supplierOpenings),
    (snap) => onData(snap.docs.map((item) => mapOpening(item.id, item.data() as Record<string, unknown>))),
    (error) => onError?.(error.message)
  );
}

export async function saveSupplierPayment(input: {
  supplierId: string;
  supplierName: string;
  amount: number;
  paidAt: string;
  dueAt?: string;
  method: SupplierPaymentMethod;
  reference?: string;
  account?: string;
  note?: string;
  status: Exclude<SupplierPaymentStatus, "cancelled">;
  allocations: SupplierPaymentAllocation[];
  idempotencyKey: string;
  actor?: string;
}): Promise<ServiceResult<{ id: string; reused: boolean }>> {
  try {
    const db = getDb();
    const id = paymentDocId(input.supplierId, input.idempotencyKey);
    const now = new Date().toISOString();
    const payment: SupplierPayment = {
      id,
      supplierId: input.supplierId,
      amount: input.amount,
      paidAt: input.paidAt,
      dueAt: input.dueAt,
      method: input.method,
      reference: input.reference,
      account: input.account,
      note: input.note,
      status: input.status,
      allocations: input.allocations,
      idempotencyKey: input.idempotencyKey,
      actor: input.actor,
      createdAt: now,
      history: [{ at: now, actor: input.actor, change: input.status === "planned" ? "planned" : "executed" }],
    };
    const entries = paymentCashEntries(payment, input.supplierName);
    payment.cashEntryIds = entries.map((entry) => entry.id);
    let reused = false;
    await runTransaction(db, async (tx) => {
      const ref = doc(db, COLLECTIONS.supplierPayments, id);
      const existing = await tx.get(ref);
      if (existing.exists()) {
        reused = true;
        return;
      }
      tx.set(ref, sanitizeFirestoreData({ ...payment, createdAt: nowTimestamp(), updatedAt: nowTimestamp() }));
      for (const entry of entries) {
        tx.set(doc(db, COLLECTIONS.cashFlowEntries, entry.id), sanitizeFirestoreData({ ...entry, createdAt: nowTimestamp() }));
      }
    });
    return success({ id, reused });
  } catch (error) {
    return failure(error, "Failed to save supplier payment");
  }
}

export async function cancelSupplierPayment(payment: SupplierPayment, actor?: string): Promise<ServiceResult<string>> {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    await runTransaction(db, async (tx) => {
      const ref = doc(db, COLLECTIONS.supplierPayments, payment.id);
      const existing = await tx.get(ref);
      if (!existing.exists()) throw new ServiceError("Missing payment", "NOT_FOUND");
      const history = historyOf(existing.data()?.history);
      tx.update(
        ref,
        sanitizeFirestoreData({
          status: "cancelled",
          updatedAt: nowTimestamp(),
          history: [...history, { at: now, actor, change: "cancelled" }],
        })
      );
      for (const entryId of payment.cashEntryIds ?? []) {
        const entryRef = doc(db, COLLECTIONS.cashFlowEntries, entryId);
        const entry = await tx.get(entryRef);
        if (entry.exists()) tx.update(entryRef, { status: "cancelled", updatedAt: nowTimestamp() });
      }
    });
    return success(payment.id);
  } catch (error) {
    return failure(error, "Failed to cancel supplier payment");
  }
}

export async function saveSupplierOpening(input: {
  supplierId: string;
  amount: number;
  date: string;
  note?: string;
  actor?: string;
  previous?: SupplierOpening;
}): Promise<ServiceResult<string>> {
  try {
    const db = getDb();
    const id = openingDocId(input.supplierId);
    const now = new Date().toISOString();
    const history = [...(input.previous?.history ?? []), { at: now, actor: input.actor, change: input.previous ? "corrected" : "opened" }];
    await runTransaction(db, async (tx) => {
      tx.set(
        doc(db, COLLECTIONS.supplierOpenings, id),
        sanitizeFirestoreData({
          supplierId: input.supplierId,
          amount: input.amount,
          date: input.date,
          note: input.note || null,
          actor: input.actor || null,
          history,
          updatedAt: nowTimestamp(),
          createdAt: input.previous ? undefined : nowTimestamp(),
        }),
        { merge: true }
      );
    });
    return success(id);
  } catch (error) {
    return failure(error, "Failed to save opening balance");
  }
}

export async function linkDeliveryToInvoice(deliveryId: string, invoiceId: string, actor?: string): Promise<ServiceResult<void>> {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    await updateDoc(doc(db, COLLECTIONS.purchaseInvoices, deliveryId), sanitizeFirestoreData({ coveredByInvoiceId: invoiceId, updatedAt: nowTimestamp() }));
    await updateDoc(
      doc(db, COLLECTIONS.purchaseInvoices, invoiceId),
      sanitizeFirestoreData({
        coversDeliveryIds: arrayUnion(deliveryId),
        updatedAt: nowTimestamp(),
        audit: arrayUnion({ at: now, actor, action: "LINK_DELIVERY", detail: deliveryId }),
      })
    );
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to link delivery");
  }
}

export async function appendSupplierAudit(supplierId: string, actor: string | undefined, action: string, detail?: string, current: Supplier["audit"] = []): Promise<ServiceResult<void>> {
  try {
    const entry = { at: new Date().toISOString(), actor, action, detail };
    await updateDoc(doc(getDb(), COLLECTIONS.suppliers, supplierId), {
      audit: [...current, entry].slice(-40),
      updatedAt: nowTimestamp(),
    });
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to save supplier history");
  }
}

async function reassign(collectionName: string, field: string, from: string, to: string, extra?: Record<string, unknown>) {
  const db = getDb();
  const snap = await getDocs(query(collection(db, collectionName), where(field, "==", from)));
  await Promise.all(snap.docs.map((item) => updateDoc(item.ref, sanitizeFirestoreData({ [field]: to, ...extra, updatedAt: nowTimestamp() }))));
  return snap.size;
}

export async function mergeSuppliers(input: {
  survivor: Supplier;
  loser: Supplier;
  invoices: PurchaseInvoice[];
  actor?: string;
}): Promise<ServiceResult<{ moved: number }>> {
  try {
    const identity = supplierIdentityMatch(input.survivor, input.loser, input.invoices);
    if (!identity.match) return failure(new ServiceError("MERGE_NEEDS_IDENTITY", "VALIDATION"));
    const db = getDb();
    const aliases = mergeAliasNames(input.survivor, input.loser);
    const movedInvoices = await reassign(COLLECTIONS.purchaseInvoices, "supplierId", input.loser.id, input.survivor.id, { supplierName: input.survivor.name });
    const movedPayments = await reassign(COLLECTIONS.supplierPayments, "supplierId", input.loser.id, input.survivor.id);
    await reassign(COLLECTIONS.supplierOpenings, "supplierId", input.loser.id, input.survivor.id);
    await reassign(COLLECTIONS.supplierOffers, "supplierId", input.loser.id, input.survivor.id);
    await reassign(COLLECTIONS.supplierItemMaps, "supplierId", input.loser.id, input.survivor.id);
    const now = new Date().toISOString();
    await updateDoc(
      doc(db, COLLECTIONS.suppliers, input.survivor.id),
      sanitizeFirestoreData({
        aliases,
        audit: [...(input.survivor.audit ?? []), { at: now, actor: input.actor, action: "MERGE", detail: input.loser.id }].slice(-40),
        updatedAt: nowTimestamp(),
      })
    );
    await updateDoc(
      doc(db, COLLECTIONS.suppliers, input.loser.id),
      sanitizeFirestoreData({
        active: false,
        mergedInto: input.survivor.id,
        audit: [...(input.loser.audit ?? []), { at: now, actor: input.actor, action: "MERGED_INTO", detail: input.survivor.id }].slice(-40),
        updatedAt: nowTimestamp(),
      })
    );
    return success({ moved: movedInvoices + movedPayments });
  } catch (error) {
    return failure(error, "Failed to merge suppliers");
  }
}

export type { CashFlowEntry };
