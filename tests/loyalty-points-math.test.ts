import { describe, it, expect } from "vitest";
import {
  pointsForAmount,
  pointsToReverseForRefund,
  planRedemption,
  qualifyingAmountMinor,
  toMinor,
  fromMinor,
} from "@/lib/loyalty/points-math";

describe("pointsForAmount — the core 10/100 rule", () => {
  it("awards 10 points for 100 ILS at the default ratio", () => {
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(100), earnPointsPer100: 10 }).points
    ).toBe(10);
  });

  it("awards 15 points for 150 ILS", () => {
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(150), earnPointsPer100: 10 }).points
    ).toBe(15);
  });

  it("awards 5 points for 50 ILS", () => {
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(50), earnPointsPer100: 10 }).points
    ).toBe(5);
  });

  it("rounds DOWN by default: 149 ILS → 14 points, not 15", () => {
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(149), earnPointsPer100: 10 }).points
    ).toBe(14);
  });

  it("rounds DOWN never fabricates: 1 ILS → 0 points", () => {
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(1), earnPointsPer100: 10 }).points
    ).toBe(0);
  });

  it("nearest rounding behaves like Math.round for 49 ILS at 10/100", () => {
    expect(
      pointsForAmount({
        qualifyingAmountMinor: toMinor(49),
        earnPointsPer100: 10,
        roundingMode: "nearest",
      }).points
    ).toBe(5);
  });

  it("awards 0 when amount or ratio is 0 regardless of mode", () => {
    expect(pointsForAmount({ qualifyingAmountMinor: 0, earnPointsPer100: 10 }).points).toBe(0);
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(100), earnPointsPer100: 0 }).points
    ).toBe(0);
  });

  it("preserves precision across small orders using carry (down mode)", () => {
    // Ten 50-agora orders at 10/100 → each is 0.05 points.
    // Without carry: 0 forever. With carry: 1 point ever 20 orders.
    let carry = 0;
    let total = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = pointsForAmount({
        qualifyingAmountMinor: 50,
        earnPointsPer100: 10,
        carryMinorPointSixteenths: carry,
      });
      total += result.points;
      carry = result.carryMinorPointSixteenths;
    }
    expect(total).toBe(1);
  });
});

describe("qualifyingAmountMinor — exclusions", () => {
  it("excludes the join fee portion", () => {
    expect(
      qualifyingAmountMinor({
        paidAmountMinor: toMinor(120),
        joinFeePortionMinor: toMinor(20),
      })
    ).toBe(toMinor(100));
  });

  it("excludes the redeemed-points value portion", () => {
    expect(
      qualifyingAmountMinor({
        paidAmountMinor: toMinor(100),
        redeemedValueMinor: toMinor(10),
      })
    ).toBe(toMinor(90));
  });

  it("never returns a negative qualifying amount", () => {
    expect(
      qualifyingAmountMinor({
        paidAmountMinor: toMinor(10),
        joinFeePortionMinor: toMinor(20),
      })
    ).toBe(0);
  });
});

describe("planRedemption — refuses to redeem until configured and approved", () => {
  const baseSettings = {
    redemptionEnabled: true,
    pointValueMinor: 100, // 1 point = 1 ILS
    pointValueApproved: true,
    redemptionMinPoints: 10,
    redemptionMaxPoints: 500,
  };

  it("plans a clean redemption inside the limits", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: baseSettings,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.spentPoints).toBe(20);
    expect(plan.discountMinor).toBe(toMinor(20));
  });

  it("refuses when redemption is disabled", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: { ...baseSettings, redemptionEnabled: false },
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("redemption_disabled");
  });

  it("refuses when point value has not been approved", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: { ...baseSettings, pointValueApproved: false },
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("point_value_unset");
  });

  it("refuses when the point value is 0 even if 'approved'", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: { ...baseSettings, pointValueMinor: 0 },
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("point_value_unset");
  });

  it("respects the configured min/max", () => {
    const low = planRedemption({
      requestedPoints: 5,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: baseSettings,
    });
    expect(low.ok).toBe(false);
    expect((low as { reason: string }).reason).toBe("below_minimum");

    const high = planRedemption({
      requestedPoints: 600,
      balancePoints: 1000,
      orderSubtotalMinor: toMinor(1000),
      settings: baseSettings,
    });
    expect(high.ok).toBe(false);
    expect((high as { reason: string }).reason).toBe("above_maximum");
  });

  it("refuses when the balance is insufficient", () => {
    const plan = planRedemption({
      requestedPoints: 30,
      balancePoints: 10,
      orderSubtotalMinor: toMinor(80),
      settings: baseSettings,
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("insufficient_balance");
  });

  it("clamps the discount to the order subtotal", () => {
    const plan = planRedemption({
      requestedPoints: 100, // = 100 ILS at value 1
      balancePoints: 500,
      orderSubtotalMinor: toMinor(40),
      settings: baseSettings,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.discountMinor).toBeLessThanOrEqual(toMinor(40));
    expect(plan.spentPoints).toBeLessThan(100);
  });
});

describe("pointsToReverseForRefund — mirror the earn math on refunds", () => {
  it("reverses the full points on a full refund", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 10,
        refundedAmountMinor: toMinor(100),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(10);
  });

  it("reverses proportionally on a partial refund", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 10,
        refundedAmountMinor: toMinor(40),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(4);
  });

  it("never removes more than was granted", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 5,
        refundedAmountMinor: toMinor(1000),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(5);
  });

  it("returns 0 when any input is 0", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 0,
        refundedAmountMinor: toMinor(100),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(0);
  });
});

describe("toMinor / fromMinor — stable money boundary", () => {
  it("round-trips without drift at 2 decimals", () => {
    const samples = [0, 0.01, 0.5, 1, 7.2, 99.99, 150, 999.95];
    for (const n of samples) {
      expect(fromMinor(toMinor(n))).toBeCloseTo(n, 2);
    }
  });

  it("coerces non-finite to 0", () => {
    expect(toMinor(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toMinor(Number.NaN)).toBe(0);
  });
});
