import { roundMoney } from "@/lib/costing/money";
import { headerGross } from "@/lib/inventory/invoice-finance";
import type { CashFlowEntry, CashInvoice } from "@/lib/cashflow/engine";
import type {
  InventoryMovement,
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  PurchasePriceRecord,
  Supplier,
  SupplierItemMap,
  SupplierOffer,
} from "@/lib/inventory/types";
import type { CostingIngredient } from "@/lib/costing/types";

export type SupplierPaymentStatus = "executed" | "planned" | "cancelled";
export type SupplierPaymentMethod = "cash" | "bank" | "check" | "card" | "other";

export type SupplierPaymentAllocation = {
  invoiceId: string;
  amount: number;
};

export type SupplierLedgerHistory = {
  at: string;
  actor?: string;
  change: string;
};

export type SupplierPayment = {
  id: string;
  supplierId: string;
  amount: number;
  paidAt: string;
  dueAt?: string;
  method: SupplierPaymentMethod;
  reference?: string;
  account?: string;
  note?: string;
  status: SupplierPaymentStatus;
  allocations: SupplierPaymentAllocation[];
  idempotencyKey?: string;
  cashEntryIds?: string[];
  actor?: string;
  createdAt: string;
  updatedAt?: string;
  history?: SupplierLedgerHistory[];
};

export type SupplierOpening = {
  id: string;
  supplierId: string;
  amount: number;
  date: string;
  note?: string;
  actor?: string;
  createdAt: string;
  history?: SupplierLedgerHistory[];
};

export type LedgerKind = "opening" | "invoice" | "credit" | "delivery" | "payment";

export type SupplierLedgerRow = {
  id: string;
  at: string;
  createdAt: string;
  kind: LedgerKind;
  reference?: string;
  description: string;
  increase: number;
  decrease: number;
  balanceAfter: number;
  sourceId?: string;
  countsInBalance: boolean;
};

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90" | "missing";

export type OpenDocument = {
  id: string;
  number: string;
  dueDate?: string;
  open: number;
  bucket: AgingBucket;
};

export type SupplierLedgerSummary = {
  rows: SupplierLedgerRow[];
  balance: number;
  periodPurchases: number;
  periodPayments: number;
  periodOpening: number;
  periodClosing: number;
  overdue: number;
  aging: Record<AgingBucket, number>;
  missingDue: OpenDocument[];
  nextPayment?: { date: string; amount: number; planned: boolean; reference?: string };
  openDocuments: OpenDocument[];
};

const APPROVED: PurchaseInvoiceStatus[] = ["saved", "approved"];
const UNAPPROVED_SCAN = new Set(["uploaded", "scanning", "needs_review", "failed", "cancelled"]);
const KIND_RANK: Record<LedgerKind, number> = { opening: 0, invoice: 1, delivery: 2, credit: 3, payment: 4 };

export function paymentDocId(supplierId: string, idempotencyKey: string): string {
  return `sp-${supplierId}-${idempotencyKey}`.replace(/[\/\\#?[\]*]/g, "_").slice(0, 700);
}

export function openingDocId(supplierId: string): string {
  return `so-${supplierId}`.replace(/[\/\\#?[\]*]/g, "_").slice(0, 700);
}

export function cashEntryId(paymentId: string, suffix: string): string {
  return `cf-${paymentId}-${suffix}`.replace(/[\/\\#?[\]*]/g, "_").slice(0, 700);
}

export function paymentCashEntries(payment: SupplierPayment, supplierName: string): CashFlowEntry[] {
  if (payment.status !== "executed") return [];
  const entries: CashFlowEntry[] = payment.allocations
    .filter((allocation) => allocation.amount > 0)
    .map((allocation) => ({
      id: cashEntryId(payment.id, allocation.invoiceId),
      kind: "settlement" as const,
      direction: "out" as const,
      amount: roundMoney(allocation.amount),
      date: dateOnly(payment.paidAt),
      description: payment.reference || payment.note || supplierName,
      counterparty: supplierName,
      account: payment.account,
      status: "done" as const,
      invoiceId: allocation.invoiceId,
      appliesToKey: `invoice:${allocation.invoiceId}`,
      paymentMethod: payment.method,
      history: [{ at: payment.createdAt, change: "supplier-payment" }],
    }));
  const allocated = roundMoney(payment.allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const excess = roundMoney(payment.amount - allocated);
  if (excess > 0.009) {
    entries.push({
      id: cashEntryId(payment.id, "excess"),
      kind: "settlement",
      direction: "out",
      amount: excess,
      date: dateOnly(payment.paidAt),
      description: payment.note || payment.reference || supplierName,
      counterparty: supplierName,
      account: payment.account,
      status: "done",
      paymentMethod: payment.method,
      history: [{ at: payment.createdAt, change: "supplier-credit" }],
    });
  }
  return entries;
}

function digits(value?: string): string {
  return (value ?? "").replace(/\D/g, "");
}

function dateOnly(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

export function documentGross(invoice: Pick<PurchaseInvoice, "grossAmount" | "grandTotal">): number {
  return roundMoney(Math.abs(headerGross(invoice) ?? 0));
}

export function isApprovedDocument(invoice: Pick<PurchaseInvoice, "status" | "scanStatus">): boolean {
  if (!APPROVED.includes(invoice.status)) return false;
  if (invoice.scanStatus && UNAPPROVED_SCAN.has(invoice.scanStatus)) return false;
  return true;
}

export function coveredDeliveryIds(invoices: PurchaseInvoice[]): Set<string> {
  const covered = new Set<string>();
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  for (const invoice of invoices) {
    if (!isApprovedDocument(invoice) || invoice.documentType === "delivery" || invoice.documentType === "credit") continue;
    for (const id of invoice.coversDeliveryIds ?? []) covered.add(id);
  }
  for (const invoice of invoices) {
    if (invoice.documentType !== "delivery" || !invoice.coveredByInvoiceId) continue;
    const cover = byId.get(invoice.coveredByInvoiceId);
    if (cover && isApprovedDocument(cover) && cover.documentType !== "delivery" && cover.documentType !== "credit") {
      covered.add(invoice.id);
    }
  }
  return covered;
}

export function debtEffect(invoice: PurchaseInvoice, covered: Set<string>): number {
  if (invoice.documentType === "delivery") {
    if (!isApprovedDocument(invoice) || covered.has(invoice.id)) return 0;
    return documentGross(invoice);
  }
  if (!isApprovedDocument(invoice)) return 0;
  if (invoice.documentType === "credit") return -documentGross(invoice);
  return documentGross(invoice);
}

export function resolveSupplierId(id: string, suppliers: Supplier[]): string {
  const seen = new Set<string>();
  let current = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const next = suppliers.find((item) => item.id === current)?.mergedInto;
    if (!next || next === current) return current;
    current = next;
  }
  return id;
}

export function supplierScopeIds(supplierId: string, suppliers: Supplier[]): Set<string> {
  const ids = new Set<string>();
  for (const supplier of suppliers) {
    if (resolveSupplierId(supplier.id, suppliers) === supplierId) ids.add(supplier.id);
  }
  ids.add(supplierId);
  return ids;
}

function uniquePayments(payments: SupplierPayment[]): SupplierPayment[] {
  const seen = new Set<string>();
  return payments.filter((payment) => {
    if (seen.has(payment.id)) return false;
    seen.add(payment.id);
    return true;
  });
}

function executedAllocations(payments: SupplierPayment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const payment of uniquePayments(payments)) {
    if (payment.status !== "executed") continue;
    for (const allocation of payment.allocations) {
      totals.set(allocation.invoiceId, roundMoney((totals.get(allocation.invoiceId) ?? 0) + allocation.amount));
    }
  }
  return totals;
}

export function compareLedgerRows(a: Pick<SupplierLedgerRow, "at" | "kind" | "createdAt" | "id">, b: Pick<SupplierLedgerRow, "at" | "kind" | "createdAt" | "id">): number {
  return dateOnly(a.at).localeCompare(dateOnly(b.at)) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function buildRows(input: {
  invoices: PurchaseInvoice[];
  payments: SupplierPayment[];
  openings: SupplierOpening[];
}): SupplierLedgerRow[] {
  const covered = coveredDeliveryIds(input.invoices);
  const drafts: Omit<SupplierLedgerRow, "balanceAfter">[] = [];
  for (const opening of input.openings) {
    if (!opening.date || !Number.isFinite(opening.amount) || opening.amount === 0) continue;
    const amount = roundMoney(opening.amount);
    drafts.push({
      id: opening.id,
      at: dateOnly(opening.date),
      createdAt: opening.createdAt || opening.date,
      kind: "opening",
      reference: opening.note,
      description: opening.note || "",
      increase: amount > 0 ? amount : 0,
      decrease: amount < 0 ? Math.abs(amount) : 0,
      sourceId: opening.id,
      countsInBalance: true,
    });
  }
  for (const invoice of input.invoices) {
    const effect = debtEffect(invoice, covered);
    if (effect === 0 && !(isApprovedDocument(invoice) && invoice.documentType === "delivery" && covered.has(invoice.id))) continue;
    if (effect === 0) continue;
    const credit = effect < 0;
    drafts.push({
      id: `doc-${invoice.id}`,
      at: dateOnly(invoice.invoiceDate || invoice.receivedAt),
      createdAt: invoice.createdAt || invoice.invoiceDate || "",
      kind: credit ? "credit" : invoice.documentType === "delivery" ? "delivery" : "invoice",
      reference: invoice.invoiceNumber,
      description: invoice.supplierName || invoice.invoiceNumber,
      increase: effect > 0 ? effect : 0,
      decrease: effect < 0 ? Math.abs(effect) : 0,
      sourceId: invoice.id,
      countsInBalance: true,
    });
  }
  for (const payment of uniquePayments(input.payments)) {
    if (payment.status !== "executed") continue;
    drafts.push({
      id: payment.id,
      at: dateOnly(payment.paidAt),
      createdAt: payment.createdAt,
      kind: "payment",
      reference: payment.reference,
      description: payment.note || payment.reference || "",
      increase: 0,
      decrease: roundMoney(payment.amount),
      sourceId: payment.id,
      countsInBalance: true,
    });
  }
  drafts.sort(compareLedgerRows);
  let balance = 0;
  return drafts.map((row) => {
    balance = roundMoney(balance + row.increase - row.decrease);
    return { ...row, balanceAfter: balance };
  });
}

function daysLate(due: string, today: string): number {
  const start = Date.parse(`${due}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function bucketFor(due: string | undefined, today: string): AgingBucket {
  if (!due) return "missing";
  const late = daysLate(due, today);
  if (late <= 0) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90";
}

function openCharges(invoices: PurchaseInvoice[], payments: SupplierPayment[]): OpenDocument[] {
  const covered = coveredDeliveryIds(invoices);
  const paid = executedAllocations(payments);
  const rows: OpenDocument[] = [];
  for (const invoice of invoices) {
    const effect = debtEffect(invoice, covered);
    if (effect <= 0) continue;
    const open = roundMoney(Math.max(0, effect - (paid.get(invoice.id) ?? 0)));
    if (open <= 0.009) continue;
    rows.push({
      id: invoice.id,
      number: invoice.invoiceNumber,
      dueDate: dateOnly(invoice.dueDate) || undefined,
      open,
      bucket: "current",
    });
  }
  return rows;
}

function applyCreditPool(documents: OpenDocument[], pool: number): OpenDocument[] {
  const ordered = documents
    .slice()
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99") || a.id.localeCompare(b.id));
  let left = roundMoney(Math.max(0, pool));
  return ordered.flatMap((row) => {
    const cut = Math.min(row.open, left);
    left = roundMoney(left - cut);
    const open = roundMoney(row.open - cut);
    return open > 0.009 ? [{ ...row, open }] : [];
  });
}

export function buildSupplierLedger(input: {
  invoices: PurchaseInvoice[];
  payments?: SupplierPayment[];
  openings?: SupplierOpening[];
  from?: string;
  to?: string;
  today: string;
}): SupplierLedgerSummary {
  const payments = uniquePayments(input.payments ?? []);
  const rows = buildRows({ invoices: input.invoices, payments, openings: input.openings ?? [] });
  const balance = rows.length ? rows[rows.length - 1]!.balanceAfter : 0;
  const from = dateOnly(input.from);
  const to = dateOnly(input.to);
  const inPeriod = rows.filter((row) => (!from || row.at >= from) && (!to || row.at <= to));
  const periodOpening = roundMoney(
    rows.filter((row) => from && row.at < from).reduce((sum, row) => roundMoney(sum + row.increase - row.decrease), 0)
  );
  const periodPurchases = roundMoney(inPeriod.filter((row) => row.kind === "invoice" || row.kind === "delivery").reduce((sum, row) => sum + row.increase, 0));
  const periodPayments = roundMoney(inPeriod.filter((row) => row.kind === "payment").reduce((sum, row) => sum + row.decrease, 0));
  const periodClosing = inPeriod.length ? inPeriod[inPeriod.length - 1]!.balanceAfter : periodOpening;

  const covered = coveredDeliveryIds(input.invoices);
  const creditPool = roundMoney(
    input.invoices.reduce((sum, invoice) => sum + Math.max(0, -debtEffect(invoice, covered)), 0) +
      payments
        .filter((payment) => payment.status === "executed")
        .reduce((sum, payment) => sum + Math.max(0, roundMoney(payment.amount - payment.allocations.reduce((inner, item) => inner + item.amount, 0))), 0)
  );
  const openDocuments = applyCreditPool(openCharges(input.invoices, payments), creditPool).map((row) => ({
    ...row,
    bucket: bucketFor(row.dueDate, input.today),
  }));
  const aging: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, missing: 0 };
  for (const row of openDocuments) aging[row.bucket] = roundMoney(aging[row.bucket] + row.open);
  const openingDebt = roundMoney((input.openings ?? []).reduce((sum, opening) => sum + (opening.amount > 0 ? opening.amount : 0), 0));
  const openingOpen = roundMoney(Math.max(0, Math.min(openingDebt, Math.max(0, balance) - (aging.current + aging.d1_30 + aging.d31_60 + aging.d61_90 + aging.d90))));
  if (openingOpen > 0.009) {
    aging.missing = roundMoney(aging.missing + openingOpen);
    openDocuments.push({ id: "opening", number: "", open: openingOpen, bucket: "missing" });
  }
  const overdue = roundMoney(aging.d1_30 + aging.d31_60 + aging.d61_90 + aging.d90);
  const upcomingDocuments = openDocuments
    .filter((row) => row.dueDate && row.dueDate >= input.today && row.bucket === "current")
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const planned = payments
    .filter((payment) => payment.status === "planned")
    .map((payment) => ({ date: dateOnly(payment.dueAt || payment.paidAt), amount: payment.amount, reference: payment.reference }))
    .filter((payment) => payment.date >= input.today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextDocument = upcomingDocuments[0];
  const nextPlanned = planned[0];
  let nextPayment: SupplierLedgerSummary["nextPayment"];
  if (nextDocument?.dueDate && (!nextPlanned || nextDocument.dueDate <= nextPlanned.date)) {
    nextPayment = { date: nextDocument.dueDate, amount: nextDocument.open, planned: false, reference: nextDocument.number };
  } else if (nextPlanned) {
    nextPayment = { date: nextPlanned.date, amount: nextPlanned.amount, planned: true, reference: nextPlanned.reference };
  }

  return {
    rows,
    balance,
    periodPurchases,
    periodPayments,
    periodOpening,
    periodClosing,
    overdue,
    aging,
    missingDue: openDocuments.filter((row) => row.bucket === "missing"),
    nextPayment,
    openDocuments,
  };
}

export function periodRows(summary: SupplierLedgerSummary, from?: string, to?: string): SupplierLedgerRow[] {
  const start = dateOnly(from);
  const end = dateOnly(to);
  const visible = summary.rows.filter((row) => (!start || row.at >= start) && (!end || row.at <= end));
  if (!start) return visible;
  const opening: SupplierLedgerRow = {
    id: "period-opening",
    at: start,
    createdAt: start,
    kind: "opening",
    description: "period-opening",
    increase: 0,
    decrease: 0,
    balanceAfter: summary.periodOpening,
    countsInBalance: false,
  };
  const closing: SupplierLedgerRow = {
    id: "period-closing",
    at: end || visible[visible.length - 1]?.at || start,
    createdAt: "9999",
    kind: "opening",
    description: "period-closing",
    increase: 0,
    decrease: 0,
    balanceAfter: summary.periodClosing,
    countsInBalance: false,
  };
  return [opening, ...visible, closing];
}

export type AllocationPreview = {
  invoiceId: string;
  before: number;
  applied: number;
  after: number;
};

export function previewPayment(input: {
  amount: number;
  allocations: SupplierPaymentAllocation[];
  openByInvoice: { invoiceId: string; open: number }[];
  balanceBefore: number;
}): { ok: true; rows: AllocationPreview[]; excess: number; balanceBefore: number; balanceAfter: number } | { ok: false; error: "amount" | "over-allocate" | "unknown-invoice" } {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, error: "amount" };
  const open = new Map(input.openByInvoice.map((row) => [row.invoiceId, roundMoney(row.open)]));
  let applied = 0;
  const rows: AllocationPreview[] = [];
  for (const allocation of input.allocations) {
    if (!open.has(allocation.invoiceId)) return { ok: false, error: "unknown-invoice" };
    const before = open.get(allocation.invoiceId) ?? 0;
    const amount = roundMoney(allocation.amount);
    if (amount < 0 || amount - before > 0.009) return { ok: false, error: "over-allocate" };
    applied = roundMoney(applied + amount);
    rows.push({ invoiceId: allocation.invoiceId, before, applied: amount, after: roundMoney(before - amount) });
  }
  if (applied - input.amount > 0.009) return { ok: false, error: "over-allocate" };
  return {
    ok: true,
    rows,
    excess: roundMoney(input.amount - applied),
    balanceBefore: roundMoney(input.balanceBefore),
    balanceAfter: roundMoney(input.balanceBefore - input.amount),
  };
}

export function supplierIdentityMatch(
  left: Supplier,
  right: Supplier,
  invoices: PurchaseInvoice[]
): { match: boolean; reasons: ("tax" | "phone" | "document")[] } {
  if (left.id === right.id) return { match: false, reasons: [] };
  const reasons: ("tax" | "phone" | "document")[] = [];
  const taxLeft = digits(left.taxId);
  const taxRight = digits(right.taxId);
  if (taxLeft.length >= 5 && taxLeft === taxRight) reasons.push("tax");
  const phoneLeft = digits(left.phone);
  const phoneRight = digits(right.phone);
  if (phoneLeft.length >= 7 && phoneLeft === phoneRight) reasons.push("phone");
  const leftDocs = invoices.filter((invoice) => invoice.supplierId === left.id);
  const rightDocs = invoices.filter((invoice) => invoice.supplierId === right.id);
  const sharedDocument = leftDocs.some((invoice) =>
    rightDocs.some((other) => {
      if (invoice.fileHash && other.fileHash && invoice.fileHash === other.fileHash) return true;
      const tax = digits(invoice.supplierTaxId);
      return Boolean(invoice.invoiceNumber) && invoice.invoiceNumber === other.invoiceNumber && tax.length >= 5 && tax === digits(other.supplierTaxId);
    })
  );
  if (sharedDocument) reasons.push("document");
  return { match: reasons.length > 0, reasons };
}

export function mergeAliasNames(survivor: Supplier, loser: Supplier): string[] {
  const names = new Set<string>([...(survivor.aliases ?? []), ...(loser.aliases ?? [])]);
  if (loser.name.trim() && loser.name.trim() !== survivor.name.trim()) names.add(loser.name.trim());
  return [...names];
}

export function purchaseInvoicesForCashFlow(invoices: PurchaseInvoice[]): CashInvoice[] {
  const covered = coveredDeliveryIds(invoices);
  const charges = invoices.filter((invoice) => debtEffect(invoice, covered) > 0);
  let pool = roundMoney(invoices.reduce((sum, invoice) => sum + Math.max(0, -debtEffect(invoice, covered)), 0));
  const sorted = charges.slice().sort((a, b) => dateOnly(a.dueDate || a.invoiceDate).localeCompare(dateOnly(b.dueDate || b.invoiceDate)) || a.id.localeCompare(b.id));
  const result: CashInvoice[] = [];
  for (const invoice of sorted) {
    let gross = debtEffect(invoice, covered);
    const cut = Math.min(gross, pool);
    pool = roundMoney(pool - cut);
    gross = roundMoney(gross - cut);
    if (gross <= 0.009) continue;
    result.push({
      id: invoice.id,
      supplierName: invoice.supplierName,
      invoiceNumber: invoice.invoiceNumber,
      dueDate: dateOnly(invoice.dueDate) || null,
      gross,
    });
  }
  return result;
}

export type SupplierProductRow = {
  name: string;
  sku?: string;
  ingredientId?: string;
  ingredientName?: string;
  compareGroup?: string;
  pack?: string;
  price?: number;
  unit?: string;
  date?: string;
  history: { date: string; price: number; unit?: string }[];
};

export function splitPackLabel(pack?: string): { quantity: string; unit?: string } | null {
  if (!pack?.trim()) return null;
  const match = /^([\d.,]+)\s+([A-Za-z]+)$/.exec(pack.trim());
  if (!match) return { quantity: pack.trim() };
  return { quantity: match[1]!, unit: match[2] };
}

export type DocumentPayTag = "open" | "partial" | "paid" | "overdue" | "credit";

export function documentPayTag(input: {
  documentType?: string | null;
  open: number;
  settled: number;
  dueDate?: string | null;
  today: string;
  countsAsDebt: boolean;
}): DocumentPayTag | null {
  if (input.documentType === "credit") return "credit";
  if (!input.countsAsDebt) return null;
  if (input.open <= 0.009) return "paid";
  const due = input.dueDate?.slice(0, 10);
  if (due && due < input.today) return "overdue";
  if (input.settled > 0.009) return "partial";
  return "open";
}

export function supplierProductRows(input: {
  supplierId: string;
  scope: Set<string>;
  ingredients: CostingIngredient[];
  maps: SupplierItemMap[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  includeHistory?: boolean;
}): SupplierProductRow[] {
  const rows = new Map<string, SupplierProductRow>();
  const ensure = (name: string): SupplierProductRow => {
    const key = name.trim().toLowerCase();
    const existing = rows.get(key);
    if (existing) return existing;
    const created: SupplierProductRow = { name: name.trim(), history: [] };
    rows.set(key, created);
    return created;
  };
  for (const map of input.maps) {
    if (!input.scope.has(map.supplierId)) continue;
    const row = ensure(map.supplierProductName || map.supplierSku || map.inventoryProductId);
    row.sku = map.supplierSku || row.sku;
    row.ingredientId = map.inventoryProductId;
    const ingredient = input.ingredients.find((item) => item.id === map.inventoryProductId);
    row.ingredientName = ingredient?.name;
    row.compareGroup = ingredient?.compareGroupName;
    if (map.packageQuantity && map.purchaseUnit) row.pack = `${map.packageQuantity} ${map.purchaseUnit}`;
  }
  for (const offer of input.offers) {
    if (!input.scope.has(offer.supplierId) || offer.active === false) continue;
    const ingredient = input.ingredients.find((item) => item.id === offer.productId);
    const row = ensure(ingredient?.name || offer.productId);
    row.ingredientId = offer.productId;
    row.ingredientName = ingredient?.name || row.ingredientName;
    row.compareGroup = ingredient?.compareGroupName || row.compareGroup;
    row.sku = offer.supplierSku || row.sku;
    if (offer.packageQuantity && (offer.purchaseUnit || offer.lastUnit)) row.pack = `${offer.packageQuantity} ${offer.purchaseUnit || offer.lastUnit}`;
    if (offer.lastPurchasePrice != null) {
      row.price = offer.lastPurchasePrice;
      row.unit = offer.lastUnit;
      row.date = offer.lastPurchaseDate || offer.lastPurchasedAt;
    }
  }
  for (const record of input.records) {
    if (!record.supplierId || !input.scope.has(record.supplierId)) continue;
    const ingredient = input.ingredients.find((item) => item.id === record.productId);
    const row = ensure(ingredient?.name || record.productId);
    row.ingredientId = record.productId;
    row.ingredientName = ingredient?.name || row.ingredientName;
    row.compareGroup = ingredient?.compareGroupName || row.compareGroup;
    if (input.includeHistory !== false) {
      row.history.push({ date: record.purchaseDate, price: record.priceIncludingVat || record.unitCost, unit: record.unit });
    }
    if (!row.date || record.purchaseDate >= row.date) {
      row.price = record.priceIncludingVat || record.unitCost;
      row.unit = record.unit;
      row.date = record.purchaseDate;
    }
  }
  for (const row of rows.values()) {
    if (row.history.length) row.history.sort((a, b) => b.date.localeCompare(a.date));
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export function supplierStockRows(input: {
  scope: Set<string>;
  movements: InventoryMovement[];
  invoices: PurchaseInvoice[];
}): InventoryMovement[] {
  const invoiceIds = new Set(input.invoices.filter((invoice) => invoice.supplierId && input.scope.has(invoice.supplierId)).map((invoice) => invoice.id));
  return input.movements
    .filter((movement) => (movement.supplierId && input.scope.has(movement.supplierId)) || (movement.invoiceId && invoiceIds.has(movement.invoiceId)))
    .slice()
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function supplierSearchMatch(supplier: Supplier, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [supplier.name, supplier.companyName, supplier.phone, supplier.taxId, supplier.contactName, ...(supplier.aliases ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  const qDigits = digits(q);
  if (qDigits.length >= 3) {
    return digits(supplier.phone).includes(qDigits) || digits(supplier.taxId).includes(qDigits);
  }
  return false;
}

export function lastPurchaseDate(invoices: PurchaseInvoice[], movements: InventoryMovement[]): string {
  const dates = [
    ...invoices.map((invoice) => dateOnly(invoice.invoiceDate)),
    ...movements.map((movement) => dateOnly(movement.receivedAt)),
  ].filter(Boolean);
  return dates.sort().at(-1) ?? "";
}

export function balanceTone(balance: number): "due" | "credit" | "zero" {
  if (balance > 0.009) return "due";
  if (balance < -0.009) return "credit";
  return "zero";
}
