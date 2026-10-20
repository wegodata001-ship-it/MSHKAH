import type { InventoryMovement, PurchaseInvoice } from "@/lib/inventory/types";
import type { BaseUnit } from "@/lib/costing/types";
import { baseUnitFor } from "@/lib/costing/units";

/**
 * Pure helpers for cancelling a purchase invoice (reversing its stock impact).
 *
 * The server-side writer uses `planInvoiceCancellation` to decide which
 * inventory movements still need a counter-movement, so the operation is
 * idempotent and never double-reduces stock.
 */

export type CancelPlanStatus =
  | "no-stock"
  | "ready"
  | "already-cancelled"
  | "already-reversed"
  | "broken-link";

export type CancelMovementPlan = {
  /** Source PURCHASE_IN movement id. */
  sourceId: string;
  /** Original line key (so UI can reconnect to the invoice line). */
  invoiceLineKey: string | null;
  /** Ingredient / product id affected. */
  productId: string;
  /** Base unit of the product (kg, liter, unit, …). */
  baseUnit: BaseUnit;
  /** Positive quantity recorded on the original movement (in base units). */
  originalBaseQty: number;
  /**
   * How much of that purchase is already reversed by prior counter-movements
   * for this exact source movement. 0 for fresh cancellations, > 0 if a
   * previous cancel attempt was partially completed.
   */
  alreadyReversedBase: number;
  /** Positive quantity we still need to counter (originalBaseQty - alreadyReversed). */
  remainingBaseQty: number;
  /** Current on-hand quantity for the product in base units. */
  currentBalance: number;
  /** Expected on-hand after this cancel (may be negative). */
  expectedAfter: number;
  /** Deterministic doc id of the counter-movement (so writes are idempotent). */
  counterMovementId: string;
};

export type CancelBrokenLink = {
  invoiceLineKey: string;
  rawName: string;
  productId: string | null;
  reason: "no-movement" | "missing-product" | "missing-quantity";
};

export type CancelPlan = {
  status: CancelPlanStatus;
  /**
   * `true` when the invoice ever posted to stock (even if already reversed).
   * The dialog uses this to decide the empty-state copy.
   */
  hasStockHistory: boolean;
  movements: CancelMovementPlan[];
  /**
   * Invoice line keys whose stock movements can't be identified cleanly.
   * When this is non-empty with `status === "broken-link"` the UI must
   * refuse to cancel and show the user exactly what is missing.
   */
  brokenLinks: CancelBrokenLink[];
  /** Lines that would go below 0 after the cancellation. */
  negativeAfter: CancelMovementPlan[];
};

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isPurchaseIn(movement: InventoryMovement): boolean {
  return movement.type === "PURCHASE_IN";
}

/**
 * Base unit of a movement. Falls back to a safe default so we never
 * silently convert kg→unit when a legacy row is missing the unit field.
 */
function baseUnitOf(movement: InventoryMovement): BaseUnit {
  return baseUnitFor(movement.unit);
}

/** On-hand balance for a product by summing signed movements. */
function currentBalanceFor(
  productId: string,
  movements: InventoryMovement[]
): number {
  let total = 0;
  for (const movement of movements) {
    if (movement.productId !== productId) continue;
    if (movement.type === "SALE_OUT" || movement.type === "ISSUE_OUT") {
      total -= Math.abs(asNumber(movement.quantityBase));
    } else if (movement.type === "REVERSAL") {
      total += asNumber(movement.quantityBase);
    } else {
      total += asNumber(movement.quantityBase);
    }
  }
  return total;
}

/**
 * Build the counter-movement doc id. The server uses this to run a
 * `tx.get()` first — if the doc already exists we treat the item as
 * already reversed and skip it. This is the whole idempotency story.
 */
export function counterMovementIdFor(sourceId: string): string {
  return `rev-${sourceId}`;
}

/**
 * Core planner. Pure. The server-side writer calls this with the full set
 * of inventory movements it just read from Firestore, and the UI calls it
 * with the same client-side movements subscription to render the preview.
 */
export function planInvoiceCancellation(input: {
  invoice: PurchaseInvoice;
  movements: InventoryMovement[];
}): CancelPlan {
  const { invoice, movements } = input;
  const isCancelled = invoice.status === "cancelled";

  // All PURCHASE_IN rows actually linked to this invoice (by invoiceId).
  const sourceMovements = movements.filter(
    (movement) => movement.invoiceId === invoice.id && isPurchaseIn(movement)
  );
  const hasStockHistory = sourceMovements.length > 0;

  if (!hasStockHistory) {
    return {
      status: isCancelled ? "already-cancelled" : "no-stock",
      hasStockHistory: false,
      movements: [],
      brokenLinks: [],
      negativeAfter: [],
    };
  }

  // Pre-compute how much of each source has already been reversed by
  // existing REVERSAL rows referencing it (via `reversesId`).
  const reversedBase = new Map<string, number>();
  const correctionDelta = new Map<string, number>();
  for (const movement of movements) {
    if (movement.type === "REVERSAL" && movement.reversesId) {
      reversedBase.set(
        movement.reversesId,
        (reversedBase.get(movement.reversesId) ?? 0) + Math.abs(asNumber(movement.quantityBase))
      );
    }
    if (movement.type === "ADJUSTMENT" && movement.correctsMovementId) {
      correctionDelta.set(
        movement.correctsMovementId,
        (correctionDelta.get(movement.correctsMovementId) ?? 0) + asNumber(movement.quantityBase)
      );
    }
  }

  const plans: CancelMovementPlan[] = [];
  const brokenLinks: CancelBrokenLink[] = [];
  const seenKeys = new Set<string>();

  for (const movement of sourceMovements) {
    const originalBase = Math.abs(asNumber(movement.quantityBase));
    const alreadyReversed = reversedBase.get(movement.id) ?? 0;
    const corrected = correctionDelta.get(movement.id) ?? 0;
    // Cancel the quantity still on the books for this line, not the original
    // receipt. A later −5 correction must not be reversed a second time as
    // part of the full 20.
    const remaining = originalBase + corrected - alreadyReversed;
    if (!movement.productId || originalBase <= 0) {
      brokenLinks.push({
        invoiceLineKey: movement.invoiceLineKey || movement.invoiceLineId || movement.id,
        rawName: "",
        productId: movement.productId || null,
        reason: !movement.productId ? "missing-product" : "missing-quantity",
      });
      continue;
    }
    const balance = currentBalanceFor(movement.productId, movements);
    const effectiveRemaining = Math.max(0, remaining);
    const expectedAfter = balance - effectiveRemaining;
    if (movement.invoiceLineKey) seenKeys.add(movement.invoiceLineKey);
    plans.push({
      sourceId: movement.id,
      invoiceLineKey: movement.invoiceLineKey || movement.invoiceLineId || null,
      productId: movement.productId,
      baseUnit: baseUnitOf(movement),
      originalBaseQty: originalBase,
      alreadyReversedBase: alreadyReversed,
      remainingBaseQty: effectiveRemaining,
      currentBalance: balance,
      expectedAfter,
      counterMovementId: counterMovementIdFor(movement.id),
    });
  }

  // Lines marked `postedToStock` but without any matching movement
  // → broken link, UI should block the cancel and surface the issue
  // instead of guessing which movement to reverse.
  for (const line of invoice.lines ?? []) {
    if (!line.postedToStock) continue;
    if (seenKeys.has(line.key)) continue;
    brokenLinks.push({
      invoiceLineKey: line.key,
      rawName: line.rawName || line.productId || "",
      productId: line.productId || null,
      reason: "no-movement",
    });
  }

  const negativeAfter = plans.filter((plan) => plan.expectedAfter < -0.0001);
  const everythingAlreadyReversed =
    plans.length > 0 && plans.every((plan) => plan.remainingBaseQty <= 0.0001);

  let status: CancelPlanStatus;
  if (isCancelled && everythingAlreadyReversed) status = "already-cancelled";
  else if (brokenLinks.length > 0) status = "broken-link";
  else if (everythingAlreadyReversed) status = "already-reversed";
  else status = "ready";

  return {
    status,
    hasStockHistory: true,
    movements: plans,
    brokenLinks,
    negativeAfter,
  };
}

/** Convenience: true when the plan should trigger a user warning banner. */
export function planHasWarnings(plan: CancelPlan): boolean {
  return plan.negativeAfter.length > 0;
}

/** Convenience: true when the plan is safe to apply. */
export function planIsExecutable(plan: CancelPlan): boolean {
  return plan.status === "ready" || plan.status === "no-stock";
}
