import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  assertPurgePhrase,
  backupCovers,
  summarizeRemoval,
  UNTOUCHED_ON_INVOICE_REMOVAL,
  type RemovalInvoice,
  type RemovalSummary,
} from "@/lib/inventory/invoice-removal";
import type { PurchaseInvoice } from "@/lib/inventory/types";

export class InvoiceRemovalError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, detail?: unknown) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

type Located = { id: string; collection: string; data: Record<string, unknown> };

async function locate(db: Firestore, id: string): Promise<Located | null> {
  for (const collection of [COLLECTIONS.purchaseInvoices, COLLECTIONS.archivePurchaseInvoices]) {
    const snap = await db.collection(collection).doc(id).get();
    if (snap.exists) return { id, collection, data: snap.data() as Record<string, unknown> };
  }
  return null;
}

async function idsIn(db: Firestore, collection: string): Promise<string[]> {
  const snap = await db.collection(collection).get();
  return snap.docs.map((doc) => doc.id);
}

function asRemoval(doc: Located): RemovalInvoice {
  const data = doc.data;
  return {
    id: doc.id,
    status: data.status ? String(data.status) : null,
    stockStatus: data.stockStatus ? String(data.stockStatus) : null,
    scanStatus: data.scanStatus ? String(data.scanStatus) : null,
    hasSource: Boolean(data.sourceFile || data.fileUrl),
    documentType: data.documentType ? String(data.documentType) : null,
  };
}

async function linksFor(db: Firestore, ids: string[]) {
  const movementIds: Record<string, string[]> = {};
  const movementTypes: Record<string, string[]> = {};
  const paymentIds: Record<string, string[]> = {};
  for (const id of ids) {
    movementIds[id] = [];
    movementTypes[id] = [];
    paymentIds[id] = [];
  }
  if (!ids.length) return { movementIds, movementTypes, paymentIds };
  const idSet = new Set(ids);
  for (const collection of [COLLECTIONS.inventoryMovements, COLLECTIONS.archiveInventoryMovements]) {
    const snap = await db.collection(collection).get();
    for (const doc of snap.docs) {
      const invoiceId = String(doc.data().invoiceId ?? "");
      if (!idSet.has(invoiceId)) continue;
      movementIds[invoiceId].push(doc.id);
      movementTypes[invoiceId].push(String(doc.data().type ?? ""));
    }
  }
  const payments = await db.collection(COLLECTIONS.supplierPayments).get();
  for (const doc of payments.docs) {
    const allocations = Array.isArray(doc.data().allocations) ? doc.data().allocations : [];
    for (const allocation of allocations) {
      const invoiceId = String(allocation?.invoiceId ?? "");
      if (paymentIds[invoiceId]) paymentIds[invoiceId].push(doc.id);
    }
  }
  return { movementIds, movementTypes, paymentIds };
}

async function protectedCounts(db: Firestore): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of UNTOUCHED_ON_INVOICE_REMOVAL) {
    const snap = await db.collection(name).count().get();
    counts[name] = snap.data().count;
  }
  return counts;
}

function countsMatch(before: Record<string, number>, after: Record<string, number>) {
  return UNTOUCHED_ON_INVOICE_REMOVAL.every((name) => before[name] === after[name]);
}

export async function previewInvoiceRemoval(
  db: Firestore,
  input: { scope: "active" | "archive"; ids?: string[] }
): Promise<RemovalSummary & { ids: string[] }> {
  const collection = input.scope === "archive" ? COLLECTIONS.archivePurchaseInvoices : COLLECTIONS.purchaseInvoices;
  const ids = input.ids?.length ? input.ids : await idsIn(db, collection);
  const located: Located[] = [];
  for (const id of ids) {
    const doc = await locate(db, id);
    if (doc && (input.ids?.length || doc.collection === collection)) located.push(doc);
  }
  const links = await linksFor(db, located.map((doc) => doc.id));
  return {
    ids: located.map((doc) => doc.id),
    ...summarizeRemoval(located.map(asRemoval), links.movementIds, links.paymentIds, links.movementTypes),
  };
}

export async function archiveInvoices(
  db: Firestore,
  input: { ids: string[]; actor: string; reason?: string }
): Promise<{ archived: string[]; missing: string[] }> {
  const before = await protectedCounts(db);
  const archived: string[] = [];
  const missing: string[] = [];
  const now = new Date().toISOString();
  for (const id of input.ids) {
    const doc = await locate(db, id);
    if (!doc) {
      missing.push(id);
      continue;
    }
    if (doc.collection === COLLECTIONS.archivePurchaseInvoices) {
      archived.push(id);
      continue;
    }
    const payload = {
      ...definedCopy(doc.data),
      sourceCollection: COLLECTIONS.purchaseInvoices,
      sourceId: id,
      archivedAt: now,
      archivedBy: input.actor,
      archiveReason: input.reason || "admin-archive",
      excludeFromActiveWork: true,
      repostBlocked: true,
    };
    await db.collection(COLLECTIONS.archivePurchaseInvoices).doc(id).set(payload);
    await db.collection(COLLECTIONS.purchaseInvoices).doc(id).delete();
    archived.push(id);
  }
  await db.collection(COLLECTIONS.invoiceAuditLog).add({
    at: now,
    actor: input.actor,
    action: "archive-invoices",
    invoiceIds: archived,
    missing,
  });
  const after = await protectedCounts(db);
  if (!countsMatch(before, after)) {
    throw new InvoiceRemovalError("PROTECTED_CHANGED");
  }
  return { archived, missing };
}

export async function purgeInvoices(
  db: Firestore,
  input: { ids: string[]; actor: string; phrase: string }
): Promise<{ deleted: string[]; backupId: string }> {
  const phrase = assertPurgePhrase(input.phrase);
  if (!phrase.ok) throw new InvoiceRemovalError(phrase.code);
  const located: Located[] = [];
  for (const id of input.ids) {
    const doc = await locate(db, id);
    if (doc) located.push(doc);
  }
  if (!located.length) throw new InvoiceRemovalError("NOT_FOUND");
  const links = await linksFor(db, located.map((doc) => doc.id));
  const summary = summarizeRemoval(located.map(asRemoval), links.movementIds, links.paymentIds, links.movementTypes);
  if (summary.purgeBlockedIds.length) {
    throw new InvoiceRemovalError("POSTED_STOCK", { ids: summary.purgeBlockedIds });
  }
  const before = await protectedCounts(db);
  const backup = db.collection(COLLECTIONS.invoicePurgeBackups).doc();
  const now = new Date().toISOString();
  await backup.set({
    at: now,
    actor: input.actor,
    invoiceIds: located.map((doc) => doc.id),
    verified: false,
  });
  for (const doc of located) {
    await backup.collection("invoices").doc(doc.id).set(definedCopy(doc.data));
  }
  const stored = await backup.collection("invoices").get();
  const storedIds = stored.docs.map((doc) => doc.id);
  const expected = located.map((doc) => doc.id);
  if (!backupCovers(expected, storedIds)) throw new InvoiceRemovalError("BACKUP_VERIFY_FAILED");
  await backup.set({ verified: true, verifiedCount: stored.size }, { merge: true });
  const check = await backup.get();
  if (check.data()?.verified !== true || check.data()?.verifiedCount !== expected.length) {
    throw new InvoiceRemovalError("BACKUP_VERIFY_FAILED");
  }
  for (const doc of located) {
    await db.collection(doc.collection).doc(doc.id).delete();
  }
  await db.collection(COLLECTIONS.invoiceAuditLog).add({
    at: now,
    actor: input.actor,
    action: "purge-invoices",
    invoiceIds: expected,
    backupId: backup.id,
    kept: UNTOUCHED_ON_INVOICE_REMOVAL,
  });
  const after = await protectedCounts(db);
  if (!countsMatch(before, after)) throw new InvoiceRemovalError("PROTECTED_CHANGED");
  return { deleted: expected, backupId: backup.id };
}

export type InvoiceDocumentPayload = {
  invoice: PurchaseInvoice;
  movements: { id: string; data: Record<string, unknown> }[];
  paidAmount: number;
  paymentsIncluded: true;
  productNames: Record<string, string>;
};

export async function loadInvoiceDocument(db: Firestore, invoiceId: string): Promise<InvoiceDocumentPayload> {
  const doc = await locate(db, invoiceId);
  if (!doc) throw new InvoiceRemovalError("NOT_FOUND");
  const movements: InvoiceDocumentPayload["movements"] = [];
  for (const collection of [COLLECTIONS.inventoryMovements, COLLECTIONS.archiveInventoryMovements]) {
    const snap = await db.collection(collection).where("invoiceId", "==", invoiceId).get();
    for (const row of snap.docs) movements.push({ id: row.id, data: row.data() as Record<string, unknown> });
  }
  let paidAmount = 0;
  const payments = await db.collection(COLLECTIONS.supplierPayments).get();
  for (const row of payments.docs) {
    if (row.data().status !== "executed") continue;
    const allocations = Array.isArray(row.data().allocations) ? row.data().allocations : [];
    for (const allocation of allocations) {
      if (String(allocation?.invoiceId ?? "") === invoiceId) paidAmount += Number(allocation.amount) || 0;
    }
  }
  const productNames: Record<string, string> = {};
  const productIds = new Set<string>();
  for (const movement of movements) {
    if (movement.data.productId) productIds.add(String(movement.data.productId));
  }
  const lines = Array.isArray(doc.data.lines) ? doc.data.lines : [];
  for (const line of lines) {
    if (line?.productId) productIds.add(String(line.productId));
  }
  for (const productId of productIds) {
    const ingredient = await db.collection(COLLECTIONS.ingredients).doc(productId).get();
    if (!ingredient.exists) continue;
    const data = ingredient.data() ?? {};
    const name = String(data.nameHe || data.name || data.nameAr || "").trim();
    if (name) productNames[productId] = name;
  }
  return {
    invoice: mapStoredInvoice(doc.id, doc.data),
    movements: movements.map((movement) => ({ id: movement.id, data: definedCopy(movement.data) })),
    paidAmount,
    paymentsIncluded: true,
    productNames,
  };
}

function definedCopy(data: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(data, (_key, value) => {
    if (value && typeof value === "object" && typeof value.toDate === "function") {
      try {
        return value.toDate().toISOString();
      } catch {
        return null;
      }
    }
    return value === undefined ? null : value;
  });
  return JSON.parse(json) as Record<string, unknown>;
}

export function mapStoredInvoice(id: string, data: Record<string, unknown>): PurchaseInvoice {
  const plain = definedCopy(data);
  const invoice = { id, ...plain, lines: Array.isArray(plain.lines) ? plain.lines : [] } as PurchaseInvoice;
  if (invoice.sourceFile?.downloadUrl) invoice.sourceFile = { ...invoice.sourceFile, downloadUrl: "" };
  return invoice;
}
