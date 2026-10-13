import { baseUnitFor, purchaseQuantityInBase } from "@/lib/costing/units";
import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";
import type { InventoryMovement, PurchasePriceRecord, SupplierOffer } from "@/lib/inventory/types";

export function movementSignedBase(movement: Pick<InventoryMovement, "type" | "quantityBase">): number {
  if (movement.type === "SALE_OUT" || movement.type === "ISSUE_OUT") return -Math.abs(movement.quantityBase);
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
    .filter((row) => row.productId === productId && (row.type === "SALE_OUT" || row.type === "ISSUE_OUT"))
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

export function offerPurchaseUnit(offer: SupplierOffer): PurchaseUnit | undefined {
  return offer.purchaseUnit ?? offer.lastUnit;
}

export function offerQuoteIncludingVat(offer: SupplierOffer): number | undefined {
  return offer.priceIncludingVat ?? offer.currentPrice ?? offer.lastPriceIncludingVat;
}

export function offerNormalizedCost(offer: SupplierOffer): number | undefined {
  if (offer.normalizedPrice != null && offer.normalizedPrice > 0) return offer.normalizedPrice;
  const price = offerQuoteIncludingVat(offer);
  const qty = offer.packageQuantity ?? offer.lastPackageQuantity;
  const unit = offerPurchaseUnit(offer);
  if (price != null && qty && unit) return unitCostFromPackage(price, qty, unit);
  return offer.lastUnitCost != null && offer.lastUnitCost > 0 ? offer.lastUnitCost : undefined;
}

export function offerLastPurchaseCost(offer: SupplierOffer): number | undefined {
  if (offer.lastPurchasePrice != null && offer.lastPurchasePrice > 0) return offer.lastPurchasePrice;
  return undefined;
}

export function offersComparable(a: SupplierOffer, b: SupplierOffer): boolean {
  const unitA = offerPurchaseUnit(a);
  const unitB = offerPurchaseUnit(b);
  if (!unitA || !unitB) return false;
  return baseUnitFor(unitA) === baseUnitFor(unitB);
}

export function comparableOffers(offers: SupplierOffer[], productBase?: BaseUnit): SupplierOffer[] {
  return offers.filter((offer) => {
    if (offer.active === false) return false;
    if (offerNormalizedCost(offer) == null) return false;
    const unit = offerPurchaseUnit(offer);
    if (productBase && unit && baseUnitFor(unit) !== productBase) return false;
    return true;
  });
}

export function cheapestOffer(offers: SupplierOffer[], productBase?: BaseUnit): SupplierOffer | undefined {
  return comparableOffers(offers, productBase)
    .slice()
    .sort((a, b) => (offerNormalizedCost(a) ?? Infinity) - (offerNormalizedCost(b) ?? Infinity))[0];
}

export function offerNormalizedNet(offer: SupplierOffer): number | undefined {
  const qty = offer.lastPackageQuantity ?? offer.packageQuantity;
  const unit = offer.lastUnit ?? offer.purchaseUnit;
  if (offer.lastPriceBeforeVat != null && qty && unit) return unitCostFromPackage(offer.lastPriceBeforeVat, qty, unit);
  const gross = offerNormalizedLastPurchase(offer);
  if (gross == null) return undefined;
  const rate = offer.vatRate ?? 0.18;
  if (offer.vatType === "exempt" || rate <= 0) return gross;
  return gross / (1 + (rate > 1 ? rate / 100 : rate));
}

export function offerNormalizedLastPurchase(offer: SupplierOffer): number | undefined {
  const qty = offer.lastPackageQuantity ?? offer.packageQuantity;
  const unit = offer.lastUnit ?? offer.purchaseUnit;
  if (offer.lastPriceIncludingVat != null && qty && unit) return unitCostFromPackage(offer.lastPriceIncludingVat, qty, unit);
  return offer.lastPurchasePrice ?? offer.lastUnitCost ?? undefined;
}

export function cheapestLastPurchase(
  offers: SupplierOffer[],
  mode: "net" | "gross" = "net",
  productBase?: BaseUnit
): SupplierOffer | undefined {
  const rows = offers.filter((offer) => {
    if (offer.active === false) return false;
    if ((mode === "net" ? offerNormalizedNet(offer) : offerNormalizedLastPurchase(offer)) == null) return false;
    const unit = offerPurchaseUnit(offer);
    if (productBase && unit && baseUnitFor(unit) !== productBase) return false;
    return true;
  });
  return rows.slice().sort((a, b) => {
    const left = (mode === "net" ? offerNormalizedNet(a) : offerNormalizedLastPurchase(a)) ?? Infinity;
    const right = (mode === "net" ? offerNormalizedNet(b) : offerNormalizedLastPurchase(b)) ?? Infinity;
    return left - right;
  })[0];
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
