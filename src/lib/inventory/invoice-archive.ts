import { roundMoney } from "@/lib/costing/money";
import { toDateOnly } from "@/lib/dates/normalize";
import { invoiceFinanceTotals, isNonStockInvoiceLine } from "@/lib/inventory/invoice-lines";
import { invoiceLineReviewStatus } from "@/lib/inventory/invoice-line-status";
import type {
  InvoiceScanStatus,
  InvoiceSourceKind,
  InvoiceTotalsValidation,
  PurchaseInvoice,
  PurchaseInvoiceLine,
} from "@/lib/inventory/types";

export const INVOICE_SCAN_STATUSES: InvoiceScanStatus[] = [
  "uploaded",
  "scanning",
  "needs_review",
  "ready",
  "approved",
  "posted",
  "failed",
  "cancelled",
];

export function sourceKindFromFile(file: { name?: string; type?: string; capture?: boolean }): InvoiceSourceKind {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "image/png" || name.endsWith(".png")) return "png";
  if (type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  return "other";
}

export function invoiceSourcePath(invoiceId: string, filename: string, at = new Date()): string {
  const ext = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() || "bin" : "bin";
  const safeExt = ["pdf", "jpg", "jpeg", "png"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "bin";
  return `invoice-files/${at.getFullYear()}/${String(at.getMonth() + 1).padStart(2, "0")}/${invoiceId}/original.${safeExt}`;
}

export function archiveStatus(invoice: PurchaseInvoice): InvoiceScanStatus {
  // A cancelled invoice always surfaces as cancelled, regardless of any
  // historical scanStatus the file might carry.
  if (invoice.status === "cancelled") return "cancelled";
  if (invoice.scanStatus) return invoice.scanStatus;
  if (invoice.inventoryPostedAt || invoice.stockStatus === "posted") return "posted";
  if (invoice.status === "approved" || invoice.status === "saved") return "approved";
  if (invoice.status === "rejected") return "cancelled";
  if (invoice.status === "needs_review") return "needs_review";
  if (invoice.lines?.length) return "needs_review";
  if (invoice.sourceFile || invoice.fileUrl) return "uploaded";
  return "uploaded";
}

export function confidenceTone(confidence: number | null | undefined): "ok" | "warn" | "bad" | "empty" {
  if (confidence == null) return "empty";
  if (confidence >= 0.8) return "ok";
  if (confidence >= 0.6) return "warn";
  return "bad";
}

export function validateInvoiceTotals(input: {
  lines: PurchaseInvoiceLine[];
  headerNet?: number | null;
  headerVat?: number | null;
  headerGross?: number | null;
  headerDiscount?: number | null;
}): InvoiceTotalsValidation {
  const totals = invoiceFinanceTotals(input.lines);
  const lineNetSum = totals.net;
  const lineVatSum = totals.vat;
  const lineGrossSum = totals.gross;
  const headerNet = input.headerNet ?? null;
  const headerVat = input.headerVat ?? null;
  const headerGross = input.headerGross ?? null;
  // The stored net is already after the document discount. Do not subtract it again.
  const computedGross = headerNet != null && headerVat != null ? roundMoney(headerNet + headerVat) : (totals.itemCount ? lineGrossSum : null);
  const netDiff = headerNet == null || !totals.itemCount ? null : roundMoney(lineNetSum - headerNet);
  const vatDiff = headerVat == null || !totals.itemCount ? null : roundMoney(lineVatSum - headerVat);
  const grossDiff = headerGross == null || !totals.itemCount ? null : roundMoney(lineGrossSum - headerGross);
  const off = (value: number | null) => value != null && Math.abs(value) > 0.05;
  const netPlusVat = headerNet != null && headerVat != null && headerGross != null
    ? Math.abs(roundMoney(headerNet + headerVat - headerGross)) > 0.05
    : false;
  const hasMismatch = off(netDiff) || off(vatDiff) || off(grossDiff) || netPlusVat;
  return {
    lineNetSum,
    lineVatSum,
    lineGrossSum,
    headerNet,
    headerVat,
    headerGross,
    computedGross,
    netDiff,
    vatDiff,
    grossDiff,
    hasMismatch,
    invoiceTotalFromSource: headerGross,
    calculatedLinesTotal: totals.itemCount ? lineGrossSum : null,
    differenceAmount: grossDiff,
    validationStatus: headerGross == null ? "missing" : hasMismatch ? "review" : "pass",
  };
}

export function invoiceArchiveQuery(
  invoices: PurchaseInvoice[],
  input: {
    filter: "all" | "review" | "approved" | "posted" | "failed" | "cancelled";
    query: string;
    from?: string;
    to?: string;
  }
): PurchaseInvoice[] {
  const q = input.query.trim().toLowerCase();
  return invoices.filter((invoice) => {
    const status = archiveStatus(invoice);
    // Cancelled invoices are hidden by default — only visible in the
    // explicit "cancelled" filter view.
    if (input.filter !== "cancelled" && status === "cancelled") return false;
    if (input.filter === "cancelled" && status !== "cancelled") return false;
    if (input.filter === "review" && status !== "needs_review" && status !== "uploaded" && status !== "scanning") return false;
    if (input.filter === "approved" && status !== "approved" && status !== "ready") return false;
    if (input.filter === "posted" && status !== "posted") return false;
    if (input.filter === "failed" && status !== "failed") return false;
    const date = invoice.invoiceDate || invoice.uploadedAt || invoice.createdAt;
    if (input.from && date && date.slice(0, 10) < input.from) return false;
    if (input.to && date && date.slice(0, 10) > input.to) return false;
    if (!q) return true;
    const hay = [
      invoice.invoiceNumber,
      invoice.supplierName,
      invoice.grossAmount,
      invoice.netAmount,
      ...(invoice.lines || []).map((line) => line.rawName),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export const SCAN_ERROR_CODES = [
  "PROVIDER_NOT_CONFIGURED",
  "INVALID_API_KEY",
  "PROVIDER_FORBIDDEN",
  "QUOTA_EXCEEDED",
  "UNSUPPORTED_FILE",
  "FILE_TOO_LARGE",
  "PDF_PARSE_FAILED",
  "SCAN_FAILED",
  "INVALID_RESPONSE",
  "STORAGE_FAILED",
  "AI_NOT_CONFIGURED",
  "INVALID_FILE",
  "PROVIDER_AUTH_ERROR",
  "PROVIDER_RATE_LIMIT",
  "EXTRACTION_FAILED",
] as const;

export type ScanErrorCode = (typeof SCAN_ERROR_CODES)[number];

export function publicScanErrorCode(code?: string | null, providerStatus?: number | null): ScanErrorCode {
  if (code === "AI_NOT_CONFIGURED") return "PROVIDER_NOT_CONFIGURED";
  if (code === "INVALID_FILE") return providerStatus === 413 ? "FILE_TOO_LARGE" : "UNSUPPORTED_FILE";
  if (code === "PROVIDER_AUTH_ERROR") return providerStatus === 403 ? "PROVIDER_FORBIDDEN" : "INVALID_API_KEY";
  if (code === "PROVIDER_RATE_LIMIT") return "PROVIDER_RATE_LIMIT";
  if (code && SCAN_ERROR_CODES.includes(code as ScanErrorCode)) return code as ScanErrorCode;
  if (providerStatus === 402 || providerStatus === 403) return "STORAGE_FAILED";
  return "SCAN_FAILED";
}

export function scanErrorMessageKey(code: ScanErrorCode): string {
  return `admin.inventory.smart.err.${code}`;
}

export type InvoiceMissingField = { key: string; labelKey: string };

const HEADER_EDIT_KEYS = [
  "supplierId",
  "supplierName",
  "supplierTaxId",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "currency",
  "paymentMethod",
  "vatRate",
  "netAmount",
  "vatAmount",
  "grossAmount",
  "subtotal",
  "vatTotal",
  "grandTotal",
] as const;

export function missingInvoiceFields(invoice: PurchaseInvoice): InvoiceMissingField[] {
  const missing: InvoiceMissingField[] = [];
  if (!invoice.supplierName?.trim()) missing.push({ key: "supplier", labelKey: "admin.costing.supplier" });
  if (!invoice.invoiceNumber?.trim()) missing.push({ key: "invoiceNumber", labelKey: "admin.inventory.invoiceNumber" });
  if (!toDateOnly(invoice.invoiceDate)) missing.push({ key: "invoiceDate", labelKey: "admin.inventory.invoiceDate" });
  if (!invoice.currency?.trim()) missing.push({ key: "currency", labelKey: "admin.finance.currency" });
  if (invoice.netAmount == null && invoice.subtotal == null) missing.push({ key: "net", labelKey: "admin.finance.netTotal" });
  if (invoice.vatAmount == null && invoice.vatTotal == null) missing.push({ key: "vat", labelKey: "admin.finance.vatTotal" });
  if (invoice.grossAmount == null && invoice.grandTotal == null) missing.push({ key: "gross", labelKey: "admin.finance.grossTotal" });
  if (!invoice.lines.length) missing.push({ key: "lines", labelKey: "admin.inventory.smart.lines" });
  return missing;
}

export function incompleteInvoiceLineCount(lines: PurchaseInvoiceLine[]): number {
  return lines.filter((line) => !isNonStockInvoiceLine(line) && !invoiceLineReviewStatus(line).ready).length;
}

export function mergeScannedInvoice(
  previous: PurchaseInvoice | null,
  scanned: PurchaseInvoice,
  editedKeys: Iterable<string>
): PurchaseInvoice {
  if (!previous) return scanned;
  const edited = new Set(editedKeys);
  const next: PurchaseInvoice = {
    ...scanned,
    id: scanned.id || previous.id,
    receivedAt: previous.receivedAt || scanned.receivedAt,
    sourceFile: scanned.sourceFile ?? previous.sourceFile,
    fileUrl: scanned.fileUrl ?? previous.fileUrl,
    fileName: scanned.fileName ?? previous.fileName,
    fileHash: scanned.fileHash ?? previous.fileHash,
  };
  for (const key of HEADER_EDIT_KEYS) {
    if (edited.has(key)) {
      (next as Record<string, unknown>)[key] = previous[key];
    }
  }
  const editedLines = edited.has("lines") || [...edited].some((key) => key.startsWith("line:"));
  if (editedLines) {
    const incoming = new Map(scanned.lines.map((line) => [line.rawName, line]));
    const kept = previous.lines.map((line) => {
      if (edited.has(`line:${line.key}`) || edited.has("lines")) return line;
      return incoming.get(line.rawName) ?? line;
    });
    for (const line of scanned.lines) {
      if (!kept.some((row) => row.rawName === line.rawName || row.key === line.key)) kept.push(line);
    }
    next.lines = kept;
  }
  return next;
}
