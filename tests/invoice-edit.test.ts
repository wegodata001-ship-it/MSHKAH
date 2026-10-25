import { describe, expect, it } from "vitest";
import { draftFromInvoice, planInvoiceEdit, recalculateEditableLine } from "@/lib/inventory/invoice-edit";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

function line(patch: Partial<PurchaseInvoiceLine>): PurchaseInvoiceLine {
  return {
    key: "line-1",
    rawName: "עוגיות",
    originalScannedName: "עוגיות",
    quantity: 8,
    unit: "unit",
    unitPrice: 28,
    discount: 0,
    lineTotal: 224,
    vatType: "exclusive",
    vatRate: 0.18,
    priceBeforeVat: 224,
    vatAmount: 40.32,
    priceIncludingVat: 264.32,
    productId: "cookies",
    postedToStock: true,
    priceIncludesVat: false,
    lastEditedField: "unitPrice",
    ...patch,
  };
}

function invoice(lines: PurchaseInvoiceLine[], patch: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "inv-1",
    supplierName: "ארטיקייק",
    supplierId: "supplier-1",
    invoiceNumber: "100",
    invoiceDate: "2026-08-11",
    receivedAt: "2026-08-11",
    status: "saved",
    stockStatus: "posted",
    inventoryPostedAt: "2026-08-11",
    sourceFile: { storagePath: "invoices/original.pdf", downloadUrl: "https://example.test/original.pdf", originalFilename: "original.pdf", mimeType: "application/pdf", size: 10, uploadedAt: "2026-08-11", kind: "pdf" },
    lines,
    createdAt: "2026-08-11",
    ...patch,
  } as PurchaseInvoice;
}

describe("saved invoice editing", () => {
  it("changes quantity on the same movement and does not repeat the delta", () => {
    const current = invoice([line({})]);
    const draft = draftFromInvoice(current);
    draft.lines[0] = recalculateEditableLine(draft.lines[0], { field: "quantity", quantity: 10 });
    const first = planInvoiceEdit(current, draft, { at: "2026-10-25T10:00:00Z", actor: "admin@example.com" });
    expect(first.stock).toEqual([
      expect.objectContaining({
        kind: "update",
        lineKey: "line-1",
        productId: "cookies",
        movementId: invoicePurchaseMovementId("inv-1", "line-1"),
        fromBase: 8,
        toBase: 10,
        delta: 2,
      }),
    ]);
    const saved = invoice(first.lines, { editHistory: first.editHistory });
    const second = planInvoiceEdit(saved, draft, { at: "2026-10-25T10:05:00Z", actor: "admin@example.com" });
    expect(second.stock).toEqual([]);
  });

  it("adds one movement for a new line and reverses a removed line without deleting the purchase", () => {
    const current = invoice([line({})]);
    const draft = draftFromInvoice(current);
    const added = recalculateEditableLine({
      ...draft.lines[0],
      key: "line-2",
      name: "עוגיות ללא סוכר",
      productId: "sugar",
      quantity: 4,
      unitPrice: 30,
    }, { field: "unitPrice", unitPrice: 30 });
    const withAdded = planInvoiceEdit(current, { ...draft, lines: [...draft.lines, added] }, { at: "t", actor: "admin" });
    expect(withAdded.stock.map((row) => row.kind)).toEqual(["add"]);
    expect(withAdded.stock[0]).toMatchObject({ productId: "sugar", toBase: 4, movementId: invoicePurchaseMovementId("inv-1", "line-2") });

    const removed = planInvoiceEdit(current, { ...draft, lines: [] }, { at: "t", actor: "admin" });
    expect(removed.stock).toEqual([
      expect.objectContaining({ kind: "reverse", movementId: invoicePurchaseMovementId("inv-1", "line-1"), fromBase: 8 }),
    ]);
    expect(removed.changes.some((change) => change.field === "line" && change.before === "עוגיות" && change.after === "")).toBe(true);
  });

  it("calculates excluding and including VAT once", () => {
    const current = invoice([line({ quantity: 2, unitPrice: 10, lineTotal: 20 })]);
    const draft = draftFromInvoice(current);
    const exclusive = recalculateEditableLine({ ...draft.lines[0], basis: "excluding", vatPercent: 18 }, { field: "basis", basis: "excluding" });
    expect(exclusive.lineExcludingVat).toBe(20);
    expect(exclusive.vatAmount).toBe(3.6);
    expect(exclusive.lineIncludingVat).toBe(23.6);
    const inclusive = recalculateEditableLine({ ...draft.lines[0], basis: "including", unitPrice: 10, vatPercent: 18 }, { field: "unitPrice", unitPrice: 10 });
    expect(inclusive.basis).toBe("including");
    expect(inclusive.lineIncludingVat).toBe(20);
    expect(inclusive.lineExcludingVat).toBe(16.95);
  });

  it("changes a price without a second stock movement and ignores a discount line", () => {
    const current = invoice([
      line({}),
      line({ key: "discount", rawName: "הנחה", originalScannedName: "הנחה", lineType: "DISCOUNT", productId: "cookies", quantity: 1, unitPrice: 10, lineTotal: 10, postedToStock: true }),
    ]);
    const draft = draftFromInvoice(current);
    draft.lines[0] = recalculateEditableLine(draft.lines[0], { field: "unitPrice", unitPrice: 30 });
    const priced = planInvoiceEdit(current, draft, { at: "t", actor: "admin" });
    expect(priced.stock).toEqual([]);
    expect(priced.changes.some((change) => change.field === "unitPrice" && change.after === "30.00")).toBe(true);
    const removed = planInvoiceEdit(current, { ...draft, lines: draft.lines.filter((row) => row.key !== "discount") }, { at: "t" });
    expect(removed.stock.every((row) => row.lineKey !== "discount")).toBe(true);
  });

  it("keeps the scanned name, source file, and other invoices untouched", () => {
    const current = invoice([line({})]);
    const draft = draftFromInvoice(current);
    draft.lines[0] = { ...draft.lines[0], name: "עוגיות רגילות" };
    const plan = planInvoiceEdit(current, draft, { at: "t", actor: "admin@example.com" });
    expect(plan.lines[0].productId).toBe("cookies");
    expect(plan.lines[0].originalScannedName).toBe("עוגיות");
    expect(plan.lines[0].correctedInvoiceName).toBe("עוגיות רגילות");
    expect(plan.header).not.toHaveProperty("sourceFile");
    expect(plan.stock.every((row) => row.movementId.includes("inv-1"))).toBe(true);
    expect(plan.changes[0]).toMatchObject({ actor: "admin@example.com", field: "name", before: "עוגיות", after: "עוגיות רגילות" });
    const unposted = planInvoiceEdit(invoice([line({ postedToStock: false })], { stockStatus: "none", inventoryPostedAt: undefined }), draft, { at: "t" });
    expect(unposted.stock).toEqual([]);
  });
});
