import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  amountOnVatBasis,
  computeBreakEven,
  foodCostFromSales,
  monthlyEquivalent,
  productContribution,
  salesInRange,
  simulateBreakEven,
  snapshotChange,
  snapshotFromResult,
} from "@/lib/breakeven/compute";
import type { BreakEvenFixedCost, BreakEvenVariableCost } from "@/lib/breakeven/types";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { Order } from "@/types";

function fixed(amount: number, extras: Partial<BreakEvenFixedCost> = {}): BreakEvenFixedCost {
  return {
    id: extras.id ?? "f1",
    name: extras.name ?? "rent",
    amount,
    frequency: extras.frequency ?? "monthly",
    vatMode: extras.vatMode ?? "exempt",
    active: extras.active ?? true,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...extras,
  };
}

function variable(
  amount: number,
  kind: BreakEvenVariableCost["kind"],
  extras: Partial<BreakEvenVariableCost> = {}
): BreakEvenVariableCost {
  return {
    id: extras.id ?? "v1",
    name: extras.name ?? "var",
    kind,
    amount,
    vatMode: extras.vatMode ?? "exempt",
    active: extras.active ?? true,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...extras,
  };
}

function order(total: number, extras: Partial<Order> = {}): Order {
  return {
    id: extras.id ?? `o-${total}`,
    orderNumber: "1",
    customerId: "c",
    customerName: "c",
    status: extras.status ?? "delivered",
    items: extras.items ?? [{ productId: "croissant", productName: "קרואסון", quantity: 1, price: total }],
    total,
    paymentStatus: extras.paymentStatus ?? "paid",
    createdAt: extras.createdAt ?? "2026-10-05T10:00:00.000Z",
    paidAt: extras.paidAt ?? extras.createdAt ?? "2026-10-05T10:00:00.000Z",
    ...extras,
  };
}

const flour: CostingIngredient = {
  id: "flour",
  name: "קמח",
  purchasePrice: 11.2,
  purchaseQuantity: 1,
  purchaseUnit: "unit",
  baseUnit: "unit",
  costPerBaseUnit: 11.2,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const croissantRecipe: DishRecipe = {
  id: "r1",
  productId: "croissant",
  ingredients: [{ ingredientId: "flour", quantity: 1, unit: "unit" }],
  overheadSettings: { packaging: 1, creditCardPercent: 2 },
  createdAt: "",
  updatedAt: "",
};

describe("fixed costs", () => {
  it("converts yearly insurance ₪12,000 to ₪1,000 / month", () => {
    expect(monthlyEquivalent(12000, "yearly", 26)).toBeCloseTo(1000, 10);
  });

  it("converts daily and weekly using operating days, not always /30", () => {
    expect(monthlyEquivalent(100, "daily", 26)).toBeCloseTo(2600, 10);
    expect(monthlyEquivalent(700, "weekly", 26)).toBeCloseTo((700 * 52) / 12, 8);
  });
});

describe("VAT basis", () => {
  it("converts inclusive to before without inventing a rate when exempt", () => {
    expect(amountOnVatBasis(1180, "including", "before", 0.18)).toBeCloseTo(1000, 6);
    expect(amountOnVatBasis(1000, "exempt", "before", 0.18)).toBe(1000);
    expect(amountOnVatBasis(1000, "before", "before", 0.18)).toBe(1000);
  });

  it("does not double-convert the same basis", () => {
    expect(amountOnVatBasis(1180, "including", "including", 0.18)).toBe(1180);
  });
});

describe("monthly break-even", () => {
  it("uses Fixed / CM ratio from real revenue and variable costs", () => {
    const orders = Array.from({ length: 20 }, (_, i) => order(5000, { id: `o${i}`, createdAt: "2026-10-03T08:00:00.000Z" }));
    const result = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "including", vatRate: 0.18, alertGap: 500 },
      fixed: [fixed(30000)],
      variable: [variable(40000, "fixed")],
      orders,
      recipes: [],
      ingredients: [],
      from: "2026-10-01",
      to: "2026-10-31",
      now: new Date("2026-10-11T12:00:00"),
    });
    expect(result.revenue).toBe(100000);
    expect(result.variableTotal).toBe(40000);
    expect(result.contribution).toBe(60000);
    expect(result.contributionRatio).toBeCloseTo(0.6, 8);
    expect(result.breakEvenMonthly).toBeCloseTo(50000, 6);
    expect(result.canCompute).toBe(true);
  });
});

describe("daily break-even and orders required", () => {
  it("divides by operating days, not 30, and uses AOV", () => {
    const orders = Array.from({ length: 20 }, (_, i) => order(2600, { id: `o${i}`, createdAt: "2026-10-02T08:00:00.000Z" }));
    const result = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "including", vatRate: 0.18, alertGap: 500 },
      fixed: [fixed(31200)],
      variable: [variable(20800, "fixed")],
      orders,
      recipes: [],
      ingredients: [],
      from: "2026-10-01",
      to: "2026-10-31",
      now: new Date("2026-10-11T12:00:00"),
    });
    expect(result.breakEvenMonthly).toBeCloseTo(52000, 4);
    expect(result.breakEvenDaily).toBeCloseTo(2000, 4);
    expect(result.averageOrderValue).toBe(2600);
    expect(result.ordersRequiredDaily).toBeCloseTo(2000 / 2600, 6);
  });

  it("needs 40 orders when daily BE is 2000 and AOV is 50", () => {
    const orders = Array.from({ length: 40 }, (_, i) =>
      order(50, { id: `o${i}`, createdAt: `2026-10-${String((i % 10) + 1).padStart(2, "0")}T08:00:00.000Z` })
    );
    const result = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "including", vatRate: 0.18, alertGap: 500 },
      fixed: [fixed(31200)],
      variable: [variable(0.4, "percent")],
      orders,
      recipes: [],
      ingredients: [],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(result.averageOrderValue).toBe(50);
    expect(result.breakEvenDaily).toBeCloseTo(2000, 4);
    expect(result.ordersRequiredDaily).toBeCloseTo(40, 4);
  });
});

describe("recipe and purchase cost connection", () => {
  it("uses recipe ingredient cost from purchase unit cost, not a manual food-cost field", () => {
    const sale = order(39, {
      items: [{ productId: "croissant", productName: "קרואסון", quantity: 1, price: 39 }],
    });
    expect(foodCostFromSales([sale], [croissantRecipe], [flour])).toBeCloseTo(11.2, 8);
    const cm = productContribution("croissant", "קרואסון בוטה", 39, [croissantRecipe], [flour]);
    expect(cm?.foodCost).toBeCloseTo(11.2, 8);
    expect(cm?.extraVariable).toBeCloseTo(1 + 39 * 0.02, 8);
    expect(cm?.contribution).toBeCloseTo(39 - 11.2 - 1 - 0.78, 6);
    expect(cm?.contributionRatio).toBeCloseTo(26.02 / 39, 6);
  });
});

describe("real sales connection", () => {
  it("ignores cancelled and test orders", () => {
    const sales = salesInRange(
      [
        order(50, { id: "ok", createdAt: "2026-10-04T10:00:00.000Z" }),
        order(80, { id: "c", status: "cancelled", createdAt: "2026-10-04T11:00:00.000Z" }),
        order(20, { id: "t", isTestOrder: true, createdAt: "2026-10-04T12:00:00.000Z" }),
      ],
      "2026-10-01",
      "2026-10-31"
    );
    expect(sales.revenue).toBe(50);
    expect(sales.orders).toBe(1);
  });
});

describe("missing data", () => {
  it("does not invent a break-even number when data is missing", () => {
    const empty = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "before", vatRate: 0.18, alertGap: 500 },
      fixed: [],
      variable: [],
      orders: [],
      recipes: [],
      ingredients: [],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(empty.canCompute).toBe(false);
    expect(empty.breakEvenMonthly).toBeNull();
    expect(empty.missing).toEqual(expect.arrayContaining(["fixed", "variable", "sales"]));
  });
});

describe("forecast and required from now", () => {
  it("projects remaining operating days from current pace", () => {
    const orders = Array.from({ length: 11 }, (_, i) =>
      order(2200, { id: `d${i}`, createdAt: `2026-10-${String(i + 1).padStart(2, "0")}T09:00:00.000Z` })
    );
    const result = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "including", vatRate: 0.18, alertGap: 500 },
      fixed: [fixed(31200)],
      variable: [variable(0.4, "percent")],
      orders,
      recipes: [],
      ingredients: [],
      from: "2026-10-01",
      to: "2026-10-31",
      now: new Date("2026-10-11T18:00:00"),
    });
    expect(result.elapsedDays).toBe(11);
    expect(result.remainingDays).toBe(15);
    expect(result.dailyAverage).toBeCloseTo(2200, 6);
    expect(result.forecast).toBeCloseTo(57200, 4);
    expect(result.breakEvenMonthly).toBeCloseTo(52000, 4);
    expect(result.forecastGap).toBeGreaterThan(0);
  });
});

describe("simulator", () => {
  it("changes the computed break-even without mutating the base result", () => {
    const orders = [order(100000, { createdAt: "2026-10-02T08:00:00.000Z" })];
    const base = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "including", vatRate: 0.18, alertGap: 500 },
      fixed: [fixed(30000)],
      variable: [variable(40000, "fixed")],
      orders,
      recipes: [],
      ingredients: [],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    const sim = simulateBreakEven(base, { rent: 6000, operatingDays: 20 });
    expect(base.breakEvenMonthly).toBeCloseTo(50000, 4);
    expect(sim.fixedMonthly).toBeCloseTo(36000, 4);
    expect(sim.operatingDays).toBe(20);
    expect(sim.breakEvenMonthly).not.toBe(base.breakEvenMonthly);
  });
});

describe("history", () => {
  it("stores a month snapshot and measures change", () => {
    const result = computeBreakEven({
      settings: { operatingDays: 26, vatBasis: "including", vatRate: 0.18, alertGap: 500 },
      fixed: [fixed(30000)],
      variable: [variable(40000, "fixed")],
      orders: [order(100000, { createdAt: "2026-10-02T08:00:00.000Z" })],
      recipes: [],
      ingredients: [],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    const snap = snapshotFromResult("2026-10", result);
    expect(snap.breakEvenRevenue).toBeCloseTo(50000, 4);
    expect(snapshotChange(52000, 48200)).toBeCloseTo((52000 - 48200) / 48200, 8);
  });
});

describe("i18n and wiring", () => {
  it("has HE / AR / EN labels", () => {
    expect(ADMIN_TRANSLATIONS.he["admin.breakeven.title"]).toBe("נקודת איזון");
    expect(ADMIN_TRANSLATIONS.ar["admin.breakeven.title"]).toBe("نقطة التعادل");
    expect(ADMIN_TRANSLATIONS.en["admin.breakeven.title"]).toBe("Break-Even");
    expect(ADMIN_TRANSLATIONS.he["admin.breakeven.cannot"]).toBeTruthy();
    expect(ADMIN_TRANSLATIONS.ar["admin.breakeven.cannot"]).toBeTruthy();
    expect(ADMIN_TRANSLATIONS.en["admin.breakeven.cannot"]).toBeTruthy();
  });

  it("adds the finance tab, dashboard widget, and PDF report type", () => {
    const costing = readFileSync(resolve("src/features/admin/costing/costing-admin.tsx"), "utf8");
    const dash = readFileSync(resolve("src/features/admin/admin-dashboard.tsx"), "utf8");
    const types = readFileSync(resolve("src/lib/reports/types.ts"), "utf8");
    expect(costing).toContain("breakeven");
    expect(costing).toContain("BreakEvenPanel");
    expect(costing).toContain("productContribution");
    expect(dash).toContain("BreakEvenDashboardWidget");
    expect(types).toContain('"breakeven"');
  });
});
