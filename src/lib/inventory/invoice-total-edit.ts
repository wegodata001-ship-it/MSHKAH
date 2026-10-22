import { roundMoney } from "@/lib/costing/money";
import { headerNet, headerVat, originalInvoiceGross, payableInvoiceGross } from "@/lib/inventory/invoice-finance";
import { emptyInvoiceLine, invoiceFinanceTotals } from "@/lib/inventory/invoice-lines";
import type { InvoiceTotalRevision, PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

export const ROUNDING_LINE_NAME = "התאמת עיגול";

export type TotalDraft = {
  net: number | null;
  vat: number | null;
  vatPercent: number | null;
  discount: number | null;
  adjustment: number | null;
  total: number | null;
};

export type TotalField = keyof TotalDraft;

const MONEY_FIELDS: TotalField[] = ["net", "vat", "discount", "adjustment", "total"];

export function parseInvoiceMoney(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  let normalized = trimmed.replace(/\s/g, "");
  if (normalized.includes(",") && normalized.includes(".")) normalized = normalized.replace(/,/g, "");
  else if (normalized.includes(",")) normalized = normalized.replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return { ok: false };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value: roundMoney(value) };
}

export function parseVatPercent(raw: string): { ok: true; value: number } | { ok: false } {
  const parsed = parseInvoiceMoney(raw);
  if (!parsed.ok || parsed.value < 0 || parsed.value > 100) return { ok: false };
  return parsed;
}

export function totalDraftFromInvoice(invoice: PurchaseInvoice): TotalDraft {
  const rate = invoice.vatRate;
  const vatPercent = rate == null || !Number.isFinite(rate) ? null : rate > 1 ? roundMoney(rate) : roundMoney(rate * 100);
  return {
    net: headerNet(invoice),
    vat: headerVat(invoice),
    vatPercent,
    discount: invoice.headerDiscount ?? invoice.discountTotal ?? 0,
    adjustment: invoice.adjustmentAmount ?? invoice.rounding ?? 0,
    total: payableInvoiceGross(invoice),
  };
}

function composeTotal(draft: TotalDraft): number | null {
  if (draft.net == null || draft.vat == null) return null;
  return roundMoney(draft.net - (draft.discount ?? 0) + (draft.adjustment ?? 0) + draft.vat);
}

/** Changing one field updates only the total that depends on it. Editing the final total leaves every other field as it was. */
export function editTotalField(draft: TotalDraft, field: TotalField, value: number | null): { draft: TotalDraft; changed: TotalField[] } {
  const next: TotalDraft = { ...draft, [field]: value };
  const changed: TotalField[] = [field];
  if (field === "total" || value == null) return { draft: next, changed };
  if (field === "vatPercent" && next.net != null && value != null) {
    const vat = roundMoney(next.net * (value / 100));
    if (vat !== next.vat) {
      next.vat = vat;
      changed.push("vat");
    }
  }
  if (field !== "vatPercent" || changed.includes("vat")) {
    const total = composeTotal(next);
    if (total != null && total !== draft.total) {
      next.total = total;
      changed.push("total");
    }
  }
  return { draft: next, changed };
}

export function changedTotalFields(before: TotalDraft, after: TotalDraft): TotalField[] {
  return (Object.keys(before) as TotalField[]).filter((field) => before[field] !== after[field]);
}

function moneyText(value: number | null): string {
  return value == null ? "" : value.toFixed(2);
}

function productMoney(line: PurchaseInvoiceLine): string {
  return [line.quantity, line.unitPrice, line.lineNet, line.netAmount, line.lineGross, line.grossAmount, line.lineTotal].join("|");
}

export function productPricesUnchanged(before: PurchaseInvoiceLine[], after: PurchaseInvoiceLine[]): boolean {
  const afterByKey = new Map(after.filter((line) => line.lineType !== "ADJUSTMENT").map((line) => [line.key, line]));
  return before.filter((line) => line.lineType !== "ADJUSTMENT").every((line) => {
    const next = afterByKey.get(line.key);
    return next != null && productMoney(line) === productMoney(next);
  });
}

function roundingLine(amount: number, reason: string): PurchaseInvoiceLine {
  const line = emptyInvoiceLine(0);
  return {
    ...line,
    rawName: ROUNDING_LINE_NAME,
    originalDescription: reason,
    lineType: "ADJUSTMENT",
    quantity: 1,
    unit: "unit",
    unitPrice: amount,
    discount: 0,
    lineTotal: amount,
    lineNet: amount,
    lineGross: amount,
    vatType: "exempt",
    taxMode: "exempt",
    vatMode: "exempt",
    vatRate: 0,
    priceBeforeVat: amount,
    vatAmount: 0,
    priceIncludingVat: amount,
    netAmount: amount,
    grossAmount: amount,
    skipInventory: true,
    needsReview: false,
  };
}

function withRoundingLine(lines: PurchaseInvoiceLine[], amount: number, reason: string): PurchaseInvoiceLine[] {
  const existing = lines.find((line) => line.lineType === "ADJUSTMENT");
  if (Math.abs(amount) <= 0.001) return lines.filter((line) => line.lineType !== "ADJUSTMENT");
  if (!existing) return [...lines, roundingLine(amount, reason)];
  return lines.map((line) => (line.key === existing.key ? { ...roundingLine(amount, reason), key: existing.key } : line));
}

export function commitInvoiceTotalEdit(
  invoice: PurchaseInvoice,
  draft: TotalDraft,
  input: { at: string; actor?: string; reason: string; addAdjustment?: boolean }
): PurchaseInvoice {
  const reason = input.reason.trim() || "עריכה ידנית";
  const before = totalDraftFromInvoice(invoice);
  const original = invoice.originalInvoiceTotal ?? invoice.invoiceTotalFromSource ?? invoice.sourceGross ?? headerGrossFallback(invoice);
  let lines = invoice.lines;
  if (input.addAdjustment && draft.total != null) {
    const without = lines.filter((line) => line.lineType !== "ADJUSTMENT");
    const base = invoiceFinanceTotals(without).gross;
    lines = withRoundingLine(lines, roundMoney(draft.total - base), reason);
  }
  const totals = invoiceFinanceTotals(lines);
  const payable = draft.total;
  const difference = payable == null || !totals.itemCount ? null : roundMoney(totals.gross - payable);
  const revisions: InvoiceTotalRevision[] = changedTotalFields(before, draft).map((field) => ({
    at: input.at,
    actor: input.actor,
    reason,
    field,
    before: moneyText(before[field]),
    after: moneyText(draft[field]),
  }));
  if (input.addAdjustment) {
    revisions.push({
      at: input.at,
      actor: input.actor,
      reason,
      field: "adjustmentLine",
      before: "",
      after: moneyText(draft.total == null ? null : roundMoney(draft.total - invoiceFinanceTotals(invoice.lines.filter((line) => line.lineType !== "ADJUSTMENT")).gross)),
    });
  }
  const next: PurchaseInvoice = {
    ...invoice,
    lines,
    netAmount: draft.net,
    subtotal: draft.net,
    vatAmount: draft.vat,
    vatTotal: draft.vat,
    grossAmount: payable,
    grandTotal: payable,
    editedInvoiceTotal: payable,
    headerDiscount: draft.discount,
    discountTotal: draft.discount,
    adjustmentAmount: draft.adjustment,
    rounding: draft.adjustment,
    vatRate: draft.vatPercent == null ? invoice.vatRate : roundMoney(draft.vatPercent / 100, 4),
    originalInvoiceTotal: original,
    invoiceTotalFromSource: invoice.invoiceTotalFromSource ?? original,
    sourceNet: invoice.sourceNet,
    sourceVat: invoice.sourceVat,
    sourceGross: invoice.sourceGross,
    calculatedLinesTotal: totals.itemCount ? totals.gross : null,
    differenceAmount: difference,
    validationStatus: payable == null ? "missing" : difference != null && Math.abs(difference) <= 0.05 ? "pass" : "review",
    manuallyEdited: true,
    editedAt: input.at,
    editedBy: input.actor,
    totalHistory: [...(invoice.totalHistory ?? []), ...revisions],
    audit: [
      ...(invoice.audit ?? []),
      {
        at: input.at,
        actor: input.actor,
        action: "totals-edit",
        detail: reason,
        before: moneyText(before.total),
        after: moneyText(payable),
      },
    ],
  };
  return next;
}

function headerGrossFallback(invoice: PurchaseInvoice): number | null {
  return originalInvoiceGross(invoice) ?? invoice.grossAmount ?? invoice.grandTotal ?? null;
}

export function draftIsValid(draft: TotalDraft): boolean {
  return MONEY_FIELDS.every((field) => draft[field] == null || Number.isFinite(draft[field]))
    && (draft.vatPercent == null || (draft.vatPercent >= 0 && draft.vatPercent <= 100))
    && (draft.discount == null || draft.discount >= 0);
}
