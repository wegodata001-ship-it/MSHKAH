import { roundMoney } from "@/lib/costing/money";
import type { PurchaseUnit } from "@/lib/costing/types";
import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { emptyInvoiceLine, isNonStockInvoiceLine, newInvoiceLineKey } from "@/lib/inventory/invoice-lines";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";
import { applyInvoiceLineMoney, shownLinePrices, type LineMoneyEdit, type LinePriceBasis } from "@/lib/inventory/unit-price";

export type InvoiceEditChange = {
  at: string;
  actor?: string;
  field: string;
  lineKey?: string;
  before: string;
  after: string;
};

export type EditableInvoiceLine = {
  key: string;
  name: string;
  category: string;
  quantity: number | null;
  unit: PurchaseUnit | null;
  unitPrice: number | null;
  discount: number | null;
  vatPercent: number | null;
  lineTotal: number | null;
  basis: LinePriceBasis;
  anchor: "unitPrice" | "lineTotal";
  productId?: string;
  unitExcludingVat: number | null;
  unitIncludingVat: number | null;
  lineExcludingVat: number | null;
  lineIncludingVat: number | null;
  vatAmount: number | null;
};

export type EditableInvoiceDraft = {
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  lines: EditableInvoiceLine[];
};

export type InvoiceStockEffect =
  | { kind: "update"; lineKey: string; productId: string; movementId: string; quantity: number; unit: PurchaseUnit; fromBase: number; toBase: number; delta: number }
  | { kind: "reassign"; lineKey: string; movementId: string; fromProductId: string; toProductId: string; fromBase: number; toBase: number; quantity: number; unit: PurchaseUnit }
  | { kind: "add"; lineKey: string; productId: string; movementId: string; quantity: number; unit: PurchaseUnit; toBase: number }
  | { kind: "reverse"; lineKey: string; productId: string; movementId: string; reversalId: string; fromBase: number };

function percentOf(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return rate > 1 ? roundMoney(rate) : roundMoney(rate * 100);
}

function decimalRate(percent: number | null): number | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  return percent > 1 ? percent / 100 : percent;
}

function lineName(line: PurchaseInvoiceLine): string {
  return line.correctedInvoiceName || line.rawName || "";
}

export function editableLineFromInvoice(line: PurchaseInvoiceLine): EditableInvoiceLine {
  const shown = shownLinePrices(line);
  return {
    key: line.key,
    name: lineName(line),
    category: line.category || "",
    quantity: shown.quantity,
    unit: line.unit,
    unitPrice: shown.unit,
    discount: shown.discount,
    vatPercent: percentOf(line.vatRate),
    lineTotal: shown.line,
    basis: shown.basis,
    anchor: line.lastEditedField === "lineTotal" ? "lineTotal" : "unitPrice",
    productId: line.productId,
    unitExcludingVat: shown.unitExcludingVat,
    unitIncludingVat: shown.unitIncludingVat,
    lineExcludingVat: shown.lineExcludingVat,
    lineIncludingVat: shown.lineIncludingVat,
    vatAmount: shown.vatAmount,
  };
}

export function draftFromInvoice(invoice: PurchaseInvoice): EditableInvoiceDraft {
  return {
    supplierId: invoice.supplierId || "",
    supplierName: invoice.supplierName || "",
    invoiceNumber: invoice.invoiceNumber || "",
    invoiceDate: (invoice.invoiceDate || "").slice(0, 10),
    lines: (invoice.lines ?? []).filter((line) => line.lineType !== "SUMMARY").map(editableLineFromInvoice),
  };
}

export function blankEditableLine(vatPercent: number | null, basis: LinePriceBasis): EditableInvoiceLine {
  const empty = emptyInvoiceLine(decimalRate(vatPercent));
  return {
    ...editableLineFromInvoice({ ...empty, key: newInvoiceLineKey(), vatType: basis === "including" ? "inclusive" : basis === "exempt" ? "exempt" : "exclusive", priceIncludesVat: basis === "including" ? true : basis === "excluding" ? false : null }),
    basis,
    vatPercent,
  };
}

function asInvoiceLine(row: EditableInvoiceLine, previous?: PurchaseInvoiceLine): PurchaseInvoiceLine {
  const base = previous ?? emptyInvoiceLine(decimalRate(row.vatPercent));
  return {
    ...base,
    key: row.key,
    rawName: previous?.rawName || row.name,
    correctedInvoiceName: row.name,
    originalScannedName: previous?.originalScannedName || previous?.originalDescription || previous?.rawName || row.name,
    category: row.category || undefined,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    discount: row.discount,
    discountAmount: row.discount,
    lineTotal: row.lineTotal,
    vatRate: decimalRate(row.vatPercent),
    vatType: row.basis === "including" ? "inclusive" : row.basis === "exempt" ? "exempt" : row.basis === "excluding" ? "exclusive" : "unknown",
    priceIncludesVat: row.basis === "including" ? true : row.basis === "excluding" ? false : null,
    lastEditedField: row.anchor,
    productId: row.productId || previous?.productId,
  };
}

export function recalculateEditableLine(row: EditableInvoiceLine, edit: LineMoneyEdit): EditableInvoiceLine {
  const patch = applyInvoiceLineMoney(asInvoiceLine(row), edit, decimalRate(row.vatPercent) ?? 0.18);
  const next = { ...asInvoiceLine(row), ...patch };
  const shown = shownLinePrices(next);
  return {
    ...row,
    quantity: shown.quantity,
    unitPrice: shown.unit,
    discount: shown.discount,
    lineTotal: shown.line,
    basis: shown.basis,
    anchor: next.lastEditedField === "lineTotal" ? "lineTotal" : "unitPrice",
    vatPercent: shown.basis === "exempt" ? 0 : percentOf(next.vatRate),
    unitExcludingVat: shown.unitExcludingVat,
    unitIncludingVat: shown.unitIncludingVat,
    lineExcludingVat: shown.lineExcludingVat,
    lineIncludingVat: shown.lineIncludingVat,
    vatAmount: shown.vatAmount,
  };
}

function text(value: unknown): string {
  if (value == null || value === "") return "";
  return String(value);
}

function moneyText(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "" : roundMoney(value).toFixed(2);
}

export function materializeEditedLines(invoice: PurchaseInvoice, draft: EditableInvoiceDraft): PurchaseInvoiceLine[] {
  const previous = new Map((invoice.lines ?? []).map((line) => [line.key, line]));
  return draft.lines.map((row) => {
    const prior = previous.get(row.key);
    const materialized = asInvoiceLine(row, prior);
    const moneyEdit: LineMoneyEdit = row.anchor === "lineTotal"
      ? { field: "lineTotal", lineTotal: row.lineTotal }
      : { field: "unitPrice", unitPrice: row.unitPrice };
    const patch = applyInvoiceLineMoney(materialized, moneyEdit, decimalRate(row.vatPercent) ?? invoice.vatRate ?? 0.18);
    const nameChanged = lineName(prior ?? materialized) !== row.name;
    return {
      ...materialized,
      ...patch,
      rawName: prior?.rawName || row.name,
      correctedInvoiceName: row.name,
      originalScannedName: prior?.originalScannedName || prior?.originalDescription || prior?.rawName || row.name,
      category: row.category || undefined,
      unit: row.unit,
      productId: row.productId || prior?.productId,
      postedToStock: prior?.postedToStock,
      nameHistory: nameChanged && prior
        ? [...(prior.nameHistory ?? []), { at: "", from: lineName(prior), to: row.name, scope: "invoice" as const }]
        : prior?.nameHistory,
    };
  });
}

function posted(invoice: PurchaseInvoice, line: PurchaseInvoiceLine | undefined): boolean {
  if (!line || isNonStockInvoiceLine(line)) return false;
  return Boolean(line.postedToStock || invoice.stockStatus === "posted" || invoice.inventoryPostedAt);
}

export function planInvoiceEdit(invoice: PurchaseInvoice, draft: EditableInvoiceDraft, meta: { at: string; actor?: string }) {
  const nextLines = materializeEditedLines(invoice, draft).map((line) => ({
    ...line,
    nameHistory: (line.nameHistory ?? []).map((item) => item.at ? item : { ...item, at: meta.at, actor: meta.actor }),
  }));
  const beforeLines = new Map((invoice.lines ?? []).map((line) => [line.key, line]));
  const afterKeys = new Set(nextLines.map((line) => line.key));
  const changes: InvoiceEditChange[] = [];
  const push = (field: string, before: string, after: string, lineKey?: string) => {
    if (before === after) return;
    changes.push({ at: meta.at, actor: meta.actor, field, lineKey, before, after });
  };
  push("supplierName", text(invoice.supplierName), text(draft.supplierName));
  push("supplierId", text(invoice.supplierId), text(draft.supplierId));
  push("invoiceNumber", text(invoice.invoiceNumber), text(draft.invoiceNumber));
  push("invoiceDate", text(invoice.invoiceDate).slice(0, 10), text(draft.invoiceDate).slice(0, 10));
  for (const line of nextLines) {
    const prior = beforeLines.get(line.key);
    push("name", lineName(prior ?? { rawName: "" } as PurchaseInvoiceLine), lineName(line), line.key);
    push("category", text(prior?.category), text(line.category), line.key);
    push("quantity", moneyText(prior?.quantity), moneyText(line.quantity), line.key);
    push("unit", text(prior?.unit), text(line.unit), line.key);
    push("unitPrice", moneyText(prior?.unitPrice), moneyText(line.unitPrice), line.key);
    push("discount", moneyText(prior?.discountAmount ?? prior?.discount), moneyText(line.discountAmount ?? line.discount), line.key);
    push("vatRate", moneyText(percentOf(prior?.vatRate)), moneyText(percentOf(line.vatRate)), line.key);
    push("lineTotal", moneyText(prior?.lineTotal), moneyText(line.lineTotal), line.key);
    if (!prior) push("line", "", lineName(line), line.key);
  }
  for (const prior of invoice.lines ?? []) {
    if (!afterKeys.has(prior.key) && prior.lineType !== "SUMMARY") push("line", lineName(prior), "", prior.key);
  }

  const stock: InvoiceStockEffect[] = [];
  const affectsStock = invoice.stockStatus === "posted" || Boolean(invoice.inventoryPostedAt) || (invoice.lines ?? []).some((line) => line.postedToStock);
  if (affectsStock && invoice.id) {
    for (const prior of invoice.lines ?? []) {
      if (!posted(invoice, prior) || prior.lineType === "SUMMARY") continue;
      const fromBase = invoiceLineQuantityBase(prior) ?? 0;
      const next = nextLines.find((line) => line.key === prior.key);
      const movementId = invoicePurchaseMovementId(invoice.id, prior.key);
      if (!next) {
        if (prior.productId && fromBase > 0) {
          stock.push({ kind: "reverse", lineKey: prior.key, productId: prior.productId, movementId, reversalId: `edit-reverse-${invoice.id}-${prior.key}`, fromBase });
        }
        continue;
      }
      const toBase = invoiceLineQuantityBase(next) ?? 0;
      const unit = next.unit || prior.unit || "unit";
      const quantity = next.quantity ?? 0;
      if (prior.productId && next.productId && prior.productId !== next.productId) {
        stock.push({ kind: "reassign", lineKey: prior.key, movementId, fromProductId: prior.productId, toProductId: next.productId, fromBase, toBase, quantity, unit });
      } else if ((next.productId || prior.productId) && (toBase !== fromBase || next.unit !== prior.unit)) {
        const productId = next.productId || prior.productId!;
        stock.push({ kind: "update", lineKey: prior.key, productId, movementId, quantity, unit, fromBase, toBase, delta: Math.round((toBase - fromBase) * 10000) / 10000 });
      }
    }
    for (const line of nextLines) {
      if (beforeLines.has(line.key) || !line.productId) continue;
      const toBase = invoiceLineQuantityBase(line) ?? 0;
      if (toBase <= 0 || !line.unit) continue;
      stock.push({ kind: "add", lineKey: line.key, productId: line.productId, movementId: invoicePurchaseMovementId(invoice.id, line.key), quantity: line.quantity ?? 0, unit: line.unit, toBase });
    }
  }

  const net = roundMoney(nextLines.reduce((sum, line) => sum + (line.priceBeforeVat ?? line.lineNet ?? 0), 0));
  const vat = roundMoney(nextLines.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0));
  const gross = roundMoney(nextLines.reduce((sum, line) => sum + (line.priceIncludingVat ?? line.lineGross ?? 0), 0));
  return {
    changes,
    lines: nextLines,
    stock,
    header: {
      supplierId: draft.supplierId || undefined,
      supplierName: draft.supplierName,
      invoiceNumber: draft.invoiceNumber,
      invoiceDate: draft.invoiceDate,
      netAmount: net,
      vatAmount: vat,
      grossAmount: gross,
      subtotal: net,
      vatTotal: vat,
      grandTotal: gross,
      manuallyEdited: true,
      editedAt: meta.at,
      editedBy: meta.actor || undefined,
    },
    editHistory: [...(invoice.editHistory ?? []), ...changes].slice(-200),
  };
}

export function draftsEqual(left: EditableInvoiceDraft, right: EditableInvoiceDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
