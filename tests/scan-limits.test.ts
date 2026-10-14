import { describe, expect, it } from "vitest";
import { classifyProviderLimit, formatRetryAfterWhen, parseRetryAfterSeconds } from "@/lib/ai/gemini-limits";
import { publicScanErrorCode } from "@/lib/inventory/invoice-archive";
import { invoiceReviewState } from "@/lib/inventory/scan-review-state";
import type { PurchaseInvoice } from "@/lib/inventory/types";

const blank: PurchaseInvoice = {
  id: "1",
  supplierName: "",
  invoiceNumber: "",
  invoiceDate: "",
  receivedAt: "2026-10-13",
  status: "draft",
  scanStatus: "failed",
  lines: [],
  createdAt: "",
  updatedAt: "",
};

describe("provider 429 classification", () => {
  it("keeps rate-limit separate from quota", () => {
    expect(classifyProviderLimit({ status: 429, reason: "RESOURCE_EXHAUSTED" })).toBe("PROVIDER_RATE_LIMIT");
    expect(classifyProviderLimit({ status: 429, reason: "You exceeded your current quota" })).toBe("QUOTA_EXCEEDED");
    expect(publicScanErrorCode("PROVIDER_RATE_LIMIT")).toBe("PROVIDER_RATE_LIMIT");
    expect(publicScanErrorCode("QUOTA_EXCEEDED")).toBe("QUOTA_EXCEEDED");
  });

  it("reads Retry-After seconds and google retryDelay", () => {
    expect(parseRetryAfterSeconds({ header: "12" })).toBe(12);
    expect(parseRetryAfterSeconds({ payload: { error: { details: [{ retryDelay: "30s" }] } } })).toBe(30);
  });

  it("formats long Retry-After as a clock time, not raw seconds", () => {
    const now = Date.parse("2026-10-13T12:00:00");
    const later = new Date(now + 16895 * 1000);
    const clock = `${String(later.getHours()).padStart(2, "0")}:${String(later.getMinutes()).padStart(2, "0")}`;
    expect(formatRetryAfterWhen(45, now)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatRetryAfterWhen(16895, now)).toContain(clock);
    expect(formatRetryAfterWhen(16895, now)).toMatch(/h/);
  });
});

describe("invoice review scan state", () => {
  it("does not treat an empty failed scan as partial or ready", () => {
    expect(invoiceReviewState(blank, true)).toBe("incomplete");
    expect(
      invoiceReviewState({
        ...blank,
        supplierName: "ספק",
        invoiceNumber: "INV-1",
        invoiceDate: "2026-10-05",
        currency: "ILS",
        netAmount: 100,
        vatAmount: 18,
        grossAmount: 118,
        lines: [{ key: "1", rawName: "A", quantity: 1, unit: "unit", unitPrice: 100, lineTotal: 118, discount: 0, vatType: "exclusive", vatRate: 0.18, priceBeforeVat: 100, vatAmount: 18, priceIncludingVat: 118 }],
        scanStatus: "needs_review",
      })
    ).toBe("ready");
    expect(
      invoiceReviewState({
        ...blank,
        invoiceNumber: "INV-1",
        invoiceDate: "2026-10-05",
        lines: [],
        scanStatus: "needs_review",
      })
    ).toBe("partial");
  });
});
