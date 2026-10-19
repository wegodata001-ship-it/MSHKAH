import { describe, expect, it } from "vitest";
import { findCategoryByNormalizedName, mergeCategoryNames, normalizeCategoryName } from "@/lib/inventory/category-name";
import { applyInvoiceUnitChange, invoiceAfterPersist, invoiceLineBlockers, invoiceLineReviewStatus, invoiceUnitTargets, shouldClearInvoiceDraft } from "@/lib/inventory/invoice-line-status";
import { intakeFailureMessageKey, intakeStatusUncertain, invoiceApproveBlockers, invoiceLineCareStatus, invoiceNeedsAttention } from "@/lib/inventory/invoice-intake";
import { applyInvoiceLineSave, isConfirmedInvoiceMatch, isPlannedNewIngredient } from "@/lib/inventory/invoice-line-review";
import { emptyInvoiceLine } from "@/lib/inventory/invoice-lines";
import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { stockInDisplayUnit } from "@/lib/inventory/issue";
import { invoicePurchaseMovementId, sanitizeInventoryDocId, selectStockPostLines, stockPostableLine } from "@/lib/inventory/invoice-stock-post";
import { labeledPurchaseUnitPrice } from "@/lib/inventory/stock";
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
  it("treats an unnamed row as missing a material and a named new row as ready", () => {
    const blank = line({ rawName: "", originalDescription: "", productId: undefined, matchKind: "none", matchConfirmed: false });
    const named = line({ rawName: "קמח", productId: undefined, matchKind: "suggest", matchConfirmed: false });
    expect(invoiceLineReviewStatus(blank).kind).toBe("missing-material");
    expect(invoiceLineReviewStatus(named).kind).toBe("ready");
    expect(invoiceNeedsAttention(named)).toBe(false);
    expect(invoiceLineCareStatus(blank)).toBe("needs-match");
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
    const missing = line({ key: "b", rawName: "", originalDescription: "", productId: undefined, matchKind: "none", matchConfirmed: false });
    const blockers = invoiceLineBlockers([ready, missing]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.lineIndex).toBe(2);
    expect(blockers[0]?.kind).toBe("missing-material");
    const header = invoiceApproveBlockers(invoice([ready, missing]));
    expect(header.some((item) => item.key === "match" && item.count === 1)).toBe(true);
  });
});

describe("invoice unit correction", () => {
  it("changes only the line unit and leaves quantity and price", () => {
    const row = { unit: "kg" as const, quantity: 2, unitPrice: 10 };
    expect(applyInvoiceUnitChange(row, "g")).toEqual({ unit: "g" });
    expect(applyInvoiceUnitChange(row, "unit")).toEqual({ unit: "unit" });
    expect(applyInvoiceUnitChange(row, "g")).not.toHaveProperty("quantity");
    expect(applyInvoiceUnitChange(row, "g")).not.toHaveProperty("unitPrice");
  });

  it("targets every line, only the selected lines, or lines missing a unit", () => {
    const rows = [
      line({ key: "visible", unit: "kg" }),
      line({ key: "hidden", unit: "g" }),
      line({ key: "blank", unit: null }),
    ];
    const visible = new Set(["visible"]);
    expect(invoiceUnitTargets(rows, "all").map((item) => item.key)).toEqual(["visible", "hidden", "blank"]);
    expect(invoiceUnitTargets(rows, "all").some((item) => !visible.has(item.key))).toBe(true);
    expect(invoiceUnitTargets(rows, "selected", ["hidden"]).map((item) => item.key)).toEqual(["hidden"]);
    expect(invoiceUnitTargets(rows, "missing").map((item) => item.key)).toEqual(["blank"]);
  });

  it("asks for a conversion when the unit does not match the ingredient", () => {
    const packed = line({ productId: "p1", matchKind: "exact", matchConfirmed: true, unit: "kg" });
    expect(invoiceLineReviewStatus(packed, { product: { purchaseUnit: "unit", baseUnit: "unit" } }).labelKey).toBe("admin.inventory.smart.unitMismatch");
    expect(invoiceLineReviewStatus(packed, { product: { purchaseUnit: "g", baseUnit: "g" } }).kind).toBe("ready");
  });

  it("keeps the draft when saving fails or a newer edit exists", () => {
    expect(shouldClearInvoiceDraft(false, 1, 1)).toBe(false);
    expect(shouldClearInvoiceDraft(true, 2, 1)).toBe(false);
    expect(shouldClearInvoiceDraft(true, 2, 2)).toBe(true);
  });

  it("keeps a newer invoice when an older save returns", () => {
    const snapshot = invoice([line({ key: "a", quantity: 1, unit: "kg" })]);
    const latest = invoice([line({ key: "a", quantity: 4, unit: "unit" })]);
    const resolved = invoiceAfterPersist(latest, snapshot, "inv-1", 2, 1);
    expect(resolved.lines[0]?.quantity).toBe(4);
    expect(resolved.lines[0]?.unit).toBe("unit");
    expect(resolved.id).toBe("inv-1");
  });
});

describe("photographed poultry invoice quantities", () => {
  it("keeps shipping and packaging out of stock and converts kg once", () => {
    const shawarma = line({
      rawName: "שווארמה עוף טרי",
      productId: "shawarma",
      matchKind: "exact",
      matchConfirmed: true,
      quantity: 16.27,
      unit: "kg",
      unitPrice: 45,
      netAmount: 732.15,
      priceBeforeVat: 732.15,
    });
    const shipping = line({ rawName: "הובלה", lineType: "SHIPPING", skipInventory: true, quantity: 55.55, unit: "kg", productId: undefined });
    const plastic = line({ rawName: "פלסטיק טרי גדול", lineType: "GENERAL", quantity: 7, unit: "unit", productId: undefined });
    expect(invoiceLineReviewStatus(shipping).kind).toBe("ancillary");
    expect(invoiceLineReviewStatus(shipping).labelKey).not.toBe("admin.inventory.smart.rowReady");
    expect(invoiceLineReviewStatus(plastic).kind).toBe("packaging");
    expect(stockPostableLine(shipping)).toBe(false);
    expect(stockPostableLine(plastic)).toBe(false);
    expect(stockPostableLine(shawarma)).toBe(true);
    expect(invoiceLineQuantityBase(shawarma)).toBeCloseTo(16270);
    expect(stockInDisplayUnit(16270, { baseUnit: "g", purchaseUnit: "kg" })).toBeCloseTo(16.27);
    expect(
      labeledPurchaseUnitPrice({
        unit: "kg",
        quantity: 16.27,
        packageQuantity: 16.27,
        priceBeforeVat: 732.15,
        unitPriceNet: 45,
        unitCost: 0.045,
      })
    ).toEqual({ amount: 45, unit: "kg" });
    expect(invoiceLineBlockers([shawarma, shipping, plastic])).toEqual([]);
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

describe("approve intake", () => {
  it("keeps every saved material when lines are written one after another", () => {
    const first = line({ key: "a", rawName: "חסה", productId: undefined, matchConfirmed: false });
    const second = line({ key: "b", rawName: "עגבניה", productId: undefined, matchConfirmed: false });
    let current = invoice([first, second]);
    current = applyInvoiceLineSave(current, { ...first, productId: "lettuce", matchKind: "exact", matchConfirmed: true });
    current = applyInvoiceLineSave(current, { ...second, productId: "tomato", matchKind: "exact", matchConfirmed: true });
    expect(current.lines.map((row) => row.productId)).toEqual(["lettuce", "tomato"]);
    expect(invoiceLineBlockers(current.lines)).toEqual([]);
  });

  it("does not ask again for a saved match and does not treat a suggestion as saved", () => {
    const saved = line({ key: "a", rawName: "חסה", productId: "lettuce", matchKind: "mapped", matchConfirmed: true });
    const suggestion = line({ key: "b", rawName: "עגבניה", productId: "tomato", matchKind: "suggest", matchConfirmed: false });
    const missingUnit = line({ key: "c", rawName: "מלפפון", productId: "cucumber", matchKind: "exact", matchConfirmed: true, unit: null });
    expect(isConfirmedInvoiceMatch(saved)).toBe(true);
    expect(isConfirmedInvoiceMatch(suggestion)).toBe(false);
    expect(isPlannedNewIngredient(suggestion)).toBe(true);
    const blockers = invoiceLineBlockers([saved, suggestion, missingUnit]);
    expect(blockers.map((item) => item.lineKey)).toEqual(["c"]);
    expect(blockers[0]?.field).toBe("unit");
  });

  it("names permission, disconnect, and unreadable responses without pretending success", () => {
    expect(intakeFailureMessageKey("PERMISSION_DENIED")).toBe("admin.inventory.smart.permissionSystem");
    expect(intakeFailureMessageKey("NETWORK")).toBe("admin.inventory.smart.networkError");
    expect(intakeFailureMessageKey("INVALID_RESPONSE")).toBe("admin.inventory.smart.invalidResponse");
    expect(intakeFailureMessageKey("POSTING_IN_PROGRESS")).toBe("admin.inventory.smart.postingInProgress");
    expect(intakeStatusUncertain("NETWORK")).toBe(true);
    expect(intakeStatusUncertain("INVALID_RESPONSE")).toBe(true);
    expect(intakeStatusUncertain("PERMISSION_DENIED")).toBe(false);
    expect(intakeFailureMessageKey("STOCK_POST_FAILED")).not.toBe("admin.inventory.smart.intakeComplete");
  });
});
