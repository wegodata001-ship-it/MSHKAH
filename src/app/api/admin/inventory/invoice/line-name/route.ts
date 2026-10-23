import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { correctInvoiceLineName } from "@/lib/inventory/invoice-line-review";
import type { PurchaseInvoice } from "@/lib/inventory/types";

export const runtime = "nodejs";

const INVOICE_COLLECTIONS = [COLLECTIONS.purchaseInvoices, COLLECTIONS.archivePurchaseInvoices] as const;

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    invoiceId?: string;
    lineKey?: string;
    name?: string;
    productId?: string;
    updateInventory?: boolean;
  } | null;
  const name = String(body?.name ?? "").trim();
  const updateInventory = body?.updateInventory === true;
  if (!name) return Response.json({ error: "EMPTY_NAME", code: "EMPTY_NAME" }, { status: 400 });

  const db = getAdminDb();
  const now = new Date().toISOString();
  let invoice: PurchaseInvoice | null = null;

  const invoiceId = String(body?.invoiceId ?? "").trim();
  const lineKey = String(body?.lineKey ?? "").trim();
  if (invoiceId && lineKey) {
    let ref = db.collection(INVOICE_COLLECTIONS[0]).doc(invoiceId);
    let snap = await ref.get();
    if (!snap.exists) {
      ref = db.collection(INVOICE_COLLECTIONS[1]).doc(invoiceId);
      snap = await ref.get();
    }
    if (!snap.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    const current = { id: snap.id, ...(snap.data() as Omit<PurchaseInvoice, "id">) } as PurchaseInvoice;
    const corrected = correctInvoiceLineName(current, {
      lineKey,
      name,
      at: now,
      actor: auth.email,
      updateInventory,
    });
    if (!corrected.ok) return Response.json({ error: corrected.error, code: corrected.error }, { status: 400 });
    await ref.set(
      sanitizeFirestoreData({
        lines: corrected.invoice.lines,
        audit: corrected.invoice.audit ?? [],
        updatedAt: now,
      }),
      { merge: true }
    );
    invoice = { ...corrected.invoice, id: snap.id };
    if (updateInventory && corrected.productId) {
      await renameInventoryProduct(db, corrected.productId, name, now);
    }
    return Response.json({ ok: true, invoice, inventoryRenamed: updateInventory && Boolean(corrected.productId) });
  }

  const productId = String(body?.productId ?? "").trim();
  if (updateInventory && productId) {
    const renamed = await renameInventoryProduct(db, productId, name, now);
    if (!renamed) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    return Response.json({ ok: true, inventoryRenamed: true });
  }

  return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
}

async function renameInventoryProduct(
  db: ReturnType<typeof getAdminDb>,
  productId: string,
  name: string,
  updatedAt: string
): Promise<boolean> {
  const ref = db.collection(COLLECTIONS.ingredients).doc(productId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.set(sanitizeFirestoreData({ name, updatedAt }), { merge: true });
  return true;
}
