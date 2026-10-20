import { roundMoney } from "@/lib/costing/money";
import { LINE_UNITS } from "@/lib/costing/units";
import type { PurchaseUnit } from "@/lib/costing/types";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/inventory/vat";
import type { PurchaseInvoiceLine, VatType } from "@/lib/inventory/types";

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

export function lineNetAmount(line: Pick<PurchaseInvoiceLine, "quantity" | "unitPrice" | "discount">): number {
  const qty = Number(line.quantity);
  const price = Number(line.unitPrice);
  const discount = Number(line.discount) || 0;
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return 0;
  return roundMoney(Math.max(0, qty * price - discount));
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
  return lineDocumentAmount(line) > 0;
}

export function finalizeInvoiceLine(line: PurchaseInvoiceLine, vatRate: number | null = DEFAULT_VAT_RATE): PurchaseInvoiceLine {
  const taxMode = line.vatType || line.taxMode || line.vatMode;
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
      ...line,
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
    ...line,
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
  const usable = finalized.filter(lineHasAmount);
  return {
    lines: finalized,
    net: roundMoney(usable.reduce((sum, line) => sum + (line.netAmount ?? line.priceBeforeVat ?? lineDocumentAmount(line)), 0)),
    vat: roundMoney(usable.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0)),
    gross: roundMoney(usable.reduce((sum, line) => sum + (line.grossAmount ?? line.priceIncludingVat ?? lineDocumentAmount(line)), 0)),
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
