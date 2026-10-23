import { purchaseQuantityInBase, unitsCompatible } from "@/lib/costing/units";
import type { BaseUnit, CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { currentStockBase } from "@/lib/inventory/stock";
import type { InventoryMovement, PurchasePriceRecord } from "@/lib/inventory/types";
import { storedPurchaseUnitPrices } from "@/lib/inventory/unit-price";

export type AdminPriceCorrection = {
  unitPriceExcludingVat: number;
  unitPriceIncludingVat: number | null;
  basis: "including" | "excluding" | "exempt";
  supplierId?: string | null;
  reason: string;
  at: string;
  actor?: string | null;
  invoiceId?: string | null;
};

export type ShownUnitPrice = {
  excludingVat: number | null;
  includingVat: number | null;
  quantity: number;
  unit: PurchaseUnit;
  invoiceId?: string;
  purchaseDate?: string;
  source: "admin" | "invoice" | "record";
  dividedTwice: boolean;
};

function explicitUnit(record: PurchasePriceRecord): boolean {
  return record.unitPriceNet != null || record.unitPriceGross != null || record.lineTotalNet != null || record.lineTotalGross != null;
}

function byDate(a: PurchasePriceRecord, b: PurchasePriceRecord): number {
  return String(b.purchaseDate ?? "").localeCompare(String(a.purchaseDate ?? ""))
    || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
}

/** Latest purchase whose unit price was stored on the invoice, not a later divided manual row. */
export function verifiedLastPurchase(records: PurchasePriceRecord[], productId: string): PurchasePriceRecord | undefined {
  const rows = records.filter((row) => row.productId === productId && !row.cancelledAt);
  const trusted = rows.filter((row) => explicitUnit(row) && (row.invoiceId || row.source === "PURCHASE_INVOICE"));
  const pool = trusted.length ? trusted : rows;
  return pool.slice().sort(byDate)[0];
}

export function shownRecordUnitPrices(record: PurchasePriceRecord, siblings: PurchasePriceRecord[] = []): {
  excludingVat: number | null;
  includingVat: number | null;
  dividedTwice: boolean;
} {
  const prices = storedPurchaseUnitPrices(record);
  if (explicitUnit(record)) {
    return { excludingVat: prices.unitExcludingVat, includingVat: prices.unitIncludingVat, dividedTwice: false };
  }
  const verified = siblings
    .filter((row) => row.id !== record.id && row.productId === record.productId && explicitUnit(row))
    .sort(byDate)[0];
  if (verified) {
    const invoice = storedPurchaseUnitPrices(verified);
    const entered = record.priceIncludingVat || record.priceBeforeVat;
    if (invoice.unitExcludingVat != null && Math.abs(invoice.unitExcludingVat - entered) <= 0.05) {
      return { excludingVat: invoice.unitExcludingVat, includingVat: invoice.unitIncludingVat, dividedTwice: true };
    }
    if (invoice.unitIncludingVat != null && Math.abs(invoice.unitIncludingVat - entered) <= 0.05) {
      return { excludingVat: invoice.unitExcludingVat, includingVat: invoice.unitIncludingVat, dividedTwice: true };
    }
  }
  if (!prices.dividedTwice) {
    return { excludingVat: prices.unitExcludingVat, includingVat: prices.unitIncludingVat, dividedTwice: false };
  }
  const qty = record.quantity > 0 ? record.quantity : 1;
  return {
    excludingVat: record.priceBeforeVat / qty,
    includingVat: record.priceIncludingVat / qty,
    dividedTwice: true,
  };
}

export function displayedLastPrice(
  product: Pick<CostingIngredient, "id" | "purchaseUnit"> & { adminPriceCorrection?: AdminPriceCorrection | null },
  records: PurchasePriceRecord[]
): ShownUnitPrice | null {
  const correction = product.adminPriceCorrection;
  if (correction && correction.unitPriceExcludingVat > 0) {
    return {
      excludingVat: correction.unitPriceExcludingVat,
      includingVat: correction.unitPriceIncludingVat,
      quantity: 1,
      unit: product.purchaseUnit,
      invoiceId: correction.invoiceId ?? undefined,
      purchaseDate: correction.at,
      source: "admin",
      dividedTwice: false,
    };
  }
  const record = verifiedLastPurchase(records, product.id);
  if (!record) return null;
  const prices = shownRecordUnitPrices(record, records.filter((row) => row.productId === product.id));
  return {
    ...prices,
    quantity: record.quantity,
    unit: record.purchaseUnit || record.unit,
    invoiceId: record.invoiceId,
    purchaseDate: record.purchaseDate,
    source: explicitUnit(record) ? "invoice" : "record",
  };
}

export function purchaseRecordBaseCost(record: PurchasePriceRecord, siblings: PurchasePriceRecord[] = []): { before: number; including: number } {
  const unit = record.purchaseUnit || record.unit;
  const one = purchaseQuantityInBase(1, unit) || 1;
  const prices = shownRecordUnitPrices(record, siblings);
  const trustedSibling = siblings.some((row) => row.id !== record.id && explicitUnit(row));
  if (explicitUnit(record) || (trustedSibling && prices.dividedTwice)) {
    return {
      before: (prices.excludingVat ?? 0) / one,
      including: (prices.includingVat ?? prices.excludingVat ?? 0) / one,
    };
  }
  const baseQty = purchaseQuantityInBase(record.quantity || record.packageQuantity, unit) || 1;
  return {
    including: record.unitCost,
    before: baseQty > 0 ? record.priceBeforeVat / baseQty : record.unitCost,
  };
}

export function attributedPurchaseQty(input: {
  productId: string;
  movements: InventoryMovement[];
  lines: Array<{ invoiceId: string; lineKey: string; name: string; quantity: number | null }>;
}): { total: number; byName: Array<{ name: string; quantity: number }> } {
  const named = new Map<string, number>();
  for (const movement of input.movements.filter((row) => row.productId === input.productId && row.type === "PURCHASE_IN")) {
    const line = input.lines.find((item) => item.invoiceId === movement.invoiceId && item.lineKey === movement.invoiceLineKey);
    const name = line?.name?.trim() || movement.note || input.productId;
    named.set(name, (named.get(name) ?? 0) + Math.abs(movement.quantityBase));
  }
  return {
    total: currentStockBase(input.movements, input.productId),
    byName: [...named.entries()].map(([name, quantity]) => ({ name, quantity })),
  };
}

export function planInventoryAdjustment(input: {
  currentBase: number;
  nextQuantity: number;
  unit: PurchaseUnit;
  baseUnit: BaseUnit;
}): { deltaBase: number; nextBase: number; noop: boolean } {
  if (!Number.isFinite(input.nextQuantity) || input.nextQuantity < 0) throw new Error("INVALID_QUANTITY");
  if (!unitsCompatible(input.baseUnit, input.unit)) throw new Error("BAD_UNIT");
  const nextBase = purchaseQuantityInBase(input.nextQuantity, input.unit);
  const deltaBase = Math.round((nextBase - input.currentBase) * 10000) / 10000;
  return { deltaBase, nextBase, noop: Math.abs(deltaBase) <= 0.0001 };
}

export function adjustmentMovementId(productId: string, nextBase: number): string {
  return `stock-adj-${productId}-${nextBase.toFixed(4).replace(".", "_")}`.slice(0, 700);
}
