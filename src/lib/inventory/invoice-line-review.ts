import { findDuplicateIngredient } from "@/lib/costing/names";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { isSafeInvoiceMatch } from "@/lib/inventory/product-match";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

export type InvoiceReviewFilter = "all" | "needs" | "review" | "unmapped" | "new" | "confirmed";
export type InvoiceMatchStatus = "confirmed" | "possible" | "none" | "new";

export function isConfirmedInvoiceMatch(line: PurchaseInvoiceLine): boolean {
  if (!line.productId) return false;
  if (line.matchConfirmed) return true;
  if (line.matchKind === "exact" || line.matchKind === "mapped" || line.matchKind === "new") return true;
  if (line.matchKind === "suggest") return false;
  return line.matchConfirmed !== false;
}

export function invoiceLineMatchStatus(line: PurchaseInvoiceLine): InvoiceMatchStatus {
  if (line.matchKind === "new" && line.productId) return "new";
  if (isConfirmedInvoiceMatch(line)) return "confirmed";
  if (line.productId || line.matchKind === "suggest" || (line.candidates?.length ?? 0) > 0) return "possible";
  return "none";
}

export function invoiceReviewCounts(lines: PurchaseInvoiceLine[]) {
  return lines.reduce(
    (acc, line) => {
      const status = invoiceLineMatchStatus(line);
      acc.total += 1;
      if (status === "confirmed") acc.confirmed += 1;
      else if (status === "new") acc.created += 1;
      else if (status === "none") acc.none += 1;
      else acc.review += 1;
      return acc;
    },
    { total: 0, confirmed: 0, review: 0, none: 0, created: 0 }
  );
}

export function invoiceLineMatchesFilter(
  line: PurchaseInvoiceLine,
  filter: InvoiceReviewFilter,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const hay = `${line.rawName} ${line.category ?? ""} ${line.candidates?.map((item) => item.name).join(" ") ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (filter === "all") return true;
  const status = invoiceLineMatchStatus(line);
  if (filter === "needs") {
    return status !== "confirmed" || !line.unit || (line.quantity == null && line.unitPrice == null && line.lineTotal == null && line.netAmount == null && line.grossAmount == null);
  }
  if (filter === "confirmed") return status === "confirmed";
  if (filter === "new") return status === "new";
  if (filter === "unmapped") return status === "none";
  return status === "possible" || Boolean(line.needsReview && status !== "confirmed" && status !== "new");
}

export function confirmInvoiceMatchPatch(
  product: Pick<CostingIngredient, "id" | "name" | "category">,
  score?: number | null
): Partial<PurchaseInvoiceLine> {
  return {
    productId: product.id,
    matchKind: "exact",
    matchConfirmed: true,
    matchConfidence: score ?? 1,
    rowStatus: "matched",
    needsReview: false,
    category: product.category,
  };
}

export function newInvoiceProductPatch(
  product: Pick<CostingIngredient, "id" | "category">,
  category?: string
): Partial<PurchaseInvoiceLine> {
  return {
    productId: product.id,
    matchKind: "new",
    matchConfirmed: true,
    matchConfidence: 1,
    rowStatus: "new",
    needsReview: false,
    category: category || product.category,
  };
}

export function clearInvoiceMatchPatch(): Partial<PurchaseInvoiceLine> {
  return {
    productId: undefined,
    matchKind: "none",
    matchConfirmed: false,
    matchConfidence: null,
    rowStatus: "unmapped",
    needsReview: true,
  };
}

export function confirmSafeInvoiceMatches(lines: PurchaseInvoiceLine[]): PurchaseInvoiceLine[] {
  return lines.map((line) => {
    if (isConfirmedInvoiceMatch(line)) return line;
    if (!line.productId) return line;
    if (!isSafeInvoiceMatch(line.matchConfidence, line.matchKind)) return line;
    return {
      ...line,
      matchKind: "exact" as const,
      matchConfirmed: true,
      rowStatus: "matched" as const,
      needsReview: false,
    };
  });
}

export function invoiceCreateProductDraft(
  line: PurchaseInvoiceLine,
  supplierName?: string
): {
  name: string;
  category?: string;
  purchasePrice: number;
  purchaseQuantity: number;
  purchaseUnit: PurchaseUnit;
  supplier?: string;
  priceBeforeVat?: number | null;
  priceIncludingVat?: number | null;
  vatRate?: number;
  vatAmount?: number | null;
} {
  return {
    name: line.rawName.trim(),
    category: line.category,
    purchasePrice: line.grossAmount ?? line.priceIncludingVat ?? line.unitPrice ?? 0,
    purchaseQuantity: line.quantity && line.quantity > 0 ? line.quantity : 1,
    purchaseUnit: line.unit ?? "unit",
    supplier: supplierName?.trim() || undefined,
    priceBeforeVat: line.netAmount ?? line.priceBeforeVat,
    priceIncludingVat: line.grossAmount ?? line.priceIncludingVat,
    vatRate: line.vatRate ?? undefined,
    vatAmount: line.vatAmount,
  };
}

export function existingProductForInvoiceName(
  name: string,
  ingredients: CostingIngredient[]
): CostingIngredient | undefined {
  return findDuplicateIngredient(name, ingredients);
}
