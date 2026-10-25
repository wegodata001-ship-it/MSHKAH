import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadMeasureUnitCatalog } from "@/lib/inventory/measure-units-admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { planInvoiceEdit, type EditableInvoiceDraft, type InvoiceStockEffect } from "@/lib/inventory/invoice-edit";
import { purchaseRecordUnitCost, unitCostFromPackage } from "@/lib/inventory/stock";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

export const runtime = "nodejs";

function affects(effect: InvoiceStockEffect): string[] {
  if (effect.kind === "reassign") return [effect.fromProductId, effect.toProductId];
  return [effect.productId];
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { invoiceId?: string; draft?: EditableInvoiceDraft } | null;
  const invoiceId = String(body?.invoiceId ?? "").trim();
  const draft = body?.draft;
  if (!invoiceId || !draft || !Array.isArray(draft.lines)) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }

  const db = getAdminDb();
  await loadMeasureUnitCatalog(db);
  const active = db.collection(COLLECTIONS.purchaseInvoices).doc(invoiceId);
  const archived = db.collection(COLLECTIONS.archivePurchaseInvoices).doc(invoiceId);
  const activeSnap = await active.get();
  const ref = activeSnap.exists ? active : archived;
  const snap = activeSnap.exists ? activeSnap : await archived.get();
  if (!snap.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
  const current = { id: snap.id, ...(snap.data() as Omit<PurchaseInvoice, "id">) } as PurchaseInvoice;
  if (current.status === "cancelled") return Response.json({ error: "INVOICE_CANCELLED", code: "INVOICE_CANCELLED" }, { status: 409 });

  const now = new Date().toISOString();
  const preview = planInvoiceEdit(current, draft, { at: now, actor: auth.email });
  const priceSnap = await db.collection(COLLECTIONS.purchasePriceRecords).where("invoiceId", "==", invoiceId).get();
  const supplierId = draft.supplierId || current.supplierId || "";
  const productIds = [...new Set(preview.stock.flatMap(affects).concat(preview.lines.map((line) => line.productId || "")).filter(Boolean))];
  const offerDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (supplierId) {
    for (const productId of productIds) {
      const found = await db.collection(COLLECTIONS.supplierOffers).where("productId", "==", productId).where("supplierId", "==", supplierId).get();
      offerDocs.push(...found.docs);
    }
  }

  let saved: PurchaseInvoice | null = null;
  await db.runTransaction(async (tx) => {
    const liveSnap = await tx.get(ref);
    const live = { id: liveSnap.id, ...(liveSnap.data() as Omit<PurchaseInvoice, "id">) } as PurchaseInvoice;
    const plan = planInvoiceEdit(live, draft, { at: now, actor: auth.email });
    const movementRefs = plan.stock.flatMap((effect) => {
      const ids = [effect.movementId];
      if (effect.kind === "reverse") ids.push(effect.reversalId);
      return ids;
    });
    const movements = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const id of [...new Set(movementRefs)]) {
      movements.set(id, await tx.get(db.collection(COLLECTIONS.inventoryMovements).doc(id)));
    }
    const balanceIds = [...new Set(plan.stock.flatMap(affects))];
    const balances = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const id of balanceIds) balances.set(id, await tx.get(db.collection(COLLECTIONS.inventoryBalances).doc(id)));
    const prices = [];
    for (const doc of priceSnap.docs) prices.push(await tx.get(doc.ref));
    const offers: FirebaseFirestore.DocumentSnapshot[] = [];
    for (const doc of offerDocs) offers.push(await tx.get(doc.ref));

    const delta = new Map<string, number>();
    const addDelta = (productId: string, amount: number) => delta.set(productId, (delta.get(productId) ?? 0) + amount);
    const lineOf = (key: string) => plan.lines.find((line) => line.key === key);

    for (const effect of plan.stock) {
      const line = lineOf(effect.lineKey);
      if (effect.kind === "reverse") {
        const reversal = movements.get(effect.reversalId);
        if (reversal?.exists) continue;
        addDelta(effect.productId, -effect.fromBase);
        tx.set(db.collection(COLLECTIONS.inventoryMovements).doc(effect.reversalId), sanitizeFirestoreData({
          productId: effect.productId,
          type: "ADJUSTMENT",
          quantity: effect.fromBase,
          unit: "unit",
          quantityBase: -effect.fromBase,
          invoiceId: live.id,
          invoiceLineKey: effect.lineKey,
          correctsMovementId: effect.movementId,
          actor: auth.email,
          note: "invoice-edit-remove",
          idempotencyKey: effect.reversalId,
          receivedAt: now,
          createdAt: now,
        }));
        continue;
      }
      const existing = movements.get(effect.movementId);
      if (effect.kind === "add") {
        if (existing?.exists) continue;
        addDelta(effect.productId, effect.toBase);
        tx.set(db.collection(COLLECTIONS.inventoryMovements).doc(effect.movementId), movementPayload(live, line, effect.productId, effect.quantity, effect.unit, effect.toBase, draft, now));
        continue;
      }
      if (effect.kind === "update") {
        if (!existing?.exists) addDelta(effect.productId, effect.toBase);
        else addDelta(effect.productId, effect.delta);
        tx.set(db.collection(COLLECTIONS.inventoryMovements).doc(effect.movementId), movementPayload(live, line, effect.productId, effect.quantity, effect.unit, effect.toBase, draft, now), { merge: true });
        continue;
      }
      if (!existing?.exists) addDelta(effect.toProductId, effect.toBase);
      else {
        addDelta(effect.fromProductId, -effect.fromBase);
        addDelta(effect.toProductId, effect.toBase);
      }
      tx.set(db.collection(COLLECTIONS.inventoryMovements).doc(effect.movementId), movementPayload(live, line, effect.toProductId, effect.quantity, effect.unit, effect.toBase, draft, now), { merge: true });
    }

    for (const [productId, amount] of delta) {
      if (Math.abs(amount) <= 0.0001) continue;
      const balance = balances.get(productId);
      const currentQty = balance?.exists ? Number(balance.get("quantityBase") ?? 0) : 0;
      tx.set(db.collection(COLLECTIONS.inventoryBalances).doc(productId), sanitizeFirestoreData({
        productId,
        quantityBase: currentQty + amount,
        updatedAt: now,
      }), { merge: true });
    }

    const usedPrices = new Set<string>();
    for (const line of plan.lines) {
      if (!line.productId) continue;
      const price = prices.find((doc) => String(doc.get("invoiceLineKey") || doc.get("invoiceLineId") || "") === line.key);
      const payload = pricePayload(live.id, draft, line, now);
      if (price?.exists) {
        usedPrices.add(price.id);
        tx.set(price.ref, sanitizeFirestoreData(payload), { merge: true });
      } else if (line.quantity && line.unit) {
        tx.set(db.collection(COLLECTIONS.purchasePriceRecords).doc(), sanitizeFirestoreData({ ...payload, createdAt: now }));
      }
    }
    for (const prior of live.lines ?? []) {
      if (plan.lines.some((line) => line.key === prior.key)) continue;
      const price = prices.find((doc) => String(doc.get("invoiceLineKey") || doc.get("invoiceLineId") || "") === prior.key);
      if (price?.exists) tx.set(price.ref, sanitizeFirestoreData({ cancelledAt: now, cancelledBy: auth.email, updatedAt: now }), { merge: true });
    }

    for (const offer of offers) {
      if (!offer.exists || String(offer.get("lastInvoiceId") || "") !== live.id) continue;
      const line = plan.lines.find((item) => item.productId === offer.get("productId"));
      if (!line) continue;
      const net = line.priceBeforeVat ?? line.lineNet ?? 0;
      const gross = line.priceIncludingVat ?? line.lineGross ?? 0;
      const unit = line.unit || "unit";
      const normalized = line.unitPriceGross != null && line.unitPriceGross > 0
        ? unitCostFromPackage(line.unitPriceGross, 1, unit)
        : unitCostFromPackage(gross, line.quantity || 1, unit);
      tx.set(offer.ref, sanitizeFirestoreData({
        lastPurchasedAt: draft.invoiceDate,
        lastPurchasePrice: normalized,
        lastPurchaseDate: draft.invoiceDate,
        lastPriceIncludingVat: gross,
        lastPriceBeforeVat: net,
        lastPackageQuantity: line.quantity,
        lastUnit: line.unit,
        lastInvoiceNumber: draft.invoiceNumber,
        lastInvoiceLineId: line.key,
        lastUnitPriceNet: line.unitPriceNet ?? null,
        lastUnitPriceGross: line.unitPriceGross ?? null,
        lastLineTotalNet: net,
        lastLineTotalVat: line.vatAmount ?? 0,
        lastLineTotalGross: gross,
        updatedAt: now,
      }), { merge: true });
    }

    const nextInvoice: PurchaseInvoice = {
      ...live,
      ...plan.header,
      lines: plan.lines,
      editHistory: plan.editHistory,
      sourceFile: live.sourceFile,
      audit: [...(live.audit ?? []), { at: now, actor: auth.email, action: "invoice-edit" }].slice(-40),
      updatedAt: now,
    };
    saved = nextInvoice;
    tx.set(ref, sanitizeFirestoreData({
      ...plan.header,
      lines: plan.lines,
      editHistory: plan.editHistory,
      audit: nextInvoice.audit,
      updatedAt: now,
    }), { merge: true });
    tx.set(db.collection(COLLECTIONS.invoiceAuditLog).doc(), sanitizeFirestoreData({
      action: "invoice-edit",
      invoiceId: live.id,
      actor: auth.email,
      at: now,
      changes: plan.changes,
    }));
  });

  return Response.json({ ok: true, invoice: saved, changes: preview.changes.length });
}

function movementPayload(invoice: PurchaseInvoice, line: PurchaseInvoiceLine | undefined, productId: string, quantity: number, unit: PurchaseInvoiceLine["unit"], quantityBase: number, draft: EditableInvoiceDraft, now: string) {
  const net = line?.priceBeforeVat ?? line?.lineNet ?? 0;
  const gross = line?.priceIncludingVat ?? line?.lineGross ?? 0;
  const purchaseUnit = line?.unit || unit || "unit";
  return sanitizeFirestoreData({
    productId,
    type: "PURCHASE_IN",
    quantity,
    unit: purchaseUnit,
    quantityBase,
    supplierId: draft.supplierId || invoice.supplierId || null,
    invoiceId: invoice.id,
    invoiceLineKey: line?.key,
    invoiceLineId: line?.key,
    lineTotalNet: net,
    lineTotalGross: gross,
    unitCostNet: line?.unitPriceNet ?? null,
    unitCostGross: line?.unitPriceGross ?? null,
    unitCost: line?.unitPriceNet != null
      ? purchaseRecordUnitCost({ unitPriceNet: line.unitPriceNet, lineNet: net, lineGross: gross, quantity: quantity || 1, unit: purchaseUnit })
      : quantityBase > 0 ? net / quantityBase : 0,
    vatRate: line?.vatRate ?? null,
    invoiceDate: draft.invoiceDate,
    updatedAt: now,
  });
}

function pricePayload(invoiceId: string, draft: EditableInvoiceDraft, line: PurchaseInvoiceLine, now: string) {
  const net = line.priceBeforeVat ?? line.lineNet ?? 0;
  const gross = line.priceIncludingVat ?? line.lineGross ?? 0;
  return {
    productId: line.productId,
    supplierId: draft.supplierId || null,
    invoiceId,
    invoiceLineId: line.key,
    invoiceLineKey: line.key,
    purchaseDate: draft.invoiceDate,
    quantity: line.quantity,
    packageQuantity: line.quantity,
    purchaseQuantity: line.quantity,
    unit: line.unit,
    purchaseUnit: line.unit,
    unitPriceNet: line.unitPriceNet ?? null,
    unitPriceGross: line.unitPriceGross ?? null,
    lineTotalNet: net,
    lineTotalGross: gross,
    priceBeforeVat: net,
    vatAmount: line.vatAmount ?? 0,
    priceIncludingVat: gross,
    vatType: line.vatType,
    vatRate: line.vatRate,
    unitCost: line.unit && line.unitPriceNet != null
      ? purchaseRecordUnitCost({ unitPriceNet: line.unitPriceNet, lineNet: net, lineGross: gross, quantity: line.quantity || 1, unit: line.unit })
      : unitCostFromPackage(gross || net, line.quantity || 1, line.unit || "unit"),
    source: "PURCHASE_INVOICE",
    cancelledAt: null,
    updatedAt: now,
  };
}
