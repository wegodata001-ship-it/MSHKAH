import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, layoutInvoicePages, NOT_POSTED_LABEL, SYSTEM_DOCUMENT_MARK } from "@/lib/inventory/invoice-document";
import { assertPurgePhrase, backupCovers, PURGE_PHRASE, summarizeRemoval, UNTOUCHED_ON_INVOICE_REMOVAL } from "@/lib/inventory/invoice-removal";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

function line(partial: Partial<PurchaseInvoiceLine> & Pick<PurchaseInvoiceLine, "key" | "rawName">): PurchaseInvoiceLine {
  return {
    quantity: 1,
    unit: "unit",
    unitPrice: 0,
    discount: null,
    lineTotal: 0,
    vatType: "exclusive",
    vatRate: 0.18,
    priceBeforeVat: null,
    vatAmount: null,
    priceIncludingVat: null,
    ...partial,
  };
}

function invoice(partial: Partial<PurchaseInvoice> & Pick<PurchaseInvoice, "id" | "lines">): PurchaseInvoice {
  return {
    supplierName: "SARI Ltd",
    supplierTaxId: "513063636",
    invoiceNumber: "127833",
    invoiceDate: "2026-10-01",
    receivedAt: "2026-10-20T09:00:00.000Z",
    documentType: "invoice",
    status: "draft",
    stockStatus: "none",
    netAmount: 337.27,
    vatAmount: 60.71,
    grossAmount: 398,
    vatRate: 0.18,
    vatMode: "exclusive",
    createdAt: "2026-10-20T09:00:00.000Z",
    createdBy: "admin@mishkat.test",
    ...partial,
  };
}

const sariLines: PurchaseInvoiceLine[] = [
  line({ key: "l1", rawName: "מוצר ראשון", quantity: 1, unit: "kg", unitPrice: 50, lineTotal: 59, netAmount: 50, vatAmount: 9, grossAmount: 59, category: "חומרי גלם" }),
  line({
    key: "line-1792496124409-4vmo3",
    rawName: "אבקת קרם פטיסייר משופרת 5ק״ג-סארי",
    quantity: 1,
    unit: "bucket",
    unitPrice: 168,
    lineTotal: 168,
    netAmount: 168,
    vatAmount: 30.24,
    grossAmount: 198.24,
    category: "חומרי גלם לבישול",
  }),
  line({ key: "l3", rawName: "سكر ناعم للحلويات العربية", quantity: 1, unit: "kg", unitPrice: 40, lineTotal: 47.2, netAmount: 40, vatAmount: 7.2, grossAmount: 47.2 }),
  line({ key: "l4", rawName: "Imported pastry cream powder with a long English name", quantity: 1, unit: "unit", unitPrice: 40, lineTotal: 47.2, netAmount: 40, vatAmount: 7.2, grossAmount: 47.2 }),
  line({ key: "l5", rawName: "שורה חמישית", quantity: 1, unit: "liter", unitPrice: 39.27, lineTotal: 46.36, netAmount: 39.27, vatAmount: 7.07, grossAmount: 46.36 }),
];

describe("invoice document", () => {
  it("keeps the SARI header, the bucket unit, and the full product names", () => {
    const doc = buildInvoiceDocument({
      invoice: invoice({
        id: "5VfUGaumcLPNOLxvGc1u",
        lines: sariLines,
        sourceFile: {
          storagePath: "invoice-files/2026/10/5VfUGaumcLPNOLxvGc1u/original.jpg",
          downloadUrl: "",
          originalFilename: "original.jpg",
          mimeType: "image/jpeg",
          size: 207268,
          uploadedAt: "2026-10-20T09:05:00.000Z",
          kind: "jpg",
        },
      }),
      paymentsIncluded: true,
      paidAmount: 0,
      generatedAt: "2026-10-20T12:00:00.000Z",
    });
    expect(doc.systemDocument).toBe(true);
    expect(doc.systemMark).toBe(SYSTEM_DOCUMENT_MARK);
    expect(doc.lines).toHaveLength(5);
    expect(doc.lines[1]?.unit).toBe("דלי");
    expect(doc.lines[1]?.quantity).toBe("1");
    expect(doc.lines[1]?.unitPrice).toBe("₪168.00");
    expect(doc.lines[1]?.name).toBe("אבקת קרם פטיסייר משופרת 5ק״ג-סארי");
    expect(doc.lines[2]?.name).toBe("سكر ناعم للحلويات العربية");
    expect(doc.lines[3]?.name).toContain("Imported pastry cream powder");
    expect(doc.header.find((field) => field.label === "מספר חשבונית")?.value).toBe("127833");
    expect(doc.money.find((field) => field.label === "סכום כולל מע״מ")?.value).toBe("₪398.00");
    expect(doc.money.find((field) => field.label === "סכום לפני מע״מ")?.value).toBe("₪337.27");
    expect(doc.money.find((field) => field.label === "שיעור מע״מ במסמך")?.value).toBe("18%");
    expect(doc.mismatchNote).toBeNull();
    expect(doc.stock.emptyLabel).toBe(NOT_POSTED_LABEL);
    expect(doc.source.available).toBe(true);
    expect(doc.source.kind).toBe("image");
    expect(doc.timeline.some((event) => event.action === "שינוי יחידת מידה")).toBe(false);
    const positions = layoutInvoicePages(doc).flatMap((page) => page.flatMap((block) => block.kind === "lines" ? block.rows.map((row) => row.position) : []));
    expect(positions).toEqual([1, 2, 3, 4, 5]);
  });

  it("marks a document without a source file and does not assume VAT", () => {
    const doc = buildInvoiceDocument({
      invoice: invoice({
        id: "no-source",
        invoiceNumber: "1",
        lines: [line({ key: "only", rawName: "מים", quantity: 2, unit: "liter", unitPrice: 10, lineTotal: 20, netAmount: 20, vatAmount: null, grossAmount: 20, vatRate: null, vatType: "unknown" })],
        vatRate: null,
        vatMode: null,
        vatAmount: null,
        grossAmount: 20,
        netAmount: 20,
        sourceFile: undefined,
      }),
    });
    expect(doc.source.available).toBe(false);
    expect(doc.source.note).toContain("אינו זמין");
    expect(doc.money.find((field) => field.label === "שיעור מע״מ במסמך")?.value).toBe("לא נשמר");
    expect(doc.money.find((field) => field.label === "סכום ששולם")?.value).toBe("לא נשמר");
  });

  it("shows a posted invoice from its stored movement", () => {
    const doc = buildInvoiceDocument({
      invoice: invoice({
        id: "posted-1",
        status: "approved",
        stockStatus: "posted",
        inventoryPostedAt: "2026-10-20T10:00:00.000Z",
        inventoryPostedBy: "manager",
        lines: [line({ key: "posted-line", rawName: "קמח", quantity: 3, unit: "kg", unitPrice: 10, lineTotal: 30, postedToStock: true, productId: "flour" })],
      }),
      movements: [{
        id: "move-1",
        productId: "flour",
        type: "PURCHASE_IN",
        quantity: 3,
        unit: "kg",
        quantityBase: 3000,
        invoiceId: "posted-1",
        invoiceLineKey: "posted-line",
        receivedAt: "2026-10-20T10:00:00.000Z",
        createdAt: "2026-10-20T10:00:00.000Z",
      }],
      productNames: { flour: "קמח לבן" },
      paymentsIncluded: true,
      paidAmount: 10,
    });
    expect(doc.stock.emptyLabel).toBeNull();
    expect(doc.stock.posted).toBe(true);
    expect(doc.lines[0]?.receipt).toBe("נקלט");
    expect(doc.lines[0]?.product).toBe("קמח לבן");
    expect(doc.stock.movements[0]?.value).toContain("3000");
    expect(doc.timeline.some((event) => event.action === "קליטה למלאי")).toBe(true);
  });

  it("flags a stored total that does not match the lines", () => {
    const doc = buildInvoiceDocument({
      invoice: invoice({
        id: "mismatch",
        grossAmount: 10,
        lines: [line({ key: "x", rawName: "X", lineTotal: 20, grossAmount: 20, netAmount: 20, vatAmount: 0 })],
      }),
    });
    expect(doc.mismatchNote).toContain("אי־התאמה");
  });
});

describe("invoice removal guards", () => {
  it("requires the exact purge phrase and a complete backup", () => {
    expect(assertPurgePhrase(PURGE_PHRASE).ok).toBe(true);
    expect(assertPurgePhrase("delete all invoices").ok).toBe(false);
    expect(backupCovers(["a", "b"], ["b", "a"])).toBe(true);
    expect(backupCovers(["a"], ["a", "b"])).toBe(false);
  });

  it("blocks permanent delete of posted stock that was not reversed", () => {
    const summary = summarizeRemoval(
      [{ id: "posted", status: "approved", stockStatus: "posted", hasSource: true }],
      { posted: ["move"] },
      { posted: ["pay"] },
      { posted: ["PURCHASE_IN"] }
    );
    expect(summary.posted).toBe(1);
    expect(summary.withSource).toBe(1);
    expect(summary.withMovements).toBe(1);
    expect(summary.withPayments).toBe(1);
    expect(summary.purgeBlockedIds).toEqual(["posted"]);
    expect(UNTOUCHED_ON_INVOICE_REMOVAL).toEqual(expect.arrayContaining(["orders", "payments", "products", "supplierPayments", "inventoryMovements"]));
  });

  it("allows purge after a stored reversal", () => {
    const summary = summarizeRemoval(
      [{ id: "done", status: "cancelled", stockStatus: "posted", hasSource: false }],
      { done: ["move", "reverse"] },
      {},
      { done: ["PURCHASE_IN", "REVERSAL"] }
    );
    expect(summary.purgeBlockedIds).toEqual([]);
    expect(summary.inReview).toBe(0);
  });
});
