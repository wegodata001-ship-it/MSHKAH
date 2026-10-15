import { describe, expect, it } from "vitest";
import type { CostingIngredient } from "@/lib/costing/types";
import {
  assignmentCreatesNoStock,
  assignmentKeepsSourceAmounts,
  buildGroupCompareRows,
  cheapestGroupRow,
  compareUsesPurchaseOnly,
  latestPurchaseForSupplier,
  packFieldsConflict,
  posSalePriceIsNotBuyPrice,
  reconcileSupplierItemMap,
  rememberedCompareGroup,
  rememberedMap,
  shouldUpdateLastPurchase,
  suggestMaterialGroup,
  toDisplayUnitCost,
  unitsComparableForGroup,
} from "@/lib/inventory/material-group";
import { matchInventoryProduct } from "@/lib/inventory/invoice-smart-match";
import type { PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";

const nutella: CostingIngredient = {
  id: "nutella",
  name: "נוטלה",
  purchasePrice: 90,
  purchaseQuantity: 3,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.03,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const cola: CostingIngredient = {
  id: "cola",
  name: "קולה",
  purchasePrice: 48,
  purchaseQuantity: 24,
  purchaseUnit: "unit",
  baseUnit: "unit",
  costPerBaseUnit: 2,
  compareGroupId: "grp-cola",
  compareGroupName: "משקאות קולה",
  active: true,
  createdAt: "",
  updatedAt: "",
};

const colaZero: CostingIngredient = {
  id: "cola-zero",
  name: "קולה זירו",
  purchasePrice: 50,
  purchaseQuantity: 24,
  purchaseUnit: "unit",
  baseUnit: "unit",
  costPerBaseUnit: 2.1,
  compareGroupId: "grp-cola",
  compareGroupName: "משקאות קולה",
  active: true,
  createdAt: "",
  updatedAt: "",
};

const alsunbola: Supplier = { id: "s1", name: "אלסונבולה שיווק מוצרי מזון בע״מ", active: true, createdAt: "", updatedAt: "" };
const brioche: Supplier = { id: "s2", name: "בריוש", active: true, createdAt: "", updatedAt: "" };

const mapAlsunbola: SupplierItemMap = {
  id: "m1",
  supplierId: "s1",
  supplierProductName: "נוטלה דלי 3 ק״ג",
  supplierSku: "NUT-3",
  inventoryProductId: "nutella",
  purchaseUnit: "kg",
  packageQuantity: 3,
  conversion: 3,
  createdAt: "",
  updatedAt: "",
};

function offer(partial: Partial<SupplierOffer> & Pick<SupplierOffer, "id" | "productId" | "supplierId">): SupplierOffer {
  return {
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("material group suggestions", () => {
  it("suggests a similar material for a different supplier name and does not auto-unify", () => {
    const suggestion = suggestMaterialGroup({
      line: { name: "نوتيلا 3 كغ", matchKind: "new" },
      ingredients: [nutella],
      maps: [mapAlsunbola],
      suppliers: [alsunbola, brioche],
      supplierId: "s2",
    });
    expect(suggestion.show).toBe(true);
    expect(suggestion.autoFill).toBeUndefined();
    expect(suggestion.candidates.some((item) => item.id === "nutella")).toBe(true);
  });

  it("remembers the approved supplier name and fills the next invoice", () => {
    const maps: SupplierItemMap[] = [
      mapAlsunbola,
      {
        ...mapAlsunbola,
        id: "m2",
        supplierId: "s2",
        supplierProductName: "نوتيلا 3 كغ",
        supplierSku: "BRI-NUT",
      },
    ];
    expect(rememberedMap(maps, "s2", { name: "نوتيلا 3 كغ" })?.inventoryProductId).toBe("nutella");
    const match = matchInventoryProduct({ name: "نوتيلا 3 كغ" }, [nutella], maps, "s2");
    expect(match.kind).toBe("mapped");
    expect(match.item?.id).toBe("nutella");
    const suggestion = suggestMaterialGroup({
      line: { name: "نوتيلا 3 كغ", matchKind: "mapped", matchConfirmed: true, productId: "nutella" },
      ingredients: [nutella],
      maps,
      supplierId: "s2",
    });
    expect(suggestion.autoFill?.ingredientId).toBe("nutella");
    expect(suggestion.show).toBe(false);
  });

  it("keeps the link when only the price changes", () => {
    const next = reconcileSupplierItemMap(mapAlsunbola, {
      supplierId: "s1",
      supplierProductName: "נוטלה דלי 3 ק״ג",
      supplierSku: "NUT-3",
      inventoryProductId: "nutella",
      purchaseUnit: "kg",
      packageQuantity: 3,
      conversion: 3,
    });
    expect(next.keepLink).toBe(true);
    expect(next.packConflict).toBe(false);
    expect(next.next.inventoryProductId).toBe("nutella");
  });

  it("flags a pack change for review without breaking the assignment", () => {
    expect(packFieldsConflict(mapAlsunbola, { unit: "unit", conversion: 1, packageQuantity: 1 })).toBe(true);
    const next = reconcileSupplierItemMap(mapAlsunbola, {
      supplierId: "s1",
      supplierProductName: "נוטלה דלי 3 ק״ג",
      inventoryProductId: "nutella",
      purchaseUnit: "unit",
      packageQuantity: 1,
      conversion: 1,
    });
    expect(next.keepLink).toBe(true);
    expect(next.packConflict).toBe(true);
    expect(next.next.purchaseUnit).toBe("kg");
    expect(next.next.conversion).toBe(3);
    const match = matchInventoryProduct({ name: "נוטלה דלי 3 ק״ג", unit: "unit", conversionFactor: 1 }, [nutella], [mapAlsunbola], "s1");
    expect(match.kind).toBe("mapped");
    expect(match.packConflict).toBe(true);
  });
});

describe("cheapest comparable purchase price", () => {
  it("marks the cheapest price per base unit and does not compare carton to unit", () => {
    const offers = [
      offer({
        id: "o1",
        productId: "nutella",
        supplierId: "s1",
        priceBeforeVat: 90,
        priceIncludingVat: 106.2,
        vatType: "exclusive",
        packageQuantity: 3,
        purchaseUnit: "kg",
        lastPurchaseDate: "2026-09-03",
        lastPriceBeforeVat: 90,
      }),
      offer({
        id: "o2",
        productId: "nutella",
        supplierId: "s2",
        priceBeforeVat: 80,
        priceIncludingVat: 94.4,
        vatType: "exclusive",
        packageQuantity: 3,
        purchaseUnit: "kg",
        lastPurchaseDate: "2026-09-18",
        lastPriceBeforeVat: 80,
      }),
      offer({
        id: "o3",
        productId: "nutella",
        supplierId: "s2",
        currentPrice: 25,
        vatType: "exclusive",
        packageQuantity: 1,
        purchaseUnit: "unit",
        lastPurchaseDate: "2026-09-18",
      }),
    ];
    const rows = buildGroupCompareRows({
      ingredientIds: ["nutella"],
      ingredients: [nutella],
      suppliers: [alsunbola, brioche],
      offers,
      maps: [mapAlsunbola],
      lineUnitCost: 0.03,
      lineVatBasis: "net",
    });
    const cheap = cheapestGroupRow(rows);
    expect(cheap?.supplierId).toBe("s2");
    expect(cheap?.purchaseDate).toBe("2026-09-18");
    expect(rows.find((row) => row.packUnit === "unit")?.comparable).toBe(false);
    expect(unitsComparableForGroup("kg", "unit", "g")).toBe(false);
  });

  it("does not change invoice amounts or create stock when assigning a group", () => {
    const line = { unitPrice: 52, lineNet: 104, lineGross: 122.72, quantity: 2, rawName: "נוטלה דלי 3 ק״ג" };
    const assigned = assignmentKeepsSourceAmounts(line, "nutella");
    expect(assigned.productId).toBe("nutella");
    expect(assigned.unitPrice).toBe(52);
    expect(assigned.lineNet).toBe(104);
    expect(assigned.rawName).toBe("נוטלה דלי 3 ק״ג");
    expect(assignmentCreatesNoStock("same")).toEqual({ stockDelta: 0, sourceUnchanged: true });
    expect(posSalePriceIsNotBuyPrice()).toBe(true);
    expect(compareUsesPurchaseOnly("purchase")).toBe(true);
    expect(compareUsesPurchaseOnly("pos-sale")).toBe(false);
  });

  it("keeps comparison-group members as separate materials", () => {
    const rows = buildGroupCompareRows({
      ingredientIds: ["cola", "cola-zero"],
      ingredients: [cola, colaZero],
      suppliers: [alsunbola, brioche],
      offers: [
        offer({
          id: "c1",
          productId: "cola",
          supplierId: "s1",
          priceIncludingVat: 48,
          vatType: "inclusive",
          packageQuantity: 24,
          purchaseUnit: "unit",
          lastPurchaseDate: "2026-09-10",
        }),
        offer({
          id: "c2",
          productId: "cola-zero",
          supplierId: "s2",
          priceIncludingVat: 50,
          vatType: "inclusive",
          packageQuantity: 24,
          purchaseUnit: "unit",
          lastPurchaseDate: "2026-09-10",
        }),
      ],
    });
    expect(new Set(rows.map((row) => row.ingredientId)).size).toBe(2);
    expect(cheapestGroupRow(rows)?.ingredientId).toBe("cola");
  });
});

const labanehA: CostingIngredient = {
  id: "labaneh-25",
  name: "לבנה 25",
  purchasePrice: 50,
  purchaseQuantity: 2,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.025,
  compareGroupId: "grp-labaneh",
  compareGroupName: "לבנה",
  active: true,
  createdAt: "",
  updatedAt: "",
};

const labanehB: CostingIngredient = {
  id: "labaneh-asli",
  name: "לבנה אסלית",
  purchasePrice: 60,
  purchaseQuantity: 2,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.03,
  compareGroupId: "grp-labaneh",
  compareGroupName: "לבנה",
  active: true,
  createdAt: "",
  updatedAt: "",
};

function record(partial: Partial<PurchasePriceRecord> & Pick<PurchasePriceRecord, "id" | "productId" | "supplierId" | "purchaseDate" | "priceIncludingVat">): PurchasePriceRecord {
  return {
    quantity: 2,
    packageQuantity: 2,
    unit: "kg",
    priceBeforeVat: partial.priceBeforeVat ?? partial.priceIncludingVat,
    vatAmount: 0,
    vatType: "inclusive",
    vatRate: 0.18,
    unitCost: (partial.priceIncludingVat ?? 0) / 2000,
    source: "PURCHASE_INVOICE",
    createdAt: partial.createdAt ?? "2026-10-15",
    ...partial,
  };
}

describe("user-defined comparison groups", () => {
  it("compares two suppliers with different names on the same kg basis", () => {
    const rows = buildGroupCompareRows({
      ingredientIds: ["labaneh-25", "labaneh-asli"],
      ingredients: [labanehA, labanehB],
      suppliers: [alsunbola, brioche],
      offers: [
        offer({
          id: "la",
          productId: "labaneh-25",
          supplierId: "s1",
          lastPurchaseDate: "2026-10-01",
          lastPriceIncludingVat: 50,
          lastPackageQuantity: 2,
          lastUnit: "kg",
          purchaseUnit: "kg",
          packageQuantity: 2,
          vatType: "inclusive",
        }),
        offer({
          id: "lb",
          productId: "labaneh-asli",
          supplierId: "s2",
          lastPurchaseDate: "2026-10-02",
          lastPriceIncludingVat: 60,
          lastPackageQuantity: 2,
          lastUnit: "kg",
          purchaseUnit: "kg",
          packageQuantity: 2,
          vatType: "inclusive",
        }),
      ],
      maps: [
        { ...mapAlsunbola, id: "ml1", inventoryProductId: "labaneh-25", supplierProductName: "לבנה 25", compareGroupId: "grp-labaneh" },
        { ...mapAlsunbola, id: "ml2", supplierId: "s2", inventoryProductId: "labaneh-asli", supplierProductName: "לבנה אסלית", compareGroupId: "grp-labaneh" },
      ],
      lineVatBasis: "gross",
    });
    const cheap = cheapestGroupRow(rows);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.supplierProductName))).toEqual(new Set(["לבנה 25", "לבנה אסלית"]));
    expect(toDisplayUnitCost(50 / 2000, "g")).toBeCloseTo(25);
    expect(cheap?.supplierProductName).toBe("לבנה 25");
    expect(cheap?.displayUnitCost).toBeCloseTo(25);
    expect(rows.find((row) => row.supplierId === "s2")?.gapAmount).toBeCloseTo(5);
    expect(rows.find((row) => row.supplierId === "s2")?.gapPercent).toBeCloseTo(20);
    expect(labanehA.id).not.toBe(labanehB.id);
  });

  it("remembers the approved supplier name and compare group on the next invoice", () => {
    const maps: SupplierItemMap[] = [
      {
        ...mapAlsunbola,
        id: "ml1",
        inventoryProductId: "labaneh-25",
        supplierProductName: "לבנה 25",
        supplierSku: "LAB-25",
        compareGroupId: "grp-labaneh",
        compareGroupName: "לבנה",
      },
    ];
    expect(rememberedMap(maps, "s1", { name: "לבנה 25", sku: "LAB-25" })?.inventoryProductId).toBe("labaneh-25");
    expect(rememberedCompareGroup(maps, [labanehA, labanehB], "s1", { name: "לבנה 25" })?.name).toBe("לבנה");
    const suggestion = suggestMaterialGroup({
      line: { name: "לבנה 25", sku: "LAB-25", matchKind: "mapped", matchConfirmed: true, productId: "labaneh-25" },
      ingredients: [labanehA, labanehB],
      maps,
      supplierId: "s1",
    });
    expect(suggestion.autoFill?.ingredientId).toBe("labaneh-25");
    expect(suggestion.groups.some((group) => group.id === "grp-labaneh")).toBe(true);
  });

  it("keeps the last purchase by invoice date when an older invoice is scanned later", () => {
    const newer = record({
      id: "r-new",
      productId: "labaneh-25",
      supplierId: "s1",
      purchaseDate: "2026-10-10",
      priceIncludingVat: 52,
      createdAt: "2026-10-10",
    });
    const older = record({
      id: "r-old",
      productId: "labaneh-25",
      supplierId: "s1",
      purchaseDate: "2026-09-01",
      priceIncludingVat: 40,
      createdAt: "2026-10-15",
    });
    expect(shouldUpdateLastPurchase("2026-10-10", "2026-09-01")).toBe(false);
    expect(shouldUpdateLastPurchase("2026-09-01", "2026-10-10")).toBe(true);
    expect(latestPurchaseForSupplier([older, newer], "labaneh-25", "s1")?.id).toBe("r-new");
    const rows = buildGroupCompareRows({
      ingredientIds: ["labaneh-25"],
      ingredients: [labanehA],
      suppliers: [alsunbola],
      offers: [
        offer({
          id: "la",
          productId: "labaneh-25",
          supplierId: "s1",
          lastPurchaseDate: "2026-10-10",
          lastPriceIncludingVat: 52,
          lastPackageQuantity: 2,
          lastUnit: "kg",
          vatType: "inclusive",
        }),
      ],
      records: [older, newer],
      lineVatBasis: "gross",
    });
    expect(rows[0]?.buyPrice).toBeCloseTo(52);
    expect(rows[0]?.purchaseDate).toBe("2026-10-10");
  });

  it("does not pick a missing pack as cheapest", () => {
    const rows = buildGroupCompareRows({
      ingredientIds: ["labaneh-25", "labaneh-asli"],
      ingredients: [labanehA, labanehB],
      suppliers: [alsunbola, brioche],
      offers: [
        offer({
          id: "la",
          productId: "labaneh-25",
          supplierId: "s1",
          lastPurchaseDate: "2026-10-01",
          lastPriceIncludingVat: 10,
          vatType: "inclusive",
        }),
        offer({
          id: "lb",
          productId: "labaneh-asli",
          supplierId: "s2",
          lastPurchaseDate: "2026-10-02",
          lastPriceIncludingVat: 60,
          lastPackageQuantity: 2,
          lastUnit: "kg",
          purchaseUnit: "kg",
          packageQuantity: 2,
          vatType: "inclusive",
        }),
      ],
      lineVatBasis: "gross",
    });
    const incomplete = rows.find((row) => row.ingredientId === "labaneh-25");
    expect(incomplete?.complete).toBe(false);
    expect(incomplete?.comparable).toBe(false);
    expect(incomplete?.reason).toBe("missing-pack");
    expect(incomplete?.cheapest).toBe(false);
    expect(cheapestGroupRow(rows)?.ingredientId).toBe("labaneh-asli");
  });
});
