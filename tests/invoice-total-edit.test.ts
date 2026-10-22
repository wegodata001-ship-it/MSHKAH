import { describe, expect, it } from "vitest";
import { invoiceFinanceTotals } from "@/lib/inventory/invoice-lines";
import {
  commitInvoiceTotalEdit,
  editTotalField,
  parseInvoiceMoney,
  productPricesUnchanged,
  totalDraftFromInvoice,
} from "@/lib/inventory/invoice-total-edit";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

function line(partial: Partial<PurchaseInvoiceLine>): PurchaseInvoiceLine {
  return {
    key: partial.key || "line-1",
    rawName: partial.rawName || "מוצר",
    quantity: 1,
    unit: "unit",
    unitPrice: 2814.92,
    discount: 0,
    lineTotal: 3320.51,
    lineNet: 2813.99,
    lineGross: 3320.51,
    vatType: "exclusive",
    vatRate: 0.18,
    priceBeforeVat: 2813.99,
    vatAmount: 506.52,
    priceIncludingVat: 3320.51,
    netAmount: 2813.99,
    grossAmount: 3320.51,
    ...partial,
  };
}

function invoice(lines: PurchaseInvoiceLine[]): PurchaseInvoice {
  return {
    id: "inv-1",
    supplierName: "ספק",
    invoiceNumber: "100",
    invoiceDate: "2026-08-15",
    receivedAt: "2026-08-15",
    status: "needs_review",
    netAmount: 2814.92,
    vatAmount: 506.69,
    grossAmount: 3321.61,
    sourceNet: 2814.92,
    sourceVat: 506.69,
    sourceGross: 3321.61,
    invoiceTotalFromSource: 3321.61,
    vatRate: 0.18,
    headerDiscount: 0,
    lines,
    createdAt: "2026-08-15T00:00:00.000Z",
  };
}

describe("editable invoice totals", () => {
  it("parses two-decimal money and rejects invalid values", () => {
    expect(parseInvoiceMoney("3,321.61").ok && parseInvoiceMoney("3,321.61")).toEqual({ ok: true, value: 3321.61 });
    expect(parseInvoiceMoney("3321,61")).toEqual({ ok: true, value: 3321.61 });
    expect(parseInvoiceMoney("1.234").ok).toBe(false);
    expect(parseInvoiceMoney("abc").ok).toBe(false);
  });

  it("recalculates the payable total from net and the existing VAT amount", () => {
    const draft = totalDraftFromInvoice(invoice([line({})]));
    const edited = editTotalField(draft, "net", 2800);
    expect(edited.draft.vat).toBe(506.69);
    expect(edited.draft.total).toBeCloseTo(3306.69, 2);
    expect(edited.changed).toEqual(["net", "total"]);
  });

  it("updates only the payable total when the VAT amount changes", () => {
    const draft = totalDraftFromInvoice(invoice([line({})]));
    const edited = editTotalField(draft, "vat", 500);
    expect(edited.draft.net).toBe(2814.92);
    expect(edited.draft.vatPercent).toBe(18);
    expect(edited.draft.total).toBeCloseTo(3314.92, 2);
  });

  it("does not add VAT a second time when the percent changes", () => {
    const draft = totalDraftFromInvoice(invoice([line({})]));
    const edited = editTotalField(draft, "vatPercent", 18);
    expect(edited.draft.vat).toBeCloseTo(506.69, 2);
    expect(edited.draft.total).toBeCloseTo(3321.61, 2);
  });

  it("keeps the source total and product prices when only the final total is edited", () => {
    const stored = invoice([line({ unitPrice: 10, key: "milk" })]);
    const draft = editTotalField(totalDraftFromInvoice(stored), "total", 3320.51).draft;
    const saved = commitInvoiceTotalEdit(stored, draft, { at: "2026-10-22T10:00:00.000Z", actor: "admin@mishkat.test", reason: "תיקון OCR" });
    expect(saved.originalInvoiceTotal).toBe(3321.61);
    expect(saved.sourceGross).toBe(3321.61);
    expect(saved.editedInvoiceTotal).toBe(3320.51);
    expect(saved.grossAmount).toBe(3320.51);
    expect(saved.netAmount).toBe(2814.92);
    expect(saved.vatAmount).toBe(506.69);
    expect(saved.differenceAmount).toBe(0);
    expect(saved.validationStatus).toBe("pass");
    expect(saved.manuallyEdited).toBe(true);
    expect(saved.editedBy).toBe("admin@mishkat.test");
    expect(saved.totalHistory?.[0]).toMatchObject({ field: "total", before: "3321.61", after: "3320.51", reason: "תיקון OCR" });
    expect(productPricesUnchanged(stored.lines, saved.lines)).toBe(true);
    expect(saved.lines.find((row) => row.key === "milk")?.unitPrice).toBe(10);
  });

  it("stays in review when the edited total still does not match the lines", () => {
    const stored = invoice([line({})]);
    const draft = editTotalField(totalDraftFromInvoice(stored), "total", 3300).draft;
    const saved = commitInvoiceTotalEdit(stored, draft, { at: "2026-10-22T10:00:00.000Z", actor: "admin@mishkat.test", reason: "בדיקה" });
    expect(saved.validationStatus).toBe("review");
    expect(saved.differenceAmount).toBeCloseTo(20.51, 2);
    expect(saved.originalInvoiceTotal).toBe(3321.61);
  });

  it("adds a documented rounding line without changing product prices", () => {
    const stored = invoice([line({ unitPrice: 44, quantity: 2 })]);
    expect(invoiceFinanceTotals(stored.lines).gross).toBeCloseTo(3320.51, 2);
    const saved = commitInvoiceTotalEdit(stored, totalDraftFromInvoice(stored), {
      at: "2026-10-22T10:00:00.000Z",
      actor: "admin@mishkat.test",
      reason: "התאמת עיגול",
      addAdjustment: true,
    });
    const adjustment = saved.lines.find((row) => row.lineType === "ADJUSTMENT");
    expect(adjustment?.grossAmount).toBeCloseTo(1.1, 2);
    expect(adjustment?.rawName).toBe("התאמת עיגול");
    expect(invoiceFinanceTotals(saved.lines).gross).toBeCloseTo(3321.61, 2);
    expect(saved.validationStatus).toBe("pass");
    expect(saved.lines.find((row) => row.key === "line-1")?.unitPrice).toBe(44);
    expect(saved.lines.find((row) => row.key === "line-1")?.quantity).toBe(2);
    expect(productPricesUnchanged(stored.lines, saved.lines)).toBe(true);
  });
});
