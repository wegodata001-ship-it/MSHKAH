import { describe, expect, it } from "vitest";
import { parseInvoiceExtraction } from "@/lib/ai/gemini-invoice";
import { validateInvoiceTotals } from "@/lib/inventory/invoice-archive";
import { compareInvoiceTotals } from "@/lib/inventory/invoice-finance";
import { applyComputedTotals } from "@/lib/inventory/invoice-intake";
import { emptyInvoiceLine, finalizeInvoiceLine, invoiceFinanceTotals } from "@/lib/inventory/invoice-lines";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

const SOURCE = {
  beforeDiscount: 450.03,
  discount: 0.88,
  beforeVat: 449.15,
  vat: 80.85,
  total: 530,
};

function line(partial: Partial<PurchaseInvoiceLine> & Pick<PurchaseInvoiceLine, "rawName">): PurchaseInvoiceLine {
  return { ...emptyInvoiceLine(0.18), quantity: 1, unit: "unit", vatType: "exclusive", ...partial };
}

function invoice(partial: Partial<PurchaseInvoice> & Pick<PurchaseInvoice, "lines">): PurchaseInvoice {
  return {
    id: "35169",
    supplierName: "אלסונבולה שיווק מוצרי מזון בע\"מ",
    invoiceNumber: "35169",
    invoiceDate: "2026-08-15",
    receivedAt: "2026-08-15",
    status: "needs_review",
    netAmount: SOURCE.beforeVat,
    vatAmount: SOURCE.vat,
    grossAmount: SOURCE.total,
    sourceNet: SOURCE.beforeVat,
    sourceVat: SOURCE.vat,
    sourceGross: SOURCE.total,
    subtotalBeforeDiscount: SOURCE.beforeDiscount,
    headerDiscount: SOURCE.discount,
    createdAt: "2026-08-15T00:00:00.000Z",
    ...partial,
  };
}

describe("invoice 35169 totals", () => {
  it("keeps the printed payable total and passes when the lines match it", () => {
    const product = line({
      rawName: "מוצר",
      quantity: 1,
      unitPrice: SOURCE.beforeVat,
      lineNet: SOURCE.beforeVat,
      vatAmount: SOURCE.vat,
      lineGross: SOURCE.total,
    });
    const stored = invoice({ lines: [product] });
    const check = compareInvoiceTotals(stored);
    expect(check.invoiceTotalFromSource).toBe(530);
    expect(check.sourceVat).toBe(80.85);
    expect(check.sourceNet).toBe(449.15);
    expect(check.calculatedLinesTotal).toBe(530);
    expect(check.differenceAmount).toBe(0);
    expect(check.validationStatus).toBe("pass");
    expect(check.headerConsistent).toBe(true);

    const validation = validateInvoiceTotals({
      lines: [product],
      headerNet: SOURCE.beforeVat,
      headerVat: SOURCE.vat,
      headerGross: SOURCE.total,
      headerDiscount: SOURCE.discount,
    });
    expect(validation.validationStatus).toBe("pass");
    expect(validation.computedGross).toBe(530);
    expect(validation.differenceAmount).toBe(0);
  });

  it("reports the real gap when line gross is 552.42 and does not replace the source total", () => {
    const product = line({
      rawName: "מוצר",
      quantity: 1,
      unitPrice: 468.15,
      lineNet: 468.15,
      vatAmount: 84.27,
      lineGross: 552.42,
    });
    const stored = invoice({ lines: [product] });
    const saved = applyComputedTotals(stored);
    expect(saved.grossAmount).toBe(530);
    expect(saved.invoiceTotalFromSource).toBe(530);
    expect(saved.calculatedLinesTotal).toBe(552.42);
    expect(saved.differenceAmount).toBeCloseTo(22.42, 2);
    expect(saved.differenceAmount).not.toBeCloseTo(-79.27, 2);
    expect(saved.validationStatus).toBe("review");
    const check = compareInvoiceTotals(saved);
    expect(check.differenceAmount).toBeCloseTo(22.42, 2);
    expect(check.validationStatus).toBe("review");
  });

  it("uses a printed line total instead of quantity times unit price", () => {
    const resolved = finalizeInvoiceLine(line({
      rawName: "שורה עם סכום מודפס",
      quantity: 2,
      unitPrice: 100,
      lineGross: 150,
      vatType: "exclusive",
    }), 0.18);
    expect(resolved.grossAmount).toBe(150);
    expect(resolved.needsReview).toBe(true);
  });

  it("does not add VAT a second time when the unit price is already gross", () => {
    const resolved = finalizeInvoiceLine(line({
      rawName: "מחיר כולל",
      quantity: 1,
      unitPrice: 118,
      lineGross: 118,
      vatType: "exclusive",
    }), 0.18);
    expect(resolved.grossAmount).toBe(118);
    expect(resolved.grossAmount).not.toBeCloseTo(139.24, 2);
  });

  it("ignores summary rows and subtracts discount, return, and keeps a deposit", () => {
    const rows = [
      line({ rawName: "מוצר", lineNet: 100, lineGross: 118, vatAmount: 18, unitPrice: 100 }),
      line({ rawName: "הנחה", lineType: "DISCOUNT", lineNet: 10, lineGross: 11.8, vatAmount: 1.8, unitPrice: 10 }),
      line({ rawName: "החזרה", lineType: "RETURN", quantity: -1, lineNet: 5, lineGross: 5.9, vatAmount: 0.9, unitPrice: 5 }),
      line({ rawName: "פיקדון", lineType: "DEPOSIT", lineNet: 2, lineGross: 2, vatAmount: 0, vatType: "exempt", unitPrice: 2 }),
      line({ rawName: "סה\"כ", lineType: "SUMMARY", lineNet: 449.15, lineGross: 530, vatAmount: 80.85, unitPrice: 530 }),
    ];
    const totals = invoiceFinanceTotals(rows, 0.18);
    expect(totals.gross).toBeCloseTo(118 - 11.8 - 5.9 + 2, 2);
    expect(totals.itemCount).toBe(4);
  });

  it("keeps decimal quantities, exempt lines, and Hebrew or Arabic names", () => {
    const rows = [
      line({ rawName: "طحين", quantity: 1.5, unitPrice: 10, lineNet: 15, lineGross: 15, vatAmount: 0, vatType: "exempt" }),
      line({ rawName: "סוכר", quantity: 0.25, unitPrice: 20, lineNet: 5, lineGross: 5.9, vatAmount: 0.9 }),
    ];
    const totals = invoiceFinanceTotals(rows, 0.18);
    expect(rows[0]?.rawName).toBe("طحين");
    expect(totals.gross).toBeCloseTo(20.9, 2);
    const validation = validateInvoiceTotals({ lines: rows, headerNet: 20, headerVat: 0.9, headerGross: 20.9 });
    expect(validation.validationStatus).toBe("pass");
  });

  it("prefers the payable total over a larger unrelated number", () => {
    const parsed = parseInvoiceExtraction(JSON.stringify({
      invoiceNumber: "35169",
      invoiceDate: "15/08/2026",
      supplierName: "אלסונבולה שיווק מוצרי מזון בע\"מ",
      subtotalBeforeDiscount: "450.03",
      discountTotal: "0.88",
      subtotalBeforeVat: "449.15",
      vatAmount: "80.85",
      grandTotal: "900.00",
      totalToPay: "530.00",
      balanceDue: "1200.00",
      lines: [
        { description: "מוצר", quantity: 1, unitPriceBeforeVat: "449.15", lineTotalBeforeVat: "449.15", vatAmount: "80.85", lineTotalIncludingVat: "530.00", lineType: "INVENTORY_ITEM" },
        { description: "סה\"כ לתשלום", lineTotalIncludingVat: "530.00", lineType: "SUMMARY" },
      ],
    }));
    expect(parsed.grandTotal.value).toBe(530);
    expect(parsed.subtotal.value).toBe(449.15);
    expect(parsed.vatTotal.value).toBe(80.85);
    expect(parsed.subtotalBeforeDiscount.value).toBe(450.03);
    expect(parsed.discountTotal.value).toBe(0.88);
    expect(parsed.lines.map((item) => item.lineType)).toEqual(["INVENTORY_ITEM", "SUMMARY"]);
  });
});
