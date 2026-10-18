import type { PurchaseUnit } from "@/lib/costing/types";
import { roundMoney } from "@/lib/costing/money";
import { baseUnitFor } from "@/lib/costing/units";
import type { CompareDisplayUnit, CompareVatMode, MaterialCompareRow } from "@/lib/inventory/material-group";
import { toDisplayUnitCost } from "@/lib/inventory/material-group";
import { unitCostFromPackage } from "@/lib/inventory/stock";
import type { PurchasePriceRecord } from "@/lib/inventory/types";

export function formatCompareAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const cents = roundMoney(value, 2);
  if (Math.abs(value) >= 1 && Math.abs(value - cents) < 0.005) return cents.toFixed(2);
  if (Math.abs(value - cents) < 0.0005) return cents.toFixed(2);
  const fine = roundMoney(value, 4);
  const [whole, frac = ""] = fine.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

export function formatCompareMoney(value: number): string {
  const amount = formatCompareAmount(value);
  return amount === "—" ? amount : `₪${amount}`;
}

export function formatCompareQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
  return String(roundMoney(value, 3));
}

export function formatComparePercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const tenths = roundMoney(value, 1);
  if (Math.abs(tenths - Math.round(tenths)) < 0.05) return String(Math.round(tenths));
  return tenths.toFixed(1);
}

export function compareFormulaParts(row: {
  buyPrice: number | null;
  packQuantity: number | null;
  displayUnitCost: number | null;
  displayUnit: CompareDisplayUnit;
}): { pack: string; quantity: string; unitPrice: string; displayUnit: CompareDisplayUnit } | null {
  if (row.buyPrice == null || row.packQuantity == null || row.packQuantity <= 0 || row.displayUnitCost == null) return null;
  return {
    pack: formatCompareAmount(row.buyPrice),
    quantity: formatCompareQuantity(row.packQuantity),
    unitPrice: formatCompareAmount(row.displayUnitCost),
    displayUnit: row.displayUnit,
  };
}

export function sortCompareRows(rows: MaterialCompareRow[]): MaterialCompareRow[] {
  return rows.slice().sort((a, b) => {
    const aCost = a.comparable && a.displayUnitCost != null ? a.displayUnitCost : Number.POSITIVE_INFINITY;
    const bCost = b.comparable && b.displayUnitCost != null ? b.displayUnitCost : Number.POSITIVE_INFINITY;
    if (aCost !== bCost) return aCost - bCost;
    const aAny = a.displayUnitCost ?? Number.POSITIVE_INFINITY;
    const bAny = b.displayUnitCost ?? Number.POSITIVE_INFINITY;
    if (aAny !== bAny) return aAny - bAny;
    return a.supplierProductName.localeCompare(b.supplierProductName, "he");
  });
}

export function savedVatParts(record: {
  priceBeforeVat?: number | null;
  vatAmount?: number | null;
  priceIncludingVat?: number | null;
}): { net: number | null; vat: number | null; gross: number | null; differenceIsStoredVat: boolean } {
  const net = finiteOrNull(record.priceBeforeVat);
  const vat = finiteOrNull(record.vatAmount);
  const gross = finiteOrNull(record.priceIncludingVat);
  const differenceIsStoredVat = net != null && vat != null && gross != null && Math.abs(net + vat - gross) <= 0.02;
  return { net, vat, gross, differenceIsStoredVat };
}

export function packPriceOnBasis(
  record: Pick<PurchasePriceRecord, "priceBeforeVat" | "priceIncludingVat" | "lineTotalNet" | "lineTotalGross">,
  mode: CompareVatMode
): number | null {
  if (mode === "net") return finiteOrNull(record.priceBeforeVat) ?? finiteOrNull(record.lineTotalNet);
  return finiteOrNull(record.priceIncludingVat) ?? finiteOrNull(record.lineTotalGross);
}

export function unitPriceOnBasis(
  packPrice: number | null,
  packQuantity: number | null,
  packUnit: PurchaseUnit | undefined
): { unitPrice: number | null; displayUnit: CompareDisplayUnit | null } {
  if (packPrice == null || packQuantity == null || packQuantity <= 0 || !packUnit) return { unitPrice: null, displayUnit: null };
  const base = baseUnitFor(packUnit);
  const perBase = unitCostFromPackage(packPrice, packQuantity, packUnit);
  return { unitPrice: toDisplayUnitCost(perBase, base), displayUnit: base === "g" ? "kg" : base === "ml" ? "liter" : "unit" };
}

export type CompareHistoryLine = {
  id: string;
  date: string;
  packPrice: number | null;
  unitPrice: number | null;
  displayUnit: CompareDisplayUnit | null;
  packQuantity: number | null;
  packUnit?: PurchaseUnit;
  invoiceId?: string;
  source: "invoice" | "manual";
  net: number | null;
  vat: number | null;
  gross: number | null;
  differenceIsStoredVat: boolean;
};

export function compareHistoryLines(
  records: PurchasePriceRecord[],
  productId: string,
  supplierId: string,
  mode: CompareVatMode
): CompareHistoryLine[] {
  return records
    .filter((row) => row.productId === productId && (!supplierId || row.supplierId === supplierId))
    .slice()
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))
    .map((row) => {
      const packQuantity = row.packageQuantity ?? row.quantity ?? null;
      const packUnit = row.unit;
      const packPrice = packPriceOnBasis(row, mode);
      const priced = unitPriceOnBasis(packPrice, packQuantity, packUnit);
      const vat = savedVatParts(row);
      return {
        id: row.id,
        date: row.purchaseDate,
        packPrice,
        unitPrice: priced.unitPrice,
        displayUnit: priced.displayUnit,
        packQuantity,
        packUnit,
        invoiceId: row.invoiceId,
        source: row.source === "PURCHASE_INVOICE" ? "invoice" : "manual",
        ...vat,
      };
    });
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
