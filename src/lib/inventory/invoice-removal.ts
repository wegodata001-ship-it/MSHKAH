import type { PurchaseInvoiceStatus } from "@/lib/inventory/types";

export const PURGE_PHRASE = "DELETE ALL INVOICES";

/** Collections a removal must never write. */
export const UNTOUCHED_ON_INVOICE_REMOVAL = [
  "orders",
  "payments",
  "products",
  "categories",
  "customers",
  "users",
  "settings",
  "supplierPayments",
  "inventoryMovements",
  "inventoryBalances",
  "archiveInventoryMovements",
] as const;

export type RemovalInvoice = {
  id: string;
  status?: PurchaseInvoiceStatus | string | null;
  stockStatus?: "none" | "partial" | "posted" | string | null;
  scanStatus?: string | null;
  hasSource: boolean;
  documentType?: string | null;
};

export type RemovalSummary = {
  count: number;
  posted: number;
  inReview: number;
  withSource: number;
  withMovements: number;
  withPayments: number;
  retention: number;
  purgeBlockedIds: string[];
};

const REVIEW = new Set(["draft", "needs_review", "approving", "uploaded", "scanning"]);

export function isPostedInvoice(invoice: RemovalInvoice): boolean {
  return invoice.stockStatus === "posted" || invoice.stockStatus === "partial";
}

export function summarizeRemoval(
  invoices: RemovalInvoice[],
  movementIds: Record<string, string[]>,
  paymentIds: Record<string, string[]>,
  movementTypes: Record<string, string[]> = {}
): RemovalSummary {
  let posted = 0;
  let inReview = 0;
  let withSource = 0;
  let withMovements = 0;
  let withPayments = 0;
  const purgeBlockedIds: string[] = [];
  for (const invoice of invoices) {
    if (isPostedInvoice(invoice)) posted += 1;
    if (REVIEW.has(String(invoice.status || "")) || REVIEW.has(String(invoice.scanStatus || ""))) inReview += 1;
    if (invoice.hasSource) withSource += 1;
    if ((movementIds[invoice.id] ?? []).length) withMovements += 1;
    if ((paymentIds[invoice.id] ?? []).length) withPayments += 1;
    if (purgeBlocked(invoice, movementTypes[invoice.id] ?? [])) purgeBlockedIds.push(invoice.id);
  }
  return {
    count: invoices.length,
    posted,
    inReview,
    withSource,
    withMovements,
    withPayments,
    retention: invoices.length,
    purgeBlockedIds,
  };
}

function purgeBlocked(invoice: RemovalInvoice, types: string[]): boolean {
  if (!isPostedInvoice(invoice)) return false;
  if (invoice.status === "cancelled") return false;
  return !types.includes("REVERSAL");
}

export function assertPurgePhrase(phrase: string): { ok: true } | { ok: false; code: "PHRASE_REQUIRED" } {
  if (phrase !== PURGE_PHRASE) return { ok: false, code: "PHRASE_REQUIRED" };
  return { ok: true };
}

export function backupCovers(expectedIds: string[], storedIds: string[]): boolean {
  if (expectedIds.length !== storedIds.length) return false;
  const stored = new Set(storedIds);
  return expectedIds.every((id) => stored.has(id));
}
