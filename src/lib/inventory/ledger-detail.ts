import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import { movementSignedBase } from "@/lib/inventory/stock";
import type { InventoryMovement, PurchaseInvoice, PurchaseInvoiceLine, Supplier } from "@/lib/inventory/types";

export type LedgerInvoiceSource = {
  kind: "invoice";
  invoiceId: string;
  invoiceLineId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  productName?: string;
  fileUrl?: string;
  fileName?: string;
  quantityMatches: boolean | null;
  restored: boolean;
  missing: boolean;
};

export type LedgerReferenceSource = {
  kind: "reference";
  labelKey: string;
  text?: string;
};

export type LedgerUnlinkedSource = {
  kind: "unlinked";
};

export type LedgerSource = LedgerInvoiceSource | LedgerReferenceSource | LedgerUnlinkedSource;

export type LedgerDetail = {
  movementId: string;
  movement: InventoryMovement;
  movementDate: string;
  supplierId?: string;
  supplierName?: string;
  source: LedgerSource;
  balanceAfterBase: number;
};

export type LedgerFilter = {
  from?: string;
  to?: string;
  supplierId?: string;
};

const QTY_EPSILON = 0.001;

function dateOnly(value?: string): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function storedLineId(movement: InventoryMovement): string | undefined {
  const id = movement.invoiceLineId?.trim() || movement.invoiceLineKey?.trim();
  return id || undefined;
}

function lineProductName(line: PurchaseInvoiceLine): string | undefined {
  const name = line.originalDescription?.trim() || line.rawName?.trim();
  return name || undefined;
}

function invoiceFile(invoice: PurchaseInvoice): { fileUrl?: string; fileName?: string } {
  return {
    fileUrl: invoice.sourceFile?.downloadUrl || invoice.fileUrl || undefined,
    fileName: invoice.fileName?.trim() || invoice.sourceFile?.originalFilename?.trim() || undefined,
  };
}

export function receivedQuantityMatchesLine(
  movement: Pick<InventoryMovement, "quantityBase">,
  line: Pick<PurchaseInvoiceLine, "quantity" | "unit" | "conversionFactor">
): boolean {
  const lineBase = invoiceLineQuantityBase(line);
  if (lineBase == null) return false;
  const received = Math.abs(movement.quantityBase);
  const diff = Math.abs(received - lineBase);
  const scale = Math.max(received, lineBase, 1);
  return diff <= QTY_EPSILON || diff / scale <= 1e-6;
}

function claimedLineKeys(invoice: PurchaseInvoice, movement: InventoryMovement, siblings: InventoryMovement[]): Set<string> {
  const claimed = new Set<string>();
  if (!invoice.id) return claimed;
  for (const other of siblings) {
    if (other.id === movement.id) continue;
    const otherLine = other.invoiceLineId?.trim() || other.invoiceLineKey?.trim();
    if (other.invoiceId === invoice.id && otherLine) claimed.add(otherLine);
    for (const line of invoice.lines ?? []) {
      if (other.id === invoicePurchaseMovementId(invoice.id, line.key)) claimed.add(line.key);
    }
  }
  return claimed;
}

function unambiguousLine(invoice: PurchaseInvoice, movement: InventoryMovement, siblings: InventoryMovement[]): PurchaseInvoiceLine | undefined {
  const claimed = claimedLineKeys(invoice, movement, siblings);
  const candidates = (invoice.lines ?? []).filter(
    (line) => Boolean(line.productId) && line.productId === movement.productId && !claimed.has(line.key)
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function movementIdIndex(invoices: PurchaseInvoice[]): Map<string, { invoice: PurchaseInvoice; line: PurchaseInvoiceLine } | "ambiguous"> {
  const index = new Map<string, { invoice: PurchaseInvoice; line: PurchaseInvoiceLine } | "ambiguous">();
  for (const invoice of invoices) {
    if (!invoice.id) continue;
    for (const line of invoice.lines ?? []) {
      const id = invoicePurchaseMovementId(invoice.id, line.key);
      index.set(id, index.has(id) ? "ambiguous" : { invoice, line });
    }
  }
  return index;
}

function supplierOf(
  movement: InventoryMovement,
  invoice: PurchaseInvoice | undefined,
  suppliers: Supplier[]
): { supplierId?: string; supplierName?: string } {
  const supplierId = movement.supplierId || invoice?.supplierId;
  if (!supplierId) return { supplierName: invoice?.supplierName?.trim() || undefined };
  const saved = suppliers.find((item) => item.id === supplierId)?.name?.trim();
  return { supplierId, supplierName: saved || invoice?.supplierName?.trim() || undefined };
}

function invoiceSource(
  movement: InventoryMovement,
  invoice: PurchaseInvoice,
  line: PurchaseInvoiceLine | undefined,
  restored: boolean
): LedgerInvoiceSource {
  const file = invoiceFile(invoice);
  const invoiceDate = dateOnly(invoice.invoiceDate) || dateOnly(movement.invoiceDate) || undefined;
  return {
    kind: "invoice",
    invoiceId: invoice.id,
    invoiceLineId: line?.key,
    invoiceNumber: invoice.invoiceNumber?.trim() || undefined,
    invoiceDate,
    productName: line ? lineProductName(line) : undefined,
    fileUrl: file.fileUrl,
    fileName: file.fileName,
    quantityMatches: line ? receivedQuantityMatchesLine(movement, line) : null,
    restored,
    missing: false,
  };
}

function resolvePurchase(
  movement: InventoryMovement,
  siblings: InventoryMovement[],
  byId: Map<string, PurchaseInvoice>,
  byMovementId: Map<string, { invoice: PurchaseInvoice; line: PurchaseInvoiceLine } | "ambiguous">
): LedgerInvoiceSource | null {
  const lineId = storedLineId(movement);
  if (movement.invoiceId) {
    const invoice = byId.get(movement.invoiceId);
    if (!invoice) {
      return {
        kind: "invoice",
        invoiceId: movement.invoiceId,
        invoiceLineId: lineId,
        invoiceDate: dateOnly(movement.invoiceDate) || undefined,
        quantityMatches: null,
        restored: false,
        missing: true,
      };
    }
    if (lineId) {
      const line = (invoice.lines ?? []).find((item) => item.key === lineId);
      return invoiceSource(movement, invoice, line, false);
    }
    const line = unambiguousLine(invoice, movement, siblings);
    return invoiceSource(movement, invoice, line, Boolean(line));
  }

  const fromId = byMovementId.get(movement.id);
  if (!fromId || fromId === "ambiguous") return null;
  return invoiceSource(movement, fromId.invoice, fromId.line, true);
}

function referenceSource(movement: InventoryMovement): LedgerReferenceSource {
  if (movement.type === "OPENING") {
    return { kind: "reference", labelKey: "admin.inventory.movement.OPENING", text: movement.note?.trim() || undefined };
  }
  if (movement.type === "ADJUSTMENT") {
    const note = movement.note?.trim() || "";
    if (note.startsWith("count:")) return { kind: "reference", labelKey: "admin.inventory.source.count", text: note.slice("count:".length).trim() || undefined };
    if (note.startsWith("merge:")) return { kind: "reference", labelKey: "admin.inventory.source.merge", text: note.slice("merge:".length).trim() || undefined };
    return { kind: "reference", labelKey: "admin.inventory.ledger.manualAdjustment", text: note || undefined };
  }
  if (movement.type === "REVERSAL") {
    return { kind: "reference", labelKey: "admin.inventory.movement.REVERSAL", text: movement.note?.trim() || movement.reversesId };
  }
  if (movement.type === "SALE_OUT") {
    return { kind: "reference", labelKey: "admin.inventory.movement.SALE_OUT", text: movement.orderId || movement.posImportId };
  }
  if (movement.type === "ISSUE_OUT") {
    return {
      kind: "reference",
      labelKey: movement.reason ? `admin.inventory.reason.${movement.reason}` : "admin.inventory.movement.ISSUE_OUT",
      text: movement.note?.trim() || undefined,
    };
  }
  return { kind: "reference", labelKey: "admin.inventory.source.other", text: movement.note?.trim() || undefined };
}

export function buildLedgerDetails(input: {
  movements: InventoryMovement[];
  productId: string;
  invoices?: PurchaseInvoice[];
  suppliers?: Supplier[];
}): LedgerDetail[] {
  const invoices = input.invoices ?? [];
  const suppliers = input.suppliers ?? [];
  const byId = new Map(invoices.filter((invoice) => invoice.id).map((invoice) => [invoice.id, invoice]));
  const byMovementId = movementIdIndex(invoices);
  const rows = input.movements
    .filter((row) => row.productId === input.productId)
    .slice()
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  let running = 0;
  return rows.map((movement) => {
    running += movementSignedBase(movement);
    const purchase = movement.type === "PURCHASE_IN" ? resolvePurchase(movement, input.movements, byId, byMovementId) : null;
    const invoice = purchase && !purchase.missing ? byId.get(purchase.invoiceId) : undefined;
    const supplier = supplierOf(movement, invoice, suppliers);
    const source: LedgerSource = purchase ?? (movement.type === "PURCHASE_IN" ? { kind: "unlinked" } : referenceSource(movement));
    return {
      movementId: movement.id,
      movement,
      movementDate: dateOnly(movement.receivedAt),
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
      source,
      balanceAfterBase: running,
    };
  });
}

export function filterLedgerDetails(rows: LedgerDetail[], filter: LedgerFilter): LedgerDetail[] {
  const from = dateOnly(filter.from);
  const to = dateOnly(filter.to);
  const supplierId = filter.supplierId?.trim() || "";
  return rows.filter((row) => {
    if (from && row.movementDate < from) return false;
    if (to && row.movementDate > to) return false;
    if (supplierId && row.supplierId !== supplierId) return false;
    return true;
  });
}

export function formatLedgerQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
  return String(rounded);
}

export function ledgerReferenceText(source: LedgerReferenceSource, t: (key: string, fallback?: string) => string): string {
  const label = t(source.labelKey, source.labelKey);
  return source.text ? `${label} · ${source.text}` : label;
}
