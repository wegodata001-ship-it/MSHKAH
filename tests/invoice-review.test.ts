import { describe, expect, it } from "vitest";
import { parseInvoiceExtraction, parseVisibleNumber } from "@/lib/ai/gemini-invoice";
import {
  incompleteInvoiceLineCount,
  mergeScannedInvoice,
  missingInvoiceFields,
} from "@/lib/inventory/invoice-archive";
import { buildReviewedInvoice } from "@/lib/inventory/invoice-smart-match";
import type { PurchaseInvoice } from "@/lib/inventory/types";

function reviewedFrom(json: unknown) {
  return buildReviewedInvoice({
    extraction: parseInvoiceExtraction(JSON.stringify(json)),
    ingredients: [],
    suppliers: [],
    offers: [],
    records: [],
    maps: [],
    fileName: "invoice.jpg",
    fileHash: "hash",
  });
}

describe("invoice review mapping", () => {
  it("fills header and lines from the attached Israeli invoice numbers without hardcoding them in the UI", () => {
    const invoice = reviewedFrom({
      supplierName: "ספק בדיקה",
      invoiceNumber: "T-100",
      invoiceDate: "05/10/2026",
      currency: "ILS",
      subtotal: "2,814.92",
      vatTotal: "506.69",
      grandTotal: "3,321.61",
      vatRate: "18%",
      vatStatus: "detected",
      lines: [
        {
          description: "פריט 1",
          quantity: 2,
          unit: "kg",
          unitPriceBeforeVat: "1,407.46",
          lineTotalBeforeVat: "2,814.92",
          vatAmount: "506.69",
          lineTotalIncludingVat: "3,321.61",
        },
      ],
    });
    expect(invoice.invoiceDate).toBe("2026-10-05");
    expect(invoice.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(invoice.currency).toBe("ILS");
    expect(invoice.netAmount).toBe(2814.92);
    expect(invoice.vatAmount).toBe(506.69);
    expect(invoice.grossAmount).toBe(3321.61);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]?.rawName).toBe("פריט 1");
    expect(invoice.lines[0]?.quantity).toBe(2);
    expect(invoice.lines[0]?.unitPrice).toBe(1407.46);
    expect(missingInvoiceFields(invoice)).toEqual([]);
  });

  it("keeps a no-VAT document as zero VAT instead of missing", () => {
    const invoice = reviewedFrom({
      invoiceNumber: "NV-1",
      invoiceDate: "2026-10-05",
      currency: "ILS",
      supplierName: "פטור",
      subtotal: 100,
      vatTotal: 0,
      grandTotal: 100,
      vatRate: 0,
      vatStatus: "detected",
      lines: [{ description: "פטור", quantity: 1, unit: "unit", unitPrice: 100, lineNet: 100, taxMode: "exempt" }],
    });
    expect(invoice.vatAmount).toBe(0);
    expect(invoice.grossAmount).toBe(100);
    expect(missingInvoiceFields(invoice).map((field) => field.key)).not.toContain("vat");
  });

  it("treats missing amounts as missing and zero as zero", () => {
    expect(parseVisibleNumber(0)).toBe(0);
    expect(parseVisibleNumber(null)).toBeNull();
    expect(parseVisibleNumber("")).toBeNull();
    expect(parseVisibleNumber("2,814.92 ₪")).toBe(2814.92);
    expect(parseVisibleNumber("506.69")).toBe(506.69);
    const partial = reviewedFrom({
      invoiceDate: "05/10/2026",
      vatStatus: "needs_review",
      lines: [{ description: "שורה חלקית" }],
    });
    expect(partial.invoiceDate).toBe("2026-10-05");
    expect(partial.netAmount).toBeNull();
    expect(missingInvoiceFields(partial).map((field) => field.key)).toEqual(
      expect.arrayContaining(["supplier", "invoiceNumber", "currency", "net", "vat", "gross"])
    );
    expect(incompleteInvoiceLineCount(partial.lines)).toBe(1);
  });

  it("keeps manual edits after a later scan", () => {
    const previous = {
      ...reviewedFrom({
        supplierName: "ידני",
        invoiceNumber: "MANUAL",
        invoiceDate: "2026-01-01",
        currency: "ILS",
        subtotal: 1,
        vatTotal: 0,
        grandTotal: 1,
        lines: [{ description: "ידני", quantity: 1, unitPrice: 1, lineNet: 1 }],
      }),
      id: "inv-1",
      receivedAt: "2026-10-12",
    } as PurchaseInvoice;
    const scanned = reviewedFrom({
      supplierName: "סריקה",
      invoiceNumber: "SCAN",
      invoiceDate: "05/10/2026",
      currency: "ILS",
      subtotal: 10,
      vatTotal: 0,
      grandTotal: 10,
      lines: [{ description: "חדש", quantity: 3, unitPrice: 10, lineNet: 10 }],
    });
    const merged = mergeScannedInvoice(previous, { ...scanned, id: "inv-1" }, ["invoiceNumber", "line:" + previous.lines[0]!.key]);
    expect(merged.invoiceNumber).toBe("MANUAL");
    expect(merged.invoiceDate).toBe("2026-10-05");
    expect(merged.receivedAt).toBe("2026-10-12");
    expect(merged.lines.some((line) => line.rawName === "ידני")).toBe(true);
  });
});
