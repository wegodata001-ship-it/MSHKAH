import type { InvoiceStockStatus, PurchaseDocumentType } from "@/lib/inventory/types";

/**
 * Stock moves only when goods physically arrive, leave, or an admin records
 * an approved count. A later tax invoice for goods already received on a
 * delivery note must not increase stock again. A credit document must not
 * be posted as a purchase receipt.
 */
export type StockPostPolicyCode = "CREDIT_NO_AUTO_IN" | "ALREADY_RECEIVED";

export type LinkedStockDocument = {
  id: string;
  documentType?: PurchaseDocumentType;
  stockStatus?: InvoiceStockStatus;
};

const RECEIVED = new Set<InvoiceStockStatus>(["posted", "partial"]);

export function evaluateStockPostPolicy(input: {
  documentType?: PurchaseDocumentType;
  coversDeliveryIds?: string[];
  coveredByInvoiceId?: string;
  linked: LinkedStockDocument[];
}): { allow: true } | { allow: false; code: StockPostPolicyCode } {
  if (input.documentType === "credit") {
    return { allow: false, code: "CREDIT_NO_AUTO_IN" };
  }
  const linkedIds = new Set([
    ...(input.coversDeliveryIds ?? []),
    ...(input.coveredByInvoiceId ? [input.coveredByInvoiceId] : []),
  ]);
  if (linkedIds.size === 0) return { allow: true };
  const alreadyReceived = input.linked.some(
    (doc) => linkedIds.has(doc.id) && doc.stockStatus != null && RECEIVED.has(doc.stockStatus)
  );
  if (alreadyReceived) return { allow: false, code: "ALREADY_RECEIVED" };
  return { allow: true };
}
