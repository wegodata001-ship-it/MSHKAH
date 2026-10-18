import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";
import { convertRecipeQuantity, unitsCompatible } from "@/lib/costing/units";
import { packNeedsCompletion } from "@/lib/inventory/ingredient-core";
import { isConfirmedInvoiceMatch } from "@/lib/inventory/invoice-line-review";
import { lineHasAmount } from "@/lib/inventory/invoice-lines";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

export type InvoiceLineCareKind =
  | "ready"
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

export function invoiceLineReviewStatus(
  line: PurchaseInvoiceLine,
  options?: { dirty?: boolean; productBase?: BaseUnit | null }
): InvoiceLineReviewStatus {
  if (line.skipInventory) {
    return { kind: "ready", ready: true, labelKey: "admin.inventory.smart.rowReady", field: "product" };
  }
  if (!line.productId || !isConfirmedInvoiceMatch(line)) {
    return { kind: "missing-material", ready: false, labelKey: "admin.inventory.smart.rowMissingMaterial", field: "product" };
  }
  if (!line.unit) {
    return { kind: "missing-unit", ready: false, labelKey: "admin.inventory.smart.rowMissingUnit", field: "unit" };
  }
  if (line.quantity == null || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
    return { kind: "missing-qty", ready: false, labelKey: "admin.inventory.smart.rowMissingQty", field: "quantity" };
  }
  if (packNeedsCompletion(line, options?.productBase)) {
    return { kind: "missing-pack", ready: false, labelKey: "admin.inventory.smart.rowMissingPack", field: "pack" };
  }
  if (!lineHasAmount(line)) {
    return { kind: "missing-price", ready: false, labelKey: "admin.inventory.smart.rowMissingPrice", field: "price" };
  }
  if (options?.dirty) {
    return { kind: "unsaved", ready: false, labelKey: "admin.inventory.smart.rowUnsaved", field: "update" };
  }
  return { kind: "ready", ready: true, labelKey: "admin.inventory.smart.rowReady", field: "product" };
}

export function workingInvoiceLines(
  lines: PurchaseInvoiceLine[],
  drafts: Record<string, PurchaseInvoiceLine> = {}
): PurchaseInvoiceLine[] {
  return lines.map((line) => drafts[line.key] ?? line);
}

export function applyInvoiceUnitChange(
  line: Pick<PurchaseInvoiceLine, "unit" | "quantity">,
  nextUnit: PurchaseUnit | null
): Partial<PurchaseInvoiceLine> {
  if (!nextUnit) return { unit: null };
  if (!line.unit || line.quantity == null || !Number.isFinite(line.quantity)) return { unit: nextUnit };
  if (!unitsCompatible(line.unit, nextUnit)) return { unit: nextUnit };
  return { unit: nextUnit, quantity: convertRecipeQuantity(line.quantity, line.unit, nextUnit) };
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
  options?: { dirtyKeys?: Iterable<string>; productBaseById?: Record<string, BaseUnit | null | undefined> }
): InvoiceLineBlocker[] {
  const dirty = new Set(options?.dirtyKeys ?? []);
  return lines.flatMap((line, index) => {
    const status = invoiceLineReviewStatus(line, {
      dirty: dirty.has(line.key),
      productBase: line.productId ? options?.productBaseById?.[line.productId] ?? null : null,
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
