import type { InventoryMovement, PosImport, PosSaleLine } from "@/lib/inventory/types";

export type PosExcelField =
  | "posCode"
  | "posName"
  | "quantity"
  | "unitPrice"
  | "reportedRevenue"
  | "transactionCount"
  | "posCost"
  | "posProfit"
  | "saleDate";

export const POS_EXCEL_FIELDS: PosExcelField[] = [
  "posName",
  "posCode",
  "quantity",
  "unitPrice",
  "reportedRevenue",
  "transactionCount",
  "posCost",
  "posProfit",
  "saleDate",
];

export type PosColumnMap = Partial<Record<PosExcelField, number>>;

export function excelImportPayload(input: {
  fileName: string;
  fileHash: string;
  period: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  sourcePeriodFrom?: string | null;
  sourcePeriodTo?: string | null;
  reportGeneratedAt?: string | null;
  uploadedAt?: string;
  periodNeedsReview?: boolean;
  periodConfirmed?: boolean;
  lines: PosSaleLine[];
  itemCount?: number;
  quantitySum?: number;
  reportedRevenueSum?: number | null;
  sheetName?: string | null;
  headerRow?: number | null;
  previousImportId?: string;
  excludedKeys?: string[];
  sourceTotals?: PosImport["sourceTotals"];
}): Omit<PosImport, "id" | "createdAt"> {
  return {
    kind: "excel-info",
    fileName: input.fileName,
    fileHash: input.fileHash,
    source: "pos-file",
    period: input.period,
    periodFrom: input.periodFrom ?? null,
    periodTo: input.periodTo ?? null,
    sourcePeriodFrom: input.sourcePeriodFrom ?? input.periodFrom ?? null,
    sourcePeriodTo: input.sourcePeriodTo ?? input.periodTo ?? null,
    reportGeneratedAt: input.reportGeneratedAt ?? null,
    uploadedAt: input.uploadedAt ?? new Date().toISOString(),
    periodNeedsReview: Boolean(input.periodNeedsReview),
    periodConfirmed: Boolean(input.periodConfirmed && isValidSalesPeriod(input.periodFrom, input.periodTo)),
    status: "saved",
    financeStatus: "none",
    infoOnly: true,
    inventoryStatus: "none",
    lines: input.lines,
    itemCount: input.itemCount ?? input.lines.length,
    quantitySum: input.quantitySum ?? input.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    reportedRevenueSum: input.reportedRevenueSum ?? null,
    sheetName: input.sheetName ?? null,
    headerRow: input.headerRow ?? null,
    previousImportId: input.previousImportId,
    excludedKeys: input.excludedKeys ?? [],
    sourceTotals: input.sourceTotals ?? null,
  };
}

export function headersMatchTemplate(current: string[], saved: string[]): boolean {
  if (!current.length || current.length !== saved.length) return false;
  return current.every((header, index) => header.trim() === saved[index]?.trim());
}

export function dateLooksLikeEpoch(value?: string | null): boolean {
  if (!value) return false;
  const year = Number(String(value).trim().slice(0, 4));
  return Number.isFinite(year) && year > 0 && year <= 1971;
}

export function isValidSalesPeriod(from?: string | null, to?: string | null): boolean {
  const start = (from ?? "").trim();
  const end = (to ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  if (dateLooksLikeEpoch(start) || dateLooksLikeEpoch(end)) return false;
  return start <= end;
}

export function periodReviewCleared(input: {
  periodNeedsReview?: boolean;
  periodConfirmed?: boolean;
  periodFrom?: string | null;
  periodTo?: string | null;
}): boolean {
  if (!input.periodNeedsReview) return true;
  return Boolean(input.periodConfirmed && isValidSalesPeriod(input.periodFrom, input.periodTo));
}

export function canConfirmExcelImport(input: {
  lineCount: number;
  periodNeedsReview?: boolean;
  periodConfirmed?: boolean;
  periodFrom?: string | null;
  periodTo?: string | null;
}): { ok: true } | { ok: false; reason: "empty" | "period-review" } {
  if (input.lineCount <= 0) return { ok: false, reason: "empty" };
  if (!periodReviewCleared(input)) return { ok: false, reason: "period-review" };
  return { ok: true };
}

export function excelMayAffectFinance(): false {
  return false;
}

export function excelMayAffectStock(): false {
  return false;
}

export function posAverageIsNotListPrice(): true {
  return true;
}

export function posPriceUpdatePreview(currentPrice: number | null | undefined, averagePrice: number | null | undefined) {
  return {
    currentPrice: currentPrice ?? null,
    proposedAverage: averagePrice ?? null,
    isAverageNotList: true as const,
  };
}

export function priorExcelStockWrites(movements: InventoryMovement[]): InventoryMovement[] {
  return movements.filter(
    (row) =>
      Boolean(row.posImportId) &&
      (row.type === "SALE_OUT" || row.type === "REVERSAL" || (row.note ?? "").includes("POS"))
  );
}

export function priorExcelFinanceWrites(imports: PosImport[]): PosImport[] {
  return imports.filter((item) => item.financeStatus === "posted" || (item.kind !== "excel-info" && item.kind !== undefined && !item.infoOnly));
}
