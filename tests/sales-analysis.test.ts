import { describe, expect, it } from "vitest";
import { recognizedIsoDate, suggestPeriodFromFileName } from "@/lib/inventory/pos-parse";
import { extractPosPeriod } from "@/lib/inventory/pos-parse";
import {
  adviseFromFacts,
  analyzeSalesLines,
  classifyReportedCost,
  rankRecommendations,
  simulateDiscount,
  simulatePriceChange,
} from "@/lib/inventory/sales-analysis";
import type { PosSaleLine } from "@/lib/inventory/types";

function line(overrides: Partial<PosSaleLine>): PosSaleLine {
  return {
    key: "latte",
    posCode: "1",
    posName: "קפה הפוך",
    quantity: 49,
    unitPrice: 45,
    reportedRevenue: 2205,
    posCost: 40,
    posProfit: 245,
    matchKind: "exact",
    menuProductId: "p1",
    ...overrides,
  };
}

describe("file name period suggestion", () => {
  it("suggests a range from the file name and never accepts 1970", () => {
    expect(suggestPeriodFromFileName("sales_2026-10-01_2026-10-31.xlsx")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(suggestPeriodFromFileName("report-1970-01-01.xlsx")).toBeNull();
  });
});

describe("discount simulation", () => {
  it("warns when a discount loses money and states how many units hold the profit", () => {
    const safe = simulateDiscount({ currentPrice: 120, discountPercent: 10, quantity: 36, verifiedUnitCost: 40 });
    expect(safe.discountedPrice).toBe(108);
    expect(safe.unitProfitAfter).toBe(68);
    expect(safe.losesMoney).toBe(false);
    expect(safe.quantityToHoldProfit).toBeGreaterThan(36);
    const loss = simulateDiscount({ currentPrice: 50, discountPercent: 30, quantity: 10, verifiedUnitCost: 40 });
    expect(loss.losesMoney).toBe(true);
    expect(loss.quantityToHoldProfit).toBeNull();
  });

  it("ranks high severity first and keeps five", () => {
    const ranked = rankRecommendations([
      { id: "b", severity: "low" as const },
      { id: "a", severity: "high" as const },
      { id: "c", severity: "medium" as const },
      { id: "d", severity: "high" as const },
      { id: "e", severity: "low" as const },
      { id: "f", severity: "medium" as const },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["a", "d", "c", "f", "b"]);
  });
});

describe("recognized dates", () => {
  it("rejects the epoch placeholder instead of treating it as a sales date", () => {
    expect(recognizedIsoDate("1970-01-01")).toBeNull();
    expect(recognizedIsoDate("2026-10-01")).toBe("2026-10-01");
  });

  it("does not invent a period when the only date is 1970", () => {
    const period = extractPosPeriod(["תקופה 01/01/1970 - 31/01/1970"]);
    expect(period.periodFrom).toBeNull();
    expect(period.periodNeedsReview).toBe(true);
  });
});

describe("sales figures", () => {
  it("treats ₪40 as a unit cost when 49 × 40 explains the reported profit", () => {
    expect(classifyReportedCost({
      quantity: 49,
      revenue: 2205,
      reportedCost: 40,
      reportedProfit: 245,
    })).toBe("unit");
    const facts = analyzeSalesLines({
      lines: [line({})],
      verifiedCosts: [{ productId: "p1", unitCost: 40, basis: "manual", listPrice: 45 }],
      periodRecognized: true,
    });
    const row = facts.products[0];
    expect(row.averagePrice).toBe(45);
    expect(row.verifiedTotalCost).toBe(1960);
    expect(row.verifiedGross).toBe(245);
    expect(row.anomalies).not.toContain("profit_mismatch");
  });

  it("does not turn a missing verified cost into zero profit", () => {
    const facts = analyzeSalesLines({
      lines: [line({ menuProductId: undefined, matchKind: "none" })],
      verifiedCosts: [],
      periodRecognized: true,
    });
    expect(facts.products[0].verifiedGross).toBeNull();
    expect(facts.verifiedGross).toBeNull();
    expect(facts.products[0].anomalies).toContain("missing_verified_cost");
  });

  it("flags revenue that does not match quantity times price", () => {
    const facts = analyzeSalesLines({
      lines: [line({ reportedRevenue: 1000, posProfit: null, posCost: null })],
      periodRecognized: true,
      verifiedCosts: [],
    });
    expect(facts.products[0].anomalies).toContain("revenue_qty_mismatch");
  });
});

describe("price simulation", () => {
  it("computes the ₪36 to ₪39 case and a demand drop without promising demand", () => {
    const flat = simulatePriceChange({
      currentPrice: 36,
      nextPrice: 39,
      quantity: 100,
      verifiedUnitCost: 25,
    });
    expect(flat.unitProfitBefore).toBe(11);
    expect(flat.unitProfitAfter).toBe(14);
    expect(flat.periodProfitBefore).toBe(1100);
    expect(flat.periodProfitAfter).toBe(1400);
    const dropped = simulatePriceChange({
      currentPrice: 36,
      nextPrice: 39,
      quantity: 100,
      verifiedUnitCost: 25,
      demandDropPercent: 10,
    });
    expect(dropped.assumedQuantity).toBe(90);
    expect(dropped.periodProfitAfter).toBe(1260);
  });

  it("keeps profit empty when the unit cost is not verified", () => {
    const result = simulatePriceChange({
      currentPrice: 36,
      nextPrice: 39,
      quantity: 100,
      verifiedUnitCost: null,
    });
    expect(result.unitProfitAfter).toBeNull();
  });
});

describe("advisor", () => {
  it("does not recommend removing a dish from a single low-demand row", () => {
    const facts = analyzeSalesLines({
      lines: [
        line({ key: "a", quantity: 100, reportedRevenue: 4500, posCost: 10, posProfit: 3500, menuProductId: "p1" }),
        line({ key: "b", posName: "נדיר", quantity: 2, unitPrice: 45, reportedRevenue: 90, posCost: 10, posProfit: 70, menuProductId: "p2" }),
      ],
      verifiedCosts: [
        { productId: "p1", unitCost: 10, basis: "manual", listPrice: 45 },
        { productId: "p2", unitCost: 10, basis: "manual", listPrice: 45 },
      ],
      periodRecognized: true,
    });
    const cards = adviseFromFacts(facts);
    const low = cards.find((card) => card.productKey === "b");
    expect(low?.kind).toBe("low_demand");
    expect(low?.caveats).toContain("do-not-remove-from-one-report");
  });
});
