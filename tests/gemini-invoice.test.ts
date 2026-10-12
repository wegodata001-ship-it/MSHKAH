import { describe, expect, it } from "vitest";
import { httpStatusForAiCode } from "@/lib/ai/gemini-config";
import {
  isEmptyInvoiceExtraction,
  parseInvoiceExtraction,
  parseInvoiceExtractionResult,
  parseVisibleNumber,
} from "@/lib/ai/gemini-invoice";
import { validateInvoiceTotals } from "@/lib/inventory/invoice-archive";

describe("invoice AI error mapping", () => {
  it("maps structured codes to HTTP statuses", () => {
    expect(httpStatusForAiCode("AI_NOT_CONFIGURED")).toBe(503);
    expect(httpStatusForAiCode("INVALID_FILE")).toBe(400);
    expect(httpStatusForAiCode("PROVIDER_AUTH_ERROR")).toBe(502);
    expect(httpStatusForAiCode("PROVIDER_RATE_LIMIT")).toBe(429);
    expect(httpStatusForAiCode("EXTRACTION_FAILED", 500)).toBe(502);
    expect(httpStatusForAiCode("EXTRACTION_FAILED", 200)).toBe(422);
  });
});

describe("parseInvoiceExtraction", () => {
  it("keeps net/gross line fields and does not invent numbers", () => {
    const parsed = parseInvoiceExtraction(
      JSON.stringify({
        supplierName: { value: "Barilla", confidence: 0.9 },
        invoiceNumber: { value: "A-12", confidence: 0.8 },
        vatStatus: "detected",
        lines: [
          {
            description: "Pasta",
            quantity: 5,
            unit: "kg",
            unitPriceBeforeVat: 10,
            lineTotalBeforeVat: 50,
            vatAmount: 9,
            unitPriceIncludingVat: 11.8,
            lineTotalIncludingVat: 59,
            vatType: "exclusive",
            confidence: 0.91,
          },
        ],
      })
    );
    expect(parsed.supplierName.value).toBe("Barilla");
    expect(parsed.lines[0]?.unitPrice).toBe(10);
    expect(parsed.lines[0]?.lineNet).toBe(50);
    expect(parsed.lines[0]?.priceIncludingVat).toBe(59);
    expect(parsed.lines[0]?.lineTotal).toBe(59);
  });

  it("returns empty extraction when JSON is invalid instead of inventing totals", () => {
    const parsed = parseInvoiceExtraction("not-json");
    expect(parsed.grandTotal.value).toBeNull();
    expect(parsed.supplierPhone.value).toBeNull();
    expect(parsed.lines).toEqual([]);
  });

  it("keeps unknown VAT instead of inventing 18%", () => {
    const parsed = parseInvoiceExtraction(
      JSON.stringify({
        vatStatus: "needs_review",
        lines: [{ description: "Water", quantity: 2, unitPrice: 5, taxMode: "unknown" }],
      })
    );
    expect(parsed.lines[0]?.vatType).toBe("unknown");
    expect(parsed.vatRate.value).toBeNull();
  });

  it("unwraps Gemini {value,confidence} line fields instead of dropping the table", () => {
    const parsed = parseInvoiceExtraction(
      JSON.stringify({
        invoiceNumber: { value: "01/002182", confidence: 0.94 },
        subtotal: { value: 13500, confidence: 0.95 },
        vatTotal: { value: 2430, confidence: 0.95 },
        grandTotal: { value: 15930, confidence: 0.96 },
        vatRate: { value: 18, confidence: 0.9 },
        vatStatus: "detected",
        lines: [
          {
            description: { value: "פריט 1", confidence: 0.88 },
            quantity: { value: 1, confidence: 0.8 },
            unitPriceBeforeVat: { value: 13500, confidence: 0.8 },
            lineTotalBeforeVat: { value: 13500, confidence: 0.8 },
            vatAmount: { value: 2430, confidence: 0.8 },
            lineTotalIncludingVat: { value: 15930, confidence: 0.8 },
            lineType: { value: "INVENTORY_ITEM", confidence: 0.7 },
          },
        ],
      })
    );
    expect(parsed.invoiceNumber.value).toBe("01/002182");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.name).toBe("פריט 1");
    expect(parsed.lines[0]?.quantity).toBe(1);
    expect(parsed.lines[0]?.lineNet).toBe(13500);
    expect(parsed.lines[0]?.lineType).toBe("INVENTORY_ITEM");
    expect(isEmptyInvoiceExtraction(parsed)).toBe(false);
  });

  it("keeps the attached Hebrew invoice numbers and does not treat empty scan as success", () => {
    const parsed = parseInvoiceExtraction(
      JSON.stringify({
        documentNumber: "01/002182",
        supplierName: "ספק בדיקה",
        invoiceDate: "2026-03-01",
        subtotalBeforeVat: "13,500.00",
        vatRate: "18%",
        vatAmount: "2,430.00",
        totalToPay: "15,930.00",
        vatStatus: "detected",
        lines: [
          { description: "שורה 1", quantity: "1", unitPriceBeforeVat: "13,500.00", lineSubtotalBeforeVat: "13,500.00", vatAmount: "2,430.00", lineTotalIncludingVat: "15,930.00" },
        ],
      })
    );
    expect(parsed.invoiceNumber.value).toBe("01/002182");
    expect(parsed.subtotal.value).toBe(13500);
    expect(parsed.vatRate.value).toBe(18);
    expect(parsed.vatTotal.value).toBe(2430);
    expect(parsed.grandTotal.value).toBe(15930);
    expect(parsed.lines.length).toBeGreaterThan(0);
    expect(isEmptyInvoiceExtraction(parsed)).toBe(false);

    const totals = validateInvoiceTotals({
      lines: [],
      headerNet: parsed.subtotal.value,
      headerVat: parsed.vatTotal.value,
      headerGross: parsed.grandTotal.value,
    });
    expect(totals.hasMismatch).toBe(false);
    expect(totals.computedGross).toBe(15930);

    const empty = parseInvoiceExtractionResult("{}");
    expect(empty.empty).toBe(true);
    expect(empty.extraction.lines).toEqual([]);
    expect(empty.extraction.invoiceNumber.value).toBeNull();
    expect(empty.extraction.grandTotal.value).toBeNull();
  });

  it("parses Israeli thousand separators instead of turning them into empty totals", () => {
    expect(parseVisibleNumber("13,500.00")).toBe(13500);
    expect(parseVisibleNumber("2,430.00 ₪")).toBe(2430);
    expect(parseVisibleNumber("15.930,00")).toBe(15930);
    expect(parseVisibleNumber({ value: "13,500.00", confidence: 0.9 })).toBe(13500);
  });
});
