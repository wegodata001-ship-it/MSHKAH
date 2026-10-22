import { roundMoney } from "@/lib/costing/money";
import { LINE_UNITS } from "@/lib/costing/units";
import type { PurchaseUnit } from "@/lib/costing/types";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/inventory/vat";
import type { InvoiceLineType, PurchaseInvoiceLine, VatType } from "@/lib/inventory/types";

export const INVOICE_UNITS: PurchaseUnit[] = LINE_UNITS;

export function newInvoiceLineKey(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyInvoiceLine(vatRate: number | null = DEFAULT_VAT_RATE): PurchaseInvoiceLine {
  return {
    key: newInvoiceLineKey(),
    rawName: "",
    quantity: null,
    unit: "kg",
    unitPrice: null,
    discount: null,
    lineTotal: null,
    vatType: "inclusive",
    taxMode: "inclusive",
    vatRate,
    priceBeforeVat: null,
    vatAmount: null,
    priceIncludingVat: null,
  };
}

const MONEY_TOLERANCE = 0.05;

const SUMMARY_LABEL = /^(?:סה["״']?כ(?:\s+(?:לתשלום|כולל מע["״']?מ|לפני מע["״']?מ|לפני הנחה))?|מע["״']?מ|יתרה(?:\s+לתשלום)?|total|subtotal|grand total|vat|المجموع|الإجمالي|الضريبة)$/i;
const DISCOUNT_LABEL = /^(?:הנחה|خصم|discount)$/i;
const RETURN_LABEL = /^(?:זיכוי|החזרה|החזר|return|credit|مرتجع)$/i;
const DEPOSIT_LABEL = /^(?:פיקדון|deposit|تأمين)$/i;

function lineLabel(line: { rawName?: string; originalDescription?: string | null }): string {
  return (line.rawName || line.originalDescription || "").replace(/\s+/g, " ").trim();
}

export function detectedLineType(line: Pick<PurchaseInvoiceLine, "lineType" | "rawName" | "originalDescription">): InvoiceLineType | null {
  if (line.lineType && line.lineType !== "UNKNOWN") return line.lineType;
  const label = lineLabel(line);
  if (!label) return line.lineType ?? null;
  if (SUMMARY_LABEL.test(label)) return "SUMMARY";
  if (DISCOUNT_LABEL.test(label)) return "DISCOUNT";
  if (RETURN_LABEL.test(label)) return "RETURN";
  if (DEPOSIT_LABEL.test(label)) return "DEPOSIT";
  return line.lineType ?? null;
}

export function invoiceLineRole(line: Pick<PurchaseInvoiceLine, "lineType" | "rawName" | "originalDescription">): "product" | "discount" | "return" | "deposit" | "summary" | "shipping" | "service" {
  const type = detectedLineType(line);
  if (type === "SUMMARY") return "summary";
  if (type === "DISCOUNT") return "discount";
  if (type === "RETURN") return "return";
  if (type === "DEPOSIT") return "deposit";
  if (type === "SHIPPING") return "shipping";
  if (type === "SERVICE") return "service";
  return "product";
}

function firstMoney(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function moneyClose(left: number | null, right: number | null): boolean {
  return left != null && right != null && Math.abs(roundMoney(left) - roundMoney(right)) <= MONEY_TOLERANCE;
}

export function lineNetAmount(line: Pick<PurchaseInvoiceLine, "quantity" | "unitPrice" | "discount">): number {
  const qty = Number(line.quantity);
  const price = Number(line.unitPrice);
  const discount = Number(line.discount) || 0;
  if (!Number.isFinite(qty) || qty === 0 || !Number.isFinite(price) || price < 0) return 0;
  return roundMoney(qty * price - discount);
}

type PrintedMoney = { net: number | null; vat: number | null; gross: number | null; conflict: boolean };

function resolvePrintedLineMoney(line: PurchaseInvoiceLine, vatRate: number | null): PrintedMoney | null {
  const tax = line.vatType || line.taxMode || line.vatMode || "inclusive";
  const rate = line.vatRate ?? vatRate;
  const printedNet = firstMoney(line.netAmount, line.lineNet, line.priceBeforeVat);
  const printedGross = firstMoney(line.grossAmount, line.lineGross, line.priceIncludingVat);
  const printedVat = firstMoney(line.vatAmount);
  const printedTotal = firstMoney(line.lineTotal);
  const computed = lineNetAmount(line);
  const computedValue = computed !== 0 ? computed : null;
  if (printedNet == null && printedGross == null && printedTotal == null) return null;

  if (printedNet != null && printedGross != null) {
    return {
      net: printedNet,
      vat: printedVat ?? roundMoney(printedGross - printedNet),
      gross: printedGross,
      conflict: computedValue != null && !moneyClose(computedValue, tax === "inclusive" ? printedGross : printedNet) && !moneyClose(computedValue, printedGross),
    };
  }

  if (printedGross != null) {
    const matchesNet = computedValue != null && rate != null && rate > 0 && moneyClose(computedValue, printedGross / (1 + (rate > 1 ? rate / 100 : rate)));
    const conflict = computedValue != null && !moneyClose(computedValue, printedGross) && !matchesNet;
    if (tax === "unknown") return { net: printedGross, vat: printedVat ?? 0, gross: printedGross, conflict };
    const split = splitVat({ amount: printedGross, vatType: tax === "exclusive" ? "inclusive" : tax, vatRate: rate });
    return { net: split.priceBeforeVat, vat: printedVat ?? split.vatAmount, gross: printedGross, conflict };
  }

  if (printedNet != null) {
    const conflict = computedValue != null && !moneyClose(computedValue, printedNet);
    if (tax === "unknown") {
      return { net: printedNet, vat: printedVat, gross: printedVat != null ? roundMoney(printedNet + printedVat) : printedNet, conflict };
    }
    const split = splitVat({ amount: printedNet, vatType: "exclusive", vatRate: rate });
    return { net: printedNet, vat: printedVat ?? split.vatAmount, gross: split.priceIncludingVat, conflict };
  }

  const total = printedTotal as number;
  const grossed = computedValue != null && rate != null && rate > 0 && moneyClose(total, computedValue * (1 + (rate > 1 ? rate / 100 : rate)));
  if (tax === "exclusive" && computedValue != null && moneyClose(total, computedValue)) {
    const split = splitVat({ amount: total, vatType: "exclusive", vatRate: rate });
    return { net: total, vat: split.vatAmount, gross: split.priceIncludingVat, conflict: false };
  }
  if (tax === "unknown" || grossed || (computedValue != null && !moneyClose(total, computedValue))) {
    return { net: grossed ? computedValue : total, vat: printedVat ?? (grossed && computedValue != null ? roundMoney(total - computedValue) : 0), gross: total, conflict: computedValue != null && !moneyClose(total, computedValue) && !grossed };
  }
  const split = splitVat({ amount: total, vatType: tax, vatRate: rate });
  return { net: split.priceBeforeVat, vat: split.vatAmount, gross: tax === "inclusive" ? total : split.priceIncludingVat, conflict: false };
}

export function lineDocumentAmount(line: PurchaseInvoiceLine): number {
  const computed = lineNetAmount(line);
  if (computed > 0) return computed;
  const candidates = [
    line.netAmount,
    line.lineNet,
    line.priceBeforeVat,
    line.grossAmount,
    line.lineGross,
    line.priceIncludingVat,
    line.lineTotal,
  ];
  for (const value of candidates) {
    if (value != null && Number.isFinite(value) && value !== 0) return roundMoney(value);
  }
  return 0;
}

export function lineHasAmount(line: PurchaseInvoiceLine): boolean {
  return Math.abs(lineDocumentAmount(line)) > 0;
}

function signedMoney(value: number, role: ReturnType<typeof invoiceLineRole>): number {
  if (role !== "discount" && role !== "return") return value;
  return value > 0 ? -value : value;
}

export function finalizeInvoiceLine(line: PurchaseInvoiceLine, vatRate: number | null = DEFAULT_VAT_RATE): PurchaseInvoiceLine {
  const role = detectedLineType(line);
  const taxMode = line.vatType || line.taxMode || line.vatMode;
  const printed = resolvePrintedLineMoney(line, vatRate);
  if (printed) {
    const qty = Number(line.quantity);
    const hasQty = Number.isFinite(qty) && qty !== 0;
    const nonProduct = role === "SUMMARY" || role === "DISCOUNT" || role === "RETURN" || role === "DEPOSIT" || role === "SHIPPING" || role === "SERVICE";
    return {
      ...line,
      lineType: role ?? line.lineType,
      skipInventory: nonProduct || line.skipInventory,
      unitPrice: line.unitPrice ?? (hasQty && printed.net != null ? roundMoney(printed.net / qty) : line.unitPrice),
      vatType: taxMode === "unknown" ? "unknown" : ((taxMode || "inclusive") as VatType),
      vatMode: taxMode === "unknown" ? "unknown" : ((taxMode || "inclusive") as VatType),
      taxMode: taxMode === "unknown" ? "unknown" : ((taxMode || "inclusive") as VatType),
      vatRate: line.vatRate ?? (taxMode === "unknown" ? null : vatRate),
      lineTotal: printed.gross ?? printed.net,
      priceBeforeVat: printed.net,
      vatAmount: printed.vat,
      priceIncludingVat: printed.gross,
      netAmount: printed.net,
      grossAmount: printed.gross,
      lineNet: printed.net ?? line.lineNet ?? null,
      lineGross: printed.gross ?? line.lineGross ?? null,
      needsReview: Boolean(line.needsReview) || printed.conflict,
      rowStatus: printed.conflict ? "review" : line.rowStatus,
      unitPriceNet: hasQty && printed.net != null ? roundMoney(printed.net / qty) : line.unitPriceNet ?? null,
      unitPriceGross: hasQty && printed.gross != null ? roundMoney(printed.gross / qty) : line.unitPriceGross ?? null,
    };
  }
  const classified: PurchaseInvoiceLine = role && role !== line.lineType ? { ...line, lineType: role, skipInventory: role === "SUMMARY" || role === "DISCOUNT" || role === "RETURN" || role === "DEPOSIT" || line.skipInventory } : line;
  const qty = Number(line.quantity);
  const hasQty = Number.isFinite(qty) && qty > 0;
  const computedNet = lineNetAmount(line);
  const scannedAmount = line.lineTotal ?? line.lineNet ?? line.lineGross ?? line.netAmount ?? line.grossAmount ?? 0;
  const amount = computedNet > 0 ? computedNet : scannedAmount;
  const derivedUnitPrice =
    line.unitPrice == null && hasQty && amount
      ? roundMoney(amount / qty)
      : line.unitPrice;

  if (taxMode === "unknown") {
    const net = line.netAmount ?? line.lineNet ?? line.priceBeforeVat ?? (computedNet > 0 ? computedNet : null);
    const gross = line.grossAmount ?? line.lineGross ?? line.priceIncludingVat;
    const rate = line.vatRate ?? vatRate;
    const vatAmount =
      line.vatAmount ??
      (net != null && gross != null
        ? roundMoney(gross - net)
        : net != null && rate != null && rate > 0
          ? roundMoney(net * (rate > 1 ? rate / 100 : rate))
          : null);
    const resolvedGross = gross ?? (net != null && vatAmount != null ? roundMoney(net + vatAmount) : null);
    return {
      ...classified,
      unitPrice: derivedUnitPrice,
      vatType: "unknown",
      vatMode: "unknown",
      taxMode: "unknown",
      vatRate: line.vatRate ?? null,
      lineTotal: computedNet > 0 ? computedNet : (line.lineTotal ?? amount ?? null),
      priceBeforeVat: net ?? null,
      vatAmount,
      priceIncludingVat: resolvedGross,
      netAmount: net ?? null,
      grossAmount: resolvedGross,
      lineNet: net ?? null,
      lineGross: resolvedGross,
      unitPriceNet: hasQty && net != null ? roundMoney(net / qty) : line.unitPriceNet ?? null,
      unitPriceGross: hasQty && gross != null ? roundMoney(gross / qty) : line.unitPriceGross ?? null,
    };
  }

  const vatType = (taxMode || "inclusive") as VatType;
  const rate = line.vatRate ?? vatRate;
  const vat = splitVat({ amount, vatType, vatRate: rate });
  return {
    ...classified,
    unitPrice: derivedUnitPrice,
    vatType,
    vatMode: vatType,
    taxMode: vatType,
    vatRate: rate,
    lineTotal: amount,
    ...vat,
    netAmount: vat.priceBeforeVat,
    grossAmount: vat.priceIncludingVat,
    lineNet: vat.priceBeforeVat,
    lineGross: vat.priceIncludingVat,
    unitPriceNet: hasQty ? roundMoney(vat.priceBeforeVat / qty) : null,
    unitPriceGross: hasQty ? roundMoney(vat.priceIncludingVat / qty) : null,
  };
}

export function invoiceFinanceTotals(lines: PurchaseInvoiceLine[], vatRate = DEFAULT_VAT_RATE) {
  const finalized = lines.map((line) => finalizeInvoiceLine(line, vatRate));
  const usable = finalized.filter((line) => invoiceLineRole(line) !== "summary" && lineHasAmount(line));
  return {
    lines: finalized,
    net: roundMoney(usable.reduce((sum, line) => sum + signedMoney(line.netAmount ?? line.priceBeforeVat ?? 0, invoiceLineRole(line)), 0)),
    vat: roundMoney(usable.reduce((sum, line) => sum + signedMoney(line.vatAmount ?? 0, invoiceLineRole(line)), 0)),
    gross: roundMoney(usable.reduce((sum, line) => sum + signedMoney(line.grossAmount ?? line.priceIncludingVat ?? 0, invoiceLineRole(line)), 0)),
    itemCount: usable.length,
  };
}

export function invoiceSummary(lines: PurchaseInvoiceLine[], vatRate = DEFAULT_VAT_RATE) {
  const totals = invoiceFinanceTotals(lines, vatRate);
  return {
    lines: totals.lines,
    beforeVat: totals.net,
    vat: totals.vat,
    includingVat: totals.gross,
    itemCount: totals.itemCount,
  };
}
