import { describe, expect, it } from "vitest";
import { splitVat, foodCostAmount, normalizeVatRate } from "@/lib/inventory/vat";
import {
  cheapestOffer,
  currentStockBase,
  latestPurchase,
  unitCostFromPackage,
} from "@/lib/inventory/stock";
import { posDelta, posPeriod, theoreticalConsumption } from "@/lib/inventory/pos";
import { hashPosFile } from "@/lib/inventory/pos-parse";
import { draftInvoiceLines } from "@/lib/inventory/invoice-match";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { InventoryMovement, PosSaleLine, PurchasePriceRecord, SupplierOffer } from "@/lib/inventory/types";

const coffee: CostingIngredient = {
  id: "coffee",
  name: "קפה עלית",
  purchasePrice: 70,
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.07,
  active: true,
  createdAt: "",
  updatedAt: "",
};

describe("VAT", () => {
  it("splits inclusive, exclusive, and exempt per line", () => {
    const inc = splitVat({ amount: 118, vatType: "inclusive", vatRate: 0.18 });
    expect(inc.priceBeforeVat).toBeCloseTo(100, 1);
    expect(inc.priceIncludingVat).toBe(118);
    const exc = splitVat({ amount: 100, vatType: "exclusive", vatRate: 0.18 });
    expect(exc.priceIncludingVat).toBeCloseTo(118, 1);
    const free = splitVat({ amount: 50, vatType: "exempt", vatRate: 0.18 });
    expect(free.vatAmount).toBe(0);
    expect(normalizeVatRate(18)).toBeCloseTo(0.18);
  });

  it("keeps food-cost VAT mode explicit", () => {
    expect(foodCostAmount(100, 118, "before")).toBe(100);
    expect(foodCostAmount(100, 118, "including")).toBe(118);
  });
});

describe("multi-supplier unit cost", () => {
  it("compares 5kg/300 vs 2kg/126 as unit cost", () => {
    const a = unitCostFromPackage(300, 5, "kg");
    const b = unitCostFromPackage(126, 2, "kg");
    expect(a).toBeCloseTo(0.06, 5);
    expect(b).toBeCloseTo(0.063, 5);
    const cheap = cheapestOffer([
      { id: "a", productId: "coffee", supplierId: "A", lastUnitCost: a, createdAt: "", updatedAt: "" },
      { id: "b", productId: "coffee", supplierId: "B", lastUnitCost: b, createdAt: "", updatedAt: "" },
    ] as SupplierOffer[]);
    expect(cheap?.supplierId).toBe("A");
  });

  it("keeps purchase price history instead of overwrite-only", () => {
    const records: PurchasePriceRecord[] = [
      { id: "1", productId: "coffee", purchaseDate: "2026-10-01", quantity: 1, packageQuantity: 1, unit: "kg", priceBeforeVat: 72, vatAmount: 0, priceIncludingVat: 72, vatType: "inclusive", vatRate: 0.18, unitCost: 0.072, createdAt: "2026-10-01" },
      { id: "2", productId: "coffee", purchaseDate: "2026-10-06", quantity: 1, packageQuantity: 1, unit: "kg", priceBeforeVat: 68, vatAmount: 0, priceIncludingVat: 68, vatType: "inclusive", vatRate: 0.18, unitCost: 0.068, createdAt: "2026-10-06" },
    ];
    expect(latestPurchase(records, "coffee")?.unitCost).toBeCloseTo(0.068);
  });
});

describe("inventory ledger", () => {
  it("current stock comes from signed movements", () => {
    const movements: InventoryMovement[] = [
      { id: "1", productId: "coffee", type: "PURCHASE_IN", quantity: 5, unit: "kg", quantityBase: 5000, receivedAt: "2026-10-06", createdAt: "a" },
      { id: "2", productId: "coffee", type: "SALE_OUT", quantity: 180, unit: "g", quantityBase: -180, receivedAt: "2026-10-07", createdAt: "b" },
    ];
    expect(currentStockBase(movements, "coffee")).toBe(4820);
  });
});

describe("POS import", () => {
  it("computes theoretical consumption from the same inventory product", () => {
    const recipes: DishRecipe[] = [
      {
        id: "r1",
        productId: "dish",
        ingredients: [{ ingredientId: "coffee", quantity: 18, unit: "g" }],
        createdAt: "",
        updatedAt: "",
      },
    ];
    const lines: PosSaleLine[] = [
      { key: "1", posCode: "X", posName: "קפה בדיקה מנה", quantity: 10, menuProductId: "dish", matchKind: "exact" },
    ];
    expect(theoreticalConsumption(lines, recipes)[0]).toMatchObject({ productId: "coffee", quantityBase: 180 });
  });

  it("hashes the same file the same way and blocks duplicates", () => {
    const a = hashPosFile(Buffer.from("abc"), "pos.xlsx");
    const b = hashPosFile(Buffer.from("abc"), "pos.xlsx");
    const c = hashPosFile(Buffer.from("abd"), "pos.xlsx");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("computes period delta only", () => {
    const prev: PosSaleLine[] = [
      { key: "1", posCode: "A", posName: "dish", quantity: 10, saleDate: "2026-10-06", matchKind: "exact" },
    ];
    const next: PosSaleLine[] = [
      { key: "1", posCode: "A", posName: "dish", quantity: 12, saleDate: "2026-10-06", matchKind: "exact" },
      { key: "2", posCode: "B", posName: "new", quantity: 1, saleDate: "2026-10-06", matchKind: "none" },
    ];
    expect(posPeriod(next)).toBe("2026-10-06");
    expect(posDelta(prev, next)).toEqual({ added: 1, changed: 1, removed: 0, unchanged: 0 });
  });
});

describe("invoice review matching", () => {
  it("matches extracted names to the single inventory product id", () => {
    const lines = draftInvoiceLines([{ name: "קפה עלית", quantity: 5, unit: "kg", lineTotal: 350 }], [coffee]);
    expect(lines[0]?.productId).toBe("coffee");
    expect(lines[0]?.matchKind).toBe("exact");
  });
});
