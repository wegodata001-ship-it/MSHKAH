import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import type { InventoryMovement, PurchaseInvoice, PurchaseInvoiceLine, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";

export type ProductSourceKind = "invoice" | "purchase-file" | "manual" | "other" | "undocumented";

export type ProductIntake = {
  id: string;
  at: string;
  kind: Exclude<ProductSourceKind, "undocumented">;
  detail?: "count" | "merge";
  supplierId?: string;
  supplierName?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  fileName?: string;
  fileUrl?: string;
  supplierProductName?: string;
  quantity: number;
  unit: PurchaseUnit;
  actor?: string;
  movementId: string;
};

export type ProductCreation = {
  kind: ProductSourceKind;
  at?: string;
  supplierId?: string;
  supplierName?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  fileName?: string;
  fileUrl?: string;
  supplierProductName?: string;
  actor?: string;
};

export type SupplierProductLink = {
  supplierId?: string;
  supplierName?: string;
  name: string;
};

export type ProductSourceSummary =
  | { code: "intake"; intakeId: string; more: boolean }
  | { code: "import-without-stock" }
  | { code: "created-invoice" }
  | { code: "created-manual" }
  | { code: "created-other" }
  | { code: "undocumented" };

export type ProductSource = {
  creation: ProductCreation;
  intakes: ProductIntake[];
  supplierProductNames: SupplierProductLink[];
  summary: ProductSourceSummary;
};

const CREATION_WINDOW_MS = 15 * 60 * 1000;

function timeOf(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isPurchaseFileInvoice(invoice: Pick<PurchaseInvoice, "notes" | "audit">): boolean {
  if (invoice.notes === "purchase-list-import") return true;
  return (invoice.audit ?? []).some((event) => event.action === "purchase-list-import");
}

function invoiceFileName(invoice: PurchaseInvoice): string | undefined {
  return invoice.fileName?.trim() || invoice.sourceFile?.originalFilename?.trim() || undefined;
}

function invoiceFileUrl(invoice: PurchaseInvoice): string | undefined {
  return invoice.sourceFile?.downloadUrl || invoice.fileUrl || undefined;
}

function lineSupplierName(line: PurchaseInvoiceLine): string | undefined {
  const name = line.originalDescription?.trim() || line.rawName?.trim();
  return name || undefined;
}

function supplierNameOf(suppliers: Supplier[], supplierId?: string, fallback?: string): string | undefined {
  if (supplierId) {
    const saved = suppliers.find((item) => item.id === supplierId)?.name?.trim();
    if (saved) return saved;
  }
  const name = fallback?.trim();
  return name || undefined;
}

function postedActor(invoice: PurchaseInvoice | undefined, movement: InventoryMovement): string | undefined {
  if (movement.actor?.trim()) return movement.actor.trim();
  if (!invoice || movement.invoiceId !== invoice.id) return undefined;
  if (invoice.inventoryPostedBy?.trim()) return invoice.inventoryPostedBy.trim();
  const posted = [...(invoice.audit ?? [])].reverse().find((event) => event.action === "INVENTORY_POSTED" && event.actor?.trim());
  return posted?.actor?.trim() || undefined;
}

function creationActor(invoice: PurchaseInvoice): string | undefined {
  const imported = [...(invoice.audit ?? [])].reverse().find((event) => event.action === "purchase-list-import" && event.actor?.trim());
  return imported?.actor?.trim() || invoice.createdBy?.trim() || undefined;
}

function sameProductLines(invoice: PurchaseInvoice, productId: string): PurchaseInvoiceLine[] {
  return (invoice.lines ?? []).filter((line) => line.productId === productId);
}

function nameForLine(invoice: PurchaseInvoice, productId: string, lineKey?: string): string | undefined {
  const lines = sameProductLines(invoice, productId);
  if (lineKey) {
    const exact = lines.find((line) => line.key === lineKey);
    if (exact) return lineSupplierName(exact);
  }
  if (lines.length === 1) return lineSupplierName(lines[0]);
  return undefined;
}

function creationFromInvoice(product: CostingIngredient, invoice: PurchaseInvoice, suppliers: Supplier[]): ProductCreation | null {
  const createdAt = timeOf(product.createdAt);
  const invoiceAt = timeOf(invoice.createdAt);
  if (createdAt == null || invoiceAt == null) return null;
  if (createdAt < invoiceAt - CREATION_WINDOW_MS) return null;
  const line = sameProductLines(invoice, product.id).find((item) => item.matchKind === "new");
  if (!line) return null;
  const file = isPurchaseFileInvoice(invoice);
  return {
    kind: file ? "purchase-file" : "invoice",
    at: invoice.createdAt,
    supplierId: invoice.supplierId,
    supplierName: supplierNameOf(suppliers, invoice.supplierId, invoice.supplierName),
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber?.trim() || undefined,
    fileName: invoiceFileName(invoice),
    fileUrl: invoiceFileUrl(invoice),
    supplierProductName: lineSupplierName(line),
    actor: creationActor(invoice),
  };
}

function intakeFromMovement(
  product: CostingIngredient,
  movement: InventoryMovement,
  invoices: PurchaseInvoice[],
  suppliers: Supplier[]
): ProductIntake | null {
  if (movement.productId !== product.id || !(movement.quantityBase > 0)) return null;
  if (movement.type !== "PURCHASE_IN" && movement.type !== "OPENING" && movement.type !== "ADJUSTMENT" && movement.type !== "REVERSAL") {
    return null;
  }
  const invoice = movement.invoiceId ? invoices.find((item) => item.id === movement.invoiceId) : undefined;
  const file = invoice ? isPurchaseFileInvoice(invoice) : false;
  let kind: ProductIntake["kind"] = "other";
  let detail: ProductIntake["detail"];
  if (movement.type === "PURCHASE_IN") {
    if (file) kind = "purchase-file";
    else if (movement.invoiceId) kind = "invoice";
  } else if (movement.type === "OPENING") {
    kind = "manual";
  } else if (movement.note?.startsWith("count:")) {
    detail = "count";
  } else if (movement.note?.startsWith("merge:")) {
    detail = "merge";
  }
  const supplierId = movement.supplierId || invoice?.supplierId;
  return {
    id: movement.id,
    at: movement.receivedAt || movement.invoiceDate || movement.createdAt || "",
    kind,
    detail,
    supplierId,
    supplierName: supplierNameOf(suppliers, supplierId, invoice?.supplierName),
    invoiceId: invoice?.id || movement.invoiceId,
    invoiceNumber: invoice?.invoiceNumber?.trim() || undefined,
    fileName: invoice ? invoiceFileName(invoice) : undefined,
    fileUrl: invoice ? invoiceFileUrl(invoice) : undefined,
    supplierProductName: invoice ? nameForLine(invoice, product.id, movement.invoiceLineId || movement.invoiceLineKey) : undefined,
    quantity: movement.quantity > 0 ? movement.quantity : movement.quantityBase,
    unit: movement.unit,
    actor: postedActor(invoice, movement),
    movementId: movement.id,
  };
}

function summaryFor(creation: ProductCreation, intakes: ProductIntake[]): ProductSourceSummary {
  if (intakes.length) return { code: "intake", intakeId: intakes[0].id, more: intakes.length > 1 };
  if (creation.kind === "purchase-file") return { code: "import-without-stock" };
  if (creation.kind === "invoice") return { code: "created-invoice" };
  if (creation.kind === "manual") return { code: "created-manual" };
  if (creation.kind === "other") return { code: "created-other" };
  return { code: "undocumented" };
}

export function buildProductSource(input: {
  product: CostingIngredient;
  invoices?: PurchaseInvoice[];
  movements?: InventoryMovement[];
  maps?: SupplierItemMap[];
  suppliers?: Supplier[];
}): ProductSource {
  const invoices = input.invoices ?? [];
  const suppliers = input.suppliers ?? [];
  const maps = input.maps ?? [];
  const creations = invoices
    .map((invoice) => creationFromInvoice(input.product, invoice, suppliers))
    .filter((item): item is ProductCreation => Boolean(item))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const documented = creations[0];
  const creation: ProductCreation = documented
    ? documented
    : input.product.originKind === "manual"
      ? { kind: "manual" }
      : input.product.originKind === "other"
        ? { kind: "other" }
        : { kind: "undocumented" };
  const intakes = (input.movements ?? [])
    .map((movement) => intakeFromMovement(input.product, movement, invoices, suppliers))
    .filter((item): item is ProductIntake => Boolean(item))
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const supplierProductNames = maps
    .filter((map) => map.inventoryProductId === input.product.id && map.supplierProductName.trim())
    .map((map) => ({
      supplierId: map.supplierId,
      supplierName: supplierNameOf(suppliers, map.supplierId),
      name: map.supplierProductName.trim(),
    }))
    .filter((item, index, all) => all.findIndex((row) => row.supplierId === item.supplierId && row.name === item.name) === index);
  return {
    creation,
    intakes,
    supplierProductNames,
    summary: summaryFor(creation, intakes),
  };
}

export function productMatchesSourceKind(source: ProductSource, kind: ProductSourceKind): boolean {
  if (kind === "undocumented") return source.summary.code === "undocumented";
  return source.creation.kind === kind || source.intakes.some((row) => row.kind === kind);
}

export function productMatchesSupplier(input: {
  product: CostingIngredient;
  supplierId: string;
  maps?: SupplierItemMap[];
  offers?: SupplierOffer[];
  source: ProductSource;
}): boolean {
  if (!input.supplierId) return true;
  if (input.product.lastSupplierId === input.supplierId) return true;
  if ((input.maps ?? []).some((map) => map.inventoryProductId === input.product.id && map.supplierId === input.supplierId)) return true;
  if ((input.offers ?? []).some((offer) => offer.productId === input.product.id && offer.supplierId === input.supplierId && offer.active !== false)) {
    return true;
  }
  if (input.source.creation.supplierId === input.supplierId) return true;
  return input.source.intakes.some((row) => row.supplierId === input.supplierId);
}
