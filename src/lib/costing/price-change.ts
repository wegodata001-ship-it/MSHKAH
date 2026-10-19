import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import type {
  PurchaseInvoice,
  PurchasePriceRecord,
  Supplier,
} from "@/lib/inventory/types";
import { costPerBaseUnit, purchaseQuantityInBase } from "@/lib/costing/units";

export type PriceVatBasis = "before" | "including";

export type ApprovedPurchasePrice = {
  record: PurchasePriceRecord;
  /** Net (before-VAT) price for one base unit (g / ml / unit). */
  pricePerBaseBefore: number;
  /** Gross (including-VAT) price for one base unit. */
  pricePerBaseIncluding: number;
  /** YYYY-MM-DD business date of the purchase. */
  purchaseDate: string;
  supplierId?: string;
  supplierName?: string;
  invoiceId?: string;
  invoiceNumber?: string;
};

export type PriceComparisonSame = {
  kind: "same-supplier" | "cross-supplier";
  previous: ApprovedPurchasePrice;
  current: ApprovedPurchasePrice;
  basis: PriceVatBasis;
  previousBase: number;
  currentBase: number;
  deltaIls: number;
  deltaPct: number | null;
  direction: "up" | "down" | "flat";
};

export type PriceComparisonMissing = {
  kind: "missing-data";
  reason: "no-previous" | "no-base-quantity" | "invalid-price";
  current: ApprovedPurchasePrice | null;
};

export type PriceComparison = PriceComparisonSame | PriceComparisonMissing;

export type IngredientPriceSummary = {
  ingredientId: string;
  /** The source of the price shown on the row. */
  source: "manual" | "invoice" | "none";
  /** Current price for one base unit, in the UI's VAT basis. */
  pricePerBase: number;
  /** Base unit (g / ml / unit) used by the ingredient. */
  baseUnit: "g" | "ml" | "unit";
  /** YYYY-MM-DD of the latest approved purchase, if any. */
  priceDate?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  supplierId?: string;
  supplierName?: string;
  current?: ApprovedPurchasePrice;
  comparison: PriceComparison;
  /**
   * When the latest approved purchase differs materially from the price stored
   * on the ingredient, this holds the suggested replacement.
   */
  suggestion: {
    hasUpdate: boolean;
    isManualOverride: boolean;
    nextCostPerBase: number;
    nextPurchasePrice: number;
    nextPurchaseQuantity: number;
    nextPurchaseUnit: PurchaseUnit;
    basis: PriceVatBasis;
    source: ApprovedPurchasePrice;
  } | null;
};

const EPSILON = 0.0001;

function invoiceIsApproved(invoice: PurchaseInvoice | undefined): boolean {
  if (!invoice) return true; // record exists → treat as approved by default
  return invoice.status === "approved" || invoice.status === "saved";
}

function recordBaseQty(record: PurchasePriceRecord): number {
  const qty = record.purchaseQuantity ?? record.packageQuantity ?? record.quantity;
  const unit = (record.purchaseUnit ?? record.unit) as PurchaseUnit | undefined;
  if (!qty || !unit) return 0;
  return purchaseQuantityInBase(qty, unit);
}

function recordNetTotal(record: PurchasePriceRecord): number {
  if (record.lineTotalNet != null && record.lineTotalNet > 0) return record.lineTotalNet;
  if (record.priceBeforeVat && record.priceBeforeVat > 0) return record.priceBeforeVat;
  if (record.unitPriceNet != null && record.unitPriceNet > 0 && record.quantity > 0) {
    return record.unitPriceNet * record.quantity;
  }
  return 0;
}

function recordGrossTotal(record: PurchasePriceRecord): number {
  if (record.lineTotalGross != null && record.lineTotalGross > 0) return record.lineTotalGross;
  if (record.priceIncludingVat && record.priceIncludingVat > 0) return record.priceIncludingVat;
  if (record.unitPriceGross != null && record.unitPriceGross > 0 && record.quantity > 0) {
    return record.unitPriceGross * record.quantity;
  }
  if (record.unitCost && record.unitCost > 0) {
    return record.unitCost * recordBaseQty(record);
  }
  return 0;
}

export function approvedPurchasePrice(
  record: PurchasePriceRecord,
  invoices: Map<string, PurchaseInvoice>,
  suppliers: Map<string, Supplier>
): ApprovedPurchasePrice | null {
  const invoice = record.invoiceId ? invoices.get(record.invoiceId) : undefined;
  if (invoice && !invoiceIsApproved(invoice)) return null;
  const baseQty = recordBaseQty(record);
  if (baseQty <= 0) return null;
  const net = recordNetTotal(record);
  const gross = recordGrossTotal(record);
  const beforePerBase = net > 0 ? net / baseQty : 0;
  const grossPerBase = gross > 0 ? gross / baseQty : beforePerBase;
  if (beforePerBase <= 0 && grossPerBase <= 0) return null;
  const supplier = record.supplierId ? suppliers.get(record.supplierId) : undefined;
  return {
    record,
    pricePerBaseBefore: beforePerBase > 0 ? beforePerBase : grossPerBase,
    pricePerBaseIncluding: grossPerBase > 0 ? grossPerBase : beforePerBase,
    purchaseDate: record.purchaseDate,
    supplierId: record.supplierId,
    supplierName: supplier?.name,
    invoiceId: record.invoiceId,
    invoiceNumber: invoice?.invoiceNumber,
  };
}

export function approvedPurchasesForIngredient(
  records: PurchasePriceRecord[],
  invoices: PurchaseInvoice[],
  suppliers: Supplier[],
  ingredientId: string
): ApprovedPurchasePrice[] {
  if (!ingredientId) return [];
  const invoiceMap = new Map(invoices.map((item) => [item.id, item]));
  const supplierMap = new Map(suppliers.map((item) => [item.id, item]));
  const list: ApprovedPurchasePrice[] = [];
  for (const record of records) {
    if (record.productId !== ingredientId) continue;
    const resolved = approvedPurchasePrice(record, invoiceMap, supplierMap);
    if (!resolved) continue;
    list.push(resolved);
  }
  return list.sort((a, b) =>
    (b.purchaseDate || "").localeCompare(a.purchaseDate || "") ||
    (b.record.createdAt || "").localeCompare(a.record.createdAt || "")
  );
}

function priceOnBasis(price: ApprovedPurchasePrice, basis: PriceVatBasis): number {
  return basis === "including" ? price.pricePerBaseIncluding : price.pricePerBaseBefore;
}

export function compareApprovedPurchases(
  current: ApprovedPurchasePrice,
  previous: ApprovedPurchasePrice,
  basis: PriceVatBasis
): PriceComparisonSame | PriceComparisonMissing {
  const currentBase = priceOnBasis(current, basis);
  const previousBase = priceOnBasis(previous, basis);
  if (!(currentBase > 0) || !(previousBase > 0)) {
    return { kind: "missing-data", reason: "invalid-price", current };
  }
  const deltaIls = currentBase - previousBase;
  const deltaPct = previousBase > 0 ? deltaIls / previousBase : null;
  const direction: "up" | "down" | "flat" =
    Math.abs(deltaIls) <= EPSILON ? "flat" : deltaIls > 0 ? "up" : "down";
  return {
    kind:
      current.supplierId && previous.supplierId && current.supplierId === previous.supplierId
        ? "same-supplier"
        : "cross-supplier",
    previous,
    current,
    basis,
    previousBase,
    currentBase,
    deltaIls,
    deltaPct,
    direction,
  };
}

export function buildIngredientPriceSummary(
  ingredient: CostingIngredient,
  records: PurchasePriceRecord[],
  invoices: PurchaseInvoice[],
  suppliers: Supplier[],
  basis: PriceVatBasis = "before"
): IngredientPriceSummary {
  const approved = approvedPurchasesForIngredient(records, invoices, suppliers, ingredient.id);
  const current = approved[0];
  const storedCost = Number.isFinite(ingredient.costPerBaseUnit) ? ingredient.costPerBaseUnit : 0;
  const isManualOverride = ingredient.originKind === "manual" && approved.length === 0 && storedCost > 0;
  let source: IngredientPriceSummary["source"] = "none";
  if (current) source = "invoice";
  else if (storedCost > 0) source = "manual";

  const pricePerBase = current ? priceOnBasis(current, basis) : storedCost;

  // Find previous same-supplier record.
  let comparison: PriceComparison = { kind: "missing-data", reason: "no-previous", current: current ?? null };
  if (current) {
    const sameSupplier = approved
      .slice(1)
      .find((item) => item.supplierId && current.supplierId && item.supplierId === current.supplierId);
    const other = approved.slice(1).find((item) => item !== sameSupplier);
    const prev = sameSupplier ?? other ?? null;
    if (prev) comparison = compareApprovedPurchases(current, prev, basis);
  }

  // Suggest update when the latest approved price differs from stored.
  let suggestion: IngredientPriceSummary["suggestion"] = null;
  if (current && storedCost > 0) {
    const latestBase = priceOnBasis(current, basis);
    const diff = latestBase - storedCost;
    const diffPct = storedCost > 0 ? Math.abs(diff) / storedCost : 0;
    if (Math.abs(diff) > EPSILON && diffPct > 0.001) {
      const purchaseUnit = (current.record.purchaseUnit ?? current.record.unit ?? ingredient.purchaseUnit) as PurchaseUnit;
      const purchaseQty =
        current.record.purchaseQuantity ?? current.record.packageQuantity ?? current.record.quantity ?? 1;
      const purchasePrice =
        basis === "including"
          ? recordGrossTotal(current.record) || recordNetTotal(current.record)
          : recordNetTotal(current.record) || recordGrossTotal(current.record);
      suggestion = {
        hasUpdate: true,
        isManualOverride: ingredient.originKind === "manual",
        nextCostPerBase: costPerBaseUnit(purchasePrice, purchaseQty, purchaseUnit),
        nextPurchasePrice: purchasePrice,
        nextPurchaseQuantity: purchaseQty,
        nextPurchaseUnit: purchaseUnit,
        basis,
        source: current,
      };
    }
  } else if (current && storedCost <= 0) {
    const purchaseUnit = (current.record.purchaseUnit ?? current.record.unit ?? ingredient.purchaseUnit) as PurchaseUnit;
    const purchaseQty =
      current.record.purchaseQuantity ?? current.record.packageQuantity ?? current.record.quantity ?? 1;
    const purchasePrice =
      basis === "including"
        ? recordGrossTotal(current.record) || recordNetTotal(current.record)
        : recordNetTotal(current.record) || recordGrossTotal(current.record);
    suggestion = {
      hasUpdate: true,
      isManualOverride: false,
      nextCostPerBase: costPerBaseUnit(purchasePrice, purchaseQty, purchaseUnit),
      nextPurchasePrice: purchasePrice,
      nextPurchaseQuantity: purchaseQty,
      nextPurchaseUnit: purchaseUnit,
      basis,
      source: current,
    };
  }

  return {
    ingredientId: ingredient.id,
    source: isManualOverride ? "manual" : source,
    pricePerBase,
    baseUnit: ingredient.baseUnit,
    priceDate: current?.purchaseDate,
    invoiceId: current?.invoiceId,
    invoiceNumber: current?.invoiceNumber,
    supplierId: current?.supplierId,
    supplierName: current?.supplierName,
    current,
    comparison,
    suggestion,
  };
}

/** Returns the price label suitable for a purchase unit label such as kg / liter. */
export function pricePerPurchaseUnit(pricePerBase: number, purchaseUnit: PurchaseUnit): number {
  if (!(pricePerBase > 0)) return 0;
  return pricePerBase * purchaseQuantityInBase(1, purchaseUnit);
}
