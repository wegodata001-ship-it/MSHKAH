import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";
import { unitsCompatible } from "@/lib/costing/units";
import { packNeedsCompletion } from "@/lib/inventory/ingredient-core";
import { isIntakeAssignmentReady } from "@/lib/inventory/invoice-line-review";
import { isNonStockInvoiceLine, lineHasAmount } from "@/lib/inventory/invoice-lines";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

export type InvoiceLineCareKind =
  | "ready"
  | "posted"
  | "ancillary"
  | "packaging"
  | "excluded"
  | "unsaved"
  | "missing-material"
  | "missing-pack"
  | "missing-unit"
  | "missing-qty"
  | "missing-price"
  | "field";

export type InvoiceLineStatusField = "product" | "category" | "quantity" | "unit" | "price" | "vat" | "pack" | "update";

export type InvoiceLineReviewStatus = {
  kind: InvoiceLineCareKind;
  ready: boolean;
  labelKey: string;
  field: InvoiceLineStatusField;
};

export function isAncillaryInvoiceLine(line: Pick<PurchaseInvoiceLine, "lineType">): boolean {
  return line.lineType === "SHIPPING" || line.lineType === "SERVICE" || line.lineType === "DISCOUNT" || line.lineType === "RETURN" || line.lineType === "DEPOSIT" || line.lineType === "SUMMARY" || line.lineType === "ADJUSTMENT";
}

export function isPackagingInvoiceLine(line: Pick<PurchaseInvoiceLine, "lineType" | "rawName" | "originalDescription" | "productId">): boolean {
  if (line.productId) return false;
  if (line.lineType === "GENERAL") return true;
  const name = `${line.rawName || ""} ${line.originalDescription || ""}`;
  return /פלסטיק|אריז|קרטון|שקית|ניילון/.test(name);
}

export function invoiceLineReviewStatus(
  line: PurchaseInvoiceLine,
  options?: {
    dirty?: boolean;
    productBase?: BaseUnit | null;
    product?: { baseUnit?: BaseUnit | null; purchaseUnit?: PurchaseUnit | null } | null;
  }
): InvoiceLineReviewStatus {
  if (line.postedToStock) {
    return { kind: "posted", ready: true, labelKey: "admin.inventory.smart.rowPosted", field: "product" };
  }
  if (isAncillaryInvoiceLine(line) || isNonStockInvoiceLine(line)) {
    return { kind: "ancillary", ready: true, labelKey: "admin.inventory.smart.rowAncillary", field: "product" };
  }
  if (isPackagingInvoiceLine(line)) {
    return { kind: "packaging", ready: true, labelKey: "admin.inventory.smart.rowPackaging", field: "product" };
  }
  if (line.skipInventory) {
    return { kind: "excluded", ready: true, labelKey: "admin.inventory.smart.rowExcluded", field: "product" };
  }
  if (!isIntakeAssignmentReady(line)) {
    return { kind: "missing-material", ready: false, labelKey: "admin.inventory.smart.rowMissingMaterial", field: "product" };
  }
  if (!line.unit) {
    return { kind: "missing-unit", ready: false, labelKey: "admin.inventory.smart.rowMissingUnit", field: "unit" };
  }
  if (line.quantity == null || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
    return { kind: "missing-qty", ready: false, labelKey: "admin.inventory.smart.rowMissingQty", field: "quantity" };
  }
  const product = options?.product ?? (options?.productBase ? { baseUnit: options.productBase } : null);
  if (invoiceUnitGap(line, product) === "mismatch") {
    return { kind: "missing-pack", ready: false, labelKey: "admin.inventory.smart.unitMismatch", field: "unit" };
  }
  if (!lineHasAmount(line)) {
    return { kind: "missing-price", ready: false, labelKey: "admin.inventory.smart.rowMissingPrice", field: "price" };
  }
  if (options?.dirty) {
    return { kind: "unsaved", ready: true, labelKey: "admin.inventory.smart.rowUnsaved", field: "update" };
  }
  return { kind: "ready", ready: true, labelKey: "admin.inventory.smart.rowReady", field: "product" };
}

export function workingInvoiceLines(
  lines: PurchaseInvoiceLine[],
  drafts: Record<string, PurchaseInvoiceLine> = {}
): PurchaseInvoiceLine[] {
  return lines.map((line) => drafts[line.key] ?? line);
}

/** Corrects the unit written on the invoice line. Quantity and price stay until a conversion is entered. */
export function applyInvoiceUnitChange(
  _line: Pick<PurchaseInvoiceLine, "unit" | "quantity" | "unitPrice">,
  nextUnit: PurchaseUnit | null
): Partial<PurchaseInvoiceLine> {
  return { unit: nextUnit };
}

export type InvoiceUnitScope = "all" | "selected" | "missing";

export function invoiceUnitTargets(
  lines: PurchaseInvoiceLine[],
  scope: InvoiceUnitScope,
  selectedKeys: Iterable<string> = []
): PurchaseInvoiceLine[] {
  if (scope === "selected") {
    const selected = new Set(selectedKeys);
    return lines.filter((line) => selected.has(line.key));
  }
  if (scope === "missing") return lines.filter((line) => !line.unit);
  return lines;
}

export function invoiceUnitGap(
  line: Pick<PurchaseInvoiceLine, "unit" | "conversionFactor" | "productId">,
  product?: { baseUnit?: BaseUnit | null; purchaseUnit?: PurchaseUnit | null } | null
): "missing" | "mismatch" | null {
  if (!line.productId || !product) return null;
  if (line.conversionFactor != null && Number(line.conversionFactor) > 0) return null;
  if (!line.unit) return "missing";
  if (product.purchaseUnit && !unitsCompatible(line.unit, product.purchaseUnit)) return "mismatch";
  if (packNeedsCompletion(line, product.baseUnit)) return "mismatch";
  return null;
}

export function invoiceLineEditStamp(line: PurchaseInvoiceLine): string {
  return JSON.stringify({
    rawName: line.rawName,
    plannedProductName: line.plannedProductName ?? null,
    productId: line.productId ?? null,
    matchKind: line.matchKind ?? null,
    matchConfirmed: Boolean(line.matchConfirmed),
    category: line.category ?? null,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    unitPrice: line.unitPrice ?? null,
    lineTotal: line.lineTotal ?? null,
    vatType: line.vatType ?? null,
    vatRate: line.vatRate ?? null,
    discount: line.discount ?? null,
    lastEditedField: line.lastEditedField ?? null,
    conversionFactor: line.conversionFactor ?? null,
    conversionNote: line.conversionNote ?? null,
  });
}

export function shouldClearInvoiceDraft(ok: boolean, revision: number, savedRevision: number): boolean {
  return ok && revision === savedRevision;
}

export function invoiceAfterPersist<T extends { id?: string }>(
  latest: T,
  snapshot: T,
  savedId: string,
  latestRevision: number,
  snapshotRevision: number
): T {
  if (latestRevision !== snapshotRevision) return { ...latest, id: savedId || latest.id };
  return { ...snapshot, id: savedId || snapshot.id };
}

export class InvoiceLineSaveError extends Error {
  lineKey: string;
  lineIndex: number;
  reason: string;

  constructor(lineKey: string, lineIndex: number, productName: string, reason: string) {
    super(`${lineIndex}. ${productName || "—"} — ${reason}`);
    this.name = "InvoiceLineSaveError";
    this.lineKey = lineKey;
    this.lineIndex = lineIndex;
    this.reason = reason;
  }
}

export type InvoiceLineBlocker = {
  lineKey: string;
  lineIndex: number;
  productName: string;
  kind: InvoiceLineCareKind;
  labelKey: string;
  field: InvoiceLineStatusField;
};

export function invoiceLineBlockers(
  lines: PurchaseInvoiceLine[],
  options?: {
    dirtyKeys?: Iterable<string>;
    productBaseById?: Record<string, BaseUnit | null | undefined>;
    productById?: Record<string, { baseUnit?: BaseUnit | null; purchaseUnit?: PurchaseUnit | null } | null | undefined>;
  }
): InvoiceLineBlocker[] {
  const dirty = new Set(options?.dirtyKeys ?? []);
  return lines.flatMap((line, index) => {
    const listed = line.productId ? options?.productById?.[line.productId] : null;
    const status = invoiceLineReviewStatus(line, {
      dirty: dirty.has(line.key),
      productBase: line.productId ? listed?.baseUnit ?? options?.productBaseById?.[line.productId] ?? null : null,
      product: listed ?? null,
    });
    if (status.ready) return [];
    return [{
      lineKey: line.key,
      lineIndex: index + 1,
      productName: line.originalDescription || line.rawName || "",
      kind: status.kind,
      labelKey: status.labelKey,
      field: status.field,
    }];
  });
}
