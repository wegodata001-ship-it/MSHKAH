import { roundMoney } from "@/lib/costing/money";
import { recipeIngredientCost } from "@/lib/costing/calc";
import { buildDishRows, ingredientLookup } from "@/lib/costing/model";
import type { CostingIngredient, CostingSettings, DishRecipe } from "@/lib/costing/types";
import { lineRecipeCost } from "@/lib/costing/units";
import { DEFAULT_COSTING_SETTINGS } from "@/lib/costing/types";
import { computeBreakEven } from "@/lib/breakeven/compute";
import type { BreakEvenFixedCost, BreakEvenSettings, BreakEvenVariableCost } from "@/lib/breakeven/types";
import { buildCashFlow, cashPosition, type CashFlowEntry } from "@/lib/cashflow/engine";
import { archiveStatus } from "@/lib/inventory/invoice-archive";
import { buildInvoiceDocument, unitDocumentLabel } from "@/lib/inventory/invoice-document";
import { headerGross, headerNet, headerVat, originalInvoiceGross } from "@/lib/inventory/invoice-finance";
import { purchaseInvoicesForCashFlow } from "@/lib/inventory/supplier-ledger";
import { currentStockBase } from "@/lib/inventory/stock";
import type { InventoryMovement, PosZReport, PurchaseInvoice, PurchasePriceRecord, Supplier, SupplierOffer } from "@/lib/inventory/types";
import type { Product, Order } from "@/types";
import type { Category } from "@/types";
import { blankNumber } from "@/lib/reports/export/safe";
import type { ExportFilters, ReportDocument, ReportSheet, ReportValue } from "@/lib/reports/export/types";

export type ReportSource = {
  invoices: PurchaseInvoice[];
  movements: InventoryMovement[];
  payments: { id: string; status?: string; allocations?: { invoiceId?: string; amount?: number }[] }[];
  suppliers: Supplier[];
  ingredients: CostingIngredient[];
  offers: SupplierOffer[];
  prices: PurchasePriceRecord[];
  recipes: DishRecipe[];
  products: Product[];
  categories: Category[];
  zReports: PosZReport[];
  cashEntries: CashFlowEntry[];
  cashOpening: { amount: number; date: string } | null;
  fixedCosts: BreakEvenFixedCost[];
  variableCosts: BreakEvenVariableCost[];
  orders: Order[];
  costingSettings?: CostingSettings;
  breakEvenSettings?: BreakEvenSettings;
};

function nowLabel(date = new Date()): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(date);
}

function report(partial: Omit<ReportDocument, "generatedAt" | "reportId"> & { generatedAt?: string; reportId?: string }): ReportDocument {
  const at = new Date();
  return {
    generatedAt: partial.generatedAt || nowLabel(at),
    reportId: partial.reportId || `R-${at.getTime().toString(36)}`,
    ...partial,
  };
}

function paidFor(invoiceId: string, payments: ReportSource["payments"]): number | null {
  let paid = 0;
  let seen = false;
  for (const payment of payments) {
    if (payment.status && payment.status !== "executed") continue;
    for (const allocation of payment.allocations ?? []) {
      if (allocation.invoiceId !== invoiceId || allocation.amount == null) continue;
      paid += allocation.amount;
      seen = true;
    }
  }
  return seen ? roundMoney(paid) : null;
}

export function filterInvoices(invoices: PurchaseInvoice[], filters?: ExportFilters, ids?: string[]): PurchaseInvoice[] {
  if (ids?.length) {
    const selected = new Set(ids);
    return invoices.filter((invoice) => selected.has(invoice.id));
  }
  const query = filters?.query?.trim().toLowerCase();
  return invoices.filter((invoice) => {
    const archived = Boolean(invoice.archivedAt);
    if (filters?.invoiceScope === "archive" && !archived) return false;
    if (filters?.invoiceScope === "active" && archived) return false;
    const status = archiveStatus(invoice);
    if (filters && (!filters.status || filters.status === "all") && status === "cancelled") return false;
    if (filters?.status && filters.status !== "all" && !matchesArchiveFilter(status, filters.status, invoice)) return false;
    if (filters?.supplierId && invoice.supplierId !== filters.supplierId) return false;
    const date = invoice.invoiceDate || invoice.uploadedAt || invoice.createdAt || "";
    if (filters?.from && date.slice(0, 10) < filters.from) return false;
    if (filters?.to && date.slice(0, 10) > filters.to) return false;
    const hasSource = Boolean(invoice.sourceFile?.storagePath || invoice.fileUrl);
    if (filters?.source === "with" && !hasSource) return false;
    if (filters?.source === "without" && hasSource) return false;
    if (!query) return true;
    return [invoice.invoiceNumber, invoice.supplierName, ...(invoice.lines ?? []).map((line) => line.rawName)].join(" ").toLowerCase().includes(query);
  });
}

function matchesArchiveFilter(status: string, wanted: string, invoice: PurchaseInvoice): boolean {
  if (wanted === "review") return status === "needs_review" || status === "uploaded" || status === "scanning";
  if (wanted === "approved") return status === "approved" || status === "ready";
  if (wanted === "posted") return status === "posted";
  if (wanted === "failed") return status === "failed";
  if (wanted === "cancelled") return status === "cancelled";
  return invoice.status === wanted || invoice.scanStatus === wanted;
}

export function invoiceReport(source: ReportSource, invoices: PurchaseInvoice[], period: string): ReportDocument {
  const single = invoices.length === 1 ? invoices[0] : null;
  const sheets: ReportSheet[] = [
    summarySheet(invoices, source.payments),
    invoiceListSheet(invoices, source.payments),
    lineSheet(invoices),
    supplierSheet(invoices, source.suppliers),
    vatSheet(invoices),
    movementSheet(invoices, source.movements, source.ingredients),
    historySheet(invoices),
  ];
  if (single) sheets.unshift(singleHeaderSheet(single, source));
  return report({
    kind: single ? "invoice" : "invoices",
    title: single ? `משקאת — תיעוד חשבונית ${single.invoiceNumber || ""}`.trim() : "משקאת — חשבוניות רכש",
    period,
    landscape: true,
    sheets,
  });
}

function singleHeaderSheet(invoice: PurchaseInvoice, source: ReportSource): ReportSheet {
  const doc = buildInvoiceDocument({
    invoice,
    movements: source.movements.filter((movement) => movement.invoiceId === invoice.id),
    paidAmount: paidFor(invoice.id, source.payments),
    paymentsIncluded: true,
  });
  return {
    name: "פרטי חשבונית",
    columns: [{ header: "שדה", width: 2 }, { header: "ערך", width: 4 }],
    rows: [
      ...doc.header.map((field) => [field.label, field.value]),
      ...doc.money.map((field) => [field.label, field.value]),
      ["קליטה", doc.stock.emptyLabel || doc.stock.facts.map((fact) => `${fact.label}: ${fact.value}`).join(" | ")],
      ["מקור", doc.source.note],
      ["מזהה מקור", invoice.sourceFile?.storagePath || null],
      ...doc.notes.map((note, index) => [`הערה ${index + 1}`, note]),
    ],
  };
}

function summarySheet(invoices: PurchaseInvoice[], payments: ReportSource["payments"]): ReportSheet {
  const net = sum(invoices.map((invoice) => headerNet(invoice)));
  const vat = sum(invoices.map((invoice) => headerVat(invoice)));
  const gross = sum(invoices.map((invoice) => headerGross(invoice)));
  const paid = sum(invoices.map((invoice) => paidFor(invoice.id, payments)));
  return {
    name: "סיכום",
    columns: [
      { header: "פריט", width: 2 },
      { header: "סכום", kind: "money", width: 1.4 },
      { header: "פירוט", width: 1.2 },
    ],
    rows: [
      ["מספר חשבוניות", null, String(invoices.length)],
      ["לפני מע״מ", net, null],
      ["מע״מ", vat, null],
      ["כולל מע״מ", gross, null],
      ["שולם", paid, null],
      ["יתרה", gross == null || paid == null ? null : roundMoney(gross - paid), null],
    ],
  };
}

function invoiceListSheet(invoices: PurchaseInvoice[], payments: ReportSource["payments"]): ReportSheet {
  return {
    name: "חשבוניות",
    totals: true,
    columns: [
      { header: "מספר חשבונית", width: 1.4 },
      { header: "ספק", width: 1.8 },
      { header: "תאריך", kind: "date", width: 1.2 },
      { header: "תאריך קליטה", kind: "date", width: 1.2 },
      { header: "סוג", width: 1 },
      { header: "בדיקה", width: 1 },
      { header: "קליטה למלאי", width: 1.2 },
      { header: "לפני מע״מ", kind: "money", width: 1.2 },
      { header: "מע״מ", kind: "money", width: 1 },
      { header: "לתשלום", kind: "money", width: 1.2 },
      { header: "סכום מקור", kind: "money", width: 1.2 },
      { header: "סכום מתוקן", kind: "money", width: 1.2 },
      { header: "שולם", kind: "money", width: 1 },
      { header: "מזהה מקור", width: 2 },
    ],
    rows: invoices.map((invoice) => [
      invoice.invoiceNumber || null,
      invoice.supplierName || null,
      invoice.invoiceDate || null,
      (invoice.receivedAt || invoice.createdAt || "").slice(0, 10) || null,
      invoice.documentType || null,
      invoice.scanStatus || invoice.status || null,
      invoice.stockStatus || null,
      headerNet(invoice),
      headerVat(invoice),
      headerGross(invoice),
      originalInvoiceGross(invoice),
      invoice.manuallyEdited ? invoice.editedInvoiceTotal ?? null : null,
      paidFor(invoice.id, payments),
      invoice.sourceFile?.storagePath || null,
    ]),
  };
}

function lineSheet(invoices: PurchaseInvoice[]): ReportSheet {
  const rows: ReportValue[][] = [];
  for (const invoice of invoices) {
    (invoice.lines ?? []).forEach((line, index) => {
      rows.push([
        invoice.invoiceNumber || invoice.id,
        index + 1,
        line.rawName || line.originalDescription || null,
        line.category || null,
        blankNumber(line.quantity),
        unitDocumentLabel(line.unit),
        blankNumber(line.unitPrice),
        line.discountAmount ?? line.discount ?? (line.discountPercent != null ? `${line.discountPercent}%` : null),
        blankNumber(line.vatAmount),
        line.vatRate == null ? null : line.vatRate > 1 ? line.vatRate : roundMoney(line.vatRate * 100, 2),
        blankNumber(line.lineTotal ?? line.grossAmount ?? line.netAmount),
        line.postedToStock ? "נקלט" : "ממתין",
      ]);
    });
  }
  return {
    name: "שורות",
    totals: true,
    columns: [
      { header: "מספר חשבונית", width: 1.3 },
      { header: "שורה", kind: "number", width: 0.6 },
      { header: "מוצר", width: 2.4 },
      { header: "קטגוריה", width: 1.3 },
      { header: "כמות", kind: "number", width: 0.8 },
      { header: "יחידה", width: 0.8 },
      { header: "מחיר יחידה", kind: "money", width: 1.1 },
      { header: "הנחה", width: 0.9 },
      { header: "מע״מ", kind: "money", width: 0.9 },
      { header: "שיעור מע״מ", kind: "percent", width: 0.9 },
      { header: "סה״כ", kind: "money", width: 1 },
      { header: "קליטה", width: 0.8 },
    ],
    rows,
  };
}

function supplierSheet(invoices: PurchaseInvoice[], suppliers: Supplier[]): ReportSheet {
  const names = new Map<string, { name: string; taxId: string | null; count: number; gross: number | null }>();
  for (const supplier of suppliers) names.set(supplier.id, { name: supplier.name, taxId: supplier.taxId || null, count: 0, gross: null });
  for (const invoice of invoices) {
    const key = invoice.supplierId || invoice.supplierName || invoice.id;
    const current = names.get(key) ?? { name: invoice.supplierName, taxId: invoice.supplierTaxId || null, count: 0, gross: null };
    current.count += 1;
    const gross = headerGross(invoice);
    if (gross != null) current.gross = roundMoney((current.gross ?? 0) + gross);
    names.set(key, current);
  }
  return {
    name: "ספקים",
    totals: true,
    columns: [
      { header: "ספק", width: 2 },
      { header: "ח.פ.", width: 1.2 },
      { header: "חשבוניות", kind: "number", width: 1 },
      { header: "סכום", kind: "money", width: 1.2 },
    ],
    rows: [...names.values()].map((row) => [row.name, row.taxId, row.count, row.gross]),
  };
}

function vatSheet(invoices: PurchaseInvoice[]): ReportSheet {
  const groups = new Map<string, { net: number | null; vat: number | null; count: number }>();
  for (const invoice of invoices) {
    const key = invoice.vatRate == null ? "לא נשמר" : String(invoice.vatRate);
    const current = groups.get(key) ?? { net: null, vat: null, count: 0 };
    current.count += 1;
    const net = headerNet(invoice);
    const vat = headerVat(invoice);
    if (net != null) current.net = roundMoney((current.net ?? 0) + net);
    if (vat != null) current.vat = roundMoney((current.vat ?? 0) + vat);
    groups.set(key, current);
  }
  return {
    name: "מע״מ",
    columns: [
      { header: "שיעור שמור", width: 1.4 },
      { header: "חשבוניות", kind: "number", width: 1 },
      { header: "לפני מע״מ", kind: "money", width: 1.3 },
      { header: "סכום מע״מ", kind: "money", width: 1.3 },
    ],
    rows: [...groups.entries()].map(([rate, row]) => [rate, row.count, row.net, row.vat]),
  };
}

function movementSheet(invoices: PurchaseInvoice[], movements: InventoryMovement[], ingredients: CostingIngredient[]): ReportSheet {
  const ids = new Set(invoices.map((invoice) => invoice.id));
  const names = new Map(ingredients.map((item) => [item.id, item.name]));
  const numbers = new Map(invoices.map((invoice) => [invoice.id, invoice.invoiceNumber || invoice.id]));
  return {
    name: "תנועות מלאי",
    columns: [
      { header: "מספר חשבונית", width: 1.4 },
      { header: "מוצר", width: 1.8 },
      { header: "סוג", width: 1.2 },
      { header: "כמות", kind: "number", width: 0.8 },
      { header: "יחידה", width: 0.8 },
      { header: "כמות בסיס", kind: "number", width: 1 },
      { header: "תאריך", kind: "date", width: 1.2 },
    ],
    rows: movements
      .filter((movement) => movement.invoiceId && ids.has(movement.invoiceId))
      .map((movement) => [
        numbers.get(movement.invoiceId || "") || movement.invoiceId || null,
        names.get(movement.productId) || movement.productId || null,
        movement.type,
        blankNumber(movement.quantity),
        unitDocumentLabel(movement.unit),
        blankNumber(movement.quantityBase),
        (movement.createdAt || "").slice(0, 10) || null,
      ]),
  };
}

function historySheet(invoices: PurchaseInvoice[]): ReportSheet {
  const rows: ReportValue[][] = [];
  for (const invoice of invoices) {
    const doc = buildInvoiceDocument({ invoice, paymentsIncluded: false });
    for (const event of doc.timeline) {
      rows.push([invoice.invoiceNumber || invoice.id, event.at, event.action, event.actor, event.detail || null, event.before || null, event.after || null]);
    }
  }
  return {
    name: "היסטוריה",
    columns: [
      { header: "מספר חשבונית", width: 1.3 },
      { header: "זמן", width: 1.6 },
      { header: "פעולה", width: 1.4 },
      { header: "משתמש", width: 1.4 },
      { header: "פירוט", width: 2 },
      { header: "לפני", width: 1.2 },
      { header: "אחרי", width: 1.2 },
    ],
    rows,
  };
}

export function supplierReport(source: ReportSource, period: string): ReportDocument {
  return report({
    kind: "suppliers",
    title: "משקאת — ספקים ומחירים",
    period,
    landscape: true,
    sheets: [
      {
        name: "ספקים",
        columns: [
          { header: "שם", width: 2 },
          { header: "ח.פ.", width: 1.2 },
          { header: "טלפון", width: 1.2 },
          { header: "פעיל", width: 0.7 },
        ],
        rows: source.suppliers.map((supplier) => [supplier.name, supplier.taxId || null, supplier.phone || null, supplier.active ? "כן" : "לא"]),
      },
      {
        name: "הצעות מחיר",
        totals: true,
        columns: [
          { header: "מוצר", width: 2 },
          { header: "ספק", width: 1.6 },
          { header: "מחיר", kind: "money", width: 1 },
          { header: "יחידה", width: 0.8 },
          { header: "תאריך", kind: "date", width: 1.1 },
        ],
        rows: source.offers.map((offer) => [
          source.ingredients.find((item) => item.id === offer.productId)?.name || offer.productId,
          source.suppliers.find((item) => item.id === offer.supplierId)?.name || offer.supplierId,
          blankNumber(offer.currentPrice ?? offer.lastPurchasePrice),
          offer.purchaseUnit ? unitDocumentLabel(offer.purchaseUnit) : null,
          (offer.lastPurchaseDate || offer.lastQuotedAt || "").slice(0, 10) || null,
        ]),
      },
    ],
  });
}

export function inventoryReport(source: ReportSource, period: string): ReportDocument {
  return report({
    kind: "inventory",
    title: "משקאת — מלאי מוצרים",
    period,
    sheets: [{
      name: "מלאי",
      columns: [
        { header: "מוצר", width: 2.2 },
        { header: "קטגוריה", width: 1.3 },
        { header: "יחידת בסיס", width: 0.9 },
        { header: "יתרה", kind: "number", width: 0.9 },
        { header: "מינימום", kind: "number", width: 0.9 },
        { header: "עלות ליחידת בסיס", kind: "money", width: 1.3 },
        { header: "ספק אחרון", width: 1.4 },
      ],
      rows: source.ingredients.map((item) => [
        item.name,
        item.category || null,
        unitDocumentLabel(item.baseUnit),
        currentStockBase(source.movements, item.id),
        item.minStock == null ? null : item.minStock,
        item.costPerBaseUnit > 0 ? item.costPerBaseUnit : null,
        item.supplier || null,
      ]),
    }],
  });
}

export function movementReport(source: ReportSource, period: string): ReportDocument {
  const names = new Map(source.ingredients.map((item) => [item.id, item.name]));
  return report({
    kind: "movements",
    title: "משקאת — תנועות מלאי",
    period,
    landscape: true,
    sheets: [{
      name: "תנועות",
      columns: [
        { header: "תאריך", kind: "date", width: 1.2 },
        { header: "מוצר", width: 1.8 },
        { header: "סוג", width: 1.2 },
        { header: "כמות", kind: "number", width: 0.8 },
        { header: "יחידה", width: 0.8 },
        { header: "כמות בסיס", kind: "number", width: 1 },
        { header: "חשבונית", width: 1.2 },
      ],
      rows: source.movements.map((movement) => [
        (movement.createdAt || movement.receivedAt || "").slice(0, 10) || null,
        names.get(movement.productId) || movement.productId,
        movement.type,
        blankNumber(movement.quantity),
        unitDocumentLabel(movement.unit),
        blankNumber(movement.quantityBase),
        movement.invoiceId || null,
      ]),
    }],
  });
}

export function alertReport(source: ReportSource, period: string): ReportDocument {
  const rows = source.ingredients.flatMap((item) => {
    const balance = currentStockBase(source.movements, item.id);
    const below = item.minStock != null && balance < item.minStock;
    const offers = source.offers.filter((offer) => offer.productId === item.id);
    const missingSupplier = offers.length === 0 && !item.supplier && !item.lastSupplierId;
    if (!below && !missingSupplier) return [];
    return [[item.name, item.category || null, balance, item.minStock ?? null, below ? "מתחת למינימום" : null, missingSupplier ? "חסר ספק" : null] as ReportValue[]];
  });
  return report({
    kind: "alerts",
    title: "משקאת — התראות מלאי",
    period,
    sheets: [{
      name: "התראות",
      columns: [
        { header: "מוצר", width: 2 },
        { header: "קטגוריה", width: 1.3 },
        { header: "יתרה", kind: "number", width: 0.9 },
        { header: "מינימום", kind: "number", width: 0.9 },
        { header: "מלאי", width: 1.3 },
        { header: "ספק", width: 1.2 },
      ],
      rows,
    }],
  });
}

export function dishReport(source: ReportSource, period: string): ReportDocument {
  const settings = source.costingSettings ?? DEFAULT_COSTING_SETTINGS;
  const rows = buildDishRows(source.products, source.recipes, source.ingredients, settings);
  const lookup = ingredientLookup(source.ingredients);
  const lines: ReportValue[][] = [];
  for (const row of rows) {
    for (const line of row.recipe?.ingredients ?? []) {
      const ingredient = lookup.get(line.ingredientId);
      const cost = ingredient && ingredient.costPerBaseUnit > 0 ? lineRecipeCost(line.quantity, line.unit, ingredient.costPerBaseUnit) : null;
      lines.push([
        row.product.name_he || row.product.name_en || null,
        ingredient?.name || line.ingredientId,
        blankNumber(line.quantity),
        unitDocumentLabel(line.unit),
        cost,
      ]);
    }
  }
  return report({
    kind: "dishes",
    title: "משקאת — תמחור מנות",
    period,
    landscape: true,
    sheets: [
      {
        name: "מנות",
        totals: true,
        columns: [
          { header: "מנה", width: 2 },
          { header: "מחיר מכירה", kind: "money", width: 1.1 },
          { header: "עלות מנה", kind: "money", width: 1.1 },
          { header: "Food Cost", kind: "percent", width: 1 },
          { header: "רווח גולמי", kind: "money", width: 1.1 },
          { header: "אחוז רווח", kind: "percent", width: 1 },
          { header: "מרכיבים", kind: "number", width: 0.8 },
        ],
        rows: rows.map((row) => {
          const costKnown = Boolean(row.recipe) && row.ingredientCost > 0;
          return [
            row.product.name_he || row.product.name_en || null,
            blankNumber(row.sellingPrice),
            costKnown ? row.ingredientCost : null,
            costKnown && row.foodCost != null ? roundMoney(row.foodCost, 1) : null,
            costKnown ? row.grossProfit : null,
            costKnown && row.grossMargin != null ? roundMoney(row.grossMargin, 1) : null,
            row.recipe ? row.lineCount : null,
          ];
        }),
      },
      {
        name: "מרכיבים",
        totals: true,
        columns: [
          { header: "מנה", width: 1.8 },
          { header: "מרכיב", width: 1.8 },
          { header: "כמות", kind: "number", width: 0.8 },
          { header: "יחידה", width: 0.8 },
          { header: "עלות", kind: "money", width: 1 },
        ],
        rows: lines,
      },
    ],
  });
}

export function breakEvenReport(source: ReportSource, period: string): ReportDocument {
  let result: ReturnType<typeof computeBreakEven> | null = null;
  try {
    const [from, to] = period.includes("–") ? period.split("–") : [period.slice(0, 7) + "-01", period.slice(0, 10)];
    result = computeBreakEven({
      settings: source.breakEvenSettings,
      fixed: source.fixedCosts,
      variable: source.variableCosts,
      orders: source.orders,
      recipes: source.recipes,
      ingredients: source.ingredients,
      products: source.products.map((product) => ({ id: product.id, name: product.name_he || product.name_en || product.id, price: product.price })),
      from: from || period,
      to: to || period,
    });
  } catch {
    result = null;
  }
  return report({
    kind: "breakeven",
    title: "משקאת — נקודת איזון",
    period,
    sheets: [
      {
        name: "סיכום",
        columns: [{ header: "פריט", width: 2 }, { header: "ערך", width: 1.4 }],
        rows: [
          ["ניתן לחשב", result?.canCompute ? "כן" : "לא"],
          ["הכנסות", result?.revenue ?? null],
          ["עלות קבועה חודשית", result?.fixedMonthly ?? null],
          ["עלות משתנה", result?.variableTotal ?? null],
          ["Food Cost", result?.foodCost ?? null],
          ["נקודת איזון חודשית", result?.breakEvenMonthly ?? null],
          ["חסר", result?.missing?.map((item) => item).join(", ") || null],
        ],
      },
      {
        name: "עלויות קבועות",
        totals: true,
        columns: [
          { header: "שם", width: 2 },
          { header: "סכום", kind: "money", width: 1 },
          { header: "תדירות", width: 1 },
          { header: "פעיל", width: 0.7 },
        ],
        rows: source.fixedCosts.map((cost) => [cost.name, blankNumber(cost.amount), cost.frequency || null, cost.active === false ? "לא" : "כן"]),
      },
    ],
  });
}

export function cashflowReport(source: ReportSource, period: string): ReportDocument {
  const [from, to] = periodBounds(period);
  const flow = buildCashFlow({
    fixed: source.fixedCosts,
    invoices: purchaseInvoicesForCashFlow(source.invoices),
    entries: source.cashEntries,
    opening: source.cashOpening,
    rangeStart: from,
    rangeEnd: to,
    today: to,
  });
  const position = cashPosition(flow);
  return report({
    kind: "cashflow",
    title: "משקאת — תזרים מזומנים",
    period: `${from}–${to}`,
    landscape: true,
    sheets: [
      {
        name: "סיכום",
        columns: [{ header: "פריט", width: 2 }, { header: "סכום", kind: "money", width: 1.3 }],
        rows: [
          ["יתרת פתיחה", flow.opening],
          ["יתרה בפועל", position.actual],
          ["צפוי נכנס", position.expectedIn],
          ["צפוי יוצא", position.expectedOut],
          ["יתרה צפויה", position.projected],
          ["יתרת סגירה", flow.closing],
        ],
      },
      {
        name: "תנועות",
        totals: true,
        columns: [
          { header: "תאריך", kind: "date", width: 1.1 },
          { header: "תיאור", width: 2 },
          { header: "צד", width: 1 },
          { header: "נכנס", kind: "money", width: 1 },
          { header: "יוצא", kind: "money", width: 1 },
          { header: "מצב", width: 1 },
          { header: "מקור", width: 1 },
          { header: "נכלל ביתרה", width: 1 },
        ],
        rows: flow.lines.map((line) => [
          line.date,
          line.description || null,
          line.inflow ? "נכנס" : "יוצא",
          line.inflow ? line.inflow : null,
          line.outflow ? line.outflow : null,
          line.forecast ? "התחייבות עתידית" : "שולם בפועל",
          line.source,
          line.countsInBalance ? "כן" : "לא",
        ]),
      },
    ],
  });
}

export function zReport(source: ReportSource, period: string): ReportDocument {
  return report({
    kind: "z",
    title: "משקאת — דוחות Z",
    period,
    sheets: [{
      name: "דוחות Z",
      totals: true,
      columns: [
        { header: "מספר", width: 1 },
        { header: "תאריך", kind: "date", width: 1.1 },
        { header: "מכירות", kind: "money", width: 1.1 },
        { header: "מע״מ", kind: "money", width: 1 },
        { header: "סטטוס", width: 0.9 },
      ],
      rows: source.zReports.map((reportRow) => [
        reportRow.reportNumber || null,
        reportRow.businessDate || null,
        reportRow.salesIncludingVat ?? reportRow.salesTotal ?? null,
        reportRow.vatTotal ?? null,
        reportRow.status,
      ]),
    }],
  });
}

export function compareReport(source: ReportSource, period: string): ReportDocument {
  return report({
    kind: "compare",
    title: "משקאת — השוואת ספקים",
    period,
    landscape: true,
    sheets: [{
      name: "השוואה",
      columns: [
        { header: "מוצר", width: 2 },
        { header: "ספק", width: 1.6 },
        { header: "מחיר", kind: "money", width: 1 },
        { header: "יחידה", width: 0.8 },
        { header: "תאריך רכישה", kind: "date", width: 1.2 },
      ],
      rows: source.offers.map((offer) => [
        source.ingredients.find((item) => item.id === offer.productId)?.name || offer.productId,
        source.suppliers.find((item) => item.id === offer.supplierId)?.name || offer.supplierId,
        blankNumber(offer.lastPurchasePrice ?? offer.currentPrice),
        offer.purchaseUnit ? unitDocumentLabel(offer.purchaseUnit) : null,
        (offer.lastPurchaseDate || "").slice(0, 10) || null,
      ]),
    }],
  });
}

export function priceReport(source: ReportSource, period: string): ReportDocument {
  const products = new Map(source.ingredients.map((item) => [item.id, item.name]));
  const suppliers = new Map(source.suppliers.map((item) => [item.id, item.name]));
  return report({
    kind: "prices",
    title: "משקאת — היסטוריית מחירי רכש",
    period,
    landscape: true,
    sheets: [{
      name: "מחירים",
      totals: true,
      columns: [
        { header: "תאריך", kind: "date", width: 1.1 },
        { header: "מוצר", width: 1.8 },
        { header: "ספק", width: 1.4 },
        { header: "כמות", kind: "number", width: 0.8 },
        { header: "יחידה", width: 0.8 },
        { header: "מחיר", kind: "money", width: 1 },
        { header: "חשבונית", width: 1.2 },
      ],
      rows: source.prices.map((record) => [
        (record.purchaseDate || "").slice(0, 10) || null,
        products.get(record.productId) || record.productId,
        record.supplierId ? suppliers.get(record.supplierId) || record.supplierId : null,
        blankNumber(record.quantity),
        unitDocumentLabel(record.unit),
        blankNumber(record.priceIncludingVat ?? record.priceBeforeVat),
        record.invoiceId || null,
      ]),
    }],
  });
}

export function buildReport(kind: ReportDocument["kind"], source: ReportSource, invoices: PurchaseInvoice[], period: string): ReportDocument {
  if (kind === "invoice" || kind === "invoices") return invoiceReport(source, invoices, period);
  if (kind === "suppliers") return supplierReport(source, period);
  if (kind === "inventory") return inventoryReport(source, period);
  if (kind === "movements") return movementReport(source, period);
  if (kind === "alerts") return alertReport(source, period);
  if (kind === "dishes") return dishReport(source, period);
  if (kind === "breakeven") return breakEvenReport(source, period);
  if (kind === "cashflow") return cashflowReport(source, period);
  if (kind === "z") return zReport(source, period);
  if (kind === "compare") return compareReport(source, period);
  return priceReport(source, period);
}

function sum(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!present.length) return null;
  return roundMoney(present.reduce((total, value) => total + value, 0));
}

function periodBounds(period: string): [string, string] {
  if (period.includes("–")) {
    const [from, to] = period.split("–");
    if (from && to) return [from, to];
  }
  const month = /^\d{4}-\d{2}$/.test(period) ? period : new Date().toISOString().slice(0, 7);
  const [year, rawMonth] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year || 2026, rawMonth || 1, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}
