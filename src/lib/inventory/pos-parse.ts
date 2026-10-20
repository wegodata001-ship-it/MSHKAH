import { createHash } from "crypto";
import ExcelJS from "exceljs";
import { enrichSaleLine, matchPosIdentity } from "@/lib/inventory/pos-apply";
import { classifyPosSummaryMetric, findTrailingSummaryFooter, isPosSummaryMetricLabel } from "@/lib/inventory/pos-summary-rows";
import type { Product } from "@/types";
import type { PosColumnMap, PosExcelField } from "@/lib/inventory/pos-excel";
import type { PosProductMap, PosSaleLine } from "@/lib/inventory/types";

export type { PosColumnMap, PosExcelField } from "@/lib/inventory/pos-excel";
export { POS_EXCEL_FIELDS } from "@/lib/inventory/pos-excel";

const MAX_BYTES = 4 * 1024 * 1024;

const HEADER_ALIASES: Record<PosExcelField, string[]> = {
  posName: [
    "שם_המוצר", "שם_מוצר", "שם_הפריט", "שם_פריט", "שם", "פריט", "מוצר",
    "اسم_المنتج", "اسم_الصنف", "الصنف", "المنتج",
    "product_name", "item_name", "name", "product", "item",
    "pos_item_name", "pos_name",
  ],
  posCode: [
    "ברקוד", "מקט", "מקט", "קוד",
    "باركود", "رمز",
    "barcode", "sku", "pos_item_code", "pos_code", "item_code",
  ],
  quantity: [
    "כמות_מכירה", "כמות_נמכרה", "כמות", "יח",
    "كمية_المبيعات", "كمية",
    "quantity_sold", "qty", "quantity", "sold",
  ],
  reportedRevenue: [
    "סהכ_הכנסות", "סהכ_הכנסות_מדווחות", "סהכ_מכירות", "הכנסות_מדווחות", "הכנסות",
    "إجمالي_الإيرادات", "اجمالي_الايرادات", "المبيعات",
    "gross_total", "net_total", "total_sales", "revenue",
  ],
  unitPrice: [
    "מחיר_מכירה_ממוצע", "מחיר_ממוצע", "מחיר_מכירה", "מחיר",
    "متوسط_السعر", "سعر_البيع",
    "average_price", "avg_price", "unit_price", "price",
  ],
  transactionCount: [
    "מספר_עסקאות", "עסקאות",
    "عدد_العمليات", "عدد_المعاملات",
    "transactions", "transaction_count", "orders",
  ],
  posCost: [
    "עלות_מוצר", "עלות_מדווחת", "עלות",
    "تكلفة_المنتج", "تكلفة",
    "product_cost", "cost",
  ],
  posProfit: [
    "רווח_מדווח", "רווח",
    "ربح",
    "profit", "reported_profit",
  ],
  saleDate: ["תאריך", "تاريخ", "sale_date", "date"],
};

export type MappedPosRow = {
  sourceRow: number;
  posCode: string;
  posName: string;
  quantity: number;
  unitPrice?: number;
  reportedRevenue?: number | null;
  transactionCount?: number | null;
  posCost?: number | null;
  posProfit?: number | null;
  saleDate?: string;
};

export type PosExcelPeriod = {
  period: string;
  periodFrom: string | null;
  periodTo: string | null;
  reportGeneratedAt: string | null;
  periodNeedsReview: boolean;
};

export type PosExcelSummary = {
  itemCount: number;
  quantitySum: number;
  reportedRevenueSum: number | null;
};

export type PosSourceTotals = {
  itemCount: number | null;
  quantitySum: number | null;
  reportedRevenueSum: number | null;
};

export type PosParseOptions = {
  sheetName?: string;
  headerRow?: number;
  columnMap?: PosColumnMap;
};

export type PosParseResult = {
  lines: PosSaleLine[];
  fileHash: string;
  period: PosExcelPeriod;
  summary: PosExcelSummary;
  sourceTotals: PosSourceTotals | null;
  gaps: { items: number | null; quantity: number | null; reportedRevenue: number | null };
  sheets: { name: string; rowCount: number }[];
  selectedSheet: string | null;
  headerRow: number | null;
  headerDetected: boolean;
  rawHeaders: string[];
  rawPreview: string[][];
  columnMap: PosColumnMap;
  needsMapping: boolean;
};

type SheetRow = { excelRow: number; cells: unknown[] };

export function unwrapCell(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  const cell = value as Record<string, unknown>;
  if (Array.isArray(cell.richText)) {
    return cell.richText.map((part) => (part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "")).join("");
  }
  if (cell.result != null) return unwrapCell(cell.result);
  if (cell.text != null) return unwrapCell(cell.text);
  if (cell.hyperlink != null && cell.text == null) return String(cell.hyperlink);
  if (cell.sharedString != null) return unwrapCell(cell.sharedString);
  return null;
}

export function headerKey(value: unknown): string {
  return String(asText(value))
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[״"'`׳]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_|_$/g, "");
}

/** A real sales date. Epoch placeholders such as 1970-01-01 are not dates. */
export function recognizedIsoDate(value?: string | null): string | null {
  if (!value) return null;
  const iso = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year) || year <= 1971 || year > 2100) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export function asText(value: unknown): string {
  const unwrapped = unwrapCell(value);
  if (unwrapped == null) return "";
  if (unwrapped instanceof Date) {
    if (Number.isNaN(unwrapped.getTime())) return "";
    return recognizedIsoDate(unwrapped.toISOString().slice(0, 10)) ?? "";
  }
  return String(unwrapped).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
}

export function asNumber(value: unknown): number | undefined {
  const unwrapped = unwrapCell(value);
  if (unwrapped == null || unwrapped === "") return undefined;
  if (unwrapped instanceof Date) return undefined;
  if (typeof unwrapped === "number") return Number.isFinite(unwrapped) ? unwrapped : undefined;
  let text = String(unwrapped).replace(/[\s₪]/g, "").replace(/[−–]/g, "-");
  if (!text) return undefined;
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (/,\d{1,2}$/.test(text)) {
    text = text.replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function hashPosFile(bytes: Uint8Array, _fileName = ""): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validatePosFile(name: string, size: number, type?: string): string | null {
  if (size <= 0 || size > MAX_BYTES) return "file-size";
  const lower = name.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) return "file-type";
  if (type && !/spreadsheet|excel|csv|octet-stream|empty/i.test(type) && type !== "") return null;
  return null;
}

function hasAny(key: string, parts: string[]): boolean {
  return parts.some((part) => key === part || key.includes(part));
}

export function fieldForHeader(header: string): PosExcelField | null {
  const key = headerKey(header);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [PosExcelField, string[]][]) {
    if (aliases.includes(key)) return field;
  }
  if (hasAny(key, ["ברקוד", "باركود", "barcode", "sku", "מקט"])) return "posCode";
  if (hasAny(key, ["כמות", "كمية", "qty", "quantity"])) return "quantity";
  if (hasAny(key, ["הכנסות", "إيراد", "ايراد", "revenue"]) || (hasAny(key, ["סהכ", "total"]) && hasAny(key, ["מכיר", "مبيع"]))) {
    return "reportedRevenue";
  }
  if (hasAny(key, ["עסקאות", "عمليات", "معاملات", "transaction"])) return "transactionCount";
  if (hasAny(key, ["עלות", "تكلفة", "cost"]) && !hasAny(key, ["רווח", "ربح", "profit"])) return "posCost";
  if (hasAny(key, ["רווח", "ربح", "profit"])) return "posProfit";
  if (hasAny(key, ["מחיר", "سعر", "price", "ממוצע", "متوسط"])) return "unitPrice";
  if (
    (hasAny(key, ["שם", "اسم", "name"]) && hasAny(key, ["מוצר", "פריט", "منتج", "صنف", "product", "item"])) ||
    key === "שם" ||
    key === "מוצר" ||
    key === "פריט"
  ) {
    return "posName";
  }
  if (hasAny(key, ["תאריך", "تاريخ", "date"])) return "saleDate";
  return null;
}

export function isSummaryLabel(value: unknown): boolean {
  return isPosSummaryMetricLabel(value);
}

export function isSummaryRow(name: string, _cells: unknown[] = []): boolean {
  return isPosSummaryMetricLabel(name);
}

export function detectHeaderRow(rows: unknown[][]): { index: number; fields: (PosExcelField | null)[] } | null {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const fields = rows[i].map((cell) => fieldForHeader(asText(cell)));
    const hasName = fields.includes("posName");
    const hasQty = fields.includes("quantity");
    const hasMoney = fields.includes("reportedRevenue") || fields.includes("unitPrice");
    if (hasName && (hasQty || hasMoney)) return { index: i, fields };
  }
  return null;
}

export function fieldsFromMap(columnMap: PosColumnMap, width: number): (PosExcelField | null)[] {
  const fields: (PosExcelField | null)[] = Array.from({ length: width }, () => null);
  for (const [field, index] of Object.entries(columnMap) as [PosExcelField, number | undefined][]) {
    if (index == null || index < 0 || index >= width) continue;
    fields[index] = field;
  }
  return fields;
}

export function columnMapFromFields(fields: (PosExcelField | null)[]): PosColumnMap {
  const map: PosColumnMap = {};
  fields.forEach((field, index) => {
    if (field && map[field] == null) map[field] = index;
  });
  return map;
}

function mapRow(fields: (PosExcelField | null)[], cells: unknown[], sourceRow: number): MappedPosRow | null {
  const row: MappedPosRow = { sourceRow, posCode: "", posName: "", quantity: 0 };
  fields.forEach((field, index) => {
    if (!field) return;
    if (field === "posCode" || field === "posName" || field === "saleDate") {
      row[field] = asText(cells[index]);
      return;
    }
    const n = asNumber(cells[index]);
    if (n == null) return;
    if (field === "quantity") row.quantity = n;
    if (field === "unitPrice") row.unitPrice = n;
    if (field === "reportedRevenue") row.reportedRevenue = n;
    if (field === "transactionCount") row.transactionCount = n;
    if (field === "posCost") row.posCost = n;
    if (field === "posProfit") row.posProfit = n;
  });
  if (isSummaryRow(row.posName)) return null;
  if (!row.posName && !row.posCode) {
    if (row.quantity || row.reportedRevenue != null || row.unitPrice != null) return row;
    return null;
  }
  return row;
}

const DATE_TOKEN = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/g;

function normalizeDateToken(token: string): string | null {
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = token.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  let candidate: string | null = null;
  if (iso) candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    candidate = `${year.padStart(4, "0")}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return recognizedIsoDate(candidate);
}

const PERIOD_HINT = /תקופ|period|من|إلى|الى|עד|בין/i;
const GENERATED_HINT = /הופק|הוצא|issued|generated|تاريخ_التقرير|תאריך_הפקה/i;

export function extractPosPeriod(headerTexts: string[], fallback = ""): PosExcelPeriod {
  const periodDates: string[] = [];
  const generatedDates: string[] = [];
  for (const raw of headerTexts) {
    const text = String(raw);
    const matches = [...(text.match(DATE_TOKEN) ?? [])]
      .map(normalizeDateToken)
      .filter((item): item is string => Boolean(item));
    if (!matches.length) continue;
    if (GENERATED_HINT.test(text) && matches.length === 1) {
      generatedDates.push(matches[0]);
      continue;
    }
    if (PERIOD_HINT.test(text) || matches.length >= 2) {
      periodDates.push(...matches);
      continue;
    }
    if (matches.length === 1 && !generatedDates.length) generatedDates.push(matches[0]);
  }
  const unique = [...new Set(periodDates)].sort();
  const periodFrom = unique[0] ?? null;
  const periodTo = unique[unique.length - 1] ?? periodFrom;
  const sawDateText = headerTexts.some((text) =>
    /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/.test(String(text))
  );
  const periodNeedsReview = !periodFrom || !periodTo || sawDateText && unique.length === 0;
  return {
    period: periodFrom && periodTo ? (periodFrom === periodTo ? periodFrom : `${periodFrom}:${periodTo}`) : fallback,
    periodFrom,
    periodTo,
    reportGeneratedAt: generatedDates[0] ?? null,
    periodNeedsReview,
  };
}

export function summarizePosExcel(lines: Pick<PosSaleLine, "quantity" | "reportedRevenue" | "netTotal">[]): PosExcelSummary {
  const quantitySum = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const revenues = lines
    .map((line) => line.reportedRevenue ?? line.netTotal)
    .filter((value): value is number => value != null && Number.isFinite(value));
  return {
    itemCount: lines.length,
    quantitySum,
    reportedRevenueSum: revenues.length ? revenues.reduce((sum, value) => sum + value, 0) : null,
  };
}

export function comparePosTotals(lines: PosExcelSummary, source: PosSourceTotals | null) {
  if (!source) return { items: null, quantity: null, reportedRevenue: null };
  return {
    items: source.itemCount == null ? null : lines.itemCount - source.itemCount,
    quantity: source.quantitySum == null ? null : lines.quantitySum - source.quantitySum,
    reportedRevenue:
      lines.reportedRevenueSum == null || source.reportedRevenueSum == null
        ? null
        : lines.reportedRevenueSum - source.reportedRevenueSum,
  };
}

function toSaleLine(row: MappedPosRow, products: Product[], maps: PosProductMap[]): PosSaleLine {
  const draft: PosSaleLine = {
    key: `pos-${row.sourceRow}-${row.posCode}-${row.posName}`,
    sourceRow: row.sourceRow,
    posCode: row.posCode,
    posName: row.posName,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    netTotal: row.reportedRevenue ?? undefined,
    reportedRevenue: row.reportedRevenue ?? null,
    transactionCount: row.transactionCount ?? null,
    posCost: row.posCost ?? null,
    posProfit: row.posProfit ?? null,
    saleDate: recognizedIsoDate(row.saleDate) ?? undefined,
    matchKind: "none",
  };
  if (row.posName || row.posCode) {
    const match = matchPosIdentity(draft, products, maps);
    if (match.product) {
      draft.menuProductId = match.product.id;
      draft.matchKind = match.identity === "uncertain" ? "suggest" : "exact";
    } else if (match.identity === "uncertain") {
      draft.matchKind = "suggest";
    }
  }
  return enrichSaleLine(draft);
}

function sheetRows(sheet: ExcelJS.Worksheet): SheetRow[] {
  const width = Math.max(sheet.actualColumnCount || 0, sheet.columnCount || 0, 8);
  const rows: SheetRow[] = [];
  sheet.eachRow({ includeEmpty: true }, (row, excelRow) => {
    const cells: unknown[] = [];
    for (let col = 1; col <= width; col += 1) {
      cells.push(unwrapCell(row.getCell(col).value));
    }
    if (cells.every((cell) => cell == null || cell === "")) return;
    rows.push({ excelRow, cells });
  });
  return rows;
}

function pickSheet(workbook: ExcelJS.Workbook, preferred?: string): ExcelJS.Worksheet | undefined {
  if (preferred) {
    const named = workbook.worksheets.find((sheet) => sheet.name === preferred);
    if (named) return named;
  }
  let best: { sheet: ExcelJS.Worksheet; score: number } | null = null;
  for (const sheet of workbook.worksheets) {
    const rows = sheetRows(sheet).map((row) => row.cells);
    const header = detectHeaderRow(rows);
    const score = header ? 100 + rows.length : rows.length;
    if (!best || score > best.score) best = { sheet, score };
  }
  return best?.sheet ?? workbook.worksheets[0];
}

function firstNumberInRow(cells: unknown[], skipIndex: number): number | null {
  for (let i = 0; i < cells.length; i += 1) {
    if (i === skipIndex) continue;
    const value = asNumber(cells[i]);
    if (value != null) return value;
  }
  return null;
}

function extractSourceTotals(rows: SheetRow[], fields: (PosExcelField | null)[]): PosSourceTotals | null {
  const nameIndex = fields.indexOf("posName");
  const qtyIndex = fields.indexOf("quantity");
  const revIndex = fields.indexOf("reportedRevenue");
  const footer = findTrailingSummaryFooter(
    rows,
    (row) => (nameIndex >= 0 ? asText(row.cells[nameIndex]) : asText(row.cells[0])),
    (row) => row.cells.every((cell) => cell == null || cell === "")
  );
  if (!footer) return null;
  const totals: PosSourceTotals = { itemCount: null, quantitySum: null, reportedRevenueSum: null };
  for (const row of footer.rows) {
    const name = nameIndex >= 0 ? asText(row.cells[nameIndex]) : asText(row.cells[0]);
    const kind = classifyPosSummaryMetric(name);
    const fallback = firstNumberInRow(row.cells, nameIndex);
    if (kind === "items") totals.itemCount = fallback;
    if (kind === "quantity") totals.quantitySum = (qtyIndex >= 0 ? asNumber(row.cells[qtyIndex]) : null) ?? fallback;
    if (kind === "revenue") totals.reportedRevenueSum = (revIndex >= 0 ? asNumber(row.cells[revIndex]) : null) ?? fallback;
    if (kind === "generic") {
      if (totals.quantitySum == null) totals.quantitySum = (qtyIndex >= 0 ? asNumber(row.cells[qtyIndex]) : null) ?? fallback;
      if (totals.reportedRevenueSum == null) totals.reportedRevenueSum = (revIndex >= 0 ? asNumber(row.cells[revIndex]) : null) ?? fallback;
    }
  }
  return totals;
}

export function applyColumnMapToRows(
  rows: SheetRow[],
  fields: (PosExcelField | null)[],
  headerIndex: number,
  products: Product[],
  maps: PosProductMap[]
): { lines: PosSaleLine[]; sourceTotals: PosSourceTotals | null } {
  const lines: PosSaleLine[] = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const mapped = mapRow(fields, rows[i].cells, rows[i].excelRow);
    if (!mapped) continue;
    lines.push(toSaleLine(mapped, products, maps));
  }
  return { lines, sourceTotals: extractSourceTotals(rows.slice(headerIndex + 1), fields) };
}

function emptyResult(fileHash: string, fileName: string, extra: Partial<PosParseResult> = {}): PosParseResult {
  return {
    lines: [],
    fileHash,
    period: extractPosPeriod([], fileName),
    summary: summarizePosExcel([]),
    sourceTotals: null,
    gaps: { items: null, quantity: null, reportedRevenue: null },
    sheets: [],
    selectedSheet: null,
    headerRow: null,
    headerDetected: false,
    rawHeaders: [],
    rawPreview: [],
    columnMap: {},
    needsMapping: true,
    ...extra,
  };
}

async function loadXlsx(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return workbook;
}

function workbookFromCsv(text: string): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("csv");
  for (const row of parseCsvRows(text)) sheet.addRow(row);
  return workbook;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((ch === "," || ch === "\t") && !quoted) {
      row.push(current);
      current = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
    } else {
      current += ch;
    }
  }
  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export async function parsePosBuffer(
  bytes: Buffer,
  fileName: string,
  products: Product[],
  maps: PosProductMap[],
  options: PosParseOptions = {}
): Promise<PosParseResult> {
  const fileHash = hashPosFile(bytes, fileName);
  const workbook = fileName.toLowerCase().endsWith(".csv")
    ? workbookFromCsv(bytes.toString("utf8"))
    : await loadXlsx(bytes);
  const sheets = workbook.worksheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.actualRowCount || sheet.rowCount || 0 }));
  const sheet = pickSheet(workbook, options.sheetName);
  if (!sheet) return emptyResult(fileHash, fileName, { sheets });

  const rows = sheetRows(sheet);
  const rawPreview = rows.slice(0, 12).map((row) => row.cells.map(asText));
  const detected = detectHeaderRow(rows.map((row) => row.cells));
  const headerIndex =
    options.headerRow != null
      ? rows.findIndex((row) => row.excelRow === options.headerRow)
      : detected?.index ?? -1;
  const headerDetected = headerIndex >= 0;
  const rawHeaders = headerDetected ? rows[headerIndex].cells.map(asText) : [];
  const fields = options.columnMap
    ? fieldsFromMap(options.columnMap, rows[0]?.cells.length ?? rawHeaders.length)
    : detected && headerIndex === detected.index
      ? detected.fields
      : headerDetected
        ? rawHeaders.map((header) => fieldForHeader(header))
        : [];
  const columnMap = columnMapFromFields(fields);
  const period = extractPosPeriod((headerDetected ? rows.slice(0, headerIndex) : rows).flatMap((row) => row.cells.map(asText)), fileName);

  if (!headerDetected || (columnMap.posName == null && !options.columnMap)) {
    return {
      ...emptyResult(fileHash, fileName),
      period,
      sheets,
      selectedSheet: sheet.name,
      headerRow: headerDetected ? rows[headerIndex].excelRow : null,
      headerDetected,
      rawHeaders,
      rawPreview,
      columnMap,
      needsMapping: true,
    };
  }

  const extracted = applyColumnMapToRows(rows, fields, headerIndex, products, maps);
  const summary = summarizePosExcel(extracted.lines);
  return {
    lines: extracted.lines,
    fileHash,
    period,
    summary,
    sourceTotals: extracted.sourceTotals,
    gaps: comparePosTotals(summary, extracted.sourceTotals),
    sheets,
    selectedSheet: sheet.name,
    headerRow: rows[headerIndex].excelRow,
    headerDetected: true,
    rawHeaders,
    rawPreview,
    columnMap,
    needsMapping: extracted.lines.length === 0,
  };
}
