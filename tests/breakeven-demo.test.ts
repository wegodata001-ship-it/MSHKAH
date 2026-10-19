import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBreakEven, localIsoDate, monthBounds } from "@/lib/breakeven/compute";
import { buildBreakEvenDemo, type BreakEvenDemoScenario } from "@/lib/breakeven/demo";

function resultFor(scenario: BreakEvenDemoScenario) {
  const demo = buildBreakEvenDemo(scenario, "he");
  const result = computeBreakEven({
    settings: demo.settings,
    fixed: demo.fixed,
    variable: demo.variable,
    orders: demo.orders,
    recipes: [],
    ingredients: [],
    products: demo.products,
    costLinks: demo.links,
    from: demo.from,
    to: demo.to,
    now: demo.now,
  });
  return { demo, result };
}

describe("break-even calendar month", () => {
  it("keeps October on the 1st through the 31st in local time", () => {
    const now = new Date(2026, 9, 19, 1, 30, 0);
    const bounds = monthBounds(now);
    const first = new Date(2026, 9, 1);
    expect(bounds).toEqual({ from: "2026-10-01", to: "2026-10-31", key: "2026-10" });
    expect(bounds.from).toBe(localIsoDate(first));
    const utc = first.toISOString().slice(0, 10);
    if (utc !== localIsoDate(first)) expect(bounds.from).not.toBe(utc);
  });
});

describe("break-even demo", () => {
  it("computes the below-target example through the existing engine", () => {
    const { demo, result } = resultFor("below");
    const sales = demo.dishes.reduce((sum, dish) => sum + dish.price * dish.quantity, 0);
    const variable = demo.dishes.reduce((sum, dish) => sum + dish.unitCost * dish.quantity, 0);
    expect(sales).toBe(28000);
    expect(variable).toBeCloseTo(11200, 4);
    expect(demo.fixed.reduce((sum, item) => sum + item.amount, 0)).toBe(24000);
    expect(result.canCompute).toBe(true);
    expect(result.fixedMonthly).toBeCloseTo(24000, 4);
    expect(result.revenue).toBeCloseTo(28000, 4);
    expect(result.variableTotal).toBeCloseTo(11200, 4);
    expect(result.contributionRatio).toBeCloseTo(0.6, 4);
    expect(result.breakEvenMonthly).toBeCloseTo(40000, 4);
    expect(result.gap).toBeCloseTo(12000, 4);
    expect(result.progress).toBeCloseTo(0.7, 4);
    expect(result.operatingDays).toBe(26);
    expect(result.elapsedDays).toBe(16);
    expect(result.remainingDays).toBe(10);
    expect(result.breakEvenDaily).toBeCloseTo(1538.46, 2);
    expect(result.requiredDailyFromNow).toBeCloseTo(1200, 2);
    expect(result.achieved).toBe(false);
    expect(result.daily[0]?.date).toBe("2026-10-01");
    expect(result.daily.at(-1)?.date).toBe("2026-10-31");
    expect(result.daily).toHaveLength(31);
    expect(result.daily.at(-1)?.cumulative).toBeCloseTo(28000, 4);
    expect(demo.orders.every((order) => order.id.startsWith("demo-order-"))).toBe(true);
  });

  it("recalculates at and above break-even without treating the sales surplus as profit", () => {
    const even = resultFor("even").result;
    expect(even.revenue).toBeCloseTo(40000, 4);
    expect(even.variableTotal).toBeCloseTo(16000, 4);
    expect(even.breakEvenMonthly).toBeCloseTo(40000, 4);
    expect(even.gap).toBeCloseTo(0, 4);
    expect(even.progress).toBeCloseTo(1, 4);
    expect(even.aboveBreakEven).toBeCloseTo(0, 4);

    const above = resultFor("above").result;
    expect(above.revenue).toBeCloseTo(48000, 4);
    expect(above.variableTotal).toBeCloseTo(19200, 4);
    expect(above.gap).toBeCloseTo(-8000, 4);
    expect(above.aboveBreakEven).toBeCloseTo(8000, 4);
    const profitAfterFixed = (above.contribution ?? 0) - (above.fixedMonthly ?? 0);
    expect(profitAfterFixed).toBeCloseTo(4800, 2);
    expect(above.aboveBreakEven).not.toBeCloseTo(profitAfterFixed, 0);
  });

  it("keeps the demo builder away from saved finance data", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/breakeven/demo.ts"), "utf8");
    expect(source.includes("firebase")).toBe(false);
    expect(source.includes("saveBreakEven")).toBe(false);
    expect(source.includes("cashFlow")).toBe(false);
    const panel = readFileSync(resolve(process.cwd(), "src/features/admin/breakeven/breakeven-panel.tsx"), "utf8");
    expect(panel.includes("if (demo)")).toBe(true);
  });
});
