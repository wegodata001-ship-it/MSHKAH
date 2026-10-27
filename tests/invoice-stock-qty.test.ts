import { describe, expect, it } from "vitest";
import { parseVisibleNumber } from "@/lib/ai/gemini-invoice";
import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { guessUnit } from "@/lib/inventory/invoice-extract";
import { auditInvoiceMovements } from "@/lib/inventory/invoice-stock-audit";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

function row(patch: Partial<PurchaseInvoiceLine>): PurchaseInvoiceLine {
  return {
    key: "line-1",
    rawName: "מגבות תעשייתיות",
    quantity: 12.7,
    unit: "unit",
    unitPrice: 24,
    discount: 0,
    lineTotal: 304.8,
    vatType: "exclusive",
    vatRate: 0.18,
    priceBeforeVat: 304.8,
    vatAmount: 54.86,
    priceIncludingVat: 359.66,
    productId: "towels",
    ...patch,
  };
}

describe("invoice stock quantity", () => {
  it("keeps 12.7 units and does not treat the decimal as thousands", () => {
    expect(parseVisibleNumber("12.7")).toBe(12.7);
    expect(parseVisibleNumber("0.5")).toBe(0.5);
    expect(invoiceLineQuantityBase(row({ quantity: 12.7, unit: "unit", conversionFactor: 10, unitPrice: 24 }))).toBe(12.7);
    expect(invoiceLineQuantityBase(row({ quantity: 0.5, unit: "unit" }))).toBe(0.5);
  });

  it("keeps two buckets and converts a carton only when a conversion is stored", () => {
    expect(guessUnit("דלי")).toBe("bucket");
    expect(guessUnit("קרטון")).toBe("carton");
    expect(guessUnit("יחידה")).toBe("unit");
    expect(invoiceLineQuantityBase(row({ quantity: 2, unit: "bucket" }))).toBe(2);
    expect(invoiceLineQuantityBase(row({ quantity: 2, unit: "carton" }))).toBe(2);
    expect(invoiceLineQuantityBase(row({ quantity: 2, unit: "carton", conversionFactor: 12, conversionConfirmed: true }))).toBe(24);
  });

  it("converts kilograms once and ignores the unit price", () => {
    expect(invoiceLineQuantityBase(row({ quantity: 12.7, unit: "kg", unitPrice: 1 }))).toBe(12700);
    expect(invoiceLineQuantityBase(row({ quantity: 12.7, unit: "kg", unitPrice: 999, conversionFactor: 10 }))).toBe(12700);
  });

  it("reports a quantity gap and a duplicate movement without changing them", () => {
    const id = invoicePurchaseMovementId("inv-1", "line-1");
    const report = auditInvoiceMovements({
      invoiceId: "inv-1",
      lines: [row({ quantity: 12.7, unit: "unit" })],
      movements: [
        { id, quantityBase: 127 },
        { id, quantityBase: 127 },
      ],
    });
    expect(report[0]).toMatchObject({ kind: "duplicate-movement", expectedStock: 12.7, recordedStock: 127 });
    expect(report[0].proposed).toContain("גיבוי");
  });
});
