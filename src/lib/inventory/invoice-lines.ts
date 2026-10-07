import type { PurchaseUnit } from "@/lib/costing/types";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/inventory/vat";
import type { PurchaseInvoiceLine, VatType } from "@/lib/inventory/types";

export const INVOICE_UNITS: PurchaseUnit[] = ["kg", "g", "liter", "ml", "unit"];

export function newInvoiceLineKey(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyInvoiceLine(vatRate = DEFAULT_VAT_RATE): PurchaseInvoiceLine {
  return {
    key: newInvoiceLineKey(),
    rawName: "",
    quantity: null,
    unit: "kg",
    unitPrice: null,
    discount: null,
    lineTotal: null,
    vatType: "inclusive",
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
  return Math.max(0, qty * price - discount);
}

export function finalizeInvoiceLine(line: PurchaseInvoiceLine, vatRate = DEFAULT_VAT_RATE): PurchaseInvoiceLine {
  const amount = lineNetAmount(line);
  const rate = line.vatRate ?? vatRate;
  const vatType = (line.vatType || line.vatMode || "inclusive") as VatType;
  const vat = splitVat({
    amount,
    vatType,
    vatRate: rate,
  });
  const qty = Number(line.quantity);
  const hasQty = Number.isFinite(qty) && qty > 0;
  return {
    ...line,
    vatType,
    vatMode: vatType,
    vatRate: rate,
    lineTotal: amount,
    ...vat,
    netAmount: vat.priceBeforeVat,
    grossAmount: vat.priceIncludingVat,
    unitPriceNet: hasQty ? vat.priceBeforeVat / qty : null,
    unitPriceGross: hasQty ? vat.priceIncludingVat / qty : null,
  };
}

export function invoiceFinanceTotals(lines: PurchaseInvoiceLine[], vatRate = DEFAULT_VAT_RATE) {
  const finalized = lines.map((line) => finalizeInvoiceLine(line, vatRate));
  const usable = finalized.filter((line) => lineNetAmount(line) > 0);
  return {
    lines: finalized,
    net: usable.reduce((sum, line) => sum + (line.netAmount ?? line.priceBeforeVat ?? 0), 0),
    vat: usable.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0),
    gross: usable.reduce((sum, line) => sum + (line.grossAmount ?? line.priceIncludingVat ?? 0), 0),
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
