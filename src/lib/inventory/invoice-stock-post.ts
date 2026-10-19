import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { isAncillaryInvoiceLine, isPackagingInvoiceLine } from "@/lib/inventory/invoice-line-status";
import { isConfirmedInvoiceMatch } from "@/lib/inventory/invoice-line-review";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

export function sanitizeInventoryDocId(value: string): string {
  return value.replace(/[\/\\#?[\]*]/g, "_").slice(0, 700);
}

export function invoicePurchaseMovementId(invoiceId: string, lineKey: string): string {
  return sanitizeInventoryDocId(`in-${invoiceId}-${lineKey}`);
}

export function stockPostableLine(line: PurchaseInvoiceLine): boolean {
  return Boolean(
    !line.skipInventory &&
      !line.postedToStock &&
      !isAncillaryInvoiceLine(line) &&
      !isPackagingInvoiceLine(line) &&
      line.transferToInventory !== false &&
      line.productId &&
      isConfirmedInvoiceMatch(line) &&
      line.quantity &&
      line.unit &&
      invoiceLineQuantityBase(line) != null
  );
}

export function selectStockPostLines(invoice: PurchaseInvoice, lineKeys?: string[]): PurchaseInvoiceLine[] {
  const selected = lineKeys?.length
    ? invoice.lines.filter((line) => lineKeys.includes(line.key))
    : invoice.lines;
  return selected.filter(stockPostableLine);
}

export function invoiceMarkedPostedWithoutMovements(
  invoice: Pick<PurchaseInvoice, "stockStatus" | "inventoryPostedAt" | "lines">,
  postedKeys: Set<string>
): boolean {
  if (invoice.stockStatus !== "posted" && !invoice.inventoryPostedAt) return false;
  return invoice.lines.some((line) => !line.skipInventory && line.productId && !postedKeys.has(line.key) && !line.postedToStock);
}
