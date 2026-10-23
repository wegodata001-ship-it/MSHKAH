import { roundMoney } from "@/lib/costing/money";
import { toDateOnly } from "@/lib/dates/normalize";
import { invoiceFinanceTotals } from "@/lib/inventory/invoice-lines";
import { invoiceMoneyCheck } from "@/lib/inventory/invoice-finance";
import {
  invoiceLineBlockers,
  invoiceLineReviewStatus,
  type InvoiceLineCareKind,
  type InvoiceLineReviewStatus,
} from "@/lib/inventory/invoice-line-status";
import { isPostedInvoice } from "@/lib/inventory/invoice-smart-match";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

export type InvoiceLineCareStatus = "ok" | "missing-unit" | "needs-match";

export type InvoiceIntakeBlocker = {
  key: string;
  labelKey: string;
  count?: number;
  field?: "invoiceDate" | "dueDate" | "supplier" | "invoiceNumber" | "lines" | "amounts";
};

export function invoiceLineCareStatus(line: PurchaseInvoiceLine, dirty = false): InvoiceLineCareStatus {
  const status = invoiceLineReviewStatus(line, { dirty });
  if (status.kind === "ready" || status.kind === "posted" || status.kind === "ancillary" || status.kind === "packaging" || status.kind === "excluded") return "ok";
  if (status.kind === "missing-unit") return "missing-unit";
  if (status.kind === "missing-material") return "needs-match";
  return status.kind === "unsaved" ? "ok" : "needs-match";
}

export function invoiceNeedsAttention(
  line: PurchaseInvoiceLine,
  options?: { dirty?: boolean; productBase?: "g" | "ml" | "unit" | null }
): boolean {
  return !invoiceLineReviewStatus(line, options).ready;
}

export function intakeFailureMessageKey(code?: string): string {
  if (code === "PERMISSION_DENIED") return "admin.inventory.smart.permissionSystem";
  if (code === "NETWORK") return "admin.inventory.smart.networkError";
  if (code === "INVALID_RESPONSE") return "admin.inventory.smart.invalidResponse";
  if (code === "POSTING_IN_PROGRESS") return "admin.inventory.smart.postingInProgress";
  if (code === "NO_STOCK_LINES") return "admin.finance.noStockLines";
  if (code === "DUPLICATE_INVOICE") return "admin.inventory.smart.duplicate";
  if (code === "ALREADY_POSTED") return "admin.inventory.smart.alreadyPosted";
  if (code === "LINES_INCOMPLETE") return "admin.inventory.smart.linesIncomplete";
  if (code === "MONEY_GAP") return "admin.inventory.smart.moneyGapBlocked";
  return "admin.inventory.smart.stockNotPosted";
}

export function intakeStatusUncertain(code?: string): boolean {
  return code === "NETWORK" || code === "INVALID_RESPONSE";
}

export function attentionLineCount(
  lines: PurchaseInvoiceLine[],
  dirtyKeys?: Iterable<string>
): number {
  const dirty = new Set(dirtyKeys ?? []);
  return invoiceLineBlockers(lines, { dirtyKeys: dirty }).length;
}

export function invoiceApproveBlockers(
  invoice: PurchaseInvoice,
  options?: { dirtyKeys?: Iterable<string> }
): InvoiceIntakeBlocker[] {
  const blockers: InvoiceIntakeBlocker[] = [];
  if (!toDateOnly(invoice.invoiceDate)) {
    blockers.push({ key: "invoiceDate", labelKey: "admin.inventory.smart.blockDate", field: "invoiceDate" });
  }
  const lineBlockers = invoiceLineBlockers(invoice.lines, { dirtyKeys: options?.dirtyKeys });
  const unmatched = lineBlockers.filter((item) => item.kind === "missing-material").length;
  if (unmatched > 0) {
    blockers.push({ key: "match", labelKey: "admin.inventory.smart.blockMatch", count: unmatched, field: "lines" });
  }
  const missingUnit = lineBlockers.filter((item) => item.kind === "missing-unit").length;
  if (missingUnit > 0) {
    blockers.push({ key: "unit", labelKey: "admin.inventory.smart.blockUnit", count: missingUnit, field: "lines" });
  }
  const unsaved = lineBlockers.filter((item) => item.kind === "unsaved").length;
  if (unsaved > 0) {
    blockers.push({ key: "unsaved", labelKey: "admin.inventory.smart.unsavedLines", count: unsaved, field: "lines" });
  }
  const other = lineBlockers.filter((item) => item.kind !== "missing-material" && item.kind !== "missing-unit" && item.kind !== "unsaved").length;
  if (other > 0) {
    blockers.push({ key: "lines", labelKey: "admin.inventory.smart.needsTreatment", count: other, field: "lines" });
  }
  if (invoice.duplicateOf && isPostedInvoice({ status: invoice.duplicateSnapshot?.status || "saved", stockStatus: invoice.duplicateSnapshot?.stockStatus, inventoryPostedAt: invoice.duplicateSnapshot?.posted ? invoice.updatedAt : undefined })) {
    blockers.push({ key: "posted", labelKey: "admin.inventory.smart.blockPosted" });
  } else if (invoice.duplicateOf && invoice.duplicateSnapshot?.posted) {
    blockers.push({ key: "posted", labelKey: "admin.inventory.smart.blockPosted" });
  }
  return blockers;
}

export function readyProductLineCount(lines: PurchaseInvoiceLine[]): number {
  return lines.filter((line) => {
    const status = invoiceLineReviewStatus(line);
    return status.kind === "ready" || status.kind === "posted";
  }).length;
}

export function canApproveInvoice(invoice: PurchaseInvoice): boolean {
  if (invoiceApproveBlockers(invoice).length > 0 || isPostedInvoice(invoice)) return false;
  const money = invoiceMoneyCheck(invoice);
  return !money.hasMismatch || invoice.moneyGapAccepted === true;
}

export function applyComputedTotals(invoice: PurchaseInvoice): PurchaseInvoice {
  const totals = invoiceFinanceTotals(invoice.lines);
  const original = invoice.originalInvoiceTotal ?? invoice.invoiceTotalFromSource ?? invoice.sourceGross ?? null;
  const payable = invoice.manuallyEdited && invoice.editedInvoiceTotal != null
    ? invoice.editedInvoiceTotal
    : original ?? invoice.grossAmount ?? invoice.grandTotal ?? null;
  const money = invoiceMoneyCheck(invoice);
  return {
    ...invoice,
    originalInvoiceTotal: invoice.originalInvoiceTotal ?? original,
    invoiceTotalFromSource: invoice.invoiceTotalFromSource ?? original,
    calculatedLinesTotal: totals.itemCount ? totals.gross : null,
    differenceAmount: money.difference,
    validationStatus: payable == null ? "missing" : !totals.itemCount ? "review" : money.hasMismatch ? "review" : "pass",
    computedNet: totals.net,
    computedVat: totals.vat,
    computedGross: totals.gross,
    grossAmount: invoice.grossAmount ?? invoice.grandTotal ?? payable,
    sourceGross: invoice.sourceGross ?? original,
    validation: invoice.validation,
  };
}

export type { InvoiceLineCareKind, InvoiceLineReviewStatus };
