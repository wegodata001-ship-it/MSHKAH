import { roundMoney } from "@/lib/costing/money";
import { isConfirmedInvoiceMatch } from "@/lib/inventory/invoice-line-review";
import { invoiceFinanceTotals } from "@/lib/inventory/invoice-lines";
import type { InvoiceStockStatus, PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

const TOLERANCE = 0.05;

export function isFinanceSaved(invoice: Pick<PurchaseInvoice, "status">): boolean {
  return invoice.status === "saved" || invoice.status === "approved";
}

export function invoiceStockStatus(invoice: Pick<PurchaseInvoice, "status" | "stockStatus" | "lines">): InvoiceStockStatus {
  if (invoice.stockStatus) return invoice.stockStatus;
  if (invoice.lines?.some((line) => line.postedToStock) && invoice.lines.some((line) => !line.postedToStock && !line.skipInventory)) {
    return "partial";
  }
  if (invoice.status === "approved" || invoice.lines?.some((line) => line.postedToStock)) return "posted";
  return "none";
}

export function canTransferStock(invoice: PurchaseInvoice): boolean {
  return isFinanceSaved(invoice) && invoiceStockStatus(invoice) !== "posted";
}

export function transferableLines(lines: PurchaseInvoiceLine[]): PurchaseInvoiceLine[] {
  return lines.filter(
    (line) =>
      !line.skipInventory &&
      !line.postedToStock &&
      line.transferToInventory !== false &&
      isConfirmedInvoiceMatch(line) &&
      Boolean(line.quantity) &&
      Boolean(line.unit)
  );
}

export function headerNet(invoice: Pick<PurchaseInvoice, "netAmount" | "subtotal">): number | null {
  return invoice.netAmount ?? invoice.subtotal ?? null;
}

export function headerVat(invoice: Pick<PurchaseInvoice, "vatAmount" | "vatTotal">): number | null {
  return invoice.vatAmount ?? invoice.vatTotal ?? null;
}

export function headerGross(invoice: Pick<PurchaseInvoice, "grossAmount" | "grandTotal">): number | null {
  return invoice.grossAmount ?? invoice.grandTotal ?? null;
}

export function originalInvoiceGross(invoice: Pick<PurchaseInvoice, "originalInvoiceTotal" | "invoiceTotalFromSource" | "sourceGross">): number | null {
  return invoice.originalInvoiceTotal ?? invoice.invoiceTotalFromSource ?? invoice.sourceGross ?? null;
}

/** The payable amount an admin is checking. A manual edit wins over the printed source total. */
export function payableInvoiceGross(invoice: Pick<PurchaseInvoice, "manuallyEdited" | "editedInvoiceTotal" | "originalInvoiceTotal" | "invoiceTotalFromSource" | "sourceGross" | "grossAmount" | "grandTotal">): number | null {
  if (invoice.manuallyEdited && invoice.editedInvoiceTotal != null) return invoice.editedInvoiceTotal;
  return originalInvoiceGross(invoice) ?? headerGross(invoice);
}

export type InvoiceMismatch = {
  hasMismatch: boolean;
  lineNet: number;
  lineVat: number;
  lineGross: number;
  headerNet: number | null;
  headerVat: number | null;
  headerGross: number | null;
  netDiff: number | null;
  vatDiff: number | null;
  grossDiff: number | null;
};

export function invoiceMismatch(invoice: PurchaseInvoice): InvoiceMismatch {
  const totals = invoiceFinanceTotals(invoice.lines);
  const net = headerNet(invoice);
  const vat = headerVat(invoice);
  const gross = headerGross(invoice);
  const netDiff = net == null ? null : roundMoney(totals.net - net);
  const vatDiff = vat == null ? null : roundMoney(totals.vat - vat);
  const grossDiff = gross == null ? null : roundMoney(totals.gross - gross);
  const off = (value: number | null) => value != null && Math.abs(value) > TOLERANCE;
  return {
    hasMismatch: off(netDiff) || off(vatDiff) || off(grossDiff),
    lineNet: totals.net,
    lineVat: totals.vat,
    lineGross: totals.gross,
    headerNet: net,
    headerVat: vat,
    headerGross: gross,
    netDiff,
    vatDiff,
    grossDiff,
  };
}

export function compareInvoiceTotals(
  invoice: Pick<PurchaseInvoice, "sourceNet" | "netAmount" | "subtotal" | "sourceVat" | "vatAmount" | "vatTotal" | "sourceGross" | "grossAmount" | "grandTotal" | "lines" | "manuallyEdited" | "editedInvoiceTotal" | "originalInvoiceTotal" | "invoiceTotalFromSource" | "headerDiscount" | "discountTotal" | "adjustmentAmount" | "rounding" | "vatRate">
) {
  const sourceNet = invoice.sourceNet ?? invoice.netAmount ?? invoice.subtotal ?? null;
  const sourceVat = invoice.sourceVat ?? invoice.vatAmount ?? invoice.vatTotal ?? null;
  const sourceGross = originalInvoiceGross(invoice) ?? headerGross(invoice);
  const payable = payableInvoiceGross(invoice);
  const totals = invoiceFinanceTotals(invoice.lines);
  const calculatedLinesTotal = totals.itemCount ? totals.gross : null;
  const differenceAmount = payable == null || calculatedLinesTotal == null ? null : roundMoney(calculatedLinesTotal - payable);
  const headerConsistent = sourceNet != null && sourceVat != null && sourceGross != null && Math.abs(roundMoney(sourceNet + sourceVat - sourceGross)) <= TOLERANCE;
  const validationStatus = payable == null ? "missing" : differenceAmount != null && Math.abs(differenceAmount) <= TOLERANCE ? "pass" : "review";
  return {
    sourceNet,
    sourceVat,
    sourceGross,
    invoiceTotalFromSource: sourceGross,
    payable,
    workingNet: headerNet(invoice),
    workingVat: headerVat(invoice),
    calculatedNet: totals.net,
    calculatedVat: totals.vat,
    calculatedLinesTotal,
    differenceAmount,
    headerConsistent,
    validationStatus,
  } as const;
}

export function syncInvoiceTotals(invoice: PurchaseInvoice): PurchaseInvoice {
  return {
    ...invoice,
    netAmount: invoice.netAmount ?? invoice.subtotal ?? null,
    vatAmount: invoice.vatAmount ?? invoice.vatTotal ?? null,
    grossAmount: invoice.grossAmount ?? invoice.grandTotal ?? null,
    subtotal: invoice.subtotal ?? invoice.netAmount ?? null,
    vatTotal: invoice.vatTotal ?? invoice.vatAmount ?? null,
    grandTotal: invoice.grandTotal ?? invoice.grossAmount ?? null,
  };
}

export function monthKey(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function financeMonthStats(invoices: PurchaseInvoice[], now = new Date()) {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = invoices.filter((item) => isFinanceSaved(item) && monthKey(item.invoiceDate || item.createdAt) === key);
  return {
    count: month.length,
    net: month.reduce((sum, item) => sum + (headerNet(item) ?? 0), 0),
    vat: month.reduce((sum, item) => sum + (headerVat(item) ?? 0), 0),
    gross: month.reduce((sum, item) => sum + (headerGross(item) ?? 0), 0),
    pendingReview: invoices.filter((item) => item.status === "draft" || item.status === "needs_review").length,
    pendingStock: invoices.filter((item) => isFinanceSaved(item) && invoiceStockStatus(item) !== "posted").length,
  };
}
