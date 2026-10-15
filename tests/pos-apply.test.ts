import { describe, expect, it } from "vitest";
import {
  canApplyPosPlan,
  classifyPosLine,
  computedUnitPrice,
  enrichSaleLine,
  matchPosIdentity,
  movementAlreadyWritten,
  planPosApply,
  posCreatedProductId,
  posMovementId,
  priceGap,
} from "@/lib/inventory/pos-apply";
import { excelMayAffectFinance, excelImportPayload } from "@/lib/inventory/pos-excel";
import type { DishRecipe } from "@/lib/costing/types";
import type { InventoryMovement, PosImport, PosSaleLine } from "@/lib/inventory/types";
import type { Product } from "@/types";

const hummus: Product = {
  id: "hummus",
  name_he: "חומוס",
  name_ar: "حمص",
  name_en: "Hummus",
  description_he: "",
  description_ar: "",
  description_en: "",
  categoryId: "cat",
  price: 28,
  cost: 8,
  profit: 20,
  businessType: "food",
  image: "",
  barcode: "7290001",
  isPopular: false,
  isNew: false,
  available: true,
  active: true,
  sortOrder: 1,
  createdAt: "",
  updatedAt: "",
};

const dish: Product = { ...hummus, id: "dish", name_he: "מנה", name_ar: "وجبة", name_en: "Dish", barcode: "" };

const recipe: DishRecipe = {
  id: "rec-dish",
  productId: "dish",
  ingredients: [{ ingredientId: "flour", quantity: 100, unit: "g" }],
  createdAt: "",
  updatedAt: "",
};

function line(partial: Partial<PosSaleLine> & Pick<PosSaleLine, "posName" | "quantity">): PosSaleLine {
  return {
    key: partial.key ?? `pos-${partial.posName}`,
    posCode: partial.posCode ?? "",
    posName: partial.posName,
    quantity: partial.quantity,
    matchKind: partial.matchKind ?? "none",
    reportedRevenue: partial.reportedRevenue ?? null,
    unitPrice: partial.unitPrice,
    sourceRow: partial.sourceRow ?? 7,
    menuProductId: partial.menuProductId,
  };
}

describe("POS unit price", () => {
  it("computes 50 from 30 units and 1500 without rounding the stored value", () => {
    expect(computedUnitPrice(1500, 30)).toBe(50);
    expect(computedUnitPrice(10, 3)).toBeCloseTo(10 / 3, 10);
    expect(computedUnitPrice(1500, 0)).toBeNull();
    expect(priceGap(48, 50)).toBe(2);
    expect(priceGap(50, 50)).toBe(0);
  });

  it("separates returns from sales and flags zero quantity", () => {
    expect(classifyPosLine({ posName: "חומוס", quantity: 30 })).toBe("sale");
    expect(classifyPosLine({ posName: "החזרה חומוס", quantity: 2 })).toBe("return");
    expect(classifyPosLine({ posName: "חומוס", quantity: -2 })).toBe("return");
    expect(enrichSaleLine(line({ posName: "חומוס", quantity: 0, reportedRevenue: 0 })).reviewReason).toBe("zero-quantity");
  });
});

describe("POS identity", () => {
  it("matches a saved map, a valid barcode, or an exact name, and does not auto-merge fuzzy names", () => {
    expect(matchPosIdentity({ posCode: "", posName: "חומוס", matchKind: "none" }, [hummus], []).identity).toBe("existing");
    expect(matchPosIdentity({ posCode: "7290001", posName: "אחר", matchKind: "none" }, [hummus], []).product?.id).toBe("hummus");
    expect(
      matchPosIdentity({ posCode: "x", posName: "x", matchKind: "none" }, [hummus], [{ id: "m", posCode: "x", posName: "x", menuProductId: "hummus" }]).identity
    ).toBe("existing");
    expect(matchPosIdentity({ posCode: "", posName: "מוצר חדש", matchKind: "none" }, [hummus], []).identity).toBe("new");
    const uncertain = matchPosIdentity({ posCode: "", posName: "חומ", matchKind: "none" }, [hummus], []);
    expect(uncertain.identity === "uncertain" || uncertain.identity === "new").toBe(true);
  });
});

describe("POS apply plan", () => {
  it("plans a new product at 0 stock to -30 and keeps finance off the excel payload", () => {
    const plan = planPosApply({
      lines: [line({ posName: "שתייה חדשה", quantity: 30, reportedRevenue: 1500, unitPrice: 50 })],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
    });
    expect(plan.rows[0]?.computedUnitPrice).toBe(50);
    expect(plan.rows[0]?.identity).toBe("new");
    expect(plan.rows[0]?.createProduct).toBe(true);
    expect(plan.rows[0]?.stockPath).toBe("finished-unit");
    expect(plan.rows[0]?.impacts[0]?.balanceBefore).toBe(0);
    expect(plan.rows[0]?.impacts[0]?.balanceAfter).toBe(-30);
    expect(plan.rows[0]?.impacts[0]?.goesNegative).toBe(true);
    expect(excelMayAffectFinance()).toBe(false);
    expect(excelImportPayload({ fileName: "a.xlsx", fileHash: "h", period: "2026-09", lines: plan.rows as never, reportedRevenueSum: 1500 }).financeStatus).toBe("none");
  });

  it("deducts recipe ingredients once and does not also deduct the finished dish", () => {
    const plan = planPosApply({
      lines: [line({ posName: "מנה", quantity: 30, reportedRevenue: 1500, menuProductId: "dish", matchKind: "exact" })],
      products: [dish],
      maps: [],
      recipes: [recipe],
      ingredients: [{ id: "flour", name: "קמח", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "kg", baseUnit: "g", costPerBaseUnit: 0.001, active: true, createdAt: "", updatedAt: "" }],
      movements: [],
      imports: [],
    });
    expect(plan.rows[0]?.stockPath).toBe("recipe");
    expect(plan.rows[0]?.impacts).toHaveLength(1);
    expect(plan.rows[0]?.impacts[0]?.productId).toBe("flour");
    expect(plan.rows[0]?.impacts[0]?.quantityBase).toBe(3000);
    expect(plan.rows[0]?.impacts.some((item) => item.productId === "dish")).toBe(false);
  });

  it("does not treat a zero proposed price as an automatic overwrite", () => {
    const plan = planPosApply({
      lines: [line({ posName: "חומוס", quantity: 2, reportedRevenue: 0, menuProductId: "hummus", matchKind: "exact" })],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
    });
    expect(plan.rows[0]?.proposedPrice).toBe(0);
    expect(plan.rows[0]?.updatePrice).toBe(false);
  });

  it("blocks a 1970 period and a second apply of the same file, and allows resume of a partial apply", () => {
    const sale = line({ posName: "חומוס", quantity: 2, reportedRevenue: 56, menuProductId: "hummus", matchKind: "exact" });
    const blocked = planPosApply({
      lines: [sale],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
      periodNeedsReview: true,
    });
    expect(canApplyPosPlan(blocked).ok).toBe(false);
    expect(canApplyPosPlan(blocked).ok === false && canApplyPosPlan(blocked).reason).toBe("period-review");
    const stillEpoch = planPosApply({
      lines: [sale],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
      periodNeedsReview: true,
      periodConfirmed: true,
      periodFrom: "1970-01-01",
      periodTo: "1970-01-31",
    });
    expect(canApplyPosPlan(stillEpoch).ok).toBe(false);
    const corrected = planPosApply({
      lines: [sale],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
      periodNeedsReview: true,
      periodConfirmed: true,
      periodFrom: "2026-10-01",
      periodTo: "2026-10-31",
      decisions: { [sale.key]: { proposedPrice: 28, updatePrice: true } },
    });
    expect(canApplyPosPlan(corrected).ok).toBe(true);
    expect(corrected.rows[0]?.proposedPrice).toBe(28);
    expect(corrected.rows[0]?.updatePrice).toBe(true);
    const posted: PosImport = {
      id: "imp-1",
      fileName: "a.xlsx",
      fileHash: "abc",
      source: "pos-file",
      period: "2026-09",
      status: "approved",
      inventoryStatus: "posted",
      lines: [],
      createdAt: "",
    };
    const again = planPosApply({
      lines: [sale],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [posted],
      fileHash: "abc",
    });
    expect(again.alreadyApplied).toBe(true);
    expect(canApplyPosPlan(again).ok).toBe(false);
    const partial = planPosApply({
      lines: [sale],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [{ ...posted, inventoryStatus: "partial" }],
      fileHash: "abc",
    });
    expect(partial.resumePartial).toBe(true);
  });

  it("excludes nameless and summary rows from create counts", () => {
    const plan = planPosApply({
      lines: [
        line({ posName: "חומוס", quantity: 2, reportedRevenue: 56 }),
        { ...line({ posName: "", quantity: 1, reportedRevenue: 10 }), reviewReason: "missing-source-name" },
        line({ posName: "סה״כ פריטים", quantity: 3, reportedRevenue: 66 }),
      ],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
      sourceItemCount: 1,
    });
    expect(plan.eligibleCount).toBe(1);
    expect(plan.excludedCount).toBe(2);
    expect(plan.itemCountGap).toBe(0);
  });

  it("manual exclude and restore change selected totals without rewriting source totals", () => {
    const hummusLine = line({ key: "keep", posName: "חומוס", quantity: 10, reportedRevenue: 280 });
    const extra = line({ key: "drop", posName: "שתייה", quantity: 5, reportedRevenue: 50 });
    const source = { sourceItemCount: 2, sourceQuantitySum: 15, sourceRevenueSum: 330 };
    const removed = planPosApply({
      lines: [hummusLine, extra],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
      excludedKeys: ["drop"],
      ...source,
    });
    expect(removed.selectedItemCount).toBe(1);
    expect(removed.selectedQuantitySum).toBe(10);
    expect(removed.selectedRevenueSum).toBe(280);
    expect(removed.sourceItemCount).toBe(2);
    expect(removed.sourceQuantitySum).toBe(15);
    expect(removed.manualExcludedCount).toBe(1);
    expect(removed.rows.find((row) => row.key === "drop")?.eligible).toBe(false);
    const restored = planPosApply({
      lines: [hummusLine, extra],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [],
      imports: [],
      excludedKeys: [],
      ...source,
    });
    expect(restored.selectedItemCount).toBe(2);
    expect(restored.sourceItemCount).toBe(2);
    expect(restored.selectedQuantitySum).toBe(15);
  });

  it("treats an unmatched similar name as a new product and does not block on cafe orders or negative stock", () => {
    const orderMove: InventoryMovement = {
      id: "ord-1",
      productId: "hummus",
      type: "SALE_OUT",
      quantity: 1,
      unit: "unit",
      quantityBase: 1,
      orderId: "order-9",
      receivedAt: "",
      createdAt: "",
    };
    const plan = planPosApply({
      lines: [
        line({ posName: "חומוס", quantity: 5, reportedRevenue: 140, menuProductId: "hummus", matchKind: "exact" }),
        line({ key: "new-drink", posName: "שתייה חדשה", quantity: 3, reportedRevenue: 36 }),
        line({ key: "fuzzy", posName: "חומ", quantity: 1, reportedRevenue: 10 }),
      ],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [orderMove],
      imports: [],
    });
    const created = plan.rows.find((row) => row.key === "new-drink");
    const fuzzy = plan.rows.find((row) => row.key === "fuzzy");
    expect(created?.identity).toBe("new");
    expect(created?.createProduct).toBe(true);
    expect(fuzzy?.identity).toBe("new");
    expect(fuzzy?.createProduct).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(canApplyPosPlan(plan).ok).toBe(true);
    expect(plan.rows[0]?.impacts[0]?.goesNegative).toBe(true);
  });

  it("only asks for overlap review when another posted POS excel already deducted the same stock", () => {
    const other: PosImport = {
      id: "imp-old",
      fileName: "old.xlsx",
      fileHash: "other",
      source: "pos-file",
      period: "2026-08",
      status: "approved",
      inventoryStatus: "posted",
      lines: [],
      createdAt: "",
    };
    const move: InventoryMovement = {
      id: "posm_imp-old_7_hummus",
      productId: "hummus",
      type: "SALE_OUT",
      quantity: 2,
      unit: "unit",
      quantityBase: 2,
      posImportId: "imp-old",
      receivedAt: "",
      createdAt: "",
    };
    const blocked = planPosApply({
      lines: [line({ posName: "חומוס", quantity: 2, reportedRevenue: 56, menuProductId: "hummus", matchKind: "exact" })],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [move],
      imports: [other],
      fileHash: "new-file",
    });
    expect(blocked.blockers).toContain("overlap-review");
    expect(canApplyPosPlan(blocked).ok).toBe(false);
    const allowed = planPosApply({
      lines: [line({ posName: "חומוס", quantity: 2, reportedRevenue: 56, menuProductId: "hummus", matchKind: "exact" })],
      products: [hummus],
      maps: [],
      recipes: [],
      movements: [move],
      imports: [other],
      fileHash: "new-file",
      overlapAcknowledged: true,
    });
    expect(canApplyPosPlan(allowed).ok).toBe(true);
  });

  it("reuses movement ids so a retry cannot deduct twice", () => {
    const importId = "imp-9";
    const movementId = posMovementId(importId, 7, "hummus");
    const existing: InventoryMovement = {
      id: movementId,
      productId: "hummus",
      type: "SALE_OUT",
      quantity: 30,
      unit: "unit",
      quantityBase: 30,
      posImportId: importId,
      posSourceRow: 7,
      receivedAt: "",
      createdAt: "",
    };
    expect(movementAlreadyWritten([existing], importId, 7, "hummus")).toBe(true);
    expect(posCreatedProductId(importId, "pos-שתייה") === posCreatedProductId(importId, "pos-שתייה")).toBe(true);
  });
});
