import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { failure, success, type ServiceResult } from "@/lib/errors";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { nowTimestamp, timestampToIso } from "@/types/firestore";
import { purchaseQuantityInBase } from "@/lib/costing/units";
import { costPerBaseUnit } from "@/lib/costing/units";
import type { CostingIngredient, DishRecipe, PurchaseUnit } from "@/lib/costing/types";
import { splitVat } from "@/lib/inventory/vat";
import { unitCostFromPackage } from "@/lib/inventory/stock";
import { theoreticalConsumption } from "@/lib/inventory/pos";
import type {
  InventoryMovement,
  PosImport,
  PosProductMap,
  PurchaseInvoice,
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
    phone: data.phone ? String(data.phone) : undefined,
    email: data.email ? String(data.email) : undefined,
    taxId: data.taxId ? String(data.taxId) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
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
    posImportId: data.posImportId ? String(data.posImportId) : undefined,
    orderId: data.orderId ? String(data.orderId) : undefined,
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
          invoiceNumber: String(data.invoiceNumber ?? ""),
          invoiceDate: String(data.invoiceDate ?? ""),
          receivedAt: String(data.receivedAt ?? ""),
          documentType: data.documentType || "invoice",
          currency: data.currency ? String(data.currency) : undefined,
          subtotal: data.subtotal != null ? asNumber(data.subtotal) : undefined,
          vatTotal: data.vatTotal != null ? asNumber(data.vatTotal) : undefined,
          grandTotal: data.grandTotal != null ? asNumber(data.grandTotal) : undefined,
          vatStatus: data.vatStatus === "detected" || data.vatStatus === "needs_review" ? data.vatStatus : undefined,
          status: (data.status as PurchaseInvoice["status"]) || "draft",
          lines: Array.isArray(data.lines) ? data.lines : [],
          fileName: data.fileName ? String(data.fileName) : undefined,
          fileUrl: data.fileUrl ? String(data.fileUrl) : undefined,
          fileHash: data.fileHash ? String(data.fileHash) : undefined,
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

export function subscribeToPosImports(onData: (items: PosImport[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), COLLECTIONS.posImports), (snap) =>
    onData(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          fileName: String(data.fileName ?? ""),
          fileHash: String(data.fileHash ?? ""),
          source: "pos-file",
          period: String(data.period ?? ""),
          status: (data.status as PosImport["status"]) || "draft",
          lines: Array.isArray(data.lines) ? data.lines : [],
          previousImportId: data.previousImportId ? String(data.previousImportId) : undefined,
          createdAt: timestampToIso(data.createdAt as never),
          approvedAt: data.approvedAt ? timestampToIso(data.approvedAt as never) : undefined,
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

export async function saveSupplier(input: {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
  notes?: string;
}): Promise<ServiceResult<Supplier>> {
  try {
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      taxId: input.taxId?.trim() || null,
      notes: input.notes?.trim() || null,
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
}): Promise<ServiceResult<void>> {
  try {
    const now = nowTimestamp();
    const existing = await findOfferDocs(input.productId, input.supplierId);
    const normalized = unitCostFromPackage(input.priceIncludingVat, input.packageQuantity, input.purchaseUnit);
    const current = existing.docs[0]?.data() as Record<string, unknown> | undefined;
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
          conversion: data.conversion != null ? asNumber(data.conversion) : undefined,
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
  conversion?: number;
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
    const payload = sanitizeFirestoreData({ ...input, updatedAt: now });
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
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      ...invoice,
      status: invoice.status && invoice.status !== "approved" ? invoice.status : "draft",
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

export async function approvePurchaseInvoice(invoice: PurchaseInvoice): Promise<ServiceResult<void>> {
  try {
    if (!invoice.id) return failure(new Error("Invoice required"), "Invoice required");
    if (invoice.status === "approved") return success(undefined);
    const db = getDb();
    const invoiceRef = doc(db, COLLECTIONS.purchaseInvoices, invoice.id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(invoiceRef);
        const status = snap.exists() ? String(snap.data()?.status ?? "draft") : "draft";
        if (status === "approved" || status === "approving") {
          throw new Error("ALREADY_APPROVED");
        }
        tx.set(
          invoiceRef,
          sanitizeFirestoreData({
            ...invoice,
            status: "approving",
            updatedAt: nowTimestamp(),
          }),
          { merge: true }
        );
      });
    } catch (error) {
      if (error instanceof Error && error.message === "ALREADY_APPROVED") return success(undefined);
      throw error;
    }

    const existingMoves = await getDocs(
      query(collection(db, COLLECTIONS.inventoryMovements), where("invoiceId", "==", invoice.id))
    );
    if (!existingMoves.empty) {
      await updateDoc(invoiceRef, { status: "approved", approvedAt: nowTimestamp() });
      return success(undefined);
    }

    const now = nowTimestamp();
    for (const line of invoice.lines) {
      if (!line.productId || !line.quantity || !line.unit) continue;
      const vat = splitVat({
        amount: line.lineTotal ?? line.priceIncludingVat ?? 0,
        vatType: line.vatType,
        vatRate: line.vatRate,
      });
      const unitCost = unitCostFromPackage(vat.priceIncludingVat, line.quantity, line.unit);
      await addDoc(
        collection(getDb(), COLLECTIONS.purchasePriceRecords),
        sanitizeFirestoreData({
          productId: line.productId,
          supplierId: invoice.supplierId || null,
          invoiceId: invoice.id,
          purchaseDate: invoice.invoiceDate,
          quantity: line.quantity,
          packageQuantity: line.quantity,
          unit: line.unit,
          ...vat,
          vatType: line.vatType,
          vatRate: line.vatRate,
          unitCost,
          source: "PURCHASE_INVOICE",
          createdAt: now,
        })
      );
      await addDoc(
        collection(getDb(), COLLECTIONS.inventoryMovements),
        sanitizeFirestoreData({
          productId: line.productId,
          type: "PURCHASE_IN",
          quantity: line.quantity,
          unit: line.unit,
          quantityBase: purchaseQuantityInBase(line.quantity, line.unit),
          supplierId: invoice.supplierId || null,
          invoiceId: invoice.id,
          unitCost,
          invoiceDate: invoice.invoiceDate,
          receivedAt: invoice.receivedAt,
          createdAt: now,
        })
      );
      if (invoice.supplierId) {
        await recordSupplierPurchase({
          productId: line.productId,
          supplierId: invoice.supplierId,
          priceIncludingVat: vat.priceIncludingVat,
          priceBeforeVat: vat.priceBeforeVat,
          packageQuantity: line.quantity,
          purchaseUnit: line.unit,
          purchasedAt: invoice.receivedAt || invoice.invoiceDate,
          vatType: line.vatType,
          vatRate: line.vatRate,
        });
      }
      await updateDoc(doc(getDb(), COLLECTIONS.ingredients, line.productId), {
        purchasePrice: vat.priceIncludingVat,
        purchaseQuantity: line.quantity,
        purchaseUnit: line.unit,
        costPerBaseUnit: costPerBaseUnit(vat.priceIncludingVat, line.quantity, line.unit),
        lastSupplierId: invoice.supplierId || null,
        lastReceivedAt: invoice.receivedAt,
        updatedAt: now,
      });
    }
    if (invoice.supplierId) {
      for (const line of invoice.lines) {
        if (!line.productId || !line.rawName) continue;
        await saveSupplierItemMap({
          supplierId: invoice.supplierId,
          supplierProductName: line.rawName,
          supplierSku: line.sku,
          inventoryProductId: line.productId,
          conversion: line.conversionFactor ?? undefined,
        });
      }
    }
    await updateDoc(doc(getDb(), COLLECTIONS.purchaseInvoices, invoice.id), {
      status: "approved",
      approvedAt: now,
      approvedBy: invoice.approvedBy || null,
      lines: invoice.lines,
      supplierId: invoice.supplierId || null,
      supplierName: invoice.supplierName,
      audit: [
        ...(invoice.audit ?? []),
        { at: new Date().toISOString(), actor: invoice.approvedBy, action: "approve", detail: "posted-to-stock" },
      ],
    });
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to approve invoice");
  }
}

export async function savePosDraft(input: Omit<PosImport, "id" | "createdAt"> & { id?: string }): Promise<ServiceResult<string>> {
  try {
    const now = nowTimestamp();
    if (input.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.posImports, input.id), sanitizeFirestoreData({ ...input, updatedAt: now }));
      return success(input.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.posImports), sanitizeFirestoreData({ ...input, createdAt: now }));
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
  return {
    id: docSnap.id,
    fileName: String(data.fileName ?? ""),
    fileHash: String(data.fileHash ?? ""),
    source: "pos-file",
    period: String(data.period ?? ""),
    status: data.status,
    lines: data.lines ?? [],
    createdAt: timestampToIso(data.createdAt as never),
  };
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
  recipes: DishRecipe[];
  previous?: PosImport | null;
}): Promise<ServiceResult<void>> {
  try {
    const now = nowTimestamp();
    const consumption = theoreticalConsumption(input.draft.lines, input.recipes);
    const previousConsumption = input.previous ? theoreticalConsumption(input.previous.lines, input.recipes) : [];
    const prevMap = new Map(previousConsumption.map((row) => [row.productId, row]));
    const productIds = new Set([...consumption.map((row) => row.productId), ...previousConsumption.map((row) => row.productId)]);
    for (const productId of productIds) {
      const row = consumption.find((item) => item.productId === productId);
      const prev = prevMap.get(productId);
      const delta = (row?.quantityBase ?? 0) - (prev?.quantityBase ?? 0);
      if (Math.abs(delta) < 0.0001) continue;
      const signed = -delta;
      await addDoc(
        collection(getDb(), COLLECTIONS.inventoryMovements),
        sanitizeFirestoreData({
          productId,
          type: signed < 0 ? "SALE_OUT" : "REVERSAL",
          quantity: Math.abs(delta),
          unit: row?.unit ?? prev?.unit ?? "g",
          quantityBase: signed,
          posImportId: input.draft.id,
          receivedAt: new Date().toISOString(),
          createdAt: now,
          note: "POS theoretical consumption",
        })
      );
    }
    await updateDoc(doc(getDb(), COLLECTIONS.posImports, input.draft.id), {
      status: "approved",
      approvedAt: now,
      lines: input.draft.lines,
    });
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to approve POS import");
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
