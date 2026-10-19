import type { LoyaltyRoundingMode, LoyaltySettings } from "@/lib/loyalty/types";

/**
 * Convert ILS (float) to minor units (agorot). We keep money in minor units
 * everywhere so a sequence of {100 ILS, 100 ILS, 100 ILS} orders never loses a
 * point to float rounding.
 */
export function toMinor(amountIls: number): number {
  if (!Number.isFinite(amountIls)) return 0;
  // Round at the agora boundary, independent of the earn rounding mode.
  return Math.round(amountIls * 100);
}

export function fromMinor(amountMinor: number): number {
  if (!Number.isFinite(amountMinor)) return 0;
  return Math.round(amountMinor) / 100;
}

/**
 * Qualifying amount for point earning on an order.
 *
 * Rules per spec:
 * - Based on the amount **paid**, after discounts.
 * - Points are **not** granted for the join fee.
 * - Points are **not** granted for the part paid with points (that would be
 *   "earning on your own redemption").
 */
export function qualifyingAmountMinor(input: {
  paidAmountMinor: number;
  joinFeePortionMinor?: number;
  redeemedValueMinor?: number;
}): number {
  const paid = Math.max(0, Math.floor(input.paidAmountMinor || 0));
  const join = Math.max(0, Math.floor(input.joinFeePortionMinor || 0));
  const redeemed = Math.max(0, Math.floor(input.redeemedValueMinor || 0));
  return Math.max(0, paid - join - redeemed);
}

/**
 * Points earned for a qualifying amount, using the configured rounding mode.
 *
 * Example at ratio 10 pts / 100 ILS:
 *   100 ILS → 10
 *   150 ILS → 15 (down) or 15 (nearest: 15.0)
 *   50  ILS → 5
 *   49  ILS → 4 (down) or 5 (nearest: 4.9 → 5)
 *
 * We compute in a pure integer domain (minor * ratio) and only round at the
 * very end — this is what lets a run of 50-agora orders eventually earn a
 * point instead of each one rounding to zero.
 *
 * The optional `carryMinor` lets callers accumulate the sub-point remainder
 * across a sequence of orders. Pass `0` for a one-off calculation.
 */
export function pointsForAmount(input: {
  qualifyingAmountMinor: number;
  earnPointsPer100: number;
  roundingMode?: LoyaltyRoundingMode;
  /** Previous unredeemed remainder in minor-units × points, if the caller
   *  wants exact long-term accounting. 0 for stateless use. */
  carryMinorPointSixteenths?: number;
}): { points: number; carryMinorPointSixteenths: number } {
  const amount = Math.max(0, Math.floor(input.qualifyingAmountMinor || 0));
  const ratio = Math.max(0, Math.floor(input.earnPointsPer100 || 0));
  if (amount === 0 || ratio === 0) {
    return { points: 0, carryMinorPointSixteenths: input.carryMinorPointSixteenths ?? 0 };
  }
  // amount is in agorot (ILS × 100), ratio is "points per 100 ILS = points per 10000 agorot".
  // raw points scaled × 10000 = amount × ratio.
  // Keep the remainder in that same "× 10000" scale.
  const scaledTotal = amount * ratio + (input.carryMinorPointSixteenths ?? 0);
  const whole = Math.floor(scaledTotal / 10000);
  const remainder = scaledTotal - whole * 10000;
  const mode = input.roundingMode ?? "down";
  if (mode === "nearest" && remainder >= 5000) {
    // Nearest: 0.5 point rounds up; the carry stays as the remaining fraction.
    return {
      points: whole + 1,
      // We "borrowed" a full point; the new carry is remainder − 10000 (negative),
      // so a stateless re-run with carry=0 would give the same answer here.
      carryMinorPointSixteenths: remainder - 10000,
    };
  }
  return { points: whole, carryMinorPointSixteenths: remainder };
}

// ──────────────────────────────────────────────────────────────────────
// Redemption
// ──────────────────────────────────────────────────────────────────────

export type RedemptionBlockedReason =
  | "redemption_disabled"
  | "point_value_unset"
  | "below_minimum"
  | "above_maximum"
  | "insufficient_balance"
  | "zero_points_requested";

export type RedemptionPlan =
  | {
      ok: true;
      requestedPoints: number;
      /** How many points we'll actually spend after clamping to balance/order total. */
      spentPoints: number;
      /** Discount value in minor units. */
      discountMinor: number;
    }
  | {
      ok: false;
      reason: RedemptionBlockedReason;
    };

/**
 * Compute a safe redemption plan given a request. **Pure** — no DB writes.
 *
 * Guarantees:
 * - Never returns `ok: true` when redemption is disabled or point value is 0.
 * - Clamps the requested amount to the member's balance and the per-order max.
 * - Clamps the discount so it never exceeds the order subtotal.
 */
export function planRedemption(input: {
  requestedPoints: number;
  balancePoints: number;
  orderSubtotalMinor: number;
  settings: Pick<
    LoyaltySettings,
    | "redemptionEnabled"
    | "pointValueMinor"
    | "pointValueApproved"
    | "redemptionMinPoints"
    | "redemptionMaxPoints"
  >;
}): RedemptionPlan {
  const requested = Math.max(0, Math.floor(input.requestedPoints || 0));
  if (requested === 0) {
    return { ok: false, reason: "zero_points_requested" };
  }
  if (!input.settings.redemptionEnabled) {
    return { ok: false, reason: "redemption_disabled" };
  }
  if (input.settings.pointValueMinor <= 0 || !input.settings.pointValueApproved) {
    return { ok: false, reason: "point_value_unset" };
  }
  const min = Math.max(0, input.settings.redemptionMinPoints);
  const max = input.settings.redemptionMaxPoints > 0
    ? input.settings.redemptionMaxPoints
    : Number.MAX_SAFE_INTEGER;
  if (min > 0 && requested < min) return { ok: false, reason: "below_minimum" };
  if (requested > max) return { ok: false, reason: "above_maximum" };
  if (requested > input.balancePoints) {
    return { ok: false, reason: "insufficient_balance" };
  }
  // Clamp the discount so a huge balance never gives a negative order total.
  const rawValue = requested * input.settings.pointValueMinor;
  const cappedValue = Math.min(rawValue, Math.max(0, input.orderSubtotalMinor));
  const spentPoints = cappedValue === rawValue
    ? requested
    : Math.max(1, Math.floor(cappedValue / input.settings.pointValueMinor));
  return {
    ok: true,
    requestedPoints: requested,
    spentPoints,
    discountMinor: spentPoints * input.settings.pointValueMinor,
  };
}

/**
 * Reverse (refund) a previously earned points entry. Returns the number of
 * points to subtract. Guards against negative refunds.
 */
export function pointsToReverseForRefund(input: {
  originalPointsEarned: number;
  refundedAmountMinor: number;
  qualifyingAmountMinor: number;
  roundingMode?: LoyaltyRoundingMode;
}): number {
  const original = Math.max(0, Math.floor(input.originalPointsEarned || 0));
  const refund = Math.max(0, Math.floor(input.refundedAmountMinor || 0));
  const qualifying = Math.max(0, Math.floor(input.qualifyingAmountMinor || 0));
  if (original === 0 || refund === 0 || qualifying === 0) return 0;
  const ratio = refund >= qualifying ? 1 : refund / qualifying;
  const raw = original * ratio;
  const points = input.roundingMode === "nearest" ? Math.round(raw) : Math.floor(raw);
  // Never remove more than was originally granted.
  return Math.min(original, Math.max(0, points));
}
