import { purchaseQuantityInBase } from "@/lib/costing/units";
import type { PurchaseUnit } from "@/lib/costing/types";
import type { InventoryMovement, PurchasePriceRecord, SupplierOffer } from "@/lib/inventory/types";

export function movementSignedBase(movement: Pick<InventoryMovement, "type" | "quantityBase">): number {
  if (movement.type === "SALE_OUT") return -Math.abs(movement.quantityBase);
  if (movement.type === "REVERSAL") return movement.quantityBase;
  return movement.quantityBase;
}

export function currentStockBase(movements: InventoryMovement[], productId: string): number {
  return movements
    .filter((row) => row.productId === productId)
    .reduce((sum, row) => sum + movementSignedBase(row), 0);
}

export function stockInBase(movements: InventoryMovement[], productId: string): number {
  return movements
    .filter((row) => row.productId === productId && (row.type === "PURCHASE_IN" || row.type === "OPENING"))
    .reduce((sum, row) => sum + Math.abs(row.quantityBase), 0);
}

export function stockOutBase(movements: InventoryMovement[], productId: string): number {
  return movements
    .filter((row) => row.productId === productId && row.type === "SALE_OUT")
    .reduce((sum, row) => sum + Math.abs(row.quantityBase), 0);
}

export function unitCostFromPackage(
  priceIncludingVat: number,
  packageQuantity: number,
  unit: PurchaseUnit
): number {
  const base = purchaseQuantityInBase(packageQuantity, unit);
  if (base <= 0) return 0;
  return priceIncludingVat / base;
}

export function cheapestOffer(offers: SupplierOffer[]): SupplierOffer | undefined {
  return offers
    .filter((offer) => offer.lastUnitCost != null && offer.lastUnitCost > 0)
    .slice()
    .sort((a, b) => (a.lastUnitCost ?? Infinity) - (b.lastUnitCost ?? Infinity))[0];
}

export function latestPurchase(records: PurchasePriceRecord[], productId: string): PurchasePriceRecord | undefined {
  return records
    .filter((row) => row.productId === productId)
    .slice()
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))[0];
}

export function averageUnitCost(records: PurchasePriceRecord[], productId: string): number | null {
  const rows = records.filter((row) => row.productId === productId && row.unitCost > 0);
  if (!rows.length) return null;
  const totalQty = rows.reduce((sum, row) => sum + purchaseQuantityInBase(row.quantity || row.packageQuantity, row.unit), 0);
  if (totalQty <= 0) {
    return rows.reduce((sum, row) => sum + row.unitCost, 0) / rows.length;
  }
  const weighted = rows.reduce(
    (sum, row) => sum + row.unitCost * purchaseQuantityInBase(row.quantity || row.packageQuantity, row.unit),
    0
  );
  return weighted / totalQty;
}

export function reorderQty(current: number, recommended: number): number {
  return current < recommended ? recommended - current : 0;
}
