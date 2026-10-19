import { describe, expect, it } from "vitest";
import {
  balanceTone,
  buildSupplierLedger,
  documentPayTag,
  splitPackLabel,
  cashEntryId,
  compareLedgerRows,
  debtEffect,
  mergeAliasNames,
  paymentCashEntries,
  paymentDocId,
  periodRows,
  previewPayment,
  purchaseInvoicesForCashFlow,
  supplierIdentityMatch,
  supplierSearchMatch,
  supplierStockRows,
} from "@/lib/inventory/supplier-ledger";
import type { InventoryMovement, PurchaseInvoice, Supplier } from "@/lib/inventory/types";
import type { SupplierOpening, SupplierPayment } from "@/lib/inventory/supplier-ledger";

function supplier(patch: Partial<Supplier> = {}): Supplier {
  return {
    id: "sup-a",
    name: "בריוש",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function invoice(patch: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "inv-1",
    supplierId: "sup-a",
    supplierName: "בריוש",
    invoiceNumber: "100",
    invoiceDate: "2026-10-01",
    dueDate: "2026-10-20",
    receivedAt: "2026-10-02",
    documentType: "invoice",
    status: "approved",
    grossAmount: 100,
    netAmount: 84.75,
    vatAmount: 15.25,
    lines: [],
    createdAt: "2026-10-01T08:00:00.000Z",
    ...patch,
  };
}

function payment(patch: Partial<SupplierPayment> = {}): SupplierPayment {
  return {
    id: "pay-1",
    supplierId: "sup-a",
    amount: 40,
    paidAt: "2026-10-05",
    method: "bank",
    status: "executed",
    allocations: [{ invoiceId: "inv-1", amount: 40 }],
    createdAt: "2026-10-05T09:00:00.000Z",
    ...patch,
  };
}

const today = "2026-10-19";

describe("supplier ledger", () => {
  it("keeps an approved invoice, a partial payment, and the remaining balance", () => {
    const ledger = buildSupplierLedger({ invoices: [invoice()], payments: [payment()], today });
    expect(ledger.balance).toBe(60);
    expect(ledger.rows.map((row) => [row.kind, row.increase, row.decrease, row.balanceAfter])).toEqual([
      ["invoice", 100, 0, 100],
      ["payment", 0, 40, 60],
    ]);
    expect(ledger.openDocuments.find((row) => row.id === "inv-1")?.open).toBe(60);
    expect(balanceTone(ledger.balance)).toBe("due");
  });

  it("allocates one payment across invoices and leaves a partial balance", () => {
    const invoices = [invoice(), invoice({ id: "inv-2", invoiceNumber: "200", grossAmount: 50, createdAt: "2026-10-01T09:00:00.000Z" })];
    const paid = payment({
      amount: 120,
      allocations: [
        { invoiceId: "inv-1", amount: 100 },
        { invoiceId: "inv-2", amount: 20 },
      ],
    });
    const ledger = buildSupplierLedger({ invoices, payments: [paid], today });
    expect(ledger.balance).toBe(30);
    expect(ledger.openDocuments.map((row) => [row.id, row.open])).toEqual([["inv-2", 30]]);
    const preview = previewPayment({
      amount: 120,
      allocations: paid.allocations,
      openByInvoice: [
        { invoiceId: "inv-1", open: 100 },
        { invoiceId: "inv-2", open: 50 },
      ],
      balanceBefore: 150,
    });
    expect(preview).toMatchObject({
      ok: true,
      excess: 0,
      balanceBefore: 150,
      balanceAfter: 30,
      rows: [
        { invoiceId: "inv-1", before: 100, applied: 100, after: 0 },
        { invoiceId: "inv-2", before: 50, applied: 20, after: 30 },
      ],
    });
  });

  it("reduces debt for a credit and keeps surplus as supplier credit", () => {
    const credit = invoice({ id: "cr-1", documentType: "credit", invoiceNumber: "C-1", grossAmount: 30, createdAt: "2026-10-03T00:00:00.000Z", invoiceDate: "2026-10-03" });
    const credited = buildSupplierLedger({ invoices: [invoice(), credit], today });
    expect(credited.balance).toBe(70);
    const surplus = buildSupplierLedger({
      invoices: [invoice()],
      payments: [payment({ amount: 130, allocations: [{ invoiceId: "inv-1", amount: 100 }] })],
      today,
    });
    expect(surplus.balance).toBe(-30);
    expect(balanceTone(surplus.balance)).toBe("credit");
    expect(surplus.openDocuments.filter((row) => row.id === "inv-1")).toHaveLength(0);
  });

  it("ignores a draft and an unapproved scan, and does not charge a covered delivery twice", () => {
    const draft = invoice({ id: "draft", status: "draft", invoiceNumber: "D" });
    const scan = invoice({ id: "scan", status: "saved", scanStatus: "needs_review", invoiceNumber: "S" });
    const delivery = invoice({
      id: "del-1",
      documentType: "delivery",
      invoiceNumber: "DN-1",
      grossAmount: 80,
      coveredByInvoiceId: "inv-1",
      invoiceDate: "2026-09-28",
      createdAt: "2026-09-28T00:00:00.000Z",
    });
    const ledger = buildSupplierLedger({ invoices: [draft, scan, delivery, invoice({ coversDeliveryIds: ["del-1"] })], today });
    expect(ledger.balance).toBe(100);
    expect(debtEffect(draft, new Set())).toBe(0);
    expect(debtEffect(scan, new Set())).toBe(0);
  });

  it("keeps a planned or postdated payment out of the balance until it is executed", () => {
    const planned = payment({ id: "plan-1", status: "planned", dueAt: "2026-10-19", amount: 40, allocations: [] });
    const ledger = buildSupplierLedger({ invoices: [invoice()], payments: [planned], today });
    expect(ledger.balance).toBe(100);
    expect(ledger.rows.some((row) => row.kind === "payment")).toBe(false);
    expect(paymentCashEntries(planned, "בריוש")).toEqual([]);
    expect(ledger.nextPayment).toMatchObject({ date: "2026-10-19", amount: 40, planned: true });
  });

  it("places open balances in the 1–30 and over-90 aging buckets", () => {
    const recent = invoice({ id: "recent", dueDate: "2026-10-01", invoiceDate: "2026-09-20", grossAmount: 25, createdAt: "2026-09-20T00:00:00.000Z" });
    const old = invoice({ id: "very-old", dueDate: "2026-06-01", invoiceDate: "2026-05-20", grossAmount: 70, createdAt: "2026-05-20T00:00:00.000Z" });
    const ledger = buildSupplierLedger({ invoices: [recent, old], today });
    expect(ledger.aging.d1_30).toBe(25);
    expect(ledger.aging.d90).toBe(70);
    expect(ledger.overdue).toBe(95);
    expect(ledger.balance).toBe(95);
  });

  it("ages overdue debt and marks a document without a due date", () => {
    const overdue = invoice({ id: "old", dueDate: "2026-09-01", invoiceDate: "2026-08-01", grossAmount: 80 });
    const missing = invoice({ id: "plain", dueDate: undefined, invoiceNumber: "no-due", grossAmount: 15, createdAt: "2026-10-02T00:00:00.000Z" });
    const ledger = buildSupplierLedger({ invoices: [invoice(), overdue, missing], today });
    expect(ledger.aging.d1_30).toBe(0);
    expect(ledger.aging.d31_60).toBe(80);
    expect(ledger.overdue).toBe(80);
    expect(ledger.aging.current).toBe(100);
    expect(ledger.missingDue.map((row) => row.id)).toContain("plain");
    expect(ledger.nextPayment).toMatchObject({ date: "2026-10-20", amount: 100, planned: false });
  });

  it("shows the balance entering a period from earlier movements and the balance leaving it", () => {
    const opening: SupplierOpening = { id: "so-sup-a", supplierId: "sup-a", amount: 10, date: "2026-09-01", createdAt: "2026-09-01T00:00:00.000Z" };
    const ledger = buildSupplierLedger({
      invoices: [invoice()],
      openings: [opening],
      payments: [payment()],
      from: "2026-10-01",
      to: "2026-10-31",
      today,
    });
    expect(ledger.periodOpening).toBe(10);
    expect(ledger.periodPurchases).toBe(100);
    expect(ledger.periodPayments).toBe(40);
    expect(ledger.periodClosing).toBe(70);
    expect(ledger.balance).toBe(70);
    const visible = periodRows(ledger, "2026-10-01", "2026-10-31");
    expect(visible[0]).toMatchObject({ id: "period-opening", balanceAfter: 10 });
    expect(visible.at(-1)).toMatchObject({ id: "period-closing", balanceAfter: 70 });
  });

  it("orders several movements on the same day consistently", () => {
    const rows = [
      { id: "p", at: "2026-10-01", createdAt: "2026-10-01T12:00:00.000Z", kind: "payment" as const },
      { id: "i", at: "2026-10-01", createdAt: "2026-10-01T08:00:00.000Z", kind: "invoice" as const },
      { id: "o", at: "2026-10-01", createdAt: "2026-10-01T07:00:00.000Z", kind: "opening" as const },
    ];
    expect(rows.slice().sort(compareLedgerRows).map((row) => row.id)).toEqual(["o", "i", "p"]);
  });

  it("does not apply the same payment twice", () => {
    const once = payment();
    const ledger = buildSupplierLedger({ invoices: [invoice()], payments: [once, { ...once }], today });
    expect(ledger.balance).toBe(60);
    expect(paymentDocId("sup-a", "key-1")).toBe(paymentDocId("sup-a", "key-1"));
    expect(cashEntryId("pay-1", "inv-1")).toBe("cf-pay-1-inv-1");
  });

  it("does not treat a goods return as a debt reduction or a credit as stock", () => {
    const credit = invoice({ id: "cr", documentType: "credit", grossAmount: 25, invoiceNumber: "C" });
    const ledger = buildSupplierLedger({ invoices: [invoice(), credit], today });
    expect(ledger.rows.some((row) => row.kind === "credit")).toBe(true);
    const movements: InventoryMovement[] = [
      {
        id: "ret-1",
        productId: "prod",
        type: "ISSUE_OUT",
        quantity: 2,
        unit: "unit",
        quantityBase: 2,
        supplierId: "sup-a",
        reason: "return",
        receivedAt: "2026-10-04",
        createdAt: "2026-10-04T00:00:00.000Z",
      },
    ];
    expect(supplierStockRows({ scope: new Set(["sup-a"]), movements, invoices: [credit] }).map((row) => row.id)).toEqual(["ret-1"]);
    expect(ledger.balance).toBe(75);
  });

  it("suggests merging Brioche only when an identifier or document matches", () => {
    const hebrew = supplier({ id: "he", name: "בריוש" });
    const latin = supplier({ id: "en", name: "BRIOCHE" });
    expect(supplierIdentityMatch(hebrew, latin, []).match).toBe(false);
    expect(supplierIdentityMatch(hebrew, supplier({ id: "en", name: "BRIOCHE", taxId: "514123456" }), []) .match).toBe(false);
    expect(supplierIdentityMatch(supplier({ id: "he", taxId: "514123456" }), supplier({ id: "en", name: "BRIOCHE", taxId: "514-123456" }), []).reasons).toContain("tax");
    const shared = [
      invoice({ supplierId: "he", supplierTaxId: "514123456", invoiceNumber: "55", fileHash: "hash-1" }),
      invoice({ id: "inv-b", supplierId: "en", supplierName: "BRIOCHE", supplierTaxId: "514123456", invoiceNumber: "55" }),
    ];
    expect(supplierIdentityMatch(hebrew, latin, shared).reasons).toContain("document");
    expect(mergeAliasNames(hebrew, latin)).toEqual(["BRIOCHE"]);
  });

  it("passes the net payable to cash flow once", () => {
    const rows = purchaseInvoicesForCashFlow([
      invoice(),
      invoice({ id: "cr", documentType: "credit", grossAmount: 30, invoiceNumber: "C" }),
      invoice({ id: "draft", status: "draft", invoiceNumber: "D", grossAmount: 500 }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ id: "inv-1", gross: 70 })]);
  });

  it("searches by name, phone, and tax id", () => {
    const row = supplier({ phone: "050-1234567", taxId: "514123456" });
    expect(supplierSearchMatch(row, "בריוש")).toBe(true);
    expect(supplierSearchMatch(row, "050123")).toBe(true);
    expect(supplierSearchMatch(row, "514123456")).toBe(true);
    expect(supplierSearchMatch(row, "מאפייה")).toBe(false);
  });

  it("labels a document without changing the open amount", () => {
    expect(documentPayTag({ documentType: "credit", open: 10, settled: 0, today: "2026-10-19", countsAsDebt: false })).toBe("credit");
    expect(documentPayTag({ documentType: "delivery", open: 0, settled: 0, today: "2026-10-19", countsAsDebt: false })).toBeNull();
    expect(documentPayTag({ documentType: "invoice", open: 0, settled: 40, today: "2026-10-19", countsAsDebt: true })).toBe("paid");
    expect(documentPayTag({ documentType: "invoice", open: 20, settled: 5, dueDate: "2026-10-01", today: "2026-10-19", countsAsDebt: true })).toBe("overdue");
    expect(documentPayTag({ documentType: "invoice", open: 20, settled: 5, dueDate: "2026-11-01", today: "2026-10-19", countsAsDebt: true })).toBe("partial");
    expect(documentPayTag({ documentType: "invoice", open: 20, settled: 0, dueDate: "2026-11-01", today: "2026-10-19", countsAsDebt: true })).toBe("open");
  });

  it("splits a pack label without rewriting the stored text", () => {
    expect(splitPackLabel("5 kg")).toEqual({ quantity: "5", unit: "kg" });
    expect(splitPackLabel("שקית 5 ק״ג")).toEqual({ quantity: "שקית 5 ק״ג" });
    expect(splitPackLabel("  ")).toBeNull();
  });
});
