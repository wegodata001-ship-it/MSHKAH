import { describe, expect, it } from "vitest";
import type { CostingIngredient } from "@/lib/costing/types";
import { buildProductSource, productMatchesSourceKind, productMatchesSupplier } from "@/lib/inventory/product-source";
import type { InventoryMovement, PurchaseInvoice, PurchaseInvoiceLine, Supplier, SupplierItemMap } from "@/lib/inventory/types";

function product(patch: Partial<CostingIngredient> = {}): CostingIngredient {
  return {
    id: "prod-1",
    name: "בריוש מאוחד",
    purchasePrice: 10,
    purchaseQuantity: 1,
    purchaseUnit: "unit",
    baseUnit: "unit",
    costPerBaseUnit: 10,
    active: true,
    createdAt: "2026-10-13T09:00:00.000Z",
    updatedAt: "2026-10-13T09:00:00.000Z",
    ...patch,
  };
}

function line(patch: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return {
    key: "line-1",
    rawName: "בריוש",
    originalDescription: "בריוש",
    productId: "prod-1",
    quantity: 40,
    unit: "unit",
    unitPrice: 6,
    discount: null,
    lineTotal: 244.8,
    vatType: "exclusive",
    vatRate: 0.18,
    priceBeforeVat: 244.8,
    vatAmount: 44.06,
    priceIncludingVat: 288.86,
    matchKind: "exact",
    ...patch,
  };
}

function invoice(patch: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "inv-1",
    supplierId: "sup-a",
    supplierName: "מאפה פתוח",
    invoiceNumber: "10275",
    invoiceDate: "2026-10-13",
    receivedAt: "2026-10-13",
    status: "saved",
    stockStatus: "posted",
    lines: [line()],
    createdAt: "2026-10-13T09:00:05.000Z",
    inventoryPostedBy: "baker@mishkat.cafe",
    ...patch,
  };
}

function movement(patch: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: "mov-1",
    productId: "prod-1",
    type: "PURCHASE_IN",
    quantity: 40,
    unit: "unit",
    quantityBase: 40,
    supplierId: "sup-a",
    invoiceId: "inv-1",
    invoiceLineKey: "line-1",
    receivedAt: "2026-10-13T10:00:00.000Z",
    createdAt: "2026-10-13T10:00:00.000Z",
    ...patch,
  };
}

const suppliers: Supplier[] = [
  { id: "sup-a", name: "מאפה פתוח", active: true, createdAt: "", updatedAt: "" },
  { id: "sup-b", name: "ספק שני", active: true, createdAt: "", updatedAt: "" },
  { id: "sup-last", name: "ספק אחרון", active: true, createdAt: "", updatedAt: "" },
];

describe("product source", () => {
  it("shows an invoice intake with the supplier product name and does not treat the card as the quantity", () => {
    const source = buildProductSource({
      product: product(),
      invoices: [invoice({ lines: [line({ matchKind: "new" })] })],
      movements: [movement()],
      suppliers,
    });
    expect(source.creation.kind).toBe("invoice");
    expect(source.creation.invoiceNumber).toBe("10275");
    expect(source.creation.supplierProductName).toBe("בריוש");
    expect(source.intakes).toHaveLength(1);
    expect(source.intakes[0]).toMatchObject({
      kind: "invoice",
      invoiceNumber: "10275",
      supplierProductName: "בריוש",
      supplierName: "מאפה פתוח",
      quantity: 40,
      unit: "unit",
      actor: "baker@mishkat.cafe",
    });
    expect(source.summary).toEqual({ code: "intake", intakeId: "mov-1", more: false });
  });

  it("shows a purchase file product without stock as created from import", () => {
    const source = buildProductSource({
      product: product(),
      invoices: [
        invoice({
          id: "file-1",
          invoiceNumber: "881",
          fileName: "רכש-ספטמבר.md",
          notes: "purchase-list-import",
          stockStatus: "none",
          lines: [line({ matchKind: "new", skipInventory: true, rawName: "קולה 24 פחיות", originalDescription: "קולה 24 פחיות" })],
          createdBy: "buyer@mishkat.cafe",
        }),
      ],
      movements: [],
      suppliers,
    });
    expect(source.creation.kind).toBe("purchase-file");
    expect(source.creation.fileName).toBe("רכש-ספטמבר.md");
    expect(source.creation.supplierProductName).toBe("קולה 24 פחיות");
    expect(source.intakes).toHaveLength(0);
    expect(source.summary.code).toBe("import-without-stock");
  });

  it("shows a manually created product without inventing a stock intake", () => {
    const source = buildProductSource({
      product: product({ originKind: "manual", supplier: "ספק אחרון", lastSupplierId: "sup-last" }),
      invoices: [],
      movements: [],
      suppliers,
    });
    expect(source.creation.kind).toBe("manual");
    expect(source.creation.supplierId).toBeUndefined();
    expect(source.intakes).toHaveLength(0);
    expect(source.summary.code).toBe("created-manual");
  });

  it("shows the latest intake beside all movements when suppliers differ", () => {
    const source = buildProductSource({
      product: product({ createdAt: "2026-09-01T08:00:00.000Z" }),
      invoices: [
        invoice({
          id: "inv-old",
          supplierId: "sup-a",
          invoiceNumber: "100",
          createdAt: "2026-09-02T08:00:00.000Z",
          lines: [line({ key: "old", matchKind: "exact", originalDescription: "שם ישן" })],
        }),
        invoice({
          id: "inv-new",
          supplierId: "sup-b",
          supplierName: "ספק שני",
          invoiceNumber: "200",
          createdAt: "2026-10-02T08:00:00.000Z",
          lines: [line({ key: "new", matchKind: "exact", originalDescription: "שם חדש" })],
        }),
      ],
      movements: [
        movement({
          id: "old-move",
          invoiceId: "inv-old",
          invoiceLineKey: "old",
          supplierId: "sup-a",
          quantity: 4,
          quantityBase: 4,
          receivedAt: "2026-09-02T09:00:00.000Z",
        }),
        movement({
          id: "new-move",
          invoiceId: "inv-new",
          invoiceLineKey: "new",
          supplierId: "sup-b",
          quantity: 9,
          quantityBase: 9,
          receivedAt: "2026-10-02T09:00:00.000Z",
        }),
      ],
      suppliers,
    });
    expect(source.creation.kind).toBe("undocumented");
    expect(source.intakes.map((row) => row.id)).toEqual(["new-move", "old-move"]);
    expect(source.intakes[0]).toMatchObject({ supplierName: "ספק שני", invoiceNumber: "200", supplierProductName: "שם חדש", quantity: 9 });
    expect(source.intakes[1]).toMatchObject({ supplierName: "מאפה פתוח", invoiceNumber: "100", supplierProductName: "שם ישן" });
    expect(source.summary).toEqual({ code: "intake", intakeId: "new-move", more: true });
    expect(productMatchesSupplier({ product: product(), supplierId: "sup-a", source, offers: [] })).toBe(true);
    expect(productMatchesSupplier({ product: product(), supplierId: "sup-b", source, offers: [] })).toBe(true);
    expect(productMatchesSourceKind(source, "invoice")).toBe(true);
    expect(productMatchesSourceKind(source, "undocumented")).toBe(false);
  });

  it("does not guess a source from the product name, the last supplier, or a price note", () => {
    const named = product({
      name: "בריוש",
      supplier: "ספק אחרון",
      lastSupplierId: "sup-last",
      notes: "שם אצל הספק: בריוש",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const source = buildProductSource({
      product: named,
      invoices: [
        invoice({
          lines: [line({ productId: "someone-else", rawName: "בריוש", originalDescription: "בריוש", matchKind: "new" })],
        }),
      ],
      movements: [],
      maps: [
        {
          id: "map-1",
          supplierId: "sup-last",
          supplierProductName: "בריוש אצל הספק",
          inventoryProductId: "prod-1",
          createdAt: "",
          updatedAt: "",
        } satisfies SupplierItemMap,
      ],
      suppliers,
    });
    expect(source.creation.kind).toBe("undocumented");
    expect(source.creation.supplierName).toBeUndefined();
    expect(source.intakes).toHaveLength(0);
    expect(source.summary.code).toBe("undocumented");
    expect(source.supplierProductNames).toEqual([
      { supplierId: "sup-last", supplierName: "ספק אחרון", name: "בריוש אצל הספק" },
    ]);
  });

  it("keeps a manual stock entry separate from an import that did not receive quantity", () => {
    const source = buildProductSource({
      product: product(),
      invoices: [
        invoice({
          notes: "purchase-list-import",
          fileName: "file.csv",
          stockStatus: "none",
          lines: [line({ matchKind: "new", skipInventory: true })],
        }),
      ],
      movements: [
        movement({
          id: "manual-1",
          type: "OPENING",
          invoiceId: undefined,
          supplierId: undefined,
          quantity: 2,
          quantityBase: 2,
          actor: "clerk@mishkat.cafe",
          receivedAt: "2026-10-18T08:00:00.000Z",
        }),
      ],
      suppliers,
    });
    expect(source.creation.kind).toBe("purchase-file");
    expect(source.intakes).toHaveLength(1);
    expect(source.intakes[0].kind).toBe("manual");
    expect(source.intakes[0].quantity).toBe(2);
    expect(source.summary).toEqual({ code: "intake", intakeId: "manual-1", more: false });
  });

  it("does not treat an older product as created by a later invoice just because the line says new", () => {
    const source = buildProductSource({
      product: product({ createdAt: "2026-01-01T00:00:00.000Z", name: "בריוש" }),
      invoices: [invoice({ lines: [line({ matchKind: "new", rawName: "בריוש" })], createdAt: "2026-10-13T09:00:05.000Z" })],
      movements: [],
      suppliers,
    });
    expect(source.creation.kind).toBe("undocumented");
    expect(source.intakes).toHaveLength(0);
  });

  it("ignores outgoing movements and a matched invoice that never posted stock", () => {
    const source = buildProductSource({
      product: product({ createdAt: "2026-01-01T00:00:00.000Z" }),
      invoices: [invoice({ lines: [line({ matchKind: "exact" })], stockStatus: "none" })],
      movements: [
        movement({ id: "out", type: "ISSUE_OUT", quantity: 3, quantityBase: 3, invoiceId: undefined }),
        movement({ id: "down", type: "ADJUSTMENT", quantity: 1, quantityBase: -1, invoiceId: undefined }),
      ],
      suppliers,
    });
    expect(source.creation.kind).toBe("undocumented");
    expect(source.intakes).toHaveLength(0);
    expect(productMatchesSourceKind(source, "undocumented")).toBe(true);
    expect(productMatchesSourceKind(source, "invoice")).toBe(false);
  });
});
