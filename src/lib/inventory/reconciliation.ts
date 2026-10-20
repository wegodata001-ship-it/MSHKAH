import { movementSignedBase } from "@/lib/inventory/stock";
import type { InventoryMovement } from "@/lib/inventory/types";

/**
 * Inventory reconciliation primitives.
 *
 * Audit section 14 required a "mismatch report" that compares the balance
 * stored in `inventoryBalances` against the sum of the per-product movement
 * ledger. Section 12 required a dedicated negative-stock surface instead of
 * silently clamping negative balances to zero.
 *
 * These helpers are pure (no I/O, no React) so the admin UI can reuse them,
 * tests can exercise them, and the server can call them without a Firestore
 * roundtrip beyond the one bulk read of movements + balances.
 */

export type ProductBalanceSnapshot = {
  productId: string;
  storedBase: number;
};

export type ReconciliationRow = {
  productId: string;
  openingBase: number;
  stockInBase: number;
  stockOutBase: number;
  reversalBase: number;
  adjustmentBase: number;
  computedBase: number;
  storedBase: number | null;
  deltaBase: number;
  /** `true` when |computed − stored| > 0.0001 and `stored` is known. */
  hasMismatch: boolean;
  /** `true` when the computed balance is below 0. */
  isNegative: boolean;
};

const EPS = 0.0001;

function round(value: number): number {
  // Keep rounding consistent with the Firestore schema (base units are g/ml/unit).
  return Math.round(value * 10000) / 10000;
}

/**
 * Build a per-product reconciliation line.
 *
 * The invariant we rely on is the one the brief writes verbatim:
 *   opening + stockIn − stockOut + reversal + adjustment = computedBase.
 *
 * We split `REVERSAL` from `ADJUSTMENT` even though both contribute to the
 * signed sum — admins want to see them separately in the mismatch report
 * so they can tell "someone cancelled an invoice" from "stock count said
 * there's one fewer bottle than we thought".
 */
export function reconcileBalances(input: {
  movements: InventoryMovement[];
  storedBalances: ProductBalanceSnapshot[];
  productIds: string[];
}): ReconciliationRow[] {
  const storedByProduct = new Map(input.storedBalances.map((row) => [row.productId, row.storedBase]));
  const buckets = new Map<string, {
    opening: number;
    stockIn: number;
    stockOut: number;
    reversal: number;
    adjustment: number;
  }>();

  for (const id of input.productIds) {
    buckets.set(id, { opening: 0, stockIn: 0, stockOut: 0, reversal: 0, adjustment: 0 });
  }

  for (const movement of input.movements) {
    if (!movement.productId) continue;
    const bucket = buckets.get(movement.productId);
    if (!bucket) continue;
    const signed = movementSignedBase(movement);
    switch (movement.type) {
      case "OPENING":
        bucket.opening += signed;
        break;
      case "PURCHASE_IN":
        bucket.stockIn += signed;
        break;
      case "SALE_OUT":
      case "ISSUE_OUT":
        bucket.stockOut += Math.abs(signed);
        break;
      case "REVERSAL":
        bucket.reversal += signed;
        break;
      case "ADJUSTMENT":
        bucket.adjustment += signed;
        break;
    }
  }

  return input.productIds.map((productId) => {
    const bucket = buckets.get(productId)!;
    const computed = round(
      bucket.opening + bucket.stockIn - bucket.stockOut + bucket.reversal + bucket.adjustment
    );
    const stored = storedByProduct.has(productId) ? round(storedByProduct.get(productId)!) : null;
    const delta = stored == null ? 0 : round(computed - stored);
    return {
      productId,
      openingBase: round(bucket.opening),
      stockInBase: round(bucket.stockIn),
      stockOutBase: round(bucket.stockOut),
      reversalBase: round(bucket.reversal),
      adjustmentBase: round(bucket.adjustment),
      computedBase: computed,
      storedBase: stored,
      deltaBase: delta,
      hasMismatch: stored != null && Math.abs(delta) > EPS,
      isNegative: computed < -EPS,
    };
  });
}

/**
 * Short-circuit used by the alerts panel. Returns only the products that
 * either have a stored/computed mismatch or a negative computed balance.
 * Admins should see this list in the UI without having to scroll the full
 * reconciliation report.
 */
export function findReconciliationIssues(rows: ReconciliationRow[]): {
  mismatches: ReconciliationRow[];
  negatives: ReconciliationRow[];
} {
  return {
    mismatches: rows.filter((row) => row.hasMismatch),
    negatives: rows.filter((row) => row.isNegative),
  };
}
