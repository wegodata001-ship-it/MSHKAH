import { matchIngredient } from "@/lib/costing/import/match";
import { normalizeIngredientName } from "@/lib/costing/names";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { matchInventoryProduct, matchSupplier } from "@/lib/inventory/invoice-smart-match";
import type { PurchaseInvoice, Supplier, SupplierItemMap } from "@/lib/inventory/types";

export type PurchaseListField =
  | "supplier"
  | "invoice"
  | "date"
  | "name"
  | "quantity"
  | "unit"
  | "unitPrice"
  | "net"
  | "vat"
  | "gross"
  | "category";

const FIELD_ALIASES: Record<PurchaseListField, string[]> = {
  supplier: ["ספק", "שם_הספק", "חברה", "supplier", "vendor"],
  invoice: ["חשבונית", "מספר_חשבונית", "מסמך", "invoice", "invoice_number", "doc"],
  date: ["תאריך", "תאריך_חשבונית", "date", "invoice_date"],
  name: ["מוצר", "פריט", "שם", "שם_המוצר", "תיאור", "product", "item", "description"],
  quantity: ["כמות", "כמות_רכישה", "qty", "quantity"],
  unit: ["יחידה", "יח", "unit"],
  unitPrice: ["מחיר", "מחיר_יחידה", "מחיר_ליחידה", "unit_price", "price"],
  net: ["לפני_מעמ", "נטו", "net", "price_before_vat", "מחיר_לפני_מעמ", "סכום_לפני_מעמ"],
  vat: ["מעמ", "מע_מ", "vat"],
  gross: ["כולל_מעמ", "כולל_מעמ", "סהכ", "סכום", "gross", "total"],
  category: ["קטגוריה", "category"],
};

export type PurchaseListLine = {
  key: string;
  sourceRow: number;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  sourceName: string;
  canonicalName: string;
  quantity: number | null;
  unitText: string;
  unitPrice: number | null;
  lineNet: number | null;
  lineVat: number | null;
  lineGross: number | null;
  categoryHint?: string;
};

export type PurchasePackHint = {
  purchaseUnit: PurchaseUnit;
  stockUnit: PurchaseUnit;
  packSize: number | null;
  stockQuantity: number | null;
  note: string;
  needsReview: boolean;
};

export type PurchaseListDecision = {
  excluded?: boolean;
  ingredientId?: string;
  canonicalName?: string;
  category?: string;
  purchaseUnit?: PurchaseUnit;
  packSize?: number | null;
  acceptSuggest?: boolean;
};

export type PurchaseListRow = {
  key: string;
  sourceName: string;
  canonicalName: string;
  supplierName: string;
  supplierId?: string;
  createSupplier: boolean;
  invoiceNumber: string;
  invoiceDate: string;
  category: string;
  purchaseUnit: PurchaseUnit;
  pack: PurchasePackHint;
  unitPrice: number | null;
  lineNet: number | null;
  lineVat: number | null;
  lineGross: number | null;
  quantity: number | null;
  identity: "existing" | "new" | "uncertain";
  ingredientId?: string;
  alternatives: { id: string; name: string }[];
  excluded: boolean;
  needs: string[];
  duplicateInvoice: boolean;
};

export type PurchaseListPlan = {
  detailLines: PurchaseListLine[];
  summaryLines: PurchaseListLine[];
  rows: PurchaseListRow[];
  selectedRows: PurchaseListRow[];
  createIngredientCount: number;
  existingIngredientCount: number;
  createSupplierNames: string[];
  invoiceCount: number;
  purchaseCount: number;
  reviewCount: number;
  summaryGaps: { name: string; detailQty: number | null; summaryQty: number | null }[];
};

function headerKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[״"'`׳]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_|_$/g, "");
}

function fieldForHeader(header: string): PurchaseListField | null {
  const key = headerKey(header);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [PurchaseListField, string[]][]) {
    if (aliases.includes(key)) return field;
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [PurchaseListField, string[]][]) {
    if (aliases.some((alias) => alias.length >= 4 && (key.endsWith(`_${alias}`) || key.startsWith(`${alias}_`)))) return field;
  }
  return null;
}

function parseNumber(value: string): number | null {
  const text = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function parseMarkdownTables(text: string): { headers: string[]; rows: string[][] }[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const tables: { headers: string[]; rows: string[][] }[] = [];
  let current: string[][] = [];
  const flush = () => {
    const body = current.filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell.trim())));
    if (body.length >= 2) tables.push({ headers: body[0], rows: body.slice(1) });
    current = [];
  };
  for (const line of lines) {
    if (!line.includes("|")) {
      if (current.length) flush();
      continue;
    }
    const cells = line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.some((cell) => cell)) current.push(cells);
  }
  if (current.length) flush();
  return tables;
}

function mapTable(table: { headers: string[]; rows: string[][] }, startRow: number): PurchaseListLine[] {
  const fields = table.headers.map(fieldForHeader);
  if (!fields.includes("name")) return [];
  return table.rows
    .map((cells, index): PurchaseListLine | null => {
      const get = (field: PurchaseListField) => {
        const i = fields.indexOf(field);
        return i >= 0 ? cells[i] ?? "" : "";
      };
      const sourceName = get("name");
      if (!sourceName) return null;
      const qty = parseNumber(get("quantity"));
      const unitPrice = parseNumber(get("unitPrice"));
      const lineNet = parseNumber(get("net"));
      const lineGross = parseNumber(get("gross"));
      const lineVat = parseNumber(get("vat"));
      return {
        key: `pl-${startRow + index}-${canonicalPurchaseName(sourceName)}-${get("invoice")}`,
        sourceRow: startRow + index,
        supplierName: get("supplier"),
        invoiceNumber: get("invoice").replace(/\s+/g, ""),
        invoiceDate: normalizeDate(get("date")),
        sourceName,
        canonicalName: canonicalPurchaseName(sourceName),
        quantity: qty,
        unitText: get("unit"),
        unitPrice,
        lineNet,
        lineVat,
        lineGross,
        categoryHint: get("category") || undefined,
      };
    })
    .filter((row): row is PurchaseListLine => row != null);
}

export function canonicalPurchaseName(name: string): string {
  return name
    .replace(/(חשבונית|invoice|inv\.?|#)\s*\d+/gi, "")
    .replace(/\b\d{4,}\b/g, (token, offset, full) => {
      const around = full.slice(Math.max(0, offset - 12), offset + token.length + 12);
      return /חשב|invoice|מסמך/i.test(around) ? "" : token;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: string): string {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!dmy) return text;
  const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
  return `${year.padStart(4, "0")}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
}

function fillForward(lines: PurchaseListLine[]): PurchaseListLine[] {
  let supplier = "";
  let invoice = "";
  let date = "";
  return lines.map((line) => {
    if (line.supplierName.trim()) supplier = line.supplierName;
    if (line.invoiceNumber.trim()) invoice = line.invoiceNumber;
    if (line.invoiceDate.trim()) date = line.invoiceDate;
    return {
      ...line,
      supplierName: line.supplierName.trim() || supplier,
      invoiceNumber: line.invoiceNumber.trim() || invoice,
      invoiceDate: line.invoiceDate.trim() || date,
    };
  });
}

function parseDelimitedTable(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  if (lines.length < 2) return null;
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;
  if (!delimiter) return null;
  const rows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  if (!rows[0].some((cell) => fieldForHeader(cell))) return null;
  return { headers: rows[0], rows: rows.slice(1) };
}

export function parsePurchaseMarkdown(text: string): { detail: PurchaseListLine[]; summary: PurchaseListLine[] } {
  const tables = parseMarkdownTables(text);
  const fallback = !tables.length ? parseDelimitedTable(text) : null;
  const all = fallback ? [fallback] : tables;
  const mapped = all.map((table, index) => {
    const fields = table.headers.map(fieldForHeader);
    const lines = fillForward(mapTable(table, index * 1000 + 2));
    const isDetail = fields.includes("invoice") && (fields.includes("date") || fields.includes("supplier"));
    return { isDetail, lines, fields };
  });
  const detail = mapped.filter((item) => item.isDetail).flatMap((item) => item.lines);
  const summary = mapped.filter((item) => !item.isDetail).flatMap((item) => item.lines);
  if (detail.length) return { detail, summary };
  const richest = mapped.sort((a, b) => b.lines.length - a.lines.length)[0];
  return { detail: fillForward(richest?.lines ?? []), summary: [] };
}

const KNOWN_SUPPLIERS: { name: string; aliases: string[] }[] = [
  { name: "אלסונבולה שיווק מוצרי מזון בע״מ", aliases: ["אלסונבולה", "אל סונבולה", "alsunbola", "al sunbola"] },
  { name: "בריוש", aliases: ["brioche", "בריוש בעמ", "בריוש בע״מ"] },
];

function knownSupplier(name: string) {
  const target = normalizeIngredientName(name);
  if (!target) return undefined;
  return KNOWN_SUPPLIERS.find((item) =>
    [item.name, ...item.aliases].some((label) => {
      const n = normalizeIngredientName(label);
      return n === target || (n.length >= 4 && (target.includes(n) || n.includes(target)));
    })
  );
}

export function unifySupplierName(name: string): string {
  return knownSupplier(name)?.name ?? name.trim();
}

export function supplierAliasesFor(name: string): string[] {
  return knownSupplier(name)?.aliases ?? [];
}

export function guessPurchaseCategory(name: string, hint?: string): string {
  if (hint?.trim()) return hint.trim();
  const n = normalizeIngredientName(name);
  if (/קולה|ספרייט|פאנטה|מים|שתי|משקה|מיץ|מוחיטו|soda|cola|juice/.test(n)) return "משקאות";
  if (/לחם|בריוש|פאן|קרואסון|מאפה|בגט|לחמניה|bakery|bread/.test(n)) return "מאפים";
  if (/כוס|מכסה|שקית|אריז|מגש חד|מפית|pack|cup|lid/.test(n)) return "אריזות";
  if (/חלב|שמנת|גבינה|חמאה|יוגרט|ביצ/.test(n)) return "חלבון וחלבי";
  if (/קפוא|frozen/.test(n)) return "קפואים";
  return "מזון";
}

export function inferPurchasePack(name: string, quantity: number | null, unitText: string): PurchasePackHint {
  const text = `${name} ${unitText}`.toLowerCase();
  const vague = /\bxl\b|מים(?!\s*\d)/i.test(text) && !/\d+\s*(ק|kg|יח|פח)/i.test(text);
  const kg = text.match(/(\d+(?:[.,]\d+)?)\s*(?:ק["״]?ג|kg|קילו)/i);
  const units = text.match(/(\d+)\s*(?:יח(?:'?|׳)?|פחיות|יחידות|units?)/i);
  const tray =
    text.match(/(?:מגש|דלי|ארגז|מארז|קרטון).{0,24}?(?:של\s*)?(\d+)/i) ||
    text.match(/(\d+)\s*(?:במגש|במארז)/i);
  const qty = quantity ?? 0;
  if (kg) {
    const pack = Number(kg[1].replace(",", "."));
    return {
      purchaseUnit: "kg",
      stockUnit: "kg",
      packSize: pack,
      stockQuantity: qty && pack ? qty * pack : null,
      note: `${qty || "?"} × ${pack} ק״ג`,
      needsReview: false,
    };
  }
  if (units) {
    const pack = Number(units[1]);
    return {
      purchaseUnit: "unit",
      stockUnit: "unit",
      packSize: pack,
      stockQuantity: qty && pack ? qty * pack : null,
      note: `${qty || "?"} × ${pack} יח׳`,
      needsReview: false,
    };
  }
  if (tray) {
    const pack = Number(tray[1]);
    return {
      purchaseUnit: "unit",
      stockUnit: "unit",
      packSize: pack,
      stockQuantity: qty && pack ? qty * pack : null,
      note: `${qty || "?"} × ${pack}`,
      needsReview: false,
    };
  }
  const unit = /ק["״]?ג|kg/.test(unitText) ? "kg" : /ליטר|liter|l\b/.test(unitText) ? "liter" : "unit";
  return {
    purchaseUnit: unit,
    stockUnit: unit,
    packSize: null,
    stockQuantity: qty || null,
    note: vague ? "גודל מארז לא צוין" : unitText || "יחידת מקור",
    needsReview: vague || !unitText,
  };
}

export function purchaseInvoiceDuplicate(
  invoices: PurchaseInvoice[],
  supplierId: string | undefined,
  invoiceNumber: string
): boolean {
  const number = invoiceNumber.trim();
  if (!number || !supplierId) return false;
  return invoices.some((item) => item.supplierId === supplierId && item.invoiceNumber.trim() === number && item.status !== "rejected");
}

export function planPurchaseList(input: {
  text: string;
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  maps?: SupplierItemMap[];
  invoices?: PurchaseInvoice[];
  decisions?: Record<string, PurchaseListDecision>;
}): PurchaseListPlan {
  const parsed = parsePurchaseMarkdown(input.text);
  const maps = input.maps ?? [];
  const invoices = input.invoices ?? [];
  const rows = parsed.detail.map((line) => {
    const decision = input.decisions?.[line.key];
    const supplierName = unifySupplierName(line.supplierName);
    const supplierMatch = matchSupplier(supplierName, null, input.suppliers);
    const supplier = supplierMatch.supplier;
    const name = decision?.canonicalName?.trim() || line.canonicalName;
    const mapped = matchInventoryProduct({ name: line.sourceName }, input.ingredients, maps, supplier?.id);
    const mappedCanonical = matchInventoryProduct({ name }, input.ingredients, maps, supplier?.id);
    const nameMatch = matchIngredient(name, input.ingredients);
    const auto =
      mapped.kind === "exact" || mapped.kind === "mapped"
        ? mapped
        : mappedCanonical.kind === "exact" || mappedCanonical.kind === "mapped"
          ? mappedCanonical
          : nameMatch.kind === "exact"
            ? nameMatch
            : undefined;
    const chosen = decision?.ingredientId
      ? input.ingredients.find((item) => item.id === decision.ingredientId)
      : decision?.acceptSuggest
        ? mapped.item || mappedCanonical.item || nameMatch.item
        : auto?.item;
    const identity: PurchaseListRow["identity"] = chosen
      ? "existing"
      : mapped.kind === "suggest" || nameMatch.kind === "suggest"
        ? "uncertain"
        : "new";
    const pack = inferPurchasePack(line.sourceName, line.quantity, line.unitText);
    if (decision?.purchaseUnit) pack.purchaseUnit = decision.purchaseUnit;
    if (decision?.packSize != null) {
      pack.packSize = decision.packSize;
      pack.stockQuantity = line.quantity && decision.packSize ? line.quantity * decision.packSize : pack.stockQuantity;
      pack.needsReview = false;
    }
    const category = decision?.category || guessPurchaseCategory(name, line.categoryHint);
    const needs: string[] = [];
    if (!supplierName) needs.push("supplier");
    if (!line.invoiceNumber) needs.push("invoice");
    if (!line.invoiceDate) needs.push("date");
    if (line.quantity == null) needs.push("quantity");
    if (line.lineNet == null && line.lineGross == null && line.unitPrice == null) needs.push("price");
    if (identity === "uncertain") needs.push("match");
    if (pack.needsReview) needs.push("conversion");
    const duplicateInvoice = purchaseInvoiceDuplicate(invoices, supplier?.id, line.invoiceNumber);
    return {
      key: line.key,
      sourceName: line.sourceName,
      canonicalName: name,
      supplierName,
      supplierId: supplier?.id,
      createSupplier: !supplier && Boolean(supplierName),
      invoiceNumber: line.invoiceNumber,
      invoiceDate: line.invoiceDate,
      category,
      purchaseUnit: pack.purchaseUnit,
      pack,
      unitPrice: line.unitPrice,
      lineNet: line.lineNet,
      lineVat: line.lineVat,
      lineGross: line.lineGross,
      quantity: line.quantity,
      identity: decision?.ingredientId === "" ? "new" : identity,
      ingredientId: chosen?.id,
      alternatives: [
        ...(mapped.item ? [mapped.item] : []),
        ...(mappedCanonical.item ? [mappedCanonical.item] : []),
        ...mapped.alternatives,
        ...mappedCanonical.alternatives,
        ...nameMatch.alternatives,
      ]
        .filter((item, index, all) => all.findIndex((row) => row.id === item.id) === index)
        .map((item) => ({ id: item.id, name: item.name })),
      excluded: Boolean(decision?.excluded),
      needs,
      duplicateInvoice,
    } satisfies PurchaseListRow;
  });
  const selected = rows.filter((row) => !row.excluded);
  const byCanonical = new Map<string, number>();
  for (const line of parsed.detail) {
    const key = normalizeIngredientName(line.canonicalName);
    byCanonical.set(key, (byCanonical.get(key) ?? 0) + (line.quantity ?? 0));
  }
  const summaryGaps = parsed.summary.map((line) => ({
    name: line.canonicalName,
    detailQty: byCanonical.get(normalizeIngredientName(line.canonicalName)) ?? null,
    summaryQty: line.quantity,
  }));
  return {
    detailLines: parsed.detail,
    summaryLines: parsed.summary,
    rows,
    selectedRows: selected,
    createIngredientCount: new Set(selected.filter((row) => !row.ingredientId).map((row) => normalizeIngredientName(row.canonicalName))).size,
    existingIngredientCount: new Set(selected.filter((row) => row.ingredientId).map((row) => row.ingredientId)).size,
    createSupplierNames: [...new Set(selected.filter((row) => row.createSupplier).map((row) => row.supplierName))],
    invoiceCount: new Set(selected.map((row) => `${row.supplierName}|${row.invoiceNumber}`)).size,
    purchaseCount: selected.length,
    reviewCount: selected.filter((row) => row.needs.length || row.identity === "uncertain").length,
    summaryGaps,
  };
}

export function isWritablePurchaseRow(row: PurchaseListRow): boolean {
  if (row.excluded) return false;
  if (row.identity === "uncertain") return false;
  if (row.needs.includes("supplier") || row.needs.includes("invoice")) return false;
  return Boolean(row.canonicalName.trim());
}

export function purchaseLineKey(row: Pick<PurchaseListRow, "supplierName" | "invoiceNumber" | "canonicalName" | "invoiceDate" | "key">): string {
  return `plist-${normalizeIngredientName(row.supplierName)}-${row.invoiceNumber}-${normalizeIngredientName(row.canonicalName)}-${row.invoiceDate}-${row.key}`;
}

export function groupPurchaseInvoices(rows: PurchaseListRow[]): {
  supplierName: string;
  supplierId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  rows: PurchaseListRow[];
}[] {
  const groups = new Map<string, PurchaseListRow[]>();
  for (const row of rows) {
    const key = `${normalizeIngredientName(row.supplierName)}|${row.invoiceNumber}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.values()].map((list) => ({
    supplierName: list[0].supplierName,
    supplierId: list[0].supplierId,
    invoiceNumber: list[0].invoiceNumber,
    invoiceDate: list[0].invoiceDate,
    rows: list,
  }));
}
