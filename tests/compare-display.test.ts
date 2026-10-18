import { describe, expect, it } from "vitest";
import type { PurchasePriceRecord } from "@/lib/inventory/types";
import type { MaterialCompareRow } from "@/lib/inventory/material-group";
import {
  compareFormulaParts,
  compareHistoryLines,
  formatCompareAmount,
  formatCompareQuantity,
  packPriceOnBasis,
  savedVatParts,
  sortCompareRows,
  unitPriceOnBasis,
} from "@/lib/inventory/compare-display";

const pastry: PurchasePriceRecord = {
  id: "rec-1",
  productId: "pastry",
  supplierId: "brioche",
  invoiceId: "inv-1",
  purchaseDate: "2026-10-13",
  quantity: 40,
  packageQuantity: 40,
  unit: "unit",
  priceBeforeVat: 244.8,
  vatAmount: 44.06,
  priceIncludingVat: 288.86,
  lineTotalNet: 244.8,
  lineTotalVat: 44.06,
  lineTotalGross: 288.86,
  vatType: "exclusive",
  vatRate: 0.18,
  unitCost: 6.12,
  source: "PURCHASE_INVOICE",
  createdAt: "2026-10-13",
};

function row(partial: Partial<MaterialCompareRow> & Pick<MaterialCompareRow, "ingredientId" | "displayUnitCost" | "comparable">): MaterialCompareRow {
  return {
    ingredientName: partial.ingredientId,
    supplierId: "s",
    supplierName: "s",
    supplierProductName: partial.ingredientId,
    packQuantity: 1,
    packUnit: "unit",
    buyPrice: 1,
    unitCost: partial.displayUnitCost,
    displayUnit: "unit",
    vatBasis: "net",
    currency: "ILS",
    source: "purchase",
    complete: partial.comparable,
    cheapest: false,
    gapAmount: null,
    gapPercent: null,
    reason: null,
    savingsVsLine: null,
    ...partial,
  };
}

describe("compare display", () => {
  it("formats money without extra decimals and keeps small unit costs", () => {
    expect(formatCompareAmount(244.8)).toBe("244.80");
    expect(formatCompareAmount(6.12)).toBe("6.12");
    expect(formatCompareAmount(7.2215)).toBe("7.22");
    expect(formatCompareAmount(0.0345)).toBe("0.0345");
    expect(formatCompareQuantity(40)).toBe("40");
  });

  it("shows the stored 40-unit purchase as 244.80 ÷ 40 = 6.12 before VAT", () => {
    const original = { ...pastry };
    const parts = savedVatParts(pastry);
    expect(parts).toEqual({ net: 244.8, vat: 44.06, gross: 288.86, differenceIsStoredVat: true });
    expect(packPriceOnBasis(pastry, "net")).toBe(244.8);
    expect(packPriceOnBasis(pastry, "gross")).toBe(288.86);
    expect(unitPriceOnBasis(244.8, 40, "unit").unitPrice).toBeCloseTo(6.12);
    expect(unitPriceOnBasis(288.86, 40, "unit").unitPrice).toBeCloseTo(7.2215);
    expect(
      compareFormulaParts({ buyPrice: 244.8, packQuantity: 40, displayUnitCost: 6.12, displayUnit: "unit" })
    ).toEqual({ pack: "244.80", quantity: "40", unitPrice: "6.12", displayUnit: "unit" });
    expect(pastry).toEqual(original);
  });

  it("does not label a mismatched pair as VAT", () => {
    expect(savedVatParts({ priceBeforeVat: 100, vatAmount: 10, priceIncludingVat: 130 }).differenceIsStoredVat).toBe(false);
    expect(savedVatParts({ priceBeforeVat: 100, vatAmount: 10, priceIncludingVat: 110 }).differenceIsStoredVat).toBe(true);
  });

  it("keeps history on the selected VAT basis", () => {
    const net = compareHistoryLines([pastry], "pastry", "brioche", "net")[0];
    const gross = compareHistoryLines([pastry], "pastry", "brioche", "gross")[0];
    expect(net?.packPrice).toBe(244.8);
    expect(net?.unitPrice).toBeCloseTo(6.12);
    expect(gross?.packPrice).toBe(288.86);
    expect(net?.packPrice).not.toBe(gross?.packPrice);
    const missingNet = { ...pastry, priceBeforeVat: Number.NaN, lineTotalNet: undefined };
    expect(packPriceOnBasis(missingNet, "net")).toBeNull();
    expect(compareHistoryLines([missingNet], "pastry", "brioche", "net")[0]?.packPrice).toBeNull();
  });

  it("sorts by base-unit price and leaves a single comparable row uncrowned", () => {
    const rows = sortCompareRows([
      row({ ingredientId: "b", displayUnitCost: 8, comparable: true }),
      row({ ingredientId: "missing", displayUnitCost: null, comparable: false, supplierProductName: "missing" }),
      row({ ingredientId: "a", displayUnitCost: 6.12, comparable: true }),
    ]);
    expect(rows.map((item) => item.ingredientId)).toEqual(["a", "b", "missing"]);
    const alone = sortCompareRows([row({ ingredientId: "only", displayUnitCost: 6.12, comparable: false, cheapest: false })]);
    expect(alone[0]?.cheapest).toBe(false);
  });

  it("does not compare a unit pack with a kilogram pack", () => {
    const units = unitPriceOnBasis(244.8, 40, "unit");
    const kilos = unitPriceOnBasis(50, 2, "kg");
    expect(units.displayUnit).toBe("unit");
    expect(kilos.displayUnit).toBe("kg");
    expect(units.displayUnit).not.toBe(kilos.displayUnit);
  });
});
