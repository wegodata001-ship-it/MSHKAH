/**
 * Correct the quantity of a line that was already posted to stock.
 *
 * The original PURCHASE_IN row stays. The correction is the signed difference
 * between the quantity now on the books for that line and the quantity the
 * admin says actually arrived. Repeating the same target is a no-op.
 * A price-only edit never reaches this helper.
 */
export function planQuantityCorrection(input: {
  originalBase: number;
  correctedBase: number;
  priorDeltaBase: number;
}): { deltaBase: number; effectiveBase: number; noop: boolean } {
  if (!Number.isFinite(input.originalBase) || input.originalBase < 0) {
    throw new Error("INVALID_ORIGINAL");
  }
  if (!Number.isFinite(input.correctedBase) || input.correctedBase < 0) {
    throw new Error("INVALID_CORRECTED");
  }
  if (!Number.isFinite(input.priorDeltaBase)) {
    throw new Error("INVALID_PRIOR");
  }
  const effectiveBase = roundBase(input.originalBase + input.priorDeltaBase);
  const deltaBase = roundBase(input.correctedBase - effectiveBase);
  return {
    deltaBase,
    effectiveBase,
    noop: Math.abs(deltaBase) <= 0.0001,
  };
}

export function correctionMovementId(sourceMovementId: string, correctedBase: number): string {
  const safeSource = sourceMovementId.replace(/[\/\\#?[\]*]/g, "_").slice(0, 500);
  const target = roundBase(correctedBase).toFixed(4).replace(".", "_");
  return `qtyfix-${safeSource}-${target}`.slice(0, 700);
}

/** Signed deltas already applied as quantity fixes for one purchase movement. */
export function priorCorrectionDelta(
  movements: Array<{ correctsMovementId?: string; type: string; quantityBase: number }>,
  sourceMovementId: string
): number {
  return movements.reduce((sum, movement) => {
    if (movement.type !== "ADJUSTMENT") return sum;
    if (movement.correctsMovementId !== sourceMovementId) return sum;
    return sum + movement.quantityBase;
  }, 0);
}

function roundBase(value: number): number {
  return Math.round(value * 10000) / 10000;
}
