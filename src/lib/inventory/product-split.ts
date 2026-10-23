import { qualifiersConflict, sameProductCore } from "@/lib/inventory/product-match";
import { movementSignedBase } from "@/lib/inventory/stock";
import type { InventoryMovement } from "@/lib/inventory/types";

export type SharedProductConflict = {
  productId: string;
  names: string[];
};

export function sharedProductQualifierConflicts(
  lines: Array<{ productId?: string | null; name: string }>
): SharedProductConflict[] {
  const names = new Map<string, Set<string>>();
  for (const line of lines) {
    const productId = line.productId?.trim();
    const name = line.name.trim();
    if (!productId || !name) continue;
    const current = names.get(productId) ?? new Set<string>();
    current.add(name);
    names.set(productId, current);
  }
  const conflicts: SharedProductConflict[] = [];
  for (const [productId, group] of names) {
    const list = [...group];
    const mixed = list.some((left, index) => list.slice(index + 1).some((right) => qualifiersConflict(left, right) || !sameProductCore(left, right)));
    if (mixed) conflicts.push({ productId, names: list });
  }
  return conflicts;
}

export type SplitLineRef = {
  invoiceId: string;
  lineKey: string;
  name: string;
  quantity: number | null;
  productId?: string | null;
};

export type SplitSelection = {
  invoiceId: string;
  lineKey: string;
  targetProductId: string;
};

export function planMergedProductSplit(input: {
  sourceProductId: string;
  lines: SplitLineRef[];
  movements: Array<Pick<InventoryMovement, "id" | "productId" | "type" | "quantityBase" | "invoiceId" | "invoiceLineKey">>;
  selections: SplitSelection[];
}) {
  const lineMoves = input.selections.map((selection) => {
    const line = input.lines.find((item) => item.invoiceId === selection.invoiceId && item.lineKey === selection.lineKey);
    return {
      ...selection,
      found: Boolean(line && line.productId === input.sourceProductId),
      name: line?.name ?? "",
      quantity: line?.quantity ?? null,
    };
  });
  const movementMoves = input.movements
    .filter((movement) => movement.productId === input.sourceProductId)
    .map((movement) => {
      const selection = input.selections.find((item) => item.invoiceId === movement.invoiceId && item.lineKey === movement.invoiceLineKey);
      if (!selection || selection.targetProductId === input.sourceProductId) return null;
      return {
        id: movement.id,
        fromProductId: input.sourceProductId,
        toProductId: selection.targetProductId,
        quantityBase: movementSignedBase(movement),
      };
    })
    .filter((item): item is { id: string; fromProductId: string; toProductId: string; quantityBase: number } => Boolean(item));
  const balanceDelta = new Map<string, number>();
  for (const move of movementMoves) {
    balanceDelta.set(move.fromProductId, (balanceDelta.get(move.fromProductId) ?? 0) - move.quantityBase);
    balanceDelta.set(move.toProductId, (balanceDelta.get(move.toProductId) ?? 0) + move.quantityBase);
  }
  return {
    lineMoves,
    movementMoves,
    balanceDelta: [...balanceDelta.entries()].map(([productId, delta]) => ({ productId, delta })),
    createsDuplicateMovement: false,
  };
}
