import { describe, expect, it } from "vitest";
import { correctInvoiceLineName, editInvoiceLineName } from "@/lib/inventory/invoice-line-review";
import { finalizeInvoiceLine, emptyInvoiceLine } from "@/lib/inventory/invoice-lines";
import { labeledPurchaseUnitPrice, offerNormalizedNet } from "@/lib/inventory/stock";
import { deriveLineUnitPrices, storedPurchaseUnitPrices } from "@/lib/inventory/unit-price";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

describe("unit prices", () => {
  it("keeps baking powder at 2.54 ex VAT and 3.00 inc VAT for two units", () => {
    const prices = deriveLineUnitPrices({
      quantity: 2,
      vatRate: 18,
      taxMode: "including",
      lineTotalIncludingVat: 6,
    });
    expect(prices.unitPriceIncludingVat).toBe(3);
    expect(prices.unitPriceExcludingVat).toBe(2.54);
    expect(prices.lineTotalIncludingVat).toBe(6);
    expect(prices.lineTotalExcludingVat).toBe(5.08);

    const stored = storedPurchaseUnitPrices({
      quantity: 2,
      priceBeforeVat: 2.54,
      priceIncludingVat: 3,
      vatRate: 0.18,
    });
    expect(stored.unitExcludingVat).toBe(2.54);
    expect(stored.unitIncludingVat).toBe(3);
    expect(stored.dividedTwice).toBe(true);
    expect(labeledPurchaseUnitPrice({
      unit: "unit",
      quantity: 2,
      packageQuantity: 2,
      priceBeforeVat: 2.54,
      priceIncludingVat: 3,
      vatAmount: 0.46,
      vatType: "inclusive",
      vatRate: 0.18,
      unitCost: 1.5,
    })).toMatchObject({ amount: 2.54, amountIncludingVat: 3, unit: "unit" });
  });

  it("does not divide a unit price that was stored in the line-total field", () => {
    const line = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      rawName: "אבקת אפיה",
      quantity: 2,
      unit: "unit",
      unitPrice: 3,
      lineGross: 3,
      priceIncludingVat: 3,
      vatType: "inclusive",
    }, 0.18);
    expect(line.unitPriceGross).toBe(3);
    expect(line.unitPriceNet).toBe(2.54);
    expect(line.grossAmount).toBe(6);
  });

  it("builds a line from a unit price that excludes VAT", () => {
    const prices = deriveLineUnitPrices({
      quantity: 4,
      vatRate: 18,
      taxMode: "excluding",
      unitPriceExcludingVat: 8,
    });
    expect(prices.lineTotalExcludingVat).toBe(32);
    expect(prices.lineTotalIncludingVat).toBe(37.76);
  });

  it("keeps an exempt price unchanged", () => {
    const prices = deriveLineUnitPrices({
      quantity: 2,
      vatRate: 0,
      taxMode: "exempt",
      unitPriceIncludingVat: 10,
    });
    expect(prices.unitPriceExcludingVat).toBe(10);
    expect(prices.unitPriceIncludingVat).toBe(10);
  });

  it("keeps a real line total when it is not the unit price", () => {
    const line = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      rawName: "שורה",
      quantity: 2,
      unit: "kg",
      unitPrice: 100,
      lineGross: 150,
      vatType: "exclusive",
    }, 0.18);
    expect(line.grossAmount).toBe(150);
    expect(line.unitPriceGross).toBe(75);
  });
});

describe("invoice line names", () => {
  it("corrects the invoice name and keeps the scanned name without renaming inventory", () => {
    const line = {
      ...emptyInvoiceLine(0.18),
      rawName: "אבקת אפיה",
      originalDescription: "אבקת אפיה",
      productId: "bake",
      inventoryProductName: "אבקת אפיה 10 יח",
    } as PurchaseInvoiceLine;
    const patch = editInvoiceLineName(line, "אבקת אפייה");
    expect(patch.rawName).toBe("אבקת אפייה");
    expect(patch.originalScannedName).toBe("אבקת אפיה");
    expect(patch.correctedInvoiceName).toBe("אבקת אפייה");
    expect(patch.productId).toBeUndefined();
    expect(patch.inventoryProductName).toBeUndefined();
  });

  it("keeps the scanned name and the inventory product unless the inventory update is chosen", () => {
    const line = {
      ...emptyInvoiceLine(0.18),
      key: "line-1",
      rawName: "אבקת אפיה",
      originalDescription: "אבקת אפיה",
      productId: "bake",
      quantity: 2,
      unitPrice: 3,
      priceBeforeVat: 5.08,
      priceIncludingVat: 6,
    } as PurchaseInvoiceLine;
    const invoice = { id: "inv", lines: [line], audit: [] } as unknown as Parameters<typeof correctInvoiceLineName>[0];
    const invoiceOnly = correctInvoiceLineName(invoice, { lineKey: "line-1", name: "אבקת אפייה", at: "2026-10-23T00:00:00.000Z" });
    expect(invoiceOnly.ok).toBe(true);
    if (!invoiceOnly.ok) return;
    expect(invoiceOnly.productId).toBeUndefined();
    expect(invoiceOnly.invoice.lines[0]?.rawName).toBe("אבקת אפייה");
    expect(invoiceOnly.invoice.lines[0]?.originalScannedName).toBe("אבקת אפיה");
    expect(invoiceOnly.invoice.lines[0]?.productId).toBe("bake");
    expect(invoiceOnly.invoice.lines[0]?.inventoryProductName).toBeUndefined();
    expect(invoiceOnly.invoice.lines[0]?.priceIncludingVat).toBe(6);
    expect(invoiceOnly.invoice.lines[0]?.nameHistory?.[0]?.scope).toBe("invoice");

    const withInventory = correctInvoiceLineName(invoice, {
      lineKey: "line-1",
      name: "אבקת אפייה",
      at: "2026-10-23T00:00:00.000Z",
      updateInventory: true,
    });
    expect(withInventory.ok && withInventory.productId).toBe("bake");
    if (!withInventory.ok) return;
    expect(withInventory.invoice.lines[0]?.inventoryProductName).toBe("אבקת אפייה");
    expect(withInventory.invoice.lines[0]?.priceBeforeVat).toBe(5.08);
  });
});

describe("saved purchase display", () => {
  it("divides a stored line total once and keeps an explicit unit price", () => {
    const stored = storedPurchaseUnitPrices({
      quantity: 5,
      priceBeforeVat: 25,
      priceIncludingVat: 29.5,
      lineTotalNet: 25,
      lineTotalGross: 29.5,
      unitPriceNet: 5,
      vatRate: 0.18,
    });
    expect(stored.unitExcludingVat).toBe(5);
    const invoiced = storedPurchaseUnitPrices({
      quantity: 4,
      priceBeforeVat: 120,
      priceIncludingVat: 141.6,
      lineTotalNet: 120,
      lineTotalGross: 141.6,
      unitPriceNet: 30,
      unitPriceGross: 35.4,
      vatRate: null,
    });
    expect(invoiced.unitExcludingVat).toBe(30);
    expect(invoiced.unitIncludingVat).toBe(35.4);
    expect(offerNormalizedNet({
      id: "offer",
      productId: "bake",
      supplierId: "supplier",
      lastUnitPriceNet: 2.54,
      lastPriceBeforeVat: 2.54,
      lastPackageQuantity: 2,
      lastUnit: "unit",
      createdAt: "",
      updatedAt: "",
    })).toBe(2.54);
  });

  it("keeps finalized prices after a save and reload", () => {
    const line = finalizeInvoiceLine({
      ...emptyInvoiceLine(0.18),
      rawName: "אבקת אפיה",
      quantity: 2,
      unit: "unit",
      unitPrice: 3,
      lineGross: 6,
      priceIncludingVat: 6,
      vatType: "inclusive",
    }, 0.18);
    const reloaded = JSON.parse(JSON.stringify(line)) as typeof line;
    expect(reloaded.unitPriceGross).toBe(3);
    expect(reloaded.unitPriceNet).toBe(2.54);
    expect(reloaded.grossAmount).toBe(6);
    expect(reloaded.quantity).toBe(2);
    expect(reloaded.vatRate).toBe(0.18);
  });
});
