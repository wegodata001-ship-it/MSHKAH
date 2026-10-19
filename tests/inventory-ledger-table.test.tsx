import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CostingIngredient } from "@/lib/costing/types";
import { InventoryLedgerTable } from "@/features/admin/inventory/inventory-ledger-table";
import { InvoiceLinesReview } from "@/features/admin/inventory/invoice-lines-review";
import type { InventoryMovement, PurchaseInvoice, PurchaseInvoiceLine, Supplier } from "@/lib/inventory/types";

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  return {
    useT: () => (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? fallback ?? key,
  };
});

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
    createdAt: "",
    updatedAt: "",
  };
}

function line(patch: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return {
    key: "line-kg",
    rawName: "חלב מלא",
    originalDescription: "חלב מלא",
    productId: "prod-milk",
    quantity: 17.91,
    unit: "kg",
    unitPrice: 8,
    discount: null,
    lineTotal: 1,
    vatType: "exclusive",
    vatRate: 0.18,
    priceBeforeVat: 1,
    vatAmount: 0,
    priceIncludingVat: 1,
    ...patch,
  };
}

function invoice(): PurchaseInvoice {
  return {
    id: "inv-saved",
    supplierId: "sup-a",
    supplierName: "מחלבות הגליל",
    invoiceNumber: "4412",
    invoiceDate: "2026-10-15",
    receivedAt: "2026-10-18",
    status: "saved",
    lines: [line()],
    sourceFile: {
      storagePath: "invoice-files/inv-saved/original.pdf",
      downloadUrl: "https://files.example/inv-saved.pdf",
      originalFilename: "invoice-4412.pdf",
      mimeType: "application/pdf",
      size: 10,
      uploadedAt: "2026-10-18T08:00:00.000Z",
      kind: "pdf",
    },
    createdAt: "2026-10-18T08:00:00.000Z",
  };
}

const suppliers: Supplier[] = [
  { id: "sup-a", name: "מחלבות הגליל", active: true, createdAt: "", updatedAt: "" },
  { id: "sup-b", name: "ספק אחר", active: true, createdAt: "", updatedAt: "" },
];

function movements(): InventoryMovement[] {
  return [
    {
      id: "mov-open",
      productId: "prod-milk",
      type: "OPENING",
      quantity: 1,
      unit: "kg",
      quantityBase: 1000,
      note: "יתרת מחסן",
      receivedAt: "2026-10-01",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "mov-1791",
      productId: "prod-milk",
      type: "PURCHASE_IN",
      quantity: 17.91,
      unit: "kg",
      quantityBase: 17910,
      supplierId: "sup-a",
      invoiceId: "inv-saved",
      invoiceLineId: "line-kg",
      receivedAt: "2026-10-18",
      createdAt: "2026-10-18T00:00:00.000Z",
    },
    {
      id: "mov-orphan",
      productId: "prod-milk",
      type: "PURCHASE_IN",
      quantity: 2,
      unit: "kg",
      quantityBase: 2000,
      supplierId: "sup-b",
      receivedAt: "2026-10-19",
      createdAt: "2026-10-19T00:00:00.000Z",
    },
  ];
}

describe("inventory ledger table", () => {
  it("opens the saved invoice line from the movement and keeps the full balance", () => {
    const onOpenInvoice = vi.fn();
    render(
      <InventoryLedgerTable
        product={product()}
        movements={movements()}
        invoices={[invoice()]}
        suppliers={suppliers}
        onOpenInvoice={onOpenInvoice}
      />
    );

    expect(screen.getByText("תאריך תנועה")).toBeTruthy();
    expect(screen.getByText("מספר חשבונית")).toBeTruthy();
    expect(screen.getByText("תאריך חשבונית")).toBeTruthy();
    expect(screen.getByText("שם המוצר בחשבונית")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "צפייה במקור" })).toBeTruthy();
    expect(screen.getByText("חשבונית מקור לא מקושרת")).toBeTruthy();
    expect(screen.getByText("יתרת פתיחה · יתרת מחסן")).toBeTruthy();

    const receipt = document.querySelector("[data-ledger-row='mov-1791']");
    expect(receipt?.textContent).toContain("2026-10-18");
    expect(receipt?.textContent).toContain("2026-10-15");
    expect(receipt?.textContent).toContain("חלב מלא");
    expect(receipt?.textContent).toContain("+17.91");
    expect(receipt?.getAttribute("data-balance")).toBe("18910");

    fireEvent.click(screen.getByRole("button", { name: "4412" }));
    expect(onOpenInvoice).toHaveBeenCalledWith("inv-saved", "line-kg");

    fireEvent.click(screen.getByRole("button", { name: "צפייה במקור" }));
    expect(onOpenInvoice).toHaveBeenLastCalledWith("inv-saved", "line-kg");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sup-b" } });
    expect(document.querySelector("[data-ledger-row='mov-1791']")).toBeNull();
    expect(document.querySelector("[data-ledger-row='mov-orphan']")?.getAttribute("data-balance")).toBe("20910");
    expect(document.querySelectorAll("[data-ledger-row]")).toHaveLength(1);
  });

  it("highlights the invoice line that the movement points to", () => {
    render(
      <InvoiceLinesReview
        lines={[line(), line({ key: "other", originalDescription: "שורה אחרת", quantity: 1 })]}
        ingredients={[]}
        vatRate={0.18}
        highlightKey="line-kg"
        onChangeLines={() => undefined}
        onUpdateLine={() => undefined}
      />
    );
    const highlighted = document.querySelector("[data-invoice-line='line-kg']");
    expect(highlighted?.className).toMatch(/amber/);
    expect(highlighted?.textContent).toContain("חלב מלא");
  });
});
