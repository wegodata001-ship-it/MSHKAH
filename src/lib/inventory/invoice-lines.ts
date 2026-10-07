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
  const vat = splitVat({
    amount,
    vatType: (line.vatType || "inclusive") as VatType,
    vatRate: line.vatRate || vatRate,
  });
  return {
    ...line,
    lineTotal: amount,
    ...vat,
  };
}

export function invoiceSummary(lines: PurchaseInvoiceLine[], vatRate = DEFAULT_VAT_RATE) {
  const finalized = lines.map((line) => finalizeInvoiceLine(line, vatRate));
  const usable = finalized.filter((line) => line.productId && lineNetAmount(line) > 0);
  return {
    lines: finalized,
    beforeVat: usable.reduce((sum, line) => sum + (line.priceBeforeVat ?? 0), 0),
    vat: usable.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0),
    includingVat: usable.reduce((sum, line) => sum + (line.priceIncludingVat ?? 0), 0),
    itemCount: usable.length,
  };
}
