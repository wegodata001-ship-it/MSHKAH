import type { InventoryMovement, InventoryMovementType } from "@/lib/inventory/types";
import { currentStockBase, movementSignedBase } from "@/lib/inventory/stock";

export type StockExplanation = {
  opening: number;
  incoming: number;
  consumption: number;
  returns: number;
  adjustments: number;
  current: number;
  explained: number;
  gap: number;
  duplicatePurchases: number;
};

type MovementSlice = Pick<InventoryMovement, "productId" | "type" | "quantityBase" | "reason" | "invoiceId" | "invoiceLineKey">;

function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Current stock is the signed movement total. The parts explain that total and do not replace it. */
export function explainStock(movements: MovementSlice[], productId: string): StockExplanation {
  const rows = movements.filter((row) => row.productId === productId);
  let opening = 0;
  let incoming = 0;
  let consumption = 0;
  let returns = 0;
  let adjustments = 0;
  const purchases = new Map<string, number>();
  for (const row of rows) {
    if (row.type === "OPENING") opening += row.quantityBase;
    else if (row.type === "PURCHASE_IN") {
      incoming += Math.abs(row.quantityBase);
      const key = row.invoiceId && row.invoiceLineKey ? `${row.invoiceId}:${row.invoiceLineKey}` : "";
      if (key) purchases.set(key, (purchases.get(key) ?? 0) + 1);
    } else if (row.type === "ISSUE_OUT" || row.type === "SALE_OUT") {
      if (row.reason === "return") returns += Math.abs(row.quantityBase);
      else consumption += Math.abs(row.quantityBase);
    } else if (row.type === "ADJUSTMENT" || row.type === "REVERSAL") {
      adjustments += movementSignedBase(row);
    }
  }
  const current = currentStockBase(movements as InventoryMovement[], productId);
  const explained = roundQty(opening + incoming - consumption - returns + adjustments);
  return {
    opening: roundQty(opening),
    incoming: roundQty(incoming),
    consumption: roundQty(consumption),
    returns: roundQty(returns),
    adjustments: roundQty(adjustments),
    current: roundQty(current),
    explained,
    gap: roundQty(current - explained),
    duplicatePurchases: [...purchases.values()].filter((count) => count > 1).length,
  };
}

export type StockSheetSort = "name" | "qty" | "price" | "date";

export type StockSheetQuery = {
  zero?: boolean;
  negative?: boolean;
  missingPrice?: boolean;
  discrepancy?: boolean;
  sort?: StockSheetSort;
};

export type StockSheetRow = {
  id: string;
  name: string;
  current: number;
  price: number | null;
  date: string;
  discrepancy: boolean;
};

export function queryStockSheet<T extends StockSheetRow>(rows: T[], query: StockSheetQuery): T[] {
  const filtered = rows.filter((row) => {
    if (query.zero && row.current !== 0) return false;
    if (query.negative && row.current >= 0) return false;
    if (query.missingPrice && row.price != null) return false;
    if (query.discrepancy && !row.discrepancy) return false;
    return true;
  });
  const sort = query.sort ?? "name";
  return filtered.slice().sort((a, b) => {
    if (sort === "qty") return a.current - b.current || a.name.localeCompare(b.name, "he");
    if (sort === "price") return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name, "he");
    if (sort === "date") return b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "he");
    return a.name.localeCompare(b.name, "he");
  });
}

export type ProductPatchInput = {
  productId: string;
  category?: string | null;
  notes?: string | null;
  purchaseUnit?: string | null;
  lastSupplierId?: string | null;
  packCount?: number | null;
  packContentUnit?: string | null;
  active?: boolean;
  openingQuantity?: number;
  nextQuantity?: number;
  reason?: string;
};

const PATCH_FIELDS = ["category", "notes", "purchaseUnit", "lastSupplierId", "packCount", "packContentUnit", "active", "openingQuantity", "nextQuantity"] as const;

export function validateProductPatch(input: ProductPatchInput): { ok: true } | { ok: false; code: "VALIDATION" | "REASON_REQUIRED" | "ONE_STOCK_EDIT" | "INVALID_QUANTITY" } {
  if (!input.productId.trim()) return { ok: false, code: "VALIDATION" };
  const touched = PATCH_FIELDS.some((field) => input[field] !== undefined);
  if (!touched) return { ok: false, code: "VALIDATION" };
  const opening = input.openingQuantity != null;
  const next = input.nextQuantity != null;
  if (opening && next) return { ok: false, code: "ONE_STOCK_EDIT" };
  if ((opening || next) && !String(input.reason ?? "").trim()) return { ok: false, code: "REASON_REQUIRED" };
  if (opening && (!Number.isFinite(input.openingQuantity) || (input.openingQuantity ?? 0) < 0)) return { ok: false, code: "INVALID_QUANTITY" };
  if (next && (!Number.isFinite(input.nextQuantity) || (input.nextQuantity ?? 0) < 0)) return { ok: false, code: "INVALID_QUANTITY" };
  return { ok: true };
}

export function openingMovementId(productId: string, nextBase: number): string {
  return `opening-adj-${productId}-${nextBase.toFixed(4).replace(".", "_")}`.slice(0, 700);
}

export function coveredMovementTypes(): InventoryMovementType[] {
  return ["OPENING", "PURCHASE_IN", "ISSUE_OUT", "SALE_OUT", "ADJUSTMENT", "REVERSAL"];
}
