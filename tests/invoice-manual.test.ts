import { describe, expect, it } from "vitest";
import { normalizeCategoryName } from "@/lib/inventory/category-name";
import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { costPerBaseFromPack, pendingCategorySuggestions, SUGGESTED_INGREDIENT_CATEGORIES } from "@/lib/inventory/pack-cost";
import { baseUnitFor, purchaseQuantityInBase, unitsCompatible } from "@/lib/costing/units";
import { lineMoneyUnchanged, withLineUnit } from "@/lib/inventory/invoice-line-unit";

describe("invoice manual entry", () => {
  it("treats spaced and accented category names as the same category", () => {
    expect(normalizeCategoryName("מוצרי   חלב")).toBe(normalizeCategoryName("מוצרי חלב"));
    expect(normalizeCategoryName("Milk")).toBe(normalizeCategoryName("  MILK "));
  });

  it("keeps suggested categories out of the catalog until the admin adds one", () => {
    expect(SUGGESTED_INGREDIENT_CATEGORIES).toHaveLength(13);
    const pending = pendingCategorySuggestions(["מוצרי חלב"], normalizeCategoryName);
    expect(pending).not.toContain("מוצרי חלב");
    expect(pending).toContain("ירקות ופירות");
    expect(pending).toHaveLength(12);
  });

  it("prices a carton of 12 one-liter bottles in milliliters", () => {
    const result = costPerBaseFromPack({
      lineTotal: 60,
      quantity: 1,
      contentCount: 12,
      contentUnit: "liter",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.base).toBe("ml");
    expect(result.factor).toBe(12000);
    expect(result.cost).toBeCloseTo(0.005);
  });

  it("does not treat kilograms as grams or liters as milliliters", () => {
    const weight = costPerBaseFromPack({ lineTotal: 40, quantity: 2, contentCount: 1, contentUnit: "kg" });
    const volume = costPerBaseFromPack({ lineTotal: 10, quantity: 1, contentCount: 1, contentUnit: "liter" });
    expect(weight.ok && weight.factor).toBe(1000);
    expect(volume.ok && volume.factor).toBe(1000);
    expect(costPerBaseFromPack({
      lineTotal: 10,
      quantity: 1,
      contentCount: 12,
      contentUnit: "liter",
      expectedBase: "g",
    }).ok).toBe(false);
  });

  it("counts one bucket as one bucket and does not turn it into kilograms", () => {
    expect(baseUnitFor("bucket")).toBe("unit");
    expect(purchaseQuantityInBase(1, "bucket")).toBe(1);
    expect(unitsCompatible("bucket", "kg")).toBe(false);
    const before = { key: "line-2", rawName: "אבקת קרם פטיסייר", quantity: 1, unit: "unit" as const, unitPrice: 168, lineTotal: 168, vatRate: 0.18, vatType: "exclusive" as const, priceBeforeVat: null, vatAmount: null, priceIncludingVat: null };
    const next = withLineUnit([before], "line-2", "bucket");
    expect(next?.[0].unit).toBe("bucket");
    expect(lineMoneyUnchanged(before, next![0])).toBe(true);
  });

  it("keeps an unconverted carton as cartons and applies a confirmed conversion once", () => {
    expect(invoiceLineQuantityBase({ quantity: 2, unit: "carton", conversionFactor: null })).toBe(2);
    expect(invoiceLineQuantityBase({ quantity: 2, unit: "bucket", conversionFactor: 10 })).toBe(2);
    expect(invoiceLineQuantityBase({ quantity: 1, unit: "carton", conversionFactor: 12000 })).toBe(12000);
    expect(invoiceLineQuantityBase({ quantity: 12.7, unit: "unit", conversionFactor: 10 })).toBe(12.7);
  });
});
