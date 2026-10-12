import { roundMoney } from "@/lib/costing/money";
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
}): InvoiceTotalsValidation {
  const lineNetSum = roundMoney(input.lines.reduce((sum, line) => sum + (line.netAmount ?? line.lineNet ?? line.priceBeforeVat ?? 0), 0));
  const lineVatSum = roundMoney(input.lines.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0));
  const lineGrossSum = roundMoney(input.lines.reduce((sum, line) => sum + (line.grossAmount ?? line.lineGross ?? line.priceIncludingVat ?? 0), 0));
  const headerNet = input.headerNet ?? null;
  const headerVat = input.headerVat ?? null;
  const headerGross = input.headerGross ?? null;
  const computedGross = headerNet != null && headerVat != null ? roundMoney(headerNet + headerVat) : roundMoney(lineNetSum + lineVatSum);
  const netDiff = headerNet == null ? null : roundMoney(lineNetSum - headerNet);
  const vatDiff = headerVat == null ? null : roundMoney(lineVatSum - headerVat);
  const grossDiff = headerGross == null ? null : roundMoney(lineGrossSum - headerGross);
  const off = (value: number | null) => value != null && Math.abs(value) > 0.05;
  const netPlusVat = headerNet != null && headerVat != null && headerGross != null
    ? Math.abs(roundMoney(headerNet + headerVat - headerGross)) > 0.05
    : false;
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
    hasMismatch: off(netDiff) || off(vatDiff) || off(grossDiff) || netPlusVat,
  };
}

export function invoiceArchiveQuery(
  invoices: PurchaseInvoice[],
  input: {
    filter: "all" | "review" | "approved" | "posted" | "failed";
    query: string;
    from?: string;
    to?: string;
  }
): PurchaseInvoice[] {
  const q = input.query.trim().toLowerCase();
  return invoices.filter((invoice) => {
    const status = archiveStatus(invoice);
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
  if (code === "PROVIDER_RATE_LIMIT") return "QUOTA_EXCEEDED";
  if (code && SCAN_ERROR_CODES.includes(code as ScanErrorCode)) return code as ScanErrorCode;
  if (providerStatus === 402 || providerStatus === 403) return "STORAGE_FAILED";
  return "SCAN_FAILED";
}

export function scanErrorMessageKey(code: ScanErrorCode): string {
  return `admin.inventory.smart.err.${code}`;
}
