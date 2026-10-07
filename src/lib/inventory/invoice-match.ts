import { matchIngredient } from "@/lib/costing/import/match";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { asPurchaseUnit } from "@/lib/costing/units";
import { DEFAULT_VAT_RATE, normalizeVatRate } from "@/lib/inventory/vat";
import type { PurchaseInvoiceLine, VatType } from "@/lib/inventory/types";

export type ExtractedInvoiceLine = {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  lineTotal?: number | null;
  unitPrice?: number | null;
  vatType?: VatType | null;
  vatRate?: number | null;
};

export type ExtractedInvoice = {
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  vatId?: string;
  lines: ExtractedInvoiceLine[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function draftInvoiceLines(
  extracted: ExtractedInvoiceLine[],
  products: CostingIngredient[],
  vatRate = DEFAULT_VAT_RATE
): PurchaseInvoiceLine[] {
  return extracted.map((line, index) => {
    const match = matchIngredient(line.name, products);
    const qty = line.quantity ?? null;
    const total = line.lineTotal ?? (line.unitPrice != null && qty != null ? line.unitPrice * qty : null);
    return {
      key: `inv-${index}-${line.name}`,
      rawName: line.name,
      productId: match.item?.id,
      quantity: qty,
      unit: line.unit ? asPurchaseUnit(line.unit) : match.item?.purchaseUnit ?? null,
      lineTotal: total,
      vatType: line.vatType ?? "inclusive",
      vatRate: normalizeVatRate(line.vatRate ?? vatRate),
      priceBeforeVat: null,
      vatAmount: null,
      priceIncludingVat: total,
      matchKind: match.kind === "new" ? "new" : match.kind,
    };
  });
}

export function emptyInvoiceDraft(fileName?: string) {
  return {
    supplierName: "",
    invoiceNumber: "",
    invoiceDate: todayIso(),
    receivedAt: todayIso(),
    lines: [] as PurchaseInvoiceLine[],
    fileName,
  };
}

export const PURCHASE_UNITS: PurchaseUnit[] = ["kg", "g", "liter", "ml", "unit"];
