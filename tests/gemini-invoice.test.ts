import { describe, expect, it } from "vitest";
import { httpStatusForAiCode } from "@/lib/ai/gemini-config";
import { parseInvoiceExtraction } from "@/lib/ai/gemini-invoice";

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
    expect(parsed.lines[0]?.priceBeforeVat).toBe(10);
    expect(parsed.lines[0]?.priceIncludingVat).toBe(11.8);
    expect(parsed.lines[0]?.lineTotal).toBe(59);
  });

  it("returns empty extraction when JSON is invalid instead of inventing totals", () => {
    const parsed = parseInvoiceExtraction("not-json");
    expect(parsed.grandTotal.value).toBeNull();
    expect(parsed.lines).toEqual([]);
  });
});
