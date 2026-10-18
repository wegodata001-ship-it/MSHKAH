import type { Order } from "@/types";
import { isCountableSale, orderBusinessDate } from "@/lib/breakeven/compute";
import { toDateOnly } from "@/lib/dates/normalize";
import type {
  PosFinanceEntry,
  PosZCheck,
  PosZPayment,
  PosZPaymentRole,
  PosZReport,
  PosZScanStatus,
  InventoryMovement,
  PosImport,
  WebsiteSalesOverlap,
} from "@/lib/inventory/types";

export function zDuplicateKey(
  report: Pick<PosZReport, "businessName" | "registerId" | "reportNumber" | "businessDate" | "salesTotal" | "periodFrom">
): string {
  return [
    (report.businessName ?? "").trim().toLowerCase(),
    (report.registerId ?? "").trim().toLowerCase(),
    (report.reportNumber ?? "").trim().toLowerCase(),
    report.businessDate ?? report.periodFrom ?? "",
    report.salesTotal == null ? "" : String(report.salesTotal),
  ].join("|");
}

export function findDuplicateZReport(existing: PosZReport[], next: PosZReport): PosZReport | null {
  if (next.fileHash) {
    const byHash = existing.find((item) => item.id !== next.id && item.fileHash && item.fileHash === next.fileHash);
    if (byHash) return byHash;
  }
  if (!next.reportNumber) return null;
  const key = zDuplicateKey(next);
  return existing.find((item) => item.id !== next.id && Boolean(item.reportNumber) && zDuplicateKey(item) === key) ?? null;
}

export function websiteSalesOverlap(
  orders: Order[],
  from: string | null | undefined,
  to: string | null | undefined
): WebsiteSalesOverlap {
  if (!from || !to) return { orderCount: 0, amount: 0, status: "ok" };
  const rows: Order[] = [];
  const invalidOrderIds: string[] = [];
  for (const order of orders) {
    try {
      if (!isCountableSale(order)) continue;
      const day = orderBusinessDate(order);
      if (!day) {
        if (order.id) invalidOrderIds.push(order.id);
        continue;
      }
      if (day >= from && day <= to) rows.push(order);
    } catch {
      if (order.id) invalidOrderIds.push(order.id);
    }
  }
  return {
    orderCount: rows.length,
    amount: rows.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
    status: invalidOrderIds.length ? "incomplete" : "ok",
    invalidOrderCount: invalidOrderIds.length || undefined,
    invalidOrderIds: invalidOrderIds.length ? invalidOrderIds.slice(0, 20) : undefined,
  };
}

export function overlapReviewRequired(overlap: WebsiteSalesOverlap | null | undefined): boolean {
  return overlap?.status === "incomplete";
}

export function canReuseZExtract(
  current: PosZReport | undefined,
  files: unknown[],
  options?: boolean | { recheckOverlap?: boolean; forceAi?: boolean }
): boolean {
  const flags = typeof options === "boolean" ? { recheckOverlap: options } : options;
  if (!current || files.length) return false;
  if (isEmptyZExtraction(current)) return false;
  if (flags?.forceAi) return false;
  if (flags?.recheckOverlap) return true;
  return current.scanStatus === "ready" || current.scanStatus === "partial";
}

export function periodsOverlap(
  aFrom?: string | null,
  aTo?: string | null,
  bFrom?: string | null,
  bTo?: string | null
): boolean {
  const leftFrom = aFrom ?? aTo;
  const leftTo = aTo ?? aFrom;
  const rightFrom = bFrom ?? bTo;
  const rightTo = bTo ?? bFrom;
  if (!leftFrom || !leftTo || !rightFrom || !rightTo) return false;
  return leftFrom <= rightTo && rightFrom <= leftTo;
}

export function overlappingPostedZReports(existing: PosZReport[], next: PosZReport): PosZReport[] {
  const from = next.periodFrom ?? next.businessDate;
  const to = next.periodTo ?? next.businessDate;
  return existing.filter(
    (item) =>
      item.id !== next.id &&
      item.status === "posted" &&
      periodsOverlap(item.periodFrom ?? item.businessDate, item.periodTo ?? item.businessDate, from, to)
  );
}

/** One finance amount: sales including VAT. Receipts are the same income, extras are never added. */
export function zAmountToPost(report: PosZReport): number | null {
  const sales = report.salesIncludingVat ?? report.salesTotal;
  if (sales == null || !Number.isFinite(sales)) return null;
  return sales;
}

export function zVatBasis(report: PosZReport): PosFinanceEntry["vatBasis"] {
  if (report.vatTotal == null) return "unknown";
  return "including";
}

export function periodNeedsConfirm(report: PosZReport): boolean {
  const from = report.periodFrom ?? null;
  const to = report.periodTo ?? null;
  if (from && to && from !== to) return true;
  const printedDay = toDateOnly(report.printedAt ?? "");
  if (printedDay && from && printedDay !== from) return true;
  if (printedDay && to && printedDay !== to) return true;
  return false;
}

export function canPostZReport(
  report: PosZReport,
  options?: { overlapReviewAcknowledged?: boolean }
): { ok: true } | { ok: false; reason: "already-posted" | "missing-amount" | "missing-date" | "period-unconfirmed" | "empty-extract" | "overlap-incomplete" } {
  if (report.status === "posted" || report.financeEntryId) return { ok: false, reason: "already-posted" };
  if (isEmptyZExtraction(report)) return { ok: false, reason: "empty-extract" };
  if (zAmountToPost(report) == null) return { ok: false, reason: "missing-amount" };
  if (!report.businessDate && !report.periodFrom) return { ok: false, reason: "missing-date" };
  if (periodNeedsConfirm(report) && !report.periodConfirmed) return { ok: false, reason: "period-unconfirmed" };
  if (overlapReviewRequired(report.websiteOverlap) && !report.overlapReviewResolved && !options?.overlapReviewAcknowledged) {
    return { ok: false, reason: "overlap-incomplete" };
  }
  return { ok: true };
}

export function excelFinanceImpact(imports: PosImport[]): { count: number; ids: string[] } {
  const finance = imports.filter((item) => item.kind !== "excel-info" && item.financeStatus === "posted");
  return { count: finance.length, ids: finance.map((item) => item.id) };
}

export function excelStockImpact(movements: InventoryMovement[]): { count: number; importIds: string[] } {
  const ids = [
    ...new Set(
      movements
        .filter((row) => row.posImportId && (row.type === "SALE_OUT" || row.note?.includes("POS")))
        .map((row) => row.posImportId!)
    ),
  ];
  return { count: ids.length, importIds: ids };
}

export function compareExcelToZ(input: {
  excelRevenue: number | null;
  zSales: number | null;
  sameRegister: boolean;
  overlappingPeriod: boolean;
}): "none" | "no-z" | "partial" | "match" {
  if (input.excelRevenue == null) return "none";
  if (input.zSales == null || !input.overlappingPeriod) return "no-z";
  if (!input.sameRegister) return "partial";
  const diff = Math.abs(input.excelRevenue - input.zSales);
  if (diff <= 1) return "match";
  return "partial";
}

export function missingNotZero(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value;
}

export function zFinanceIdempotencyKey(reportId: string): string {
  return `z-finance-${reportId}`;
}

export function overlapRequiresAck(overlap: { orderCount: number; amount: number } | null | undefined): boolean {
  return Boolean(overlap && (overlap.orderCount > 0 || overlap.amount > 0));
}

export function normalizeZLabel(label: string): string {
  return label
    .replace(/["״׳'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function classifyPaymentRole(label: string): PosZPaymentRole {
  const n = normalizeZLabel(label);
  if (!n) return "tender";
  if (/סיכום\s*אשראי/.test(n) || /credit\s*summary/.test(n) || /total\s*credit/.test(n)) return "tender-summary";
  if (/^(סה.?כ|סיכום)\s*(אשראי|credit)/.test(n) && !/ידני|manual/.test(n)) return "tender-summary";
  return "tender";
}

export function isExtraZLabel(label: string): boolean {
  const n = normalizeZLabel(label);
  return /דמי\s*מחזור|מצטבר|turnover|cycle fee|accumul|יתרה מצטברת|grand total accumulated/.test(n);
}

export function financeTenders(payments?: PosZPayment[]): PosZPayment[] {
  return (payments ?? []).filter((row) => (row.role ?? classifyPaymentRole(row.sourceLabel || row.method)) === "tender");
}

function paymentText(row: PosZPayment): string {
  return normalizeZLabel(row.sourceLabel || row.method);
}

export function findZPayment(payments: PosZPayment[] | undefined, match: (label: string) => boolean): PosZPayment | undefined {
  return (payments ?? []).find((row) => match(paymentText(row)));
}

export function isCreditTenderLabel(label: string): boolean {
  const n = normalizeZLabel(label);
  return (/אשראי|credit|visa|mastercard|כרטיס/.test(n) || n === "אשראי") && !/ידני|manual|סיכום|סה.?כ/.test(n);
}

export function isManualCreditLabel(label: string): boolean {
  const n = normalizeZLabel(label);
  return /אשראי\s*ידני|ידני|manual\s*credit/.test(n);
}

export function isCashLabel(label: string): boolean {
  return /מזומן|cash/.test(normalizeZLabel(label));
}

function moneyEq(left: number | null, right: number | null): boolean {
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= 0.02;
}

function checkRow(id: string, label: string, left: number | null, right: number | null): PosZCheck {
  const gap = left == null || right == null ? null : Math.round((left - right) * 100) / 100;
  return { id, label, left, right, gap, ok: gap != null && Math.abs(gap) <= 0.02 };
}

export function buildZChecks(report: Pick<PosZReport, "payments" | "receiptsTotal" | "salesBeforeVat" | "vatTotal" | "salesIncludingVat" | "salesTotal">): PosZCheck[] {
  const credit = findZPayment(report.payments, isCreditTenderLabel)?.amount ?? null;
  const manual = findZPayment(report.payments, isManualCreditLabel)?.amount ?? null;
  const cash = findZPayment(report.payments, isCashLabel)?.amount ?? null;
  const creditSummary =
    findZPayment(report.payments, (label) => classifyPaymentRole(label) === "tender-summary")?.amount ?? null;
  const creditPlusManual = credit == null || manual == null ? null : credit + manual;
  const sales = report.salesIncludingVat ?? report.salesTotal ?? null;
  const beforePlusVat =
    report.salesBeforeVat == null || report.vatTotal == null ? null : report.salesBeforeVat + report.vatTotal;
  const summaryPlusCash = creditSummary == null || cash == null ? null : creditSummary + cash;

  const checks: PosZCheck[] = [
    checkRow("credit-summary", "אשראי + אשראי ידני = סיכום אשראי", creditPlusManual, creditSummary),
    checkRow("receipts", "סיכום אשראי + מזומן = סה״כ תקבולים", summaryPlusCash, report.receiptsTotal ?? null),
    checkRow("sales-vat", "לפני מע״מ + מע״מ = סה״כ מכירות", beforePlusVat, sales),
  ];
  if (sales != null && report.receiptsTotal != null) {
    checks.push(checkRow("sales-vs-receipts", "סה״כ מכירות מול סה״כ תקבולים (הכנסה אחת)", sales, report.receiptsTotal));
  }
  return checks;
}

export function isEmptyZExtraction(report: Pick<PosZReport, "salesTotal" | "salesIncludingVat" | "salesBeforeVat" | "vatTotal" | "receiptsTotal" | "payments" | "fields" | "reportNumber" | "registerId" | "periodFrom" | "printedAt" | "businessName">): boolean {
  const money = [report.salesTotal, report.salesIncludingVat, report.salesBeforeVat, report.vatTotal, report.receiptsTotal];
  if (money.some((value) => value != null)) return false;
  if ((report.payments ?? []).some((row) => row.amount != null || row.method.trim())) return false;
  if ((report.fields ?? []).some((field) => field.value != null && field.value !== "")) return false;
  return !report.reportNumber && !report.registerId && !report.periodFrom && !report.printedAt && !report.businessName;
}

export function zScanStatusFromExtract(report: PosZReport): PosZScanStatus {
  if (report.lastScanError) return "failed";
  if (isEmptyZExtraction(report)) return "failed";
  const hasSales = zAmountToPost(report) != null;
  const hasTender = financeTenders(report.payments).some((row) => row.amount != null);
  if (hasSales && hasTender) return "ready";
  return "partial";
}

export function refreshZDerived(report: PosZReport): PosZReport {
  const payments = (report.payments ?? []).map((row) => ({
    ...row,
    role: row.role ?? classifyPaymentRole(row.sourceLabel || row.method),
  }));
  const next = { ...report, payments };
  return {
    ...next,
    checks: buildZChecks(next),
    scanStatus: zScanStatusFromExtract(next),
  };
}

export function moneyNearEqual(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null || right == null) return false;
  return moneyEq(left, right);
}
