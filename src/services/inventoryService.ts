import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  runTransaction,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { failure, success, type ServiceResult } from "@/lib/errors";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { nowTimestamp, timestampToIso } from "@/types/firestore";
import { toDateOnly } from "@/lib/dates/normalize";
import { invoiceLineQuantityBase, planIngredientMerge } from "@/lib/inventory/ingredient-core";
import { sanitizeInventoryDocId } from "@/lib/inventory/invoice-stock-post";
import { purchaseQuantityInBase } from "@/lib/costing/units";
import { costPerBaseUnit } from "@/lib/costing/units";
import { createIngredient } from "@/services/costingService";
import type { CostingIngredient, DishRecipe, PurchaseUnit } from "@/lib/costing/types";
import {
  groupPurchaseInvoices,
  isWritablePurchaseRow,
  planPurchaseList,
  purchaseInvoiceDuplicate,
  purchaseLineKey,
  supplierAliasesFor,
  type PurchaseListDecision,
} from "@/lib/inventory/purchase-list";
import { reconcileSupplierItemMap, shouldUpdateLastPurchase } from "@/lib/inventory/material-group";
import { splitVat } from "@/lib/inventory/vat";
import { currentStockBase, movementSignedBase, unitCostFromPackage } from "@/lib/inventory/stock";
import { excelImportPayload, periodReviewCleared } from "@/lib/inventory/pos-excel";
import {
  movementAlreadyWritten,
  posCreatedProductId,
  posMovementId,
  posSourceKey,
  type PosApplyRow,
} from "@/lib/inventory/pos-apply";
import { isConfirmedInvoiceMatch } from "@/lib/inventory/invoice-line-review";
import type { PosFinanceEntry, PosZReport } from "@/lib/inventory/types";
import { findDuplicateInvoice } from "@/lib/inventory/invoice-smart-match";
import { invoiceStockStatus, syncInvoiceTotals, transferableLines } from "@/lib/inventory/invoice-finance";
import { validateIssueLines, type IssueDraftLine } from "@/lib/inventory/issue";
import type {
  InventoryIssueReason,
  InventoryMovement,
  PosImport,
  PosProductMap,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchaseInvoiceStatus,
  PurchasePriceRecord,
  Supplier,
  SupplierItemMap,
  SupplierOffer,
  VatType,
} from "@/lib/inventory/types";

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapSupplier(id: string, data: Record<string, unknown>): Supplier {
  return {
    id,
    name: String(data.name ?? ""),
    companyName: data.companyName ? String(data.companyName) : undefined,
    phone: data.phone ? String(data.phone) : undefined,
    email: data.email ? String(data.email) : undefined,
    taxId: data.taxId ? String(data.taxId) : undefined,
    address: data.address ? String(data.address) : undefined,
    contactName: data.contactName ? String(data.contactName) : undefined,
    paymentTerms: data.paymentTerms ? String(data.paymentTerms) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    aliases: Array.isArray(data.aliases) ? data.aliases.map((item) => String(item)).filter(Boolean) : undefined,
    active: data.active !== false,
    createdAt: timestampToIso(data.createdAt as never),
    updatedAt: timestampToIso(data.updatedAt as never),
  };
}

function mapOffer(id: string, data: Record<string, unknown>): SupplierOffer {
  return {
    id,
    productId: String(data.productId ?? ""),
    supplierId: String(data.supplierId ?? ""),
    currentPrice: data.currentPrice != null ? asNumber(data.currentPrice) : undefined,
    vatType: (data.vatType as VatType) || undefined,
    vatRate: data.vatRate != null ? asNumber(data.vatRate) : undefined,
    priceBeforeVat: data.priceBeforeVat != null ? asNumber(data.priceBeforeVat) : undefined,
    vatAmount: data.vatAmount != null ? asNumber(data.vatAmount) : undefined,
    priceIncludingVat: data.priceIncludingVat != null ? asNumber(data.priceIncludingVat) : undefined,
    packageQuantity: data.packageQuantity != null ? asNumber(data.packageQuantity) : undefined,
    purchaseUnit: (data.purchaseUnit as PurchaseUnit) || undefined,
    normalizedPrice: data.normalizedPrice != null ? asNumber(data.normalizedPrice) : undefined,
    supplierSku: data.supplierSku ? String(data.supplierSku) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    lastQuotedAt: data.lastQuotedAt ? String(data.lastQuotedAt) : undefined,
    lastPurchasedAt: data.lastPurchasedAt ? String(data.lastPurchasedAt) : undefined,
    lastPurchasePrice: data.lastPurchasePrice != null ? asNumber(data.lastPurchasePrice) : undefined,
    lastPriceIncludingVat: data.lastPriceIncludingVat != null ? asNumber(data.lastPriceIncludingVat) : undefined,
    lastPriceBeforeVat: data.lastPriceBeforeVat != null ? asNumber(data.lastPriceBeforeVat) : undefined,
    lastUnitCost: data.lastUnitCost != null ? asNumber(data.lastUnitCost) : undefined,
    lastPurchaseDate: data.lastPurchaseDate ? String(data.lastPurchaseDate) : undefined,
    lastPackageQuantity: data.lastPackageQuantity != null ? asNumber(data.lastPackageQuantity) : undefined,
    lastUnit: (data.lastUnit as PurchaseUnit) || undefined,
    lastInvoiceId: data.lastInvoiceId ? String(data.lastInvoiceId) : undefined,
    lastInvoiceNumber: data.lastInvoiceNumber ? String(data.lastInvoiceNumber) : undefined,
    active: data.active !== false,
    createdAt: timestampToIso(data.createdAt as never),
    updatedAt: timestampToIso(data.updatedAt as never),
  };
}

function mapMovement(id: string, data: Record<string, unknown>): InventoryMovement {
  return {
    id,
    productId: String(data.productId ?? ""),
    type: data.type as InventoryMovement["type"],
    quantity: asNumber(data.quantity),
    unit: (data.unit as PurchaseUnit) || "unit",
    quantityBase: asNumber(data.quantityBase),
    supplierId: data.supplierId ? String(data.supplierId) : undefined,
    invoiceId: data.invoiceId ? String(data.invoiceId) : undefined,
    invoiceLineKey: data.invoiceLineKey ? String(data.invoiceLineKey) : undefined,
    conversionFactor: data.conversionFactor != null ? asNumber(data.conversionFactor) : undefined,
    lineTotalNet: data.lineTotalNet != null ? asNumber(data.lineTotalNet) : undefined,
    lineTotalGross: data.lineTotalGross != null ? asNumber(data.lineTotalGross) : undefined,
    posImportId: data.posImportId ? String(data.posImportId) : undefined,
    posSourceRow: typeof data.posSourceRow === "number" ? data.posSourceRow : undefined,
    orderId: data.orderId ? String(data.orderId) : undefined,
    recipeId: data.recipeId ? String(data.recipeId) : undefined,
    menuProductId: data.menuProductId ? String(data.menuProductId) : undefined,
    dishCount: data.dishCount != null ? asNumber(data.dishCount) : undefined,
    reason: data.reason === "kitchen" || data.reason === "waste" || data.reason === "return" || data.reason === "recipe" || data.reason === "other" ? data.reason : undefined,
    actor: data.actor ? String(data.actor) : undefined,
    issueBatchId: data.issueBatchId ? String(data.issueBatchId) : undefined,
    idempotencyKey: data.idempotencyKey ? String(data.idempotencyKey) : undefined,
    reversesId: data.reversesId ? String(data.reversesId) : undefined,
    unitCost: data.unitCost != null ? asNumber(data.unitCost) : undefined,
    note: data.note ? String(data.note) : undefined,
    invoiceDate: data.invoiceDate ? String(data.invoiceDate) : undefined,
    receivedAt: data.receivedAt ? String(data.receivedAt) : timestampToIso(data.createdAt as never),
    createdAt: timestampToIso(data.createdAt as never),
  };
}

function mapRecord(id: string, data: Record<string, unknown>): PurchasePriceRecord {
  return {
    id,
    productId: String(data.productId ?? ""),
    supplierId: data.supplierId ? String(data.supplierId) : undefined,
    invoiceId: data.invoiceId ? String(data.invoiceId) : undefined,
    purchaseDate: String(data.purchaseDate ?? ""),
    quantity: asNumber(data.quantity),
    packageQuantity: asNumber(data.packageQuantity),
    unit: (data.unit as PurchaseUnit) || "kg",
    priceBeforeVat: asNumber(data.priceBeforeVat),
    vatAmount: asNumber(data.vatAmount),
    priceIncludingVat: asNumber(data.priceIncludingVat),
    vatType: (data.vatType as VatType) || "inclusive",
    vatRate: asNumber(data.vatRate, 0.18),
    unitCost: asNumber(data.unitCost),
    source: data.source === "PURCHASE_INVOICE" || data.source === "PURCHASE_ORDER" || data.source === "MANUAL" ? data.source : undefined,
    createdAt: timestampToIso(data.createdAt as never),
  };
}

async function commitStockMovement(input: {
  movementId?: string;
  productId: string;
  deltaBase: number;
  fallbackAvailable: number;
  requireNonNegative?: boolean;
  payload: Record<string, unknown>;
}): Promise<{ id: string; reused: boolean }> {
  const db = getDb();
  const movementRef = input.movementId
    ? doc(db, COLLECTIONS.inventoryMovements, sanitizeInventoryDocId(input.movementId))
    : doc(collection(db, COLLECTIONS.inventoryMovements));
  let reused = false;
  await runTransaction(db, async (tx) => {
    const existingMove = await tx.get(movementRef);
    if (existingMove.exists()) {
      reused = true;
      return;
    }
    const balRef = doc(db, COLLECTIONS.inventoryBalances, input.productId);
    const bal = await tx.get(balRef);
    const available = bal.exists()
      ? asNumber((bal.data() as Record<string, unknown>).quantityBase)
      : input.fallbackAvailable;
    const next = available + input.deltaBase;
    if (input.requireNonNegative && next < -0.0001) {
      throw new Error("overStock");
    }
    tx.set(
      movementRef,
      sanitizeFirestoreData({
        ...input.payload,
        quantityBefore: available,
        quantityAfter: next,
      })
    );
    tx.set(
      balRef,
      sanitizeFirestoreData({
        productId: input.productId,
        quantityBase: next,
        updatedAt: nowTimestamp(),
      }),
      { merge: true }
    );
  });
  return { id: movementRef.id, reused };
}

export function subscribeToSuppliers(onData: (items: Supplier[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.suppliers), (snap) =>
    onData(snap.docs.map((d) => mapSupplier(d.id, d.data() as Record<string, unknown>)))
  );
}

export function subscribeToSupplierOffers(onData: (items: SupplierOffer[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.supplierOffers), (snap) =>
    onData(snap.docs.map((d) => mapOffer(d.id, d.data() as Record<string, unknown>)))
  );
}

export function subscribeToInventoryMovements(onData: (items: InventoryMovement[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.inventoryMovements), (snap) =>
    onData(snap.docs.map((d) => mapMovement(d.id, d.data() as Record<string, unknown>)))
  );
}

export function subscribeToPurchasePriceRecords(onData: (items: PurchasePriceRecord[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.purchasePriceRecords), (snap) =>
    onData(snap.docs.map((d) => mapRecord(d.id, d.data() as Record<string, unknown>)))
  );
}

export function subscribeToPurchaseInvoices(onData: (items: PurchaseInvoice[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.purchaseInvoices), (snap) =>
    onData(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          supplierId: data.supplierId ? String(data.supplierId) : undefined,
          supplierName: String(data.supplierName ?? ""),
          supplierTaxId: data.supplierTaxId ? String(data.supplierTaxId) : undefined,
          supplierVatNumber: data.supplierVatNumber ? String(data.supplierVatNumber) : undefined,
          supplierPhone: data.supplierPhone ? String(data.supplierPhone) : undefined,
          supplierAddress: data.supplierAddress ? String(data.supplierAddress) : undefined,
          invoiceNumber: String(data.invoiceNumber ?? ""),
          invoiceDate: toDateOnly(data.invoiceDate) || "",
          dueDate: toDateOnly(data.dueDate) ?? undefined,
          receivedAt: toDateOnly(data.receivedAt) || "",
          documentType: data.documentType || "invoice",
          currency: data.currency ? String(data.currency) : undefined,
          paymentMethod: data.paymentMethod ? String(data.paymentMethod) : undefined,
          headerDiscount: data.headerDiscount != null ? asNumber(data.headerDiscount) : undefined,
          vatRate: data.vatRate != null ? asNumber(data.vatRate) : undefined,
          vatMode: data.vatMode === "inclusive" || data.vatMode === "exclusive" || data.vatMode === "exempt" ? data.vatMode : undefined,
          netAmount: data.netAmount != null ? asNumber(data.netAmount) : data.subtotal != null ? asNumber(data.subtotal) : undefined,
          vatAmount: data.vatAmount != null ? asNumber(data.vatAmount) : data.vatTotal != null ? asNumber(data.vatTotal) : undefined,
          grossAmount: data.grossAmount != null ? asNumber(data.grossAmount) : data.grandTotal != null ? asNumber(data.grandTotal) : undefined,
          subtotal: data.subtotal != null ? asNumber(data.subtotal) : undefined,
          vatTotal: data.vatTotal != null ? asNumber(data.vatTotal) : undefined,
          grandTotal: data.grandTotal != null ? asNumber(data.grandTotal) : undefined,
          vatStatus: data.vatStatus === "detected" || data.vatStatus === "needs_review" ? data.vatStatus : undefined,
          status: (data.status as PurchaseInvoice["status"]) || "draft",
          scanStatus: data.scanStatus || undefined,
          stockStatus: data.stockStatus === "partial" || data.stockStatus === "posted" || data.stockStatus === "none" ? data.stockStatus : undefined,
          lines: Array.isArray(data.lines) ? data.lines : [],
          sourceFile: data.sourceFile && typeof data.sourceFile === "object" ? (data.sourceFile as PurchaseInvoice["sourceFile"]) : undefined,
          scanAttempts: Array.isArray(data.scanAttempts) ? data.scanAttempts : undefined,
          validation: data.validation && typeof data.validation === "object" ? data.validation : undefined,
          headerConfidence: data.headerConfidence && typeof data.headerConfidence === "object" ? data.headerConfidence : undefined,
          fileName: data.fileName ? String(data.fileName) : undefined,
          fileUrl: data.fileUrl ? String(data.fileUrl) : undefined,
          fileHash: data.fileHash ? String(data.fileHash) : undefined,
          shipping: data.shipping != null ? asNumber(data.shipping) : undefined,
          delivery: data.delivery != null ? asNumber(data.delivery) : undefined,
          inventoryPostedAt: data.inventoryPostedAt ? timestampToIso(data.inventoryPostedAt as never) : data.inventoryPostedAt ? String(data.inventoryPostedAt) : undefined,
          inventoryPostedBy: data.inventoryPostedBy ? String(data.inventoryPostedBy) : undefined,
          inventoryPostingId: data.inventoryPostingId ? String(data.inventoryPostingId) : undefined,
          createdBy: data.createdBy ? String(data.createdBy) : undefined,
          uploadedAt: data.uploadedAt ? String(data.uploadedAt) : undefined,
          aiProvider: data.aiProvider ? String(data.aiProvider) : undefined,
          aiModel: data.aiModel ? String(data.aiModel) : undefined,
          audit: Array.isArray(data.audit) ? data.audit : undefined,
          duplicateOf: data.duplicateOf ? String(data.duplicateOf) : undefined,
          notes: data.notes ? String(data.notes) : undefined,
          createdAt: timestampToIso(data.createdAt as never),
          approvedAt: data.approvedAt ? timestampToIso(data.approvedAt as never) : undefined,
        };
      })
    )
  );
}

function mapPosImport(id: string, data: Record<string, unknown>): PosImport {
  const lines = Array.isArray(data.lines) ? (data.lines as PosImport["lines"]) : [];
  return {
    id,
    kind: (data.kind as PosImport["kind"]) || "excel-info",
    fileName: String(data.fileName ?? ""),
    fileHash: String(data.fileHash ?? ""),
    source: data.source === "z-scan" ? "z-scan" : "pos-file",
    period: String(data.period ?? ""),
    periodFrom: data.periodFrom ? String(data.periodFrom) : null,
    periodTo: data.periodTo ? String(data.periodTo) : null,
    sourcePeriodFrom: data.sourcePeriodFrom ? String(data.sourcePeriodFrom) : data.periodFrom ? String(data.periodFrom) : null,
    sourcePeriodTo: data.sourcePeriodTo ? String(data.sourcePeriodTo) : data.periodTo ? String(data.periodTo) : null,
    reportGeneratedAt: data.reportGeneratedAt ? String(data.reportGeneratedAt) : null,
    uploadedAt: data.uploadedAt ? String(data.uploadedAt) : timestampToIso(data.createdAt as never),
    periodNeedsReview: Boolean(data.periodNeedsReview),
    periodConfirmed: data.periodConfirmed === true,
    status: (data.status as PosImport["status"]) || "saved",
    financeStatus: (data.financeStatus as PosImport["financeStatus"]) || "none",
    infoOnly: data.infoOnly !== false,
    inventoryStatus: data.inventoryStatus === "posted" || data.inventoryStatus === "partial" ? data.inventoryStatus : "none",
    applyProgress: data.applyProgress && typeof data.applyProgress === "object" ? (data.applyProgress as PosImport["applyProgress"]) : undefined,
    lines,
    itemCount: typeof data.itemCount === "number" ? data.itemCount : lines.length,
    quantitySum: typeof data.quantitySum === "number" ? data.quantitySum : lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    reportedRevenueSum: typeof data.reportedRevenueSum === "number" ? data.reportedRevenueSum : null,
    sheetName: data.sheetName ? String(data.sheetName) : null,
    headerRow: typeof data.headerRow === "number" ? data.headerRow : null,
    previousImportId: data.previousImportId ? String(data.previousImportId) : undefined,
    excludedKeys: Array.isArray(data.excludedKeys) ? data.excludedKeys.map(String) : [],
    sourceTotals: data.sourceTotals && typeof data.sourceTotals === "object" ? (data.sourceTotals as PosImport["sourceTotals"]) : null,
    createdAt: timestampToIso(data.createdAt as never),
    approvedAt: data.approvedAt ? timestampToIso(data.approvedAt as never) : undefined,
  };
}

export function subscribeToPosImports(onData: (items: PosImport[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.posImports), (snap) =>
    onData(snap.docs.map((d) => mapPosImport(d.id, d.data() as Record<string, unknown>)))
  );
}

export function subscribeToPosZReports(onData: (items: PosZReport[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.posZReports), (snap) =>
    onData(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          reportNumber: data.reportNumber ? String(data.reportNumber) : null,
          reportType: data.reportType ? String(data.reportType) : null,
          registerId: data.registerId ? String(data.registerId) : null,
          cashier: data.cashier ? String(data.cashier) : null,
          branch: data.branch ? String(data.branch) : null,
          businessName: data.businessName ? String(data.businessName) : null,
          businessDate: data.businessDate ? String(data.businessDate) : null,
          periodFrom: data.periodFrom ? String(data.periodFrom) : null,
          periodTo: data.periodTo ? String(data.periodTo) : null,
          printedAt: data.printedAt ? String(data.printedAt) : null,
          salesBeforeVat: typeof data.salesBeforeVat === "number" ? data.salesBeforeVat : null,
          salesTotal: typeof data.salesTotal === "number" ? data.salesTotal : null,
          salesIncludingVat: typeof data.salesIncludingVat === "number" ? data.salesIncludingVat : null,
          vatTotal: typeof data.vatTotal === "number" ? data.vatTotal : null,
          vatRate: typeof data.vatRate === "number" ? data.vatRate : null,
          receiptsTotal: typeof data.receiptsTotal === "number" ? data.receiptsTotal : null,
          receiptsCount: typeof data.receiptsCount === "number" ? data.receiptsCount : null,
          returnsTotal: typeof data.returnsTotal === "number" ? data.returnsTotal : null,
          discountsTotal: typeof data.discountsTotal === "number" ? data.discountsTotal : null,
          cashExpected: typeof data.cashExpected === "number" ? data.cashExpected : null,
          payments: Array.isArray(data.payments) ? data.payments : [],
          extraAmounts: Array.isArray(data.extraAmounts) ? data.extraAmounts : [],
          fields: Array.isArray(data.fields) ? data.fields : [],
          checks: Array.isArray(data.checks) ? data.checks : [],
          periodConfirmed: data.periodConfirmed === true,
          scanStatus: data.scanStatus ?? undefined,
          lastScanError: data.lastScanError ? String(data.lastScanError) : null,
          extractionModel: data.extractionModel ? String(data.extractionModel) : null,
          status: data.status === "posted" ? "posted" : "draft",
          financeEntryId: data.financeEntryId ? String(data.financeEntryId) : null,
          sourceFiles: Array.isArray(data.sourceFiles) ? data.sourceFiles : [],
          fileHash: data.fileHash ? String(data.fileHash) : undefined,
          duplicateOf: data.duplicateOf ? String(data.duplicateOf) : null,
          websiteOverlap: data.websiteOverlap ?? null,
          periodOverlapIds: Array.isArray(data.periodOverlapIds) ? data.periodOverlapIds.map(String) : [],
          createdAt: timestampToIso(data.createdAt as never),
          updatedAt: data.updatedAt ? timestampToIso(data.updatedAt as never) : undefined,
          postedAt: data.postedAt ? timestampToIso(data.postedAt as never) : undefined,
          postedBy: data.postedBy ? String(data.postedBy) : undefined,
        } as PosZReport;
      })
    )
  );
}

export function subscribeToPosFinanceEntries(onData: (items: PosFinanceEntry[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.posFinanceEntries), (snap) =>
    onData(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          zReportId: String(data.zReportId ?? ""),
          kind: data.kind === "z-correction" ? "z-correction" : "z-post",
          businessDate: String(data.businessDate ?? ""),
          amount: Number(data.amount) || 0,
          vatBasis: (data.vatBasis as PosFinanceEntry["vatBasis"]) || "unknown",
          vatTotal: typeof data.vatTotal === "number" ? data.vatTotal : null,
          payments: Array.isArray(data.payments) ? data.payments : [],
          sourceFilePaths: Array.isArray(data.sourceFilePaths) ? data.sourceFilePaths : [],
          postedAt: timestampToIso(data.postedAt as never) || String(data.postedAt ?? ""),
          postedBy: data.postedBy ? String(data.postedBy) : undefined,
          correctionOf: data.correctionOf ? String(data.correctionOf) : null,
          reason: data.reason ? String(data.reason) : null,
        };
      })
    )
  );
}

export function subscribeToPosProductMaps(onData: (items: PosProductMap[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.posProductMaps), (snap) =>
    onData(
      snap.docs.map((d) => ({
        id: d.id,
        posCode: String(d.data().posCode ?? ""),
        posName: String(d.data().posName ?? ""),
        menuProductId: String(d.data().menuProductId ?? ""),
      }))
    )
  );
}

export async function rememberSupplierAlias(supplierId: string, scannedName: string): Promise<ServiceResult<void>> {
  try {
    const alias = scannedName.trim();
    if (!alias) return success(undefined);
    const ref = doc(getDb(), COLLECTIONS.suppliers, supplierId);
    const snap = await getDoc(ref);
    const current = ((snap.data()?.aliases as string[] | undefined) ?? []).map((item) => String(item));
    const name = String(snap.data()?.name ?? "");
    if (!alias || alias === name || current.some((item) => item.toLowerCase() === alias.toLowerCase())) {
      return success(undefined);
    }
    await updateDoc(ref, { aliases: [...current, alias], updatedAt: nowTimestamp() });
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to remember supplier alias");
  }
}

export async function saveSupplier(input: {
  id?: string;
  name: string;
  companyName?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  address?: string;
  contactName?: string;
  paymentTerms?: string;
  notes?: string;
  aliases?: string[];
}): Promise<ServiceResult<Supplier>> {
  try {
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      name: input.name.trim(),
      companyName: input.companyName?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      taxId: input.taxId?.trim() || null,
      address: input.address?.trim() || null,
      contactName: input.contactName?.trim() || null,
      paymentTerms: input.paymentTerms?.trim() || null,
      notes: input.notes?.trim() || null,
      aliases: input.aliases?.map((item) => item.trim()).filter(Boolean) || null,
      active: true,
      updatedAt: now,
    });
    if (input.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.suppliers, input.id), payload);
      return success(mapSupplier(input.id, { ...payload, createdAt: now }));
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.suppliers), { ...payload, createdAt: now });
    return success(mapSupplier(ref.id, { ...payload, createdAt: now }));
  } catch (error) {
    return failure(error, "Failed to save supplier");
  }
}

async function findOfferDocs(productId: string, supplierId: string) {
  return getDocs(
    query(
      collection(getDb(), COLLECTIONS.supplierOffers),
      where("productId", "==", productId),
      where("supplierId", "==", supplierId)
    )
  );
}

export async function saveSupplierOffer(input: {
  productId: string;
  supplierId: string;
  currentPrice: number;
  packageQuantity: number;
  purchaseUnit: PurchaseUnit;
  vatType: VatType;
  vatRate?: number;
  quotedAt?: string;
  supplierSku?: string;
  notes?: string;
}): Promise<ServiceResult<void>> {
  try {
    const now = nowTimestamp();
    const vat = splitVat({
      amount: input.currentPrice,
      vatType: input.vatType,
      vatRate: input.vatRate ?? 0.18,
    });
    const normalized = unitCostFromPackage(vat.priceIncludingVat, input.packageQuantity, input.purchaseUnit);
    const quotedAt = input.quotedAt || new Date().toISOString().slice(0, 10);
    const existing = await findOfferDocs(input.productId, input.supplierId);
    const payload = sanitizeFirestoreData({
      productId: input.productId,
      supplierId: input.supplierId,
      currentPrice: input.currentPrice,
      vatType: input.vatType,
      vatRate: input.vatRate ?? 0.18,
      ...vat,
      packageQuantity: input.packageQuantity,
      purchaseUnit: input.purchaseUnit,
      normalizedPrice: normalized,
      lastUnitCost: normalized,
      lastPriceIncludingVat: vat.priceIncludingVat,
      lastPriceBeforeVat: vat.priceBeforeVat,
      lastPackageQuantity: input.packageQuantity,
      lastUnit: input.purchaseUnit,
      lastQuotedAt: quotedAt,
      supplierSku: input.supplierSku?.trim() || null,
      notes: input.notes?.trim() || null,
      active: true,
      updatedAt: now,
    });
    if (existing.docs[0]) {
      await updateDoc(existing.docs[0].ref, payload);
    } else {
      await addDoc(collection(getDb(), COLLECTIONS.supplierOffers), { ...payload, createdAt: now });
    }
    await addDoc(
      collection(getDb(), COLLECTIONS.purchasePriceRecords),
      sanitizeFirestoreData({
        productId: input.productId,
        supplierId: input.supplierId,
        purchaseDate: quotedAt,
        quantity: input.packageQuantity,
        packageQuantity: input.packageQuantity,
        unit: input.purchaseUnit,
        ...vat,
        vatType: input.vatType,
        vatRate: input.vatRate ?? 0.18,
        unitCost: normalized,
        source: "MANUAL",
        createdAt: now,
      })
    );
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to save supplier offer");
  }
}

export async function unlinkSupplierOffer(offerId: string): Promise<ServiceResult<void>> {
  try {
    await updateDoc(doc(getDb(), COLLECTIONS.supplierOffers, offerId), {
      active: false,
      updatedAt: nowTimestamp(),
    });
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to unlink supplier");
  }
}

export async function recordSupplierPurchase(input: {
  productId: string;
  supplierId: string;
  priceIncludingVat: number;
  priceBeforeVat?: number;
  packageQuantity: number;
  purchaseUnit: PurchaseUnit;
  purchasedAt: string;
  vatType?: VatType;
  vatRate?: number;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceLineId?: string;
  unitPriceNet?: number;
  unitPriceGross?: number;
  lineTotalNet?: number;
  lineTotalVat?: number;
  lineTotalGross?: number;
}): Promise<ServiceResult<void>> {
  try {
    const now = nowTimestamp();
    const existing = await findOfferDocs(input.productId, input.supplierId);
    const normalized = unitCostFromPackage(input.priceIncludingVat, input.packageQuantity, input.purchaseUnit);
    const current = existing.docs[0]?.data() as Record<string, unknown> | undefined;
    const existingDate = String(current?.lastPurchaseDate || current?.lastPurchasedAt || "");
    if (!shouldUpdateLastPurchase(existingDate, input.purchasedAt)) {
      return success(undefined);
    }
    const payload = sanitizeFirestoreData({
      productId: input.productId,
      supplierId: input.supplierId,
      lastPurchasedAt: input.purchasedAt,
      lastPurchasePrice: normalized,
      lastPurchaseDate: input.purchasedAt,
      lastPriceIncludingVat: input.priceIncludingVat,
      lastPriceBeforeVat: input.priceBeforeVat ?? null,
      lastPackageQuantity: input.packageQuantity,
      lastUnit: input.purchaseUnit,
      lastInvoiceId: input.invoiceId || null,
      lastInvoiceNumber: input.invoiceNumber || null,
      lastInvoiceLineId: input.invoiceLineId || null,
      lastUnitPriceNet: input.unitPriceNet ?? null,
      lastUnitPriceGross: input.unitPriceGross ?? null,
      lastLineTotalNet: input.lineTotalNet ?? null,
      lastLineTotalVat: input.lineTotalVat ?? null,
      lastLineTotalGross: input.lineTotalGross ?? null,
      lastUnitCost: current?.normalizedPrice ?? current?.lastUnitCost ?? normalized,
      active: true,
      updatedAt: now,
      ...(current?.currentPrice == null
        ? {
            currentPrice: input.priceIncludingVat,
            priceIncludingVat: input.priceIncludingVat,
            priceBeforeVat: input.priceBeforeVat ?? null,
            packageQuantity: input.packageQuantity,
            purchaseUnit: input.purchaseUnit,
            normalizedPrice: normalized,
            vatType: input.vatType ?? "inclusive",
            vatRate: input.vatRate ?? 0.18,
            lastQuotedAt: input.purchasedAt,
          }
        : {}),
    });
    if (existing.docs[0]) {
      await updateDoc(existing.docs[0].ref, payload);
    } else {
      await addDoc(collection(getDb(), COLLECTIONS.supplierOffers), { ...payload, createdAt: now });
    }
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to record supplier purchase");
  }
}

export async function linkSupplierOffer(input: {
  productId: string;
  supplierId: string;
  lastPriceIncludingVat?: number;
  lastPriceBeforeVat?: number;
  lastPackageQuantity?: number;
  lastUnit?: PurchaseUnit;
  lastPurchaseDate?: string;
}): Promise<ServiceResult<void>> {
  if (input.lastPriceIncludingVat != null && input.lastPackageQuantity && input.lastUnit) {
    return saveSupplierOffer({
      productId: input.productId,
      supplierId: input.supplierId,
      currentPrice: input.lastPriceIncludingVat,
      packageQuantity: input.lastPackageQuantity,
      purchaseUnit: input.lastUnit,
      vatType: "inclusive",
      quotedAt: input.lastPurchaseDate,
    });
  }
  return saveSupplierOffer({
    productId: input.productId,
    supplierId: input.supplierId,
    currentPrice: 0,
    packageQuantity: input.lastPackageQuantity || 1,
    purchaseUnit: input.lastUnit || "kg",
    vatType: "inclusive",
    quotedAt: input.lastPurchaseDate,
  });
}

export function subscribeToSupplierItemMaps(onData: (items: SupplierItemMap[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.supplierItemMaps), (snap) =>
    onData(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          supplierId: String(data.supplierId ?? ""),
          supplierProductName: String(data.supplierProductName ?? ""),
          supplierSku: data.supplierSku ? String(data.supplierSku) : undefined,
          inventoryProductId: String(data.inventoryProductId ?? ""),
          purchaseUnit: data.purchaseUnit ? (data.purchaseUnit as PurchaseUnit) : undefined,
          packageQuantity: data.packageQuantity != null ? asNumber(data.packageQuantity) : undefined,
          conversion: data.conversion != null ? asNumber(data.conversion) : undefined,
          compareGroupId: data.compareGroupId ? String(data.compareGroupId) : undefined,
          compareGroupName: data.compareGroupName ? String(data.compareGroupName) : undefined,
          createdAt: timestampToIso(data.createdAt as never),
          updatedAt: timestampToIso(data.updatedAt as never),
        };
      })
    )
  );
}

export async function saveSupplierItemMap(input: {
  supplierId: string;
  supplierProductName: string;
  supplierSku?: string;
  inventoryProductId: string;
  purchaseUnit?: PurchaseUnit;
  packageQuantity?: number;
  conversion?: number;
  compareGroupId?: string;
  compareGroupName?: string;
}): Promise<ServiceResult<void>> {
  try {
    const existing = await getDocs(
      query(
        collection(getDb(), COLLECTIONS.supplierItemMaps),
        where("supplierId", "==", input.supplierId),
        where("supplierProductName", "==", input.supplierProductName)
      )
    );
    const now = nowTimestamp();
    const current = existing.docs[0]
      ? ({
          id: existing.docs[0].id,
          ...(existing.docs[0].data() as Omit<SupplierItemMap, "id">),
        } as SupplierItemMap)
      : undefined;
    const ingredientSnap = await getDoc(doc(getDb(), COLLECTIONS.ingredients, input.inventoryProductId));
    const ingredient = ingredientSnap.exists() ? ingredientSnap.data() : undefined;
    const reconciled = reconcileSupplierItemMap(current, input);
    const payload = sanitizeFirestoreData({
      ...reconciled.next,
      compareGroupId: input.compareGroupId ?? current?.compareGroupId ?? ingredient?.compareGroupId ?? null,
      compareGroupName: input.compareGroupName ?? current?.compareGroupName ?? ingredient?.compareGroupName ?? null,
      updatedAt: now,
    });
    if (existing.docs[0]) await updateDoc(existing.docs[0].ref, payload);
    else await addDoc(collection(getDb(), COLLECTIONS.supplierItemMaps), { ...payload, createdAt: now });
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to save item mapping");
  }
}

export async function savePurchaseInvoiceDraft(
  invoice: Omit<PurchaseInvoice, "id" | "createdAt"> & { id?: string; status?: PurchaseInvoiceStatus }
): Promise<ServiceResult<string>> {
  try {
    const viaApi = await clientAdminFetch<{ id: string }>("/api/admin/inventory/invoice/save", {
      invoice,
      mode: "draft",
    });
    if (viaApi.ok && viaApi.data?.id) return success(viaApi.data.id);
    if (viaApi.code === "PERMISSION_DENIED" || viaApi.status === 401 || viaApi.status === 403) {
      return failure(new Error("PERMISSION_DENIED"), "PERMISSION_DENIED");
    }
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      ...invoice,
      status: invoice.status === "saved" || invoice.status === "needs_review" || invoice.status === "rejected" || invoice.status === "draft"
        ? invoice.status
        : "draft",
      updatedAt: now,
    });
    if (invoice.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.purchaseInvoices, invoice.id), payload);
      return success(invoice.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.purchaseInvoices), { ...payload, createdAt: now });
    return success(ref.id);
  } catch (error) {
    return failure(error, "Failed to save invoice draft");
  }
}

export async function saveFinanceInvoice(invoice: PurchaseInvoice): Promise<ServiceResult<string>> {
  try {
    const viaApi = await clientAdminFetch<{ id: string; invoice?: PurchaseInvoice }>("/api/admin/inventory/invoice/save", {
      invoice,
      mode: "finance",
    });
    if (viaApi.ok && viaApi.data?.id) return success(viaApi.data.id);
    if (viaApi.code === "DUPLICATE_INVOICE" || viaApi.error === "DUPLICATE_INVOICE") {
      return failure(new Error("DUPLICATE_INVOICE"), "DUPLICATE_INVOICE");
    }
    if (viaApi.code === "PERMISSION_DENIED" || viaApi.status === 401 || viaApi.status === 403) {
      return failure(new Error("PERMISSION_DENIED"), "PERMISSION_DENIED");
    }
    const synced = syncInvoiceTotals(invoice);
    const existingSnap = await getDocs(collection(getDb(), COLLECTIONS.purchaseInvoices));
    const existing = existingSnap.docs.map((item) => ({ id: item.id, ...item.data() }) as PurchaseInvoice);
    const duplicateOf = findDuplicateInvoice(
      existing.filter((item) => item.id !== synced.id),
      synced
    );
    if (duplicateOf) return failure(new Error("DUPLICATE_INVOICE"), "DUPLICATE_INVOICE");

    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      ...synced,
      status: "saved",
      stockStatus: invoiceStockStatus(synced) === "none" ? "none" : invoiceStockStatus(synced),
      approvedAt: now,
      approvedBy: synced.approvedBy || null,
      audit: [...(synced.audit ?? []), { at: new Date().toISOString(), actor: synced.approvedBy, action: "finance-save" }],
      updatedAt: now,
    });
    let id = synced.id;
    if (id) await updateDoc(doc(getDb(), COLLECTIONS.purchaseInvoices, id), payload);
    else {
      const ref = await addDoc(collection(getDb(), COLLECTIONS.purchaseInvoices), { ...payload, createdAt: now });
      id = ref.id;
    }

    const existingRecords = await getDocs(
      query(collection(getDb(), COLLECTIONS.purchasePriceRecords), where("invoiceId", "==", id))
    );
    const recordedKeys = new Set(existingRecords.docs.map((item) => String(item.data().invoiceLineKey || "")));
    for (const line of synced.lines) {
      const productId = line.productId;
      if (!productId || !isConfirmedInvoiceMatch(line) || !line.quantity || !line.unit) continue;
      if (recordedKeys.has(line.key)) continue;
      const net = line.netAmount ?? line.priceBeforeVat ?? 0;
      const gross = line.grossAmount ?? line.priceIncludingVat ?? 0;
      await addDoc(
        collection(getDb(), COLLECTIONS.purchasePriceRecords),
        sanitizeFirestoreData({
          productId,
          supplierId: synced.supplierId || null,
          invoiceId: id,
          invoiceLineId: line.key,
          invoiceLineKey: line.key,
          purchaseDate: synced.invoiceDate,
          quantity: line.quantity,
          packageQuantity: line.quantity,
          purchaseQuantity: line.quantity,
          unit: line.unit,
          purchaseUnit: line.unit,
          unitPriceNet: line.unitPriceNet ?? null,
          unitPriceGross: line.unitPriceGross ?? null,
          lineTotalNet: net,
          lineTotalVat: line.vatAmount ?? 0,
          lineTotalGross: gross,
          priceBeforeVat: net,
          vatAmount: line.vatAmount ?? 0,
          priceIncludingVat: gross,
          vatType: line.vatType,
          vatRate: line.vatRate,
          unitCost: unitCostFromPackage(net || gross, line.quantity, line.unit),
          source: "PURCHASE_INVOICE",
          createdAt: now,
        })
      );
      if (synced.supplierId) {
        await recordSupplierPurchase({
          productId,
          supplierId: synced.supplierId,
          priceIncludingVat: gross,
          priceBeforeVat: net,
          packageQuantity: line.quantity,
          purchaseUnit: line.unit,
          purchasedAt: synced.invoiceDate || synced.receivedAt,
          vatType: line.vatType,
          vatRate: line.vatRate ?? undefined,
          invoiceId: id,
          invoiceNumber: synced.invoiceNumber,
          invoiceLineId: line.key,
          unitPriceNet: line.unitPriceNet ?? undefined,
          unitPriceGross: line.unitPriceGross ?? undefined,
          lineTotalNet: net,
          lineTotalVat: line.vatAmount ?? 0,
          lineTotalGross: gross,
        });
        if (line.rawName) {
          await saveSupplierItemMap({
            supplierId: synced.supplierId,
            supplierProductName: line.rawName,
            supplierSku: line.sku,
            inventoryProductId: productId,
            purchaseUnit: line.unit ?? undefined,
            packageQuantity: line.quantity ?? undefined,
            conversion: line.conversionFactor ?? undefined,
          });
        }
      }
    }
    return success(id);
  } catch (error) {
    return failure(error, "Failed to save finance invoice");
  }
}

export async function transferInvoiceLinesToStock(
  invoice: PurchaseInvoice,
  lineKeys?: string[],
  options?: { skipFinanceSave?: boolean }
): Promise<ServiceResult<PurchaseInvoice | void>> {
  try {
    if (!invoice.id) return failure(new Error("Invoice required"), "Invoice required");
    if (invoice.inventoryPostedAt && invoice.stockStatus === "posted") {
      return failure(new Error("ALREADY_POSTED"), "ALREADY_POSTED");
    }
    const viaApi = await clientAdminFetch<{ invoice: PurchaseInvoice }>("/api/admin/inventory/invoice/stock-post", {
      invoice,
      lineKeys,
      skipFinanceSave: options?.skipFinanceSave,
    });
    if (viaApi.ok && viaApi.data?.invoice) return success(viaApi.data.invoice);
    if (viaApi.code === "PERMISSION_DENIED" || viaApi.status === 401 || viaApi.status === 403) {
      return failure(new Error("PERMISSION_DENIED"), "PERMISSION_DENIED");
    }
    return failure(new Error(viaApi.error || "STOCK_POST_FAILED"), viaApi.error || "STOCK_POST_FAILED");
  } catch (error) {
    return failure(error, "Failed to transfer invoice to stock");
  }
}

export async function approvePurchaseInvoice(invoice: PurchaseInvoice): Promise<ServiceResult<void>> {
  const saved = await saveFinanceInvoice(invoice);
  if (!saved.success) return failure(new Error(saved.error), saved.error);
  return success(undefined);
}

export async function savePosDraft(input: Omit<PosImport, "id" | "createdAt"> & { id?: string }): Promise<ServiceResult<string>> {
  try {
    if (!input.lines?.length) return failure(new Error("empty-import"), "empty-import");
    const now = nowTimestamp();
    const payload = excelImportPayload({
      fileName: input.fileName,
      fileHash: input.fileHash,
      period: input.period,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      reportGeneratedAt: input.reportGeneratedAt,
      uploadedAt: input.uploadedAt,
      periodNeedsReview: input.periodNeedsReview,
      lines: input.lines,
      itemCount: input.itemCount,
      quantitySum: input.quantitySum,
      reportedRevenueSum: input.reportedRevenueSum,
      sheetName: input.sheetName,
      headerRow: input.headerRow,
      previousImportId: input.previousImportId,
      excludedKeys: input.excludedKeys,
      sourceTotals: input.sourceTotals,
    });
    if (input.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.posImports, input.id), sanitizeFirestoreData({ ...payload, updatedAt: now }));
      return success(input.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.posImports), sanitizeFirestoreData({ ...payload, createdAt: now }));
    return success(ref.id);
  } catch (error) {
    return failure(error, "Failed to save POS import");
  }
}

export async function findPosImportByHash(fileHash: string): Promise<PosImport | null> {
  const snap = await getDocs(query(collection(getDb(), COLLECTIONS.posImports), where("fileHash", "==", fileHash)));
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  const data = docSnap.data();
  return mapPosImport(docSnap.id, data as Record<string, unknown>);
}

export async function saveZDraft(input: Omit<PosZReport, "id" | "createdAt"> & { id?: string }): Promise<ServiceResult<string>> {
  try {
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      ...input,
      status: "draft" as const,
      financeEntryId: input.financeEntryId ?? null,
    });
    if (input.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.posZReports, input.id), { ...payload, updatedAt: now });
      return success(input.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.posZReports), { ...payload, createdAt: now });
    return success(ref.id);
  } catch (error) {
    return failure(error, "Failed to save Z draft");
  }
}

export async function savePosColumnMap(input: {
  headers: string[];
  columnMap: Record<string, number>;
  sheetName?: string | null;
  headerRow?: number | null;
}): Promise<ServiceResult<string>> {
  try {
    const existing = await getDocs(query(collection(getDb(), COLLECTIONS.posColumnMaps), where("headers", "==", input.headers)));
    const payload = sanitizeFirestoreData({ ...input, createdAt: nowTimestamp() });
    if (existing.docs[0]) {
      await updateDoc(existing.docs[0].ref, payload);
      return success(existing.docs[0].id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.posColumnMaps), payload);
    return success(ref.id);
  } catch (error) {
    return failure(error, "Failed to save column map");
  }
}

export async function savePosProductMap(input: { posCode: string; posName: string; menuProductId: string }): Promise<ServiceResult<void>> {
  try {
    const existing = await getDocs(
      query(collection(getDb(), COLLECTIONS.posProductMaps), where("posCode", "==", input.posCode), where("posName", "==", input.posName))
    );
    const payload = sanitizeFirestoreData(input);
    if (existing.docs[0]) await updateDoc(existing.docs[0].ref, payload);
    else await addDoc(collection(getDb(), COLLECTIONS.posProductMaps), payload);
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to save POS map");
  }
}

export async function approvePosImport(input: {
  draft: PosImport;
  recipes?: DishRecipe[];
  previous?: PosImport | null;
  periodConfirmed?: boolean;
}): Promise<ServiceResult<void>> {
  try {
    if (!input.draft.lines?.length) return failure(new Error("empty-import"), "empty-import");
    if (
      !periodReviewCleared({
        periodNeedsReview: input.draft.periodNeedsReview,
        periodConfirmed: input.periodConfirmed,
        periodFrom: input.draft.periodFrom,
        periodTo: input.draft.periodTo,
      })
    ) {
      return failure(new Error("period-review"), "period-review");
    }
    const now = nowTimestamp();
    const payload = excelImportPayload({
      fileName: input.draft.fileName,
      fileHash: input.draft.fileHash,
      period: input.draft.period,
      periodFrom: input.draft.periodFrom,
      periodTo: input.draft.periodTo,
      sourcePeriodFrom: input.draft.sourcePeriodFrom,
      sourcePeriodTo: input.draft.sourcePeriodTo,
      reportGeneratedAt: input.draft.reportGeneratedAt,
      uploadedAt: input.draft.uploadedAt,
      periodNeedsReview: input.draft.periodNeedsReview,
      periodConfirmed: input.periodConfirmed,
      lines: input.draft.lines,
      itemCount: input.draft.itemCount,
      quantitySum: input.draft.quantitySum,
      reportedRevenueSum: input.draft.reportedRevenueSum,
      previousImportId: input.draft.previousImportId,
    });
    await updateDoc(doc(getDb(), COLLECTIONS.posImports, input.draft.id), sanitizeFirestoreData({
      ...payload,
      status: "saved",
      approvedAt: now,
      updatedAt: now,
    }));
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to save POS information");
  }
}

export async function applyPosExcelImport(input: {
  draft: PosImport;
  rows: PosApplyRow[];
  periodConfirmed?: boolean;
  overlapAcknowledged?: boolean;
  actor?: string;
}): Promise<
  ServiceResult<{
    importId: string;
    complete: boolean;
    productsCreated: number;
    pricesUpdated: number;
    movementsWritten: number;
    error?: string;
  }>
> {
  try {
    if (!input.draft.lines?.length) return failure(new Error("empty-import"), "empty-import");
    if (
      !periodReviewCleared({
        periodNeedsReview: input.draft.periodNeedsReview,
        periodConfirmed: input.periodConfirmed,
        periodFrom: input.draft.periodFrom,
        periodTo: input.draft.periodTo,
      })
    ) {
      return failure(new Error("period-review"), "period-review");
    }
    const eligible = input.rows.filter((row) => row.eligible);
    const fakePlan = {
      blockers: [] as ("empty" | "period-review" | "overlap-review" | "already-applied")[],
      alreadyApplied: input.draft.inventoryStatus === "posted",
      resumePartial: input.draft.inventoryStatus === "partial",
      eligibleCount: eligible.length,
    };
    if (fakePlan.alreadyApplied && !fakePlan.resumePartial) {
      return success({
        importId: input.draft.id,
        complete: true,
        productsCreated: input.draft.applyProgress?.productsCreated?.length ?? 0,
        pricesUpdated: input.draft.applyProgress?.pricesUpdated?.length ?? 0,
        movementsWritten: input.draft.applyProgress?.movementIds?.length ?? 0,
      });
    }
    const db = getDb();
    const now = nowTimestamp();
    const executedAt = new Date().toISOString();
    const productsCreated = [...(input.draft.applyProgress?.productsCreated ?? [])];
    const pricesUpdated = [...(input.draft.applyProgress?.pricesUpdated ?? [])];
    const movementIds = [...(input.draft.applyProgress?.movementIds ?? [])];
    const productIdByKey = new Map<string, string>();

    const productsSnap = await getDocs(collection(db, COLLECTIONS.products));
    const existingBySource = new Map<string, string>();
    const existingById = new Set<string>();
    for (const item of productsSnap.docs) {
      existingById.add(item.id);
      const data = item.data() as Record<string, unknown>;
      const key = typeof data.posSourceKey === "string" ? data.posSourceKey : "";
      if (key) existingBySource.set(key, item.id);
    }

    await updateDoc(doc(db, COLLECTIONS.posImports, input.draft.id), sanitizeFirestoreData({
      inventoryStatus: "partial",
      status: "approved",
      financeStatus: "none",
      infoOnly: true,
      applyProgress: { productsCreated, pricesUpdated, movementIds },
      updatedAt: now,
    }));

    for (const row of eligible) {
      if (!row.createProduct) {
        if (row.menuProductId) productIdByKey.set(row.key, row.menuProductId);
        continue;
      }
      const sourceKey = posSourceKey(row);
      const existing = existingBySource.get(sourceKey);
      if (existing) {
        productIdByKey.set(row.key, existing);
        if (!productsCreated.includes(existing)) productsCreated.push(existing);
        continue;
      }
      const id = posCreatedProductId(input.draft.id, row.key);
      productIdByKey.set(row.key, id);
      if (existingById.has(id)) {
        if (!productsCreated.includes(id)) productsCreated.push(id);
        continue;
      }
      const name = row.posName.trim();
      const price = row.updatePrice && row.proposedPrice && row.proposedPrice > 0 ? row.proposedPrice : row.proposedPrice && row.proposedPrice > 0 ? row.proposedPrice : 0;
      await setDoc(
        doc(db, COLLECTIONS.products, id),
        sanitizeFirestoreData({
          nameHe: name,
          nameAr: name,
          nameEn: name,
          descriptionHe: "ייבוא קופה",
          descriptionAr: "استيراد الصندوق",
          descriptionEn: "POS import",
          categoryId: "pos-internal",
          price,
          cost: 0,
          profit: price,
          businessType: "food",
          imageUrl: "",
          barcode: row.posCode || "",
          available: false,
          popular: false,
          newProduct: false,
          active: true,
          hidden: true,
          sortOrder: 9999,
          posImportId: input.draft.id,
          posSourceKey: sourceKey,
          createdAt: now,
          updatedAt: now,
        })
      );
      existingById.add(id);
      existingBySource.set(sourceKey, id);
      productsCreated.push(id);
      await savePosProductMap({ posCode: row.posCode, posName: row.posName, menuProductId: id });
    }

    for (const row of eligible) {
      const productId = row.menuProductId || productIdByKey.get(row.key);
      if (!productId || !row.updatePrice) continue;
      if (row.proposedPrice == null || !Number.isFinite(row.proposedPrice)) continue;
      if (row.proposedPrice === 0 && (row.currentPrice ?? 0) > 0) continue;
      if (pricesUpdated.includes(productId)) continue;
      const current = productsSnap.docs.find((item) => item.id === productId)?.data() as Record<string, unknown> | undefined;
      if (typeof current?.price === "number" && Math.abs(current.price - row.proposedPrice) <= 0.005) {
        pricesUpdated.push(productId);
        continue;
      }
      const cost = typeof current?.cost === "number" ? current.cost : 0;
      await updateDoc(doc(db, COLLECTIONS.products, productId), sanitizeFirestoreData({
        price: row.proposedPrice,
        profit: row.proposedPrice - cost,
        updatedAt: now,
      }));
      pricesUpdated.push(productId);
    }

    const live = await getDocs(collection(db, COLLECTIONS.inventoryMovements));
    const movements = live.docs.map((item) => mapMovement(item.id, item.data() as Record<string, unknown>));

    for (const row of eligible) {
      const menuProductId = row.menuProductId || productIdByKey.get(row.key);
      for (const impact of row.impacts) {
        const createdId = productIdByKey.get(row.key);
        const targetId =
          row.createProduct && row.stockPath === "finished-unit"
            ? createdId || menuProductId
            : impact.productId === row.key || impact.productId === posCreatedProductId("draft", row.key)
              ? createdId || menuProductId
              : impact.productId;
        if (!targetId) continue;
        if (movementAlreadyWritten(movements, input.draft.id, row.sourceRow, targetId)) {
          const existingId = posMovementId(input.draft.id, row.sourceRow, targetId);
          if (!movementIds.includes(existingId)) movementIds.push(existingId);
          continue;
        }
        const movementId = posMovementId(input.draft.id, row.sourceRow, targetId);
        const deltaBase = row.lineKind === "return" ? Math.abs(impact.quantityBase) : -Math.abs(impact.quantityBase);
        const result = await commitStockMovement({
          movementId,
          productId: targetId,
          deltaBase,
          fallbackAvailable: currentStockBase(movements, targetId),
          requireNonNegative: false,
          payload: {
            productId: targetId,
            type: row.lineKind === "return" ? "ADJUSTMENT" : row.stockPath === "recipe" ? "ISSUE_OUT" : "SALE_OUT",
            quantity: Math.abs(impact.quantity),
            unit: impact.unit,
            quantityBase: Math.abs(impact.quantityBase),
            posImportId: input.draft.id,
            posSourceRow: row.sourceRow ?? null,
            menuProductId: menuProductId || null,
            recipeId: row.stockPath === "recipe" ? menuProductId || null : null,
            actor: input.actor || null,
            reason: row.stockPath === "recipe" ? "recipe" : row.lineKind === "return" ? "return" : null,
            note: row.lineKind === "return" ? "POS return" : "POS excel sale",
            idempotencyKey: `pos-${input.draft.id}-${row.sourceRow}-${targetId}`,
            quantityIn: deltaBase,
            receivedAt: executedAt,
            createdAt: now,
          },
        });
        movementIds.push(result.id);
        movements.push({
          id: result.id,
          productId: targetId,
          type: "SALE_OUT",
          quantity: Math.abs(impact.quantity),
          unit: impact.unit,
          quantityBase: Math.abs(impact.quantityBase),
          posImportId: input.draft.id,
          posSourceRow: row.sourceRow,
          receivedAt: executedAt,
          createdAt: executedAt,
        });
      }
    }

    const expectedMovements = eligible.reduce((sum, row) => sum + row.impacts.length, 0);
    const complete = movementIds.length >= expectedMovements;
    await updateDoc(doc(db, COLLECTIONS.posImports, input.draft.id), sanitizeFirestoreData({
      inventoryStatus: complete ? "posted" : "partial",
      status: "approved",
      financeStatus: "none",
      infoOnly: true,
      applyProgress: {
        productsCreated,
        pricesUpdated,
        movementIds,
        lastError: complete ? null : "incomplete",
      },
      approvedAt: now,
      updatedAt: now,
    }));
    return success({
      importId: input.draft.id,
      complete,
      productsCreated: productsCreated.length,
      pricesUpdated: pricesUpdated.length,
      movementsWritten: movementIds.length,
      error: complete ? undefined : "incomplete",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "apply-failed";
    try {
      await updateDoc(doc(getDb(), COLLECTIONS.posImports, input.draft.id), sanitizeFirestoreData({
        inventoryStatus: "partial",
        applyProgress: {
          ...(input.draft.applyProgress ?? {}),
          lastError: message,
        },
        updatedAt: nowTimestamp(),
      }));
    } catch {
      /* keep the original error */
    }
    return failure(error, message);
  }
}

export async function issueInventory(input: {
  lines: IssueDraftLine[];
  ingredients: CostingIngredient[];
  reason: InventoryIssueReason;
  note?: string;
  receivedAt: string;
  actor?: string;
  recipeId?: string;
  menuProductId?: string;
  dishCount?: number;
  idempotencyKey: string;
}): Promise<ServiceResult<{ movementIds: string[]; reused?: boolean }>> {
  try {
    const key = input.idempotencyKey.trim();
    if (!key) return failure(new Error("IDEMPOTENCY_REQUIRED"), "IDEMPOTENCY_REQUIRED");
    const live = await getDocs(collection(getDb(), COLLECTIONS.inventoryMovements));
    const movements = live.docs.map((item) => mapMovement(item.id, item.data() as Record<string, unknown>));
    const already = movements.filter((row) => row.idempotencyKey === key);
    if (already.length) return success({ movementIds: already.map((row) => row.id), reused: true });
    const checked = validateIssueLines(input.lines, input.ingredients, movements);
    if (!checked.ok) return failure(new Error(checked.error), checked.error);
    const now = nowTimestamp();
    const movementIds: string[] = [];
    let reused = false;
    for (const line of checked.lines) {
      const result = await commitStockMovement({
        movementId: `issue-${key}-${line.productId}`,
        productId: line.productId,
        deltaBase: -line.quantityBase,
        fallbackAvailable: currentStockBase(movements, line.productId),
        requireNonNegative: true,
        payload: {
          productId: line.productId,
          type: "ISSUE_OUT",
          quantity: line.quantity,
          unit: line.unit,
          quantityBase: line.quantityBase,
          reason: input.reason,
          actor: input.actor || null,
          note: input.note || null,
          recipeId: input.recipeId || null,
          menuProductId: input.menuProductId || null,
          dishCount: input.dishCount ?? null,
          issueBatchId: key,
          idempotencyKey: key,
          quantityIn: -line.quantityBase,
          receivedAt: input.receivedAt,
          createdAt: now,
        },
      });
      movementIds.push(result.id);
      reused = reused || result.reused;
    }
    return success({ movementIds, reused });
  } catch (error) {
    const message = error instanceof Error && error.message === "overStock" ? "overStock" : "Failed to issue inventory";
    return failure(error, message);
  }
}

export async function reverseInventoryMovement(movementId: string, actor?: string): Promise<ServiceResult<string>> {
  try {
    const live = await getDocs(collection(getDb(), COLLECTIONS.inventoryMovements));
    const movements = live.docs.map((item) => mapMovement(item.id, item.data() as Record<string, unknown>));
    const existing = movements.find((row) => row.reversesId === movementId);
    if (existing) return success(existing.id);
    const source = live.docs.find((item) => item.id === movementId);
    if (!source) return failure(new Error("NOT_FOUND"), "NOT_FOUND");
    const data = source.data();
    if (data.type === "REVERSAL") return failure(new Error("CANNOT_REVERSE"), "CANNOT_REVERSE");
    const productId = String(data.productId ?? "");
    const restore = -movementSignedBase({
      type: data.type as InventoryMovement["type"],
      quantityBase: asNumber(data.quantityBase),
    });
    const result = await commitStockMovement({
      movementId: `rev-${movementId}`,
      productId,
      deltaBase: restore,
      fallbackAvailable: currentStockBase(movements, productId),
      payload: {
        productId,
        type: "REVERSAL",
        quantity: Math.abs(asNumber(data.quantity)),
        unit: data.unit,
        quantityBase: restore,
        reversesId: movementId,
        actor: actor || null,
        note: `Reverse ${movementId}`,
        invoiceId: data.invoiceId || null,
        recipeId: data.recipeId || null,
        menuProductId: data.menuProductId || null,
        receivedAt: new Date().toISOString(),
        createdAt: nowTimestamp(),
      },
    });
    return success(result.id);
  } catch (error) {
    return failure(error, "Failed to reverse movement");
  }
}

export async function reverseOrderInventory(orderId: string): Promise<void> {
  const snap = await getDocs(query(collection(getDb(), COLLECTIONS.inventoryMovements), where("orderId", "==", orderId)));
  const now = nowTimestamp();
  for (const row of snap.docs) {
    const data = row.data();
    await addDoc(
      collection(getDb(), COLLECTIONS.inventoryMovements),
      sanitizeFirestoreData({
        productId: data.productId,
        type: "REVERSAL",
        quantity: Math.abs(asNumber(data.quantityBase)),
        unit: data.unit,
        quantityBase: -asNumber(data.quantityBase),
        orderId,
        note: `Reverse ${orderId}`,
        receivedAt: new Date().toISOString(),
        createdAt: now,
      })
    );
  }
}

export async function findPaidPaymentForOrder(orderId: string): Promise<{ id: string; provider?: string } | null> {
  const snap = await getDocs(query(collection(getDb(), COLLECTIONS.payments), where("orderId", "==", orderId)));
  for (const row of snap.docs) {
    const data = row.data();
    if (String(data.status ?? "") === "paid") {
      return { id: row.id, provider: data.provider ? String(data.provider) : undefined };
    }
  }
  return null;
}

export async function permanentlyDeleteOrder(orderId: string): Promise<ServiceResult<void>> {
  try {
    await reverseOrderInventory(orderId);
    await deleteDoc(doc(getDb(), COLLECTIONS.orders, orderId));
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to permanently delete order");
  }
}

export function latestUnitCost(
  product: CostingIngredient,
  records: PurchasePriceRecord[],
  basis: "latest" | "weighted" = "latest"
): { including: number; before: number } {
  const rows = records.filter((row) => row.productId === product.id);
  if (!rows.length) {
    return { including: product.costPerBaseUnit, before: product.costPerBaseUnit };
  }
  if (basis === "weighted") {
    const qty = rows.reduce((sum, row) => sum + purchaseQuantityInBase(row.quantity || row.packageQuantity, row.unit), 0);
    const inc = qty > 0 ? rows.reduce((sum, row) => sum + row.unitCost * purchaseQuantityInBase(row.quantity || row.packageQuantity, row.unit), 0) / qty : product.costPerBaseUnit;
    const before =
      qty > 0
        ? rows.reduce((sum, row) => sum + (row.priceBeforeVat / Math.max(purchaseQuantityInBase(row.quantity || row.packageQuantity, row.unit), 1)) * purchaseQuantityInBase(row.quantity || row.packageQuantity, row.unit), 0) / qty
        : inc;
    return { including: inc, before };
  }
  const latest = rows.slice().sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))[0];
  const baseQty = purchaseQuantityInBase(latest.quantity || latest.packageQuantity, latest.unit) || 1;
  return { including: latest.unitCost, before: latest.priceBeforeVat / baseQty };
}

export async function recordManualStockIn(input: {
  productId: string;
  quantity: number;
  unit: PurchaseUnit;
  note?: string;
  actor?: string;
  receivedAt: string;
  idempotencyKey: string;
}): Promise<ServiceResult<string>> {
  try {
    const key = input.idempotencyKey.trim();
    if (!key) return failure(new Error("IDEMPOTENCY_REQUIRED"), "IDEMPOTENCY_REQUIRED");
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) return failure(new Error("zeroQty"), "zeroQty");
    const qtyBase = purchaseQuantityInBase(input.quantity, input.unit);
    if (qtyBase <= 0) return failure(new Error("zeroQty"), "zeroQty");
    const live = await getDocs(collection(getDb(), COLLECTIONS.inventoryMovements));
    const movements = live.docs.map((item) => mapMovement(item.id, item.data() as Record<string, unknown>));
    const already = movements.find((row) => row.idempotencyKey === key);
    if (already) return success(already.id);
    const result = await commitStockMovement({
      movementId: `in-manual-${key}`,
      productId: input.productId,
      deltaBase: qtyBase,
      fallbackAvailable: currentStockBase(movements, input.productId),
      payload: {
        productId: input.productId,
        type: "OPENING",
        quantity: input.quantity,
        unit: input.unit,
        quantityBase: qtyBase,
        actor: input.actor || null,
        note: input.note || null,
        idempotencyKey: key,
        receivedAt: input.receivedAt,
        createdAt: nowTimestamp(),
      },
    });
    return success(result.id);
  } catch (error) {
    return failure(error, "Failed to record stock in");
  }
}

export async function mergeIngredients(input: {
  survivor: CostingIngredient;
  loser: CostingIngredient;
  actor?: string;
}): Promise<ServiceResult<{ mergedBalance: number }>> {
  try {
    const db = getDb();
    const live = await getDocs(collection(db, COLLECTIONS.inventoryMovements));
    const movements = live.docs.map((item) => mapMovement(item.id, item.data() as Record<string, unknown>));
    const plan = planIngredientMerge({
      survivor: input.survivor,
      loser: input.loser,
      survivorBalance: currentStockBase(movements, input.survivor.id),
      loserBalance: currentStockBase(movements, input.loser.id),
    });
    if (!plan.ok) return failure(new Error(plan.reason), plan.reason);
    const now = nowTimestamp();
    const batchKey = `merge-${input.survivor.id}-${input.loser.id}`;
    if (plan.survivorDelta !== 0) {
      await commitStockMovement({
        movementId: `${batchKey}-in`,
        productId: input.survivor.id,
        deltaBase: plan.survivorDelta,
        fallbackAvailable: plan.survivorBalance,
        payload: {
          productId: input.survivor.id,
          type: "ADJUSTMENT",
          quantity: Math.abs(plan.survivorDelta),
          unit: input.survivor.baseUnit,
          quantityBase: plan.survivorDelta,
          actor: input.actor || null,
          note: `merge:${input.loser.id}`,
          idempotencyKey: `${batchKey}-in`,
          receivedAt: new Date().toISOString(),
          createdAt: now,
        },
      });
      await commitStockMovement({
        movementId: `${batchKey}-out`,
        productId: input.loser.id,
        deltaBase: plan.loserDelta,
        fallbackAvailable: plan.loserBalance,
        payload: {
          productId: input.loser.id,
          type: "ADJUSTMENT",
          quantity: Math.abs(plan.loserDelta),
          unit: input.loser.baseUnit,
          quantityBase: plan.loserDelta,
          actor: input.actor || null,
          note: `merge:${input.survivor.id}`,
          idempotencyKey: `${batchKey}-out`,
          receivedAt: new Date().toISOString(),
          createdAt: now,
        },
      });
    }
    const retarget = async (col: string, field: string) => {
      const snap = await getDocs(query(collection(db, col), where(field, "==", input.loser.id)));
      for (const row of snap.docs) {
        await updateDoc(row.ref, { [field]: input.survivor.id, updatedAt: now });
      }
    };
    await retarget(COLLECTIONS.supplierItemMaps, "inventoryProductId");
    await retarget(COLLECTIONS.supplierOffers, "productId");
    await retarget(COLLECTIONS.purchasePriceRecords, "productId");
    const recipes = await getDocs(collection(db, COLLECTIONS.dishRecipes));
    for (const row of recipes.docs) {
      const data = row.data() as DishRecipe;
      const next = (data.ingredients ?? []).map((line) =>
        line.ingredientId === input.loser.id ? { ...line, ingredientId: input.survivor.id } : line
      );
      if (next.some((line, i) => line.ingredientId !== data.ingredients[i]?.ingredientId)) {
        await updateDoc(row.ref, { ingredients: next, updatedAt: now });
      }
    }
    await updateDoc(doc(db, COLLECTIONS.ingredients, input.loser.id), {
      active: false,
      notes: `merged:${input.survivor.id}`,
      updatedAt: now,
    });
    return success({ mergedBalance: plan.mergedBalance });
  } catch (error) {
    return failure(error, "Failed to merge ingredients");
  }
}

export type StockCountSession = {
  id: string;
  status: "open" | "pending" | "approved" | "cancelled";
  startedAt: string;
  startedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  lines: { productId: string; countedBase: number | null }[];
  snapshot: Record<string, number>;
};

export async function saveStockCountSession(
  session: Omit<StockCountSession, "id"> & { id?: string }
): Promise<ServiceResult<string>> {
  try {
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({ ...session, updatedAt: now });
    if (session.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.stockCountSessions, session.id), payload);
      return success(session.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.stockCountSessions), { ...payload, createdAt: now });
    return success(ref.id);
  } catch (error) {
    return failure(error, "Failed to save stock count");
  }
}

export async function approveStockCountSession(input: {
  session: StockCountSession;
  movements: InventoryMovement[];
  actor?: string;
}): Promise<ServiceResult<string>> {
  try {
    if (input.session.status === "approved") return success(input.session.id);
    if (input.session.status !== "pending" && input.session.status !== "open") {
      return failure(new Error("NOT_PENDING"), "NOT_PENDING");
    }
    const { stockCountAdjustment, movementsDuringCount } = await import("@/lib/inventory/ingredient-core");
    const now = nowTimestamp();
    for (const line of input.session.lines) {
      const counted = line.countedBase;
      const snapshot = input.session.snapshot[line.productId] ?? 0;
      const during = movementsDuringCount(input.movements, line.productId, input.session.startedAt);
      const result = stockCountAdjustment({ countedBase: counted, snapshotBase: snapshot, movementsDuringBase: during });
      if (result.skip || Math.abs(result.adjustment) < 0.0001) continue;
      await commitStockMovement({
        movementId: `count-${input.session.id}-${line.productId}`,
        productId: line.productId,
        deltaBase: result.adjustment,
        fallbackAvailable: currentStockBase(input.movements, line.productId),
        payload: {
          productId: line.productId,
          type: "ADJUSTMENT",
          quantity: Math.abs(result.adjustment),
          unit: "unit",
          quantityBase: result.adjustment,
          actor: input.actor || null,
          note: `count:${input.session.id}`,
          idempotencyKey: `count-${input.session.id}-${line.productId}`,
          receivedAt: new Date().toISOString(),
          createdAt: now,
        },
      });
    }
    await updateDoc(doc(getDb(), COLLECTIONS.stockCountSessions, input.session.id), {
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: input.actor || null,
      updatedAt: now,
    });
    return success(input.session.id);
  } catch (error) {
    return failure(error, "Failed to approve stock count");
  }
}

export type PurchaseListApplyResult = {
  createdIngredients: { id: string; name: string }[];
  matchedIngredients: { id: string; name: string }[];
  createdSuppliers: { id: string; name: string }[];
  invoicesSaved: { id: string; supplierId: string; invoiceNumber: string; skippedDuplicate: boolean }[];
  purchasesSaved: number;
  skippedDuplicates: number;
  incomplete: { key: string; sourceName: string; needs: string[] }[];
  stockChanged: false;
  financeCreated: false;
};

function purchaseMoney(row: { unitPrice: number | null; lineNet: number | null; lineVat: number | null; lineGross: number | null; quantity: number | null }) {
  const sourceNet = row.lineNet;
  const sourceVat = row.lineVat;
  const sourceGross = row.lineGross;
  const qty = row.quantity && row.quantity > 0 ? row.quantity : null;
  let net = sourceNet;
  let gross = sourceGross;
  let vat = sourceVat;
  if (net == null && gross != null) {
    const split = splitVat({ amount: gross, vatType: "inclusive", vatRate: 0.18 });
    net = split.priceBeforeVat;
    vat = vat ?? split.vatAmount;
  } else if (gross == null && net != null) {
    const split = splitVat({ amount: net, vatType: "exclusive", vatRate: 0.18 });
    gross = split.priceIncludingVat;
    vat = vat ?? split.vatAmount;
  }
  const unitNet = row.unitPrice ?? (net != null && qty ? net / qty : null);
  const unitGross = unitNet != null && net != null && gross != null && net > 0 ? unitNet * (gross / net) : unitNet;
  return { sourceNet, sourceVat, sourceGross, net, vat, gross, unitNet, unitGross };
}

export async function applyPurchaseList(input: {
  text: string;
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  maps: SupplierItemMap[];
  invoices: PurchaseInvoice[];
  decisions?: Record<string, PurchaseListDecision>;
  actor?: string;
}): Promise<ServiceResult<PurchaseListApplyResult>> {
  try {
    const plan = planPurchaseList(input);
    const incomplete = plan.selectedRows
      .filter((row) => !isWritablePurchaseRow(row))
      .map((row) => ({ key: row.key, sourceName: row.sourceName, needs: row.needs }));
    const writable = plan.selectedRows.filter(isWritablePurchaseRow);
    const createdIngredients: PurchaseListApplyResult["createdIngredients"] = [];
    const matchedIngredients: PurchaseListApplyResult["matchedIngredients"] = [];
    const createdSuppliers: PurchaseListApplyResult["createdSuppliers"] = [];
    const invoicesSaved: PurchaseListApplyResult["invoicesSaved"] = [];
    const ingredientIds = new Map<string, string>();
    const supplierIds = new Map<string, string>();
    let liveIngredients = [...input.ingredients];
    let liveSuppliers = [...input.suppliers];
    let liveInvoices = [...input.invoices];

    for (const row of writable) {
      const supplierKey = row.supplierName.trim();
      if (row.supplierId) {
        supplierIds.set(supplierKey, row.supplierId);
        continue;
      }
      if (supplierIds.has(supplierKey)) continue;
      const existing = liveSuppliers.find((item) => item.name.trim() === supplierKey);
      if (existing) {
        supplierIds.set(supplierKey, existing.id);
        continue;
      }
      const saved = await saveSupplier({ name: supplierKey, aliases: supplierAliasesFor(supplierKey) });
      if (!saved.success) return failure(new Error(saved.error), saved.error);
      supplierIds.set(supplierKey, saved.data.id);
      createdSuppliers.push({ id: saved.data.id, name: saved.data.name });
      liveSuppliers = [...liveSuppliers, saved.data];
    }

    for (const row of writable) {
      const nameKey = row.canonicalName.trim();
      if (row.ingredientId) {
        ingredientIds.set(nameKey, row.ingredientId);
        if (!matchedIngredients.some((item) => item.id === row.ingredientId)) {
          matchedIngredients.push({ id: row.ingredientId, name: nameKey });
        }
        continue;
      }
      if (ingredientIds.has(nameKey)) continue;
      const existing = liveIngredients.find((item) => item.name.trim() === nameKey);
      if (existing) {
        ingredientIds.set(nameKey, existing.id);
        matchedIngredients.push({ id: existing.id, name: existing.name });
        continue;
      }
      const money = purchaseMoney(row);
      const created = await createIngredient({
        name: nameKey,
        category: row.category,
        purchasePrice: money.net ?? money.gross ?? money.unitNet ?? 0,
        purchaseQuantity: row.quantity && row.quantity > 0 ? row.quantity : 1,
        purchaseUnit: row.purchaseUnit,
        supplier: row.supplierName,
        notes: row.sourceName !== nameKey ? `שם אצל הספק: ${row.sourceName}` : undefined,
      });
      if (!created.success) return failure(new Error(created.error), created.error);
      const supplierId = supplierIds.get(row.supplierName.trim());
      if (supplierId) {
        await updateDoc(doc(getDb(), COLLECTIONS.ingredients, created.data.id), {
          lastSupplierId: supplierId,
          updatedAt: nowTimestamp(),
        });
      }
      ingredientIds.set(nameKey, created.data.id);
      createdIngredients.push({ id: created.data.id, name: created.data.name });
      liveIngredients = [...liveIngredients, created.data];
    }

    for (const row of writable) {
      const supplierId = supplierIds.get(row.supplierName.trim());
      const productId = ingredientIds.get(row.canonicalName.trim());
      if (!supplierId || !productId) continue;
      await saveSupplierItemMap({
        supplierId,
        supplierProductName: row.sourceName,
        inventoryProductId: productId,
        purchaseUnit: row.purchaseUnit,
        packageQuantity: row.quantity ?? undefined,
        conversion: row.pack.packSize ?? undefined,
      });
    }

    let purchasesSaved = 0;
    let skippedDuplicates = 0;
    const groups = groupPurchaseInvoices(
      writable.map((row) => ({ ...row, supplierId: supplierIds.get(row.supplierName.trim()) || row.supplierId }))
    );

    for (const group of groups) {
      const supplierId = group.supplierId || supplierIds.get(group.supplierName.trim());
      if (!supplierId || !group.invoiceNumber) continue;
      const duplicate = purchaseInvoiceDuplicate(liveInvoices, supplierId, group.invoiceNumber);
      const existingInvoice = liveInvoices.find(
        (item) => item.supplierId === supplierId && item.invoiceNumber.trim() === group.invoiceNumber && item.status !== "rejected"
      );
      const lines: PurchaseInvoiceLine[] = group.rows.map((row) => {
        const money = purchaseMoney(row);
        const productId = ingredientIds.get(row.canonicalName.trim());
        const vatType: PurchaseInvoiceLine["vatType"] =
          money.sourceGross != null && money.sourceNet == null ? "inclusive" : "exclusive";
        return {
          key: purchaseLineKey(row),
          rawName: row.sourceName,
          originalDescription: row.sourceName,
          productId,
          quantity: row.quantity,
          unit: row.purchaseUnit,
          unitPrice: row.unitPrice,
          discount: null,
          lineTotal: money.sourceNet ?? money.sourceGross,
          lineNet: money.sourceNet,
          lineGross: money.sourceGross,
          vatType,
          vatRate: 0.18,
          priceBeforeVat: money.sourceNet,
          vatAmount: money.sourceVat,
          priceIncludingVat: money.sourceGross,
          matchKind: row.ingredientId ? "exact" : "new",
          matchConfirmed: true,
          category: row.category,
          conversionNote: row.pack.note,
          conversionFactor: row.pack.packSize,
          needsReview: row.pack.needsReview,
          skipInventory: true,
          unitPriceNet: money.unitNet,
          unitPriceGross: money.unitGross,
          netAmount: money.sourceNet,
          grossAmount: money.sourceGross,
        };
      });
      let invoiceId = existingInvoice?.id;
      if (!duplicate) {
        const sourceNet = group.rows.reduce((sum, row) => sum + (row.lineNet ?? 0), 0);
        const sourceVat = group.rows.reduce((sum, row) => sum + (row.lineVat ?? 0), 0);
        const sourceGross = group.rows.reduce((sum, row) => sum + (row.lineGross ?? 0), 0);
        const saved = await savePurchaseInvoiceDraft({
          supplierId,
          supplierName: group.supplierName,
          invoiceNumber: group.invoiceNumber,
          invoiceDate: group.invoiceDate,
          receivedAt: group.invoiceDate,
          status: "draft",
          stockStatus: "none",
          lines,
          notes: "purchase-list-import",
          sourceNet: sourceNet || null,
          sourceVat: sourceVat || null,
          sourceGross: sourceGross || null,
          createdBy: input.actor,
          audit: [{ at: new Date().toISOString(), actor: input.actor, action: "purchase-list-import" }],
        });
        if (!saved.success) return failure(new Error(saved.error), saved.error);
        invoiceId = saved.data;
        liveInvoices = [
          ...liveInvoices,
          {
            id: saved.data,
            supplierId,
            supplierName: group.supplierName,
            invoiceNumber: group.invoiceNumber,
            invoiceDate: group.invoiceDate,
            receivedAt: group.invoiceDate,
            status: "draft",
            stockStatus: "none",
            lines,
            createdAt: new Date().toISOString(),
          },
        ];
      } else {
        skippedDuplicates += 1;
      }
      invoicesSaved.push({
        id: invoiceId || existingInvoice?.id || "",
        supplierId,
        invoiceNumber: group.invoiceNumber,
        skippedDuplicate: duplicate,
      });
      if (!invoiceId) continue;
      const existingRecords = await getDocs(
        query(collection(getDb(), COLLECTIONS.purchasePriceRecords), where("invoiceId", "==", invoiceId))
      );
      const recordedKeys = new Set(existingRecords.docs.map((item) => String(item.data().invoiceLineKey || "")));
      const now = nowTimestamp();
      for (const row of group.rows) {
        const productId = ingredientIds.get(row.canonicalName.trim());
        const lineKey = purchaseLineKey(row);
        if (!productId || recordedKeys.has(lineKey)) continue;
        const money = purchaseMoney(row);
        const qty = row.quantity && row.quantity > 0 ? row.quantity : 1;
        await addDoc(
          collection(getDb(), COLLECTIONS.purchasePriceRecords),
          sanitizeFirestoreData({
            productId,
            supplierId,
            invoiceId,
            invoiceLineId: lineKey,
            invoiceLineKey: lineKey,
            purchaseDate: row.invoiceDate,
            quantity: qty,
            packageQuantity: qty,
            purchaseQuantity: qty,
            unit: row.purchaseUnit,
            purchaseUnit: row.purchaseUnit,
            unitPriceNet: money.unitNet,
            unitPriceGross: money.unitGross,
            lineTotalNet: money.sourceNet,
            lineTotalVat: money.sourceVat,
            lineTotalGross: money.sourceGross,
            priceBeforeVat: money.sourceNet ?? money.net ?? 0,
            vatAmount: money.sourceVat ?? money.vat ?? 0,
            priceIncludingVat: money.sourceGross ?? money.gross ?? 0,
            vatType: money.sourceGross != null && money.sourceNet == null ? "inclusive" : "exclusive",
            vatRate: 0.18,
            unitCost: unitCostFromPackage(money.sourceNet ?? money.net ?? 0, qty, row.purchaseUnit),
            source: "PURCHASE_INVOICE",
            createdAt: now,
          })
        );
        await recordSupplierPurchase({
          productId,
          supplierId,
          priceIncludingVat: money.sourceGross ?? money.gross ?? 0,
          priceBeforeVat: money.sourceNet ?? money.net ?? undefined,
          packageQuantity: qty,
          purchaseUnit: row.purchaseUnit,
          purchasedAt: row.invoiceDate,
          vatType: money.sourceGross != null && money.sourceNet == null ? "inclusive" : "exclusive",
          vatRate: 0.18,
          invoiceId,
          invoiceNumber: group.invoiceNumber,
          invoiceLineId: lineKey,
          unitPriceNet: money.unitNet ?? undefined,
          unitPriceGross: money.unitGross ?? undefined,
          lineTotalNet: money.sourceNet ?? undefined,
          lineTotalVat: money.sourceVat ?? undefined,
          lineTotalGross: money.sourceGross ?? undefined,
        });
        purchasesSaved += 1;
      }
    }

    return success({
      createdIngredients,
      matchedIngredients,
      createdSuppliers,
      invoicesSaved,
      purchasesSaved,
      skippedDuplicates,
      incomplete,
      stockChanged: false,
      financeCreated: false,
    });
  } catch (error) {
    return failure(error, "Failed to import purchase list");
  }
}

export async function saveIngredientCompareGroup(input: {
  groupId?: string;
  name: string;
  memberIds: string[];
}): Promise<ServiceResult<{ id: string; name: string; memberIds: string[] }>> {
  const memberIds = [...new Set(input.memberIds.filter(Boolean))];
  try {
    const viaApi = await clientAdminFetch<{ id: string; name: string; memberIds: string[] }>("/api/admin/inventory/compare-group", {
      action: "save-group",
      groupId: input.groupId,
      name: input.name.trim(),
      memberIds,
    });
    if (
      viaApi.ok &&
      viaApi.data?.id &&
      Array.isArray(viaApi.data.memberIds) &&
      viaApi.data.memberIds.length === memberIds.length
    ) {
      return success({ id: viaApi.data.id, name: viaApi.data.name, memberIds: viaApi.data.memberIds });
    }
    if (viaApi.code === "PERMISSION_DENIED" || viaApi.status === 401 || viaApi.status === 403) {
      return failure(new Error("PERMISSION_DENIED"), "PERMISSION_DENIED");
    }
    return failure(new Error(viaApi.error || "SAVE_FAILED"), viaApi.code || "SAVE_FAILED");
  } catch (error) {
    return failure(error, "Failed to save compare group");
  }
}

export async function saveComparePack(input: {
  productId: string;
  supplierId: string;
  packageQuantity: number;
  purchaseUnit: PurchaseUnit;
}): Promise<ServiceResult<void>> {
  try {
    const viaApi = await clientAdminFetch<{ ok: boolean }>("/api/admin/inventory/compare-group", {
      action: "save-pack",
      productId: input.productId,
      supplierId: input.supplierId,
      packageQuantity: input.packageQuantity,
      purchaseUnit: input.purchaseUnit,
    });
    if (viaApi.ok) return success(undefined);
    if (viaApi.code === "PERMISSION_DENIED" || viaApi.status === 401 || viaApi.status === 403) {
      return failure(new Error("PERMISSION_DENIED"), "PERMISSION_DENIED");
    }
    return failure(new Error(viaApi.error || "SAVE_FAILED"), viaApi.code || "SAVE_FAILED");
  } catch (error) {
    return failure(error, "Failed to save pack for compare");
  }
}

export async function saveComparePurchaseBasis(input: {
  productId: string;
  supplierId: string;
  price: number;
  packageQuantity: number;
  purchaseUnit: PurchaseUnit;
  vatMode: "net" | "gross";
}): Promise<ServiceResult<void>> {
  try {
    const viaApi = await clientAdminFetch<{ ok: boolean }>("/api/admin/inventory/compare-group", {
      action: "complete-basis",
      ...input,
    });
    if (viaApi.ok) return success(undefined);
    if (viaApi.code === "PERMISSION_DENIED" || viaApi.status === 401 || viaApi.status === 403) {
      return failure(new Error("PERMISSION_DENIED"), "PERMISSION_DENIED");
    }
    return failure(new Error(viaApi.error || "SAVE_FAILED"), viaApi.code || "SAVE_FAILED");
  } catch (error) {
    return failure(error, "Failed to save compare purchase basis");
  }
}
