import type { Firestore } from "firebase-admin/firestore";
import { costPerBaseUnit, purchaseQuantityInBase } from "@/lib/costing/units";
import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { findDuplicateInvoice, matchSupplier } from "@/lib/inventory/invoice-smart-match";
import { isConfirmedInvoiceMatch } from "@/lib/inventory/invoice-line-review";
import { syncInvoiceTotals } from "@/lib/inventory/invoice-finance";
import { invoicePurchaseMovementId, selectStockPostLines } from "@/lib/inventory/invoice-stock-post";
import { reconcileSupplierItemMap, shouldUpdateLastPurchase } from "@/lib/inventory/material-group";
import { unitCostFromPackage } from "@/lib/inventory/stock";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import type { PurchaseInvoice, PurchaseInvoiceLine, Supplier, SupplierItemMap } from "@/lib/inventory/types";

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function upsertSupplierOffer(
  db: Firestore,
  invoice: PurchaseInvoice,
  line: PurchaseInvoiceLine
) {
  if (!invoice.supplierId || !line.productId) return;
  const net = line.netAmount ?? line.priceBeforeVat ?? 0;
  const gross = line.grossAmount ?? line.priceIncludingVat ?? 0;
  const existing = await db
    .collection(COLLECTIONS.supplierOffers)
    .where("productId", "==", line.productId)
    .where("supplierId", "==", invoice.supplierId)
    .limit(1)
    .get();
  const current = existing.docs[0]?.data() as Record<string, unknown> | undefined;
  const existingDate = String(current?.lastPurchaseDate || current?.lastPurchasedAt || "");
  if (!shouldUpdateLastPurchase(existingDate, invoice.invoiceDate || invoice.receivedAt)) return;
  const normalized = unitCostFromPackage(gross, line.quantity || 1, line.unit || "unit");
  const payload = sanitizeFirestoreData({
    productId: line.productId,
    supplierId: invoice.supplierId,
    lastPurchasedAt: invoice.invoiceDate || invoice.receivedAt,
    lastPurchasePrice: normalized,
    lastPurchaseDate: invoice.invoiceDate || invoice.receivedAt,
    lastPriceIncludingVat: gross,
    lastPriceBeforeVat: net,
    lastPackageQuantity: line.quantity,
    lastUnit: line.unit,
    lastInvoiceId: invoice.id || null,
    lastInvoiceNumber: invoice.invoiceNumber || null,
    lastInvoiceLineId: line.key,
    lastUnitPriceNet: line.unitPriceNet ?? null,
    lastUnitPriceGross: line.unitPriceGross ?? null,
    lastLineTotalNet: net,
    lastLineTotalVat: line.vatAmount ?? 0,
    lastLineTotalGross: gross,
    lastUnitCost: current?.normalizedPrice ?? current?.lastUnitCost ?? normalized,
    active: true,
    updatedAt: new Date().toISOString(),
    ...(current?.currentPrice == null
      ? {
          currentPrice: gross,
          priceIncludingVat: gross,
          priceBeforeVat: net,
          packageQuantity: line.quantity,
          purchaseUnit: line.unit,
          normalizedPrice: normalized,
          vatType: line.vatType ?? "inclusive",
          vatRate: line.vatRate ?? 0.18,
          lastQuotedAt: invoice.invoiceDate || invoice.receivedAt,
        }
      : {}),
  });
  if (existing.docs[0]) await existing.docs[0].ref.set(payload, { merge: true });
  else await db.collection(COLLECTIONS.supplierOffers).add({ ...payload, createdAt: new Date().toISOString() });
}

async function upsertSupplierItemMap(
  db: Firestore,
  invoice: PurchaseInvoice,
  line: PurchaseInvoiceLine
) {
  if (!invoice.supplierId || !line.productId || !line.rawName) return;
  const existing = await db
    .collection(COLLECTIONS.supplierItemMaps)
    .where("supplierId", "==", invoice.supplierId)
    .where("supplierProductName", "==", line.rawName)
    .limit(1)
    .get();
  const current = existing.docs[0]
    ? ({ id: existing.docs[0].id, ...(existing.docs[0].data() as Omit<SupplierItemMap, "id">) } as SupplierItemMap)
    : undefined;
  const ingredient = await db.collection(COLLECTIONS.ingredients).doc(line.productId).get();
  const reconciled = reconcileSupplierItemMap(current, {
    supplierId: invoice.supplierId,
    supplierProductName: line.rawName,
    supplierSku: line.sku,
    inventoryProductId: line.productId,
    purchaseUnit: line.unit ?? undefined,
    packageQuantity: line.quantity ?? undefined,
    conversion: line.conversionFactor ?? undefined,
  });
  const payload = sanitizeFirestoreData({
    ...reconciled.next,
    compareGroupId: current?.compareGroupId ?? ingredient.data()?.compareGroupId ?? null,
    compareGroupName: current?.compareGroupName ?? ingredient.data()?.compareGroupName ?? null,
    updatedAt: new Date().toISOString(),
  });
  if (existing.docs[0]) await existing.docs[0].ref.set(payload, { merge: true });
  else await db.collection(COLLECTIONS.supplierItemMaps).add({ ...payload, createdAt: new Date().toISOString() });
}

export async function persistInvoiceDocument(
  db: Firestore,
  invoice: PurchaseInvoice,
  mode: "draft" | "finance",
  actor?: string
): Promise<{ id: string; invoice: PurchaseInvoice }> {
  const synced = mode === "finance" ? syncInvoiceTotals(invoice) : invoice;
  if (mode === "finance") {
    const existingSnap = await db.collection(COLLECTIONS.purchaseInvoices).limit(400).get();
    const existing = existingSnap.docs.map((item) => ({ id: item.id, ...item.data() }) as PurchaseInvoice);
    const duplicateOf = findDuplicateInvoice(
      existing.filter((item) => item.id !== synced.id),
      synced
    );
    if (duplicateOf) {
      const error = new Error("DUPLICATE_INVOICE");
      error.name = "DUPLICATE_INVOICE";
      throw error;
    }
  }
  const now = new Date().toISOString();
  const id = synced.id || db.collection(COLLECTIONS.purchaseInvoices).doc().id;
  const currentSnap = await db.collection(COLLECTIONS.purchaseInvoices).doc(id).get();
  const current = currentSnap.exists ? (currentSnap.data() as PurchaseInvoice) : undefined;
  // Don't overwrite a cancelled invoice via any save mode. The cancel flow
  // locks the record; the only way out is to not re-save at all.
  if (current?.status === "cancelled") {
    const error = new Error("INVOICE_CANCELLED");
    error.name = "INVOICE_CANCELLED";
    throw error;
  }
  const alreadyPosted = current?.stockStatus === "posted" && Boolean(current.inventoryPostedAt);
  const lines = synced.lines.map((line) => {
    const liveLine = current?.lines?.find((item) => item.key === line.key);
    return liveLine?.postedToStock ? { ...line, postedToStock: true } : line;
  });
  const payload = sanitizeFirestoreData({
    ...synced,
    lines,
    id,
    status:
      alreadyPosted
        ? current?.status || "saved"
        : mode === "finance"
          ? "saved"
          : synced.status === "saved" || synced.status === "needs_review" || synced.status === "rejected" || synced.status === "draft"
            ? synced.status
            : "draft",
    stockStatus: alreadyPosted ? "posted" : synced.stockStatus === "posted" ? current?.stockStatus || "none" : synced.stockStatus || "none",
    inventoryPostedAt: alreadyPosted ? current?.inventoryPostedAt : synced.inventoryPostedAt || null,
    approvedAt: mode === "finance" ? now : synced.approvedAt || current?.approvedAt || null,
    approvedBy: mode === "finance" ? actor || synced.approvedBy || null : synced.approvedBy || current?.approvedBy || null,
    audit: [
      ...(current?.audit ?? synced.audit ?? []),
      { at: now, actor, action: mode === "finance" ? "finance-save" : "draft-save" },
    ].slice(-20),
    updatedAt: now,
  });
  await db.collection(COLLECTIONS.purchaseInvoices).doc(id).set(payload, { merge: true });

  if (mode === "finance") {
    const existingRecords = await db.collection(COLLECTIONS.purchasePriceRecords).where("invoiceId", "==", id).get();
    const recordedKeys = new Set(existingRecords.docs.map((item) => String(item.data().invoiceLineKey || "")));
    for (const line of synced.lines) {
      if (!line.productId || !isConfirmedInvoiceMatch(line) || !line.quantity || !line.unit) continue;
      if (recordedKeys.has(line.key)) continue;
      const net = line.netAmount ?? line.priceBeforeVat ?? 0;
      const gross = line.grossAmount ?? line.priceIncludingVat ?? 0;
      await db.collection(COLLECTIONS.purchasePriceRecords).add(
        sanitizeFirestoreData({
          productId: line.productId,
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
      await upsertSupplierOffer(db, { ...synced, id }, line);
      await upsertSupplierItemMap(db, { ...synced, id }, line);
    }
  }

  const saved = { ...synced, ...payload, id } as PurchaseInvoice;
  return { id, invoice: saved };
}

async function resolveSupplierId(db: Firestore, invoice: PurchaseInvoice): Promise<string | undefined> {
  if (invoice.supplierId) return invoice.supplierId;
  const name = invoice.supplierName?.trim();
  if (!name) return undefined;
  const snap = await db.collection(COLLECTIONS.suppliers).get();
  const suppliers = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Supplier);
  const match = matchSupplier(name, invoice.supplierTaxId, suppliers);
  return match.kind === "exact" && match.supplier ? match.supplier.id : undefined;
}

export async function postInvoiceStock(
  db: Firestore,
  invoice: PurchaseInvoice,
  lineKeys: string[] | undefined,
  actor?: string
): Promise<{ invoice: PurchaseInvoice; postedKeys: string[]; reusedKeys: string[] }> {
  if (!invoice.id) throw new Error("Invoice required");
  const liveSnap = await db.collection(COLLECTIONS.purchaseInvoices).doc(invoice.id).get();
  const live = liveSnap.exists ? ({ id: liveSnap.id, ...liveSnap.data() } as PurchaseInvoice) : invoice;
  // Refuse to re-post a cancelled invoice. Clients that still hold an old
  // reference (e.g. "approve stock" tab opened before the cancel landed) will
  // get a clean 400 instead of silently creating duplicate movements.
  if (live.status === "cancelled") {
    throw new Error("INVOICE_CANCELLED");
  }
  const merged: PurchaseInvoice = { ...live, ...invoice, id: invoice.id, lines: invoice.lines?.length ? invoice.lines : live.lines };
  const supplierId = await resolveSupplierId(db, merged);
  if (supplierId) merged.supplierId = supplierId;

  const existingMoves = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", merged.id).get();
  const postedKeys = new Set(
    existingMoves.docs.map((item) => String(item.data().invoiceLineKey || "")).filter(Boolean)
  );
  const selected = selectStockPostLines(merged, lineKeys);
  if (!selected.length) {
    const anyPosted = merged.lines.some((line) => line.postedToStock || postedKeys.has(line.key));
    if (anyPosted) {
      return { invoice: merged, postedKeys: [], reusedKeys: [...postedKeys] };
    }
    throw new Error("NO_STOCK_LINES");
  }
  const nextLines = merged.lines.map((line) => ({ ...line }));
  const reusedKeys: string[] = [];
  const writtenKeys: string[] = [];
  const now = new Date().toISOString();

  for (const line of selected) {
    const movementId = invoicePurchaseMovementId(merged.id!, line.key);
    const qtyBase = invoiceLineQuantityBase(line);
    if (qtyBase == null || !line.productId) continue;
    if (postedKeys.has(line.key)) {
      const idx = nextLines.findIndex((item) => item.key === line.key);
      if (idx >= 0) nextLines[idx] = { ...nextLines[idx], postedToStock: true };
      reusedKeys.push(line.key);
      continue;
    }
    const net = line.netAmount ?? line.priceBeforeVat ?? 0;
    const gross = line.grossAmount ?? line.priceIncludingVat ?? 0;
    const conversionFactor = line.conversionFactor && line.conversionFactor > 0 ? line.conversionFactor : line.unit ? purchaseQuantityInBase(1, line.unit) : null;
    let before = 0;
    let reused = false;
    await db.runTransaction(async (tx) => {
      const moveRef = db.collection(COLLECTIONS.inventoryMovements).doc(movementId);
      const existingMove = await tx.get(moveRef);
      const balRef = db.collection(COLLECTIONS.inventoryBalances).doc(line.productId!);
      const bal = await tx.get(balRef);
      if (existingMove.exists) {
        reused = true;
        const existing = existingMove.data() ?? {};
        before = asNumber(existing.quantityBefore);
        if (!existing.invoiceId || !existing.invoiceLineKey || !existing.invoiceLineId) {
          tx.set(
            moveRef,
            sanitizeFirestoreData({
              invoiceId: merged.id,
              invoiceLineKey: line.key,
              invoiceLineId: line.key,
            }),
            { merge: true }
          );
        }
        return;
      }
      before = bal.exists ? asNumber(bal.data()?.quantityBase) : 0;
      const next = before + qtyBase;
      tx.set(
        moveRef,
        sanitizeFirestoreData({
          productId: line.productId,
          type: "PURCHASE_IN",
          quantity: line.quantity,
          unit: line.unit,
          quantityBase: qtyBase,
          conversionFactor,
          supplierId: merged.supplierId || null,
          invoiceId: merged.id,
          invoiceLineKey: line.key,
          invoiceLineId: line.key,
          lineTotalNet: net,
          lineTotalGross: gross,
          unitCost: qtyBase > 0 ? (net || gross) / qtyBase : 0,
          unitCostNet: qtyBase > 0 ? net / qtyBase : 0,
          unitCostGross: qtyBase > 0 ? gross / qtyBase : 0,
          vatRate: line.vatRate ?? null,
          quantityIn: qtyBase,
          quantityBefore: before,
          quantityAfter: next,
          invoiceDate: merged.invoiceDate,
          receivedAt: merged.receivedAt,
          createdAt: now,
        })
      );
      tx.set(
        balRef,
        sanitizeFirestoreData({
          productId: line.productId,
          quantityBase: next,
          updatedAt: now,
        }),
        { merge: true }
      );
    });
    if (reused) {
      reusedKeys.push(line.key);
    } else {
      writtenKeys.push(line.key);
      await db.collection(COLLECTIONS.ingredients).doc(line.productId).set(
        {
          purchasePrice: gross || net,
          purchaseQuantity: line.quantity,
          purchaseUnit: line.unit,
          costPerBaseUnit: qtyBase > 0 ? (net || gross) / qtyBase : costPerBaseUnit(net || gross, line.quantity!, line.unit!),
          supplier: merged.supplierName || null,
          lastSupplierId: merged.supplierId || null,
          lastReceivedAt: merged.receivedAt,
          updatedAt: now,
        },
        { merge: true }
      );
      await upsertSupplierOffer(db, merged, line);
      await upsertSupplierItemMap(db, merged, line);
    }
    postedKeys.add(line.key);
    const idx = nextLines.findIndex((item) => item.key === line.key);
    if (idx >= 0) {
      nextLines[idx] = {
        ...nextLines[idx],
        postedToStock: true,
        quantityBefore: before,
        quantityIn: qtyBase,
        quantityAfter: before + qtyBase,
      };
    }
  }

  const postedLineKeys = nextLines.filter((line) => line.postedToStock || postedKeys.has(line.key)).map((line) => line.key);
  const remaining = nextLines.some((line) => !line.skipInventory && line.productId && !line.postedToStock && !postedKeys.has(line.key));
  const anyPosted = postedLineKeys.length > 0;
  const stockStatus = anyPosted ? (remaining ? "partial" : "posted") : "none";
  const postingId = merged.inventoryPostingId || `post-${merged.id}`;
  const updated: PurchaseInvoice = {
    ...merged,
    status: "saved",
    scanStatus: stockStatus === "posted" ? "posted" : merged.scanStatus || "approved",
    stockStatus,
    lines: nextLines.map((line) => (postedKeys.has(line.key) ? { ...line, postedToStock: true } : line)),
    inventoryPostedAt: stockStatus === "posted" ? now : merged.inventoryPostedAt || undefined,
    inventoryPostedBy: stockStatus === "posted" ? actor || merged.approvedBy || merged.createdBy || undefined : merged.inventoryPostedBy || undefined,
    inventoryPostingId: stockStatus === "posted" ? postingId : merged.inventoryPostingId || undefined,
    audit: [
      ...(merged.audit ?? []),
      { at: now, actor, action: "INVENTORY_POSTED", detail: stockStatus },
    ].slice(-20),
    updatedAt: now,
  };
  await db.collection(COLLECTIONS.purchaseInvoices).doc(merged.id!).set(sanitizeFirestoreData(updated), { merge: true });
  return { invoice: updated, postedKeys: writtenKeys, reusedKeys };
}
