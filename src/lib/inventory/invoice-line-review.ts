import { findDuplicateIngredient, normalizeIngredientName } from "@/lib/costing/names";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { packNeedsCompletion } from "@/lib/inventory/ingredient-core";
import { lineHasAmount } from "@/lib/inventory/invoice-lines";
import { isSafeInvoiceMatch } from "@/lib/inventory/product-match";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

export type InvoiceReviewFilter = "all" | "needs" | "review" | "unmapped" | "new" | "confirmed";
export type InvoiceMatchStatus = "confirmed" | "possible" | "none" | "new";

export function isConfirmedInvoiceMatch(line: PurchaseInvoiceLine): boolean {
  if (!line.productId) return false;
  if (line.matchKind === "suggest") return false;
  if (line.matchConfirmed) return true;
  if (line.matchKind === "exact" || line.matchKind === "mapped" || line.matchKind === "new") return true;
  return line.matchConfirmed !== false;
}

function lineSkipsStock(line: PurchaseInvoiceLine): boolean {
  if (line.postedToStock || line.skipInventory) return true;
  if (line.lineType === "SHIPPING" || line.lineType === "SERVICE" || line.lineType === "DISCOUNT") return true;
  if (line.productId) return false;
  if (line.lineType === "GENERAL") return true;
  return /פלסטיק|אריז|קרטון|שקית|ניילון/.test(`${line.rawName || ""} ${line.originalDescription || ""}`);
}

export function plannedIngredientName(line: PurchaseInvoiceLine): string {
  return (line.plannedProductName || line.originalDescription || line.rawName || "").trim();
}

export function isExistingIngredientAssignment(line: PurchaseInvoiceLine): boolean {
  if (lineSkipsStock(line) || !line.productId || line.matchKind === "suggest") return false;
  return isConfirmedInvoiceMatch(line);
}

export function isPlannedNewIngredient(line: PurchaseInvoiceLine): boolean {
  if (lineSkipsStock(line) || isExistingIngredientAssignment(line)) return false;
  if (line.matchKind === "new" && line.productId) return false;
  return true;
}

export function isIntakeAssignmentReady(line: PurchaseInvoiceLine): boolean {
  if (lineSkipsStock(line)) return true;
  if (isExistingIngredientAssignment(line)) return true;
  return isPlannedNewIngredient(line) && plannedIngredientName(line).length > 0;
}

export function supplierProductKey(line: PurchaseInvoiceLine): string {
  const sku = line.sku?.trim();
  if (sku) return `sku:${normalizeIngredientName(sku)}`;
  return `name:${normalizeIngredientName(line.originalDescription || line.rawName)}`;
}

export function preferredSupplierAssignments(lines: PurchaseInvoiceLine[]): PurchaseInvoiceLine[] {
  const chosen = new Map<string, PurchaseInvoiceLine>();
  for (const line of lines) {
    if (!line.productId || line.skipInventory) continue;
    const key = supplierProductKey(line);
    const current = chosen.get(key);
    if (!current || (current.matchKind === "new" && line.matchKind !== "new")) chosen.set(key, line);
  }
  return [...chosen.values()];
}

export function plannedCreateGroups(lines: PurchaseInvoiceLine[]): { key: string; name: string; lineKeys: string[] }[] {
  const groups: { key: string; name: string; lineKeys: string[] }[] = [];
  for (const line of lines) {
    if (!isPlannedNewIngredient(line)) continue;
    const key = supplierProductKey(line);
    const name = plannedIngredientName(line);
    const normalized = normalizeIngredientName(name);
    const existing = groups.find((group) => group.key === key || (normalized && normalizeIngredientName(group.name) === normalized));
    if (existing) {
      existing.lineKeys.push(line.key);
      continue;
    }
    groups.push({ key, name, lineKeys: [line.key] });
  }
  return groups;
}

export function invoiceAssignmentPlan(lines: PurchaseInvoiceLine[], ingredients: CostingIngredient[]) {
  const groups = plannedCreateGroups(lines);
  let createCount = 0;
  let existingRows = lines.filter((line) => isExistingIngredientAssignment(line)).length;
  for (const group of groups) {
    if (group.name && existingProductForInvoiceName(group.name, ingredients)) existingRows += group.lineKeys.length;
    else if (group.name) createCount += 1;
  }
  return { createCount, existingRows };
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
    if (line.skipInventory) return false;
    if (!line.productId || !isConfirmedInvoiceMatch(line)) return true;
    if (!line.unit || line.quantity == null || line.quantity <= 0) return true;
    if (packNeedsCompletion(line)) return true;
    return !lineHasAmount(line);
  }
  if (filter === "confirmed") return status === "confirmed";
  if (filter === "new") return status === "new";
  if (filter === "unmapped") return status === "none";
  return status === "possible" || Boolean(line.needsReview && status !== "confirmed" && status !== "new");
}

export function applyInvoiceLineSave<T extends { lines: PurchaseInvoiceLine[] }>(invoice: T, line: PurchaseInvoiceLine): T {
  const exists = invoice.lines.some((row) => row.key === line.key);
  return {
    ...invoice,
    lines: exists ? invoice.lines.map((row) => (row.key === line.key ? line : row)) : [...invoice.lines, line],
  };
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
    plannedProductName: undefined,
  };
}

export function planNewIngredientPatch(line: PurchaseInvoiceLine): Partial<PurchaseInvoiceLine> {
  return {
    productId: undefined,
    matchKind: "new",
    matchConfirmed: true,
    matchConfidence: null,
    rowStatus: "new",
    needsReview: false,
    plannedProductName: line.plannedProductName?.trim() || line.originalDescription || line.rawName,
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
