import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CostingIngredient } from "@/lib/costing/types";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";
import { currentStockBase } from "@/lib/inventory/stock";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import { buildLedgerDetails, filterLedgerDetails, receivedQuantityMatchesLine } from "@/lib/inventory/ledger-detail";
import type { InventoryMovement, PurchaseInvoice, PurchaseInvoiceLine, Supplier } from "@/lib/inventory/types";

function product(): CostingIngredient {
  return {
    id: "prod-milk",
    name: "חלב",
    purchasePrice: 10,
    purchaseQuantity: 1,
    purchaseUnit: "kg",
    baseUnit: "g",
    costPerBaseUnit: 0.01,
    active: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function line(patch: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return {
    key: "line-kg",
    rawName: "חלב מלא",
    originalDescription: "חלב מלא 17.91",
    productId: "prod-milk",
    quantity: 17.91,
    unit: "kg",
    unitPrice: 8,
    discount: null,
    lineTotal: 143.28,
    vatType: "exclusive",
    vatRate: 0.18,
    priceBeforeVat: 143.28,
    vatAmount: 25.79,
    priceIncludingVat: 169.07,
    matchKind: "exact",
    ...patch,
  };
}

function invoice(patch: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "inv-saved",
    supplierId: "sup-a",
    supplierName: "מחלבות הגליל",
    invoiceNumber: "4412",
    invoiceDate: "2026-10-15",
    receivedAt: "2026-10-18",
    status: "saved",
    stockStatus: "posted",
    lines: [line()],
    sourceFile: {
      storagePath: "invoice-files/inv-saved/original.pdf",
      downloadUrl: "https://files.example/inv-saved.pdf",
      originalFilename: "invoice-4412.pdf",
      mimeType: "application/pdf",
      size: 1000,
      uploadedAt: "2026-10-18T08:00:00.000Z",
      kind: "pdf",
    },
    createdAt: "2026-10-18T08:00:00.000Z",
    ...patch,
  };
}

function movement(patch: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: "mov-1791",
    productId: "prod-milk",
    type: "PURCHASE_IN",
    quantity: 17.91,
    unit: "kg",
    quantityBase: 17910,
    supplierId: "sup-a",
    invoiceId: "inv-saved",
    invoiceLineId: "line-kg",
    invoiceLineKey: "line-kg",
    invoiceDate: "2026-10-18",
    receivedAt: "2026-10-18T12:00:00.000Z",
    createdAt: "2026-10-18T12:00:00.000Z",
    ...patch,
  };
}

const suppliers: Supplier[] = [
  { id: "sup-a", name: "מחלבות הגליל", active: true, createdAt: "", updatedAt: "" },
  { id: "sup-b", name: "ספק אחר", active: true, createdAt: "", updatedAt: "" },
  { id: "sup-last", name: "ספק אחרון", active: true, createdAt: "", updatedAt: "" },
];

const ledgerKeys = [
  "admin.inventory.ledger.movementDate",
  "admin.inventory.ledger.movementType",
  "admin.inventory.ledger.supplier",
  "admin.inventory.ledger.invoiceNumber",
  "admin.inventory.ledger.invoiceDate",
  "admin.inventory.ledger.invoiceProduct",
  "admin.inventory.ledger.inOut",
  "admin.inventory.ledger.balanceAfter",
  "admin.inventory.ledger.viewSource",
  "admin.inventory.ledger.unlinked",
  "admin.inventory.ledger.filterFrom",
  "admin.inventory.ledger.filterTo",
  "admin.inventory.ledger.allSuppliers",
  "admin.inventory.ledger.manualAdjustment",
];

describe("ledger invoice detail", () => {
  it("reads the saved invoice and line for a 17.91 kg receipt, including unit conversion", () => {
    const opening = movement({
      id: "mov-open",
      type: "OPENING",
      quantity: 1,
      unit: "kg",
      quantityBase: 1000,
      supplierId: undefined,
      invoiceId: undefined,
      invoiceLineId: undefined,
      invoiceLineKey: undefined,
      note: "יתרת מחסן",
      receivedAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    const receipt = movement();
    const saved = invoice();
    const decoy = invoice({
      id: "inv-later",
      invoiceNumber: "9999",
      supplierId: "sup-last",
      supplierName: "ספק אחרון",
      invoiceDate: "2026-10-19",
      lines: [line({ key: "other", originalDescription: "חלב מלא", quantity: 17.91 })],
    });
    const movements = [opening, receipt];
    const before = movements.map((row) => row.quantityBase);
    const stockBefore = currentStockBase(movements, product().id);

    const details = buildLedgerDetails({ movements, productId: product().id, invoices: [decoy, saved], suppliers });

    expect(movements.map((row) => row.quantityBase)).toEqual(before);
    expect(currentStockBase(movements, product().id)).toBe(stockBefore);
    expect(details).toHaveLength(movements.length);
    expect(details[1]).toMatchObject({
      movementId: "mov-1791",
      movementDate: "2026-10-18",
      supplierName: "מחלבות הגליל",
      balanceAfterBase: 18910,
      source: {
        kind: "invoice",
        invoiceId: "inv-saved",
        invoiceLineId: "line-kg",
        invoiceNumber: "4412",
        invoiceDate: "2026-10-15",
        productName: "חלב מלא 17.91",
        fileUrl: "https://files.example/inv-saved.pdf",
        quantityMatches: true,
        restored: false,
      },
    });
    expect(details[1]?.source.kind === "invoice" && details[1].source.invoiceNumber).not.toBe("9999");
    expect(receivedQuantityMatchesLine(receipt, line({ quantity: 17910, unit: "g" }))).toBe(true);
    expect(receivedQuantityMatchesLine(receipt, line({ quantity: 10, unit: "kg" }))).toBe(false);
  });

  it("keeps separate rows when the quantity came from more than one invoice", () => {
    const first = movement({ id: "mov-a", invoiceId: "inv-a", invoiceLineId: "a", invoiceLineKey: "a", quantity: 10, quantityBase: 10000 });
    const second = movement({
      id: "mov-b",
      invoiceId: "inv-b",
      invoiceLineId: "b",
      invoiceLineKey: "b",
      supplierId: "sup-b",
      quantity: 7.91,
      quantityBase: 7910,
      receivedAt: "2026-10-19T00:00:00.000Z",
      createdAt: "2026-10-19T00:00:00.000Z",
    });
    const invoices = [
      invoice({ id: "inv-a", invoiceNumber: "100", lines: [line({ key: "a", quantity: 10, originalDescription: "שק א" })] }),
      invoice({ id: "inv-b", invoiceNumber: "200", supplierId: "sup-b", supplierName: "ספק אחר", lines: [line({ key: "b", quantity: 7.91, originalDescription: "שק ב" })] }),
    ];
    const details = buildLedgerDetails({ movements: [first, second], productId: product().id, invoices, suppliers });
    expect(details.map((row) => (row.source.kind === "invoice" ? row.source.invoiceNumber : ""))).toEqual(["100", "200"]);
    expect(details.map((row) => row.balanceAfterBase)).toEqual([10000, 17910]);
    expect(details.at(-1)?.balanceAfterBase).toBe(currentStockBase([first, second], product().id));
  });

  it("restores a link only from an unambiguous stored id", () => {
    const canonical = movement({
      id: invoicePurchaseMovementId("inv-saved", "line-kg"),
      invoiceId: undefined,
      invoiceLineId: undefined,
      invoiceLineKey: undefined,
      supplierId: undefined,
    });
    const restored = buildLedgerDetails({
      movements: [canonical],
      productId: product().id,
      invoices: [invoice()],
      suppliers,
    });
    expect(restored[0]?.source).toMatchObject({
      kind: "invoice",
      invoiceId: "inv-saved",
      invoiceLineId: "line-kg",
      invoiceNumber: "4412",
      restored: true,
      quantityMatches: true,
    });
    expect(restored[0]?.supplierName).toBe("מחלבות הגליל");

    const ambiguous = movement({
      id: "mov-plain",
      invoiceId: "inv-saved",
      invoiceLineId: undefined,
      invoiceLineKey: undefined,
      quantity: 17.91,
      quantityBase: 17910,
    });
    const twoLines = invoice({
      lines: [
        line({ key: "line-a", quantity: 17.91, originalDescription: "שק גדול" }),
        line({ key: "line-b", quantity: 1, originalDescription: "שק קטן" }),
      ],
    });
    const unresolved = buildLedgerDetails({
      movements: [ambiguous],
      productId: product().id,
      invoices: [twoLines],
      suppliers,
    });
    expect(unresolved[0]?.source).toMatchObject({
      kind: "invoice",
      invoiceNumber: "4412",
      invoiceLineId: undefined,
      productName: undefined,
      restored: false,
    });

    const claimed = movement({
      id: "mov-claimed",
      invoiceId: "inv-saved",
      invoiceLineId: "line-a",
      invoiceLineKey: "line-a",
      quantity: 1,
      quantityBase: 1000,
    });
    const openLine = movement({
      id: "mov-open-line",
      invoiceId: "inv-saved",
      invoiceLineId: undefined,
      invoiceLineKey: undefined,
      quantity: 4,
      quantityBase: 4000,
      receivedAt: "2026-10-19T00:00:00.000Z",
      createdAt: "2026-10-19T00:00:00.000Z",
    });
    const restoredLine = buildLedgerDetails({
      movements: [claimed, openLine],
      productId: product().id,
      invoices: [twoLines],
      suppliers,
    });
    expect(restoredLine[1]?.source).toMatchObject({
      kind: "invoice",
      invoiceLineId: "line-b",
      productName: "שק קטן",
      restored: true,
    });

    const keyOnly = movement({ invoiceLineId: undefined, invoiceLineKey: "line-kg" });
    const fromKey = buildLedgerDetails({
      movements: [keyOnly],
      productId: product().id,
      invoices: [invoice()],
      suppliers,
    });
    expect(fromKey[0]?.source).toMatchObject({ invoiceLineId: "line-kg", invoiceNumber: "4412", restored: false });
  });

  it("does not guess an invoice from the product, quantity, or latest supplier", () => {
    const orphan = movement({
      id: "mov-orphan",
      invoiceId: undefined,
      invoiceLineId: undefined,
      invoiceLineKey: undefined,
      supplierId: "sup-last",
      quantity: 17.91,
      quantityBase: 17910,
    });
    const details = buildLedgerDetails({
      movements: [orphan],
      productId: product().id,
      invoices: [invoice({ supplierId: "sup-last", supplierName: "ספק אחרון", invoiceNumber: "7777" })],
      suppliers,
    });
    expect(details[0]?.source).toEqual({ kind: "unlinked" });
    expect(details[0]?.supplierName).toBe("ספק אחרון");
  });

  it("shows the source type and reference for opening stock and a manual correction", () => {
    const rows = [
      movement({
        id: "open",
        type: "OPENING",
        invoiceId: undefined,
        invoiceLineId: undefined,
        invoiceLineKey: undefined,
        supplierId: undefined,
        note: "יתרת מחסן",
        quantity: 2,
        quantityBase: 2000,
        receivedAt: "2026-10-01T00:00:00.000Z",
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
      movement({
        id: "fix",
        type: "ADJUSTMENT",
        invoiceId: undefined,
        invoiceLineId: undefined,
        invoiceLineKey: undefined,
        supplierId: undefined,
        note: "תיקון שקילה",
        quantity: 0.5,
        quantityBase: -500,
        receivedAt: "2026-10-02T00:00:00.000Z",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ];
    const details = buildLedgerDetails({ movements: rows, productId: product().id, invoices: [], suppliers });
    expect(details[0]?.source).toEqual({ kind: "reference", labelKey: "admin.inventory.movement.OPENING", text: "יתרת מחסן" });
    expect(details[1]?.source).toEqual({ kind: "reference", labelKey: "admin.inventory.ledger.manualAdjustment", text: "תיקון שקילה" });
    expect(details[1]?.balanceAfterBase).toBe(1500);
  });

  it("filters by movement date and supplier without recomputing the balance", () => {
    const early = movement({ id: "early", supplierId: "sup-a", receivedAt: "2026-10-10T00:00:00.000Z", createdAt: "2026-10-10T00:00:00.000Z", quantity: 1, quantityBase: 1000 });
    const late = movement({ id: "late", supplierId: "sup-b", receivedAt: "2026-10-20T00:00:00.000Z", createdAt: "2026-10-20T00:00:00.000Z", quantity: 2, quantityBase: 2000 });
    const details = buildLedgerDetails({
      movements: [early, late],
      productId: product().id,
      invoices: [
        invoice({ id: "inv-saved", lines: [line({ key: "line-kg", quantity: 1 })] }),
        invoice({ id: "inv-saved-b", invoiceNumber: "2", supplierId: "sup-b", lines: [line({ key: "line-kg", quantity: 2 })] }),
      ],
      suppliers,
    });
    const lateFixed = { ...late, invoiceId: "inv-saved-b" };
    const rebuilt = buildLedgerDetails({
      movements: [early, lateFixed],
      productId: product().id,
      invoices: [
        invoice(),
        invoice({ id: "inv-saved-b", invoiceNumber: "2", supplierId: "sup-b", supplierName: "ספק אחר", lines: [line({ quantity: 2 })] }),
      ],
      suppliers,
    });
    const filtered = filterLedgerDetails(rebuilt, { from: "2026-10-19", supplierId: "sup-b" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.balanceAfterBase).toBe(3000);
    expect(filtered[0]?.movementDate).toBe("2026-10-20");
    expect(details).toHaveLength(2);
  });

  it("saves the invoice id and line id on a new stock receipt", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/inventory/invoice-admin-write.ts"), "utf8");
    expect(source).toContain("invoiceId: merged.id");
    expect(source).toContain("invoiceLineId: line.key");
    expect(source).toContain("invoiceLineKey: line.key");
  });

  it("has Hebrew and Arabic ledger labels", () => {
    for (const key of ledgerKeys) {
      expect(ADMIN_TRANSLATIONS.he[key]).toBeTruthy();
      expect(ADMIN_TRANSLATIONS.ar[key]).toBeTruthy();
    }
    expect(ADMIN_TRANSLATIONS.he["admin.inventory.ledger.unlinked"]).toBe("חשבונית מקור לא מקושרת");
    expect(ADMIN_TRANSLATIONS.ar["admin.inventory.ledger.invoiceNumber"]).toBe("رقم الفاتورة");
    expect(ADMIN_TRANSLATIONS.he["admin.inventory.ledger.movementDate"]).toBe("תאריך תנועה");
    expect(ADMIN_TRANSLATIONS.he["admin.inventory.ledger.invoiceDate"]).toBe("תאריך חשבונית");
  });
});
