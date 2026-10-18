import { describe, expect, it } from "vitest";
import { findCategoryByNormalizedName, mergeCategoryNames, normalizeCategoryName } from "@/lib/inventory/category-name";
import { applyInvoiceUnitChange, invoiceLineBlockers, invoiceLineReviewStatus } from "@/lib/inventory/invoice-line-status";
import { invoiceApproveBlockers, invoiceLineCareStatus, invoiceNeedsAttention } from "@/lib/inventory/invoice-intake";
import { emptyInvoiceLine } from "@/lib/inventory/invoice-lines";
import { invoicePurchaseMovementId, sanitizeInventoryDocId, selectStockPostLines, stockPostableLine } from "@/lib/inventory/invoice-stock-post";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

function line(patch: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return {
    ...emptyInvoiceLine(0.18),
    rawName: "קמח",
    originalDescription: "קמח",
    quantity: 2,
    unit: "kg",
    unitPrice: 10,
    netAmount: 20,
    grossAmount: 23.6,
    vatRate: 0.18,
    ...patch,
  };
}

function invoice(lines: PurchaseInvoiceLine[]): PurchaseInvoice {
  return {
    id: "inv-1",
    supplierId: "s1",
    supplierName: "ספק",
    invoiceNumber: "1",
    invoiceDate: "2026-10-15",
    receivedAt: "2026-10-15",
    currency: "ILS",
    status: "draft",
    lines,
    createdAt: "2026-10-15",
    updatedAt: "2026-10-15",
  };
}

describe("ingredient category names", () => {
  it("dedupes Hebrew and Arabic equivalents", () => {
    expect(normalizeCategoryName("  חלב  ")).toBe(normalizeCategoryName("חלב"));
    expect(normalizeCategoryName("ألألبان")).toBe(normalizeCategoryName("الالبان"));
    expect(findCategoryByNormalizedName("קפה", ["קפה", "תה"])).toBe("קפה");
    expect(mergeCategoryNames(["חלב"], ["חלב", "קפה"], ["  חלב "])).toEqual(["חלב", "קפה"]);
  });
});

describe("invoice line review status", () => {
  it("does not call a row ready when it still needs a material", () => {
    const unmatched = line({ productId: undefined, matchKind: "suggest", matchConfirmed: false });
    const status = invoiceLineReviewStatus(unmatched);
    expect(status.kind).toBe("missing-material");
    expect(status.ready).toBe(false);
    expect(invoiceNeedsAttention(unmatched)).toBe(true);
    expect(invoiceLineCareStatus(unmatched)).toBe("needs-match");
  });

  it("shows unsaved changes instead of ready", () => {
    const matched = line({ productId: "p1", matchKind: "exact", matchConfirmed: true });
    expect(invoiceLineReviewStatus(matched).kind).toBe("ready");
    expect(invoiceLineReviewStatus(matched, { dirty: true }).kind).toBe("unsaved");
  });

  it("requires pack conversion when unit is a pack against weight stock", () => {
    const packed = line({
      productId: "p1",
      matchKind: "exact",
      matchConfirmed: true,
      unit: "unit",
      conversionFactor: null,
    });
    expect(invoiceLineReviewStatus(packed, { productBase: "g" }).kind).toBe("missing-pack");
  });

  it("keeps footer blockers aligned with per-row reasons", () => {
    const ready = line({ key: "a", productId: "p1", matchKind: "exact", matchConfirmed: true });
    const missing = line({ key: "b", productId: undefined, matchKind: "none", matchConfirmed: false });
    const blockers = invoiceLineBlockers([ready, missing]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.lineIndex).toBe(2);
    expect(blockers[0]?.kind).toBe("missing-material");
    const header = invoiceApproveBlockers(invoice([ready, missing]));
    expect(header.some((item) => item.key === "match" && item.count === 1)).toBe(true);
  });
});

describe("invoice unit conversion", () => {
  it("converts kg to g without guessing pack contents", () => {
    expect(applyInvoiceUnitChange({ unit: "kg", quantity: 2 }, "g")).toEqual({ unit: "g", quantity: 2000 });
    expect(applyInvoiceUnitChange({ unit: "kg", quantity: 2 }, "unit")).toEqual({ unit: "unit" });
  });
});

describe("stock post identity", () => {
  it("sanitizes movement ids and does not mark unmatched lines postable", () => {
    expect(sanitizeInventoryDocId("in-abc-line/1")).toBe("in-abc-line_1");
    expect(invoicePurchaseMovementId("abc", "line/1")).toBe("in-abc-line_1");
    const unmatched = line({ productId: undefined });
    expect(stockPostableLine(unmatched)).toBe(false);
    expect(selectStockPostLines(invoice([unmatched]))).toEqual([]);
    const matched = line({ productId: "p1", matchKind: "exact", matchConfirmed: true, postedToStock: true });
    expect(stockPostableLine(matched)).toBe(false);
  });
});
