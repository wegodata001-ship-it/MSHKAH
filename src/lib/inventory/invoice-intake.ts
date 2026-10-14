import { toDateOnly } from "@/lib/dates/normalize";
import { isConfirmedInvoiceMatch } from "@/lib/inventory/invoice-line-review";
import { invoiceFinanceTotals, lineHasAmount } from "@/lib/inventory/invoice-lines";
import { isPostedInvoice } from "@/lib/inventory/invoice-smart-match";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

export type InvoiceLineCareStatus = "ok" | "missing-unit" | "needs-match";

export type InvoiceIntakeBlocker = {
  key: string;
  labelKey: string;
  count?: number;
  field?: "invoiceDate" | "dueDate" | "supplier" | "invoiceNumber" | "lines" | "amounts";
};

export function invoiceLineCareStatus(line: PurchaseInvoiceLine): InvoiceLineCareStatus {
  if (!line.productId || !isConfirmedInvoiceMatch(line)) return "needs-match";
  if (!line.unit) return "missing-unit";
  return "ok";
}

export function invoiceNeedsAttention(line: PurchaseInvoiceLine): boolean {
  return invoiceLineCareStatus(line) !== "ok" || !lineHasAmount(line);
}

export function attentionLineCount(lines: PurchaseInvoiceLine[]): number {
  return lines.filter(invoiceNeedsAttention).length;
}

export function invoiceApproveBlockers(invoice: PurchaseInvoice): InvoiceIntakeBlocker[] {
  const blockers: InvoiceIntakeBlocker[] = [];
  if (!toDateOnly(invoice.invoiceDate)) {
    blockers.push({ key: "invoiceDate", labelKey: "admin.inventory.smart.blockDate", field: "invoiceDate" });
  }
  const unmatched = invoice.lines.filter((line) => !line.skipInventory && invoiceLineCareStatus(line) === "needs-match").length;
  if (unmatched > 0) {
    blockers.push({ key: "match", labelKey: "admin.inventory.smart.blockMatch", count: unmatched, field: "lines" });
  }
  const missingUnit = invoice.lines.filter((line) => !line.skipInventory && !line.unit && line.productId).length;
  if (missingUnit > 0) {
    blockers.push({ key: "unit", labelKey: "admin.inventory.smart.blockUnit", count: missingUnit, field: "lines" });
  }
  if (invoice.duplicateOf && isPostedInvoice({ status: invoice.duplicateSnapshot?.status || "saved", stockStatus: invoice.duplicateSnapshot?.stockStatus, inventoryPostedAt: invoice.duplicateSnapshot?.posted ? invoice.updatedAt : undefined })) {
    blockers.push({ key: "posted", labelKey: "admin.inventory.smart.blockPosted" });
  } else if (invoice.duplicateOf && invoice.duplicateSnapshot?.posted) {
    blockers.push({ key: "posted", labelKey: "admin.inventory.smart.blockPosted" });
  }
  const totals = invoiceFinanceTotals(invoice.lines);
  const sourceGross = invoice.sourceGross ?? invoice.grossAmount ?? invoice.grandTotal;
  if (sourceGross != null && totals.itemCount > 0 && Math.abs(totals.gross - sourceGross) > 1) {
    blockers.push({ key: "amounts", labelKey: "admin.inventory.smart.blockAmounts", field: "amounts" });
  }
  return blockers;
}

export function canApproveInvoice(invoice: PurchaseInvoice): boolean {
  return invoiceApproveBlockers(invoice).length === 0 && !isPostedInvoice(invoice);
}

export function applyComputedTotals(invoice: PurchaseInvoice): PurchaseInvoice {
  const totals = invoiceFinanceTotals(invoice.lines);
  return {
    ...invoice,
    computedNet: totals.net,
    computedVat: totals.vat,
    computedGross: totals.gross,
    validation: invoice.validation,
  };
}
