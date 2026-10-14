import { incompleteInvoiceLineCount, missingInvoiceFields } from "@/lib/inventory/invoice-archive";
import type { PurchaseInvoice } from "@/lib/inventory/types";

export type InvoiceReviewState = "incomplete" | "partial" | "ready";

export function invoiceHasExtractedData(invoice: Pick<PurchaseInvoice, "invoiceNumber" | "invoiceDate" | "netAmount" | "subtotal" | "vatAmount" | "vatTotal" | "grossAmount" | "grandTotal" | "lines">): boolean {
  return Boolean(
    invoice.invoiceNumber?.trim() ||
      invoice.invoiceDate ||
      invoice.lines?.length ||
      invoice.netAmount != null ||
      invoice.subtotal != null ||
      invoice.vatAmount != null ||
      invoice.vatTotal != null ||
      invoice.grossAmount != null ||
      invoice.grandTotal != null
  );
}

export function invoiceReviewState(invoice: PurchaseInvoice, failed = false): InvoiceReviewState {
  const extracted = invoiceHasExtractedData(invoice);
  if (!extracted || (failed && !extracted)) return "incomplete";
  const missing = missingInvoiceFields(invoice);
  const incomplete = incompleteInvoiceLineCount(invoice.lines ?? []);
  if (missing.length || incomplete > 0) return "partial";
  return "ready";
}
