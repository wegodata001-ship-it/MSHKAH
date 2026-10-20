import type { PurchaseUnit } from "@/lib/costing/types";
import { LINE_UNITS } from "@/lib/costing/units";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

const MONEY_KEYS = [
  "quantity",
  "unitPrice",
  "discount",
  "lineTotal",
  "lineNet",
  "lineGross",
  "vatRate",
  "vatAmount",
  "priceBeforeVat",
  "priceIncludingVat",
  "netAmount",
  "grossAmount",
] as const;

export function isInvoiceLineUnit(value: string): value is PurchaseUnit {
  return LINE_UNITS.includes(value as PurchaseUnit);
}

/** Replace only the unit. Quantity, price, VAT and totals stay as stored. */
export function withLineUnit(lines: PurchaseInvoiceLine[], lineKey: string, unit: PurchaseUnit): PurchaseInvoiceLine[] | null {
  const index = lines.findIndex((line) => line.key === lineKey);
  if (index < 0) return null;
  return lines.map((line, lineIndex) => (lineIndex === index ? { ...line, unit } : line));
}

export function lineMoneyUnchanged(before: PurchaseInvoiceLine, after: PurchaseInvoiceLine): boolean {
  return MONEY_KEYS.every((key) => before[key] === after[key]);
}
