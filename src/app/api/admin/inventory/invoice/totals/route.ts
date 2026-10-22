import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { commitInvoiceTotalEdit, draftIsValid, productPricesUnchanged, type TotalDraft } from "@/lib/inventory/invoice-total-edit";
import type { PurchaseInvoice } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    invoiceId?: string;
    draft?: TotalDraft;
    reason?: string;
    addAdjustment?: boolean;
  } | null;
  if (!body?.invoiceId || !body.draft || !draftIsValid(body.draft)) {
    return Response.json({ error: "INVALID_AMOUNT", code: "INVALID_AMOUNT" }, { status: 400 });
  }

  const db = getAdminDb();
  const active = db.collection(COLLECTIONS.purchaseInvoices).doc(body.invoiceId);
  const archived = db.collection(COLLECTIONS.archivePurchaseInvoices).doc(body.invoiceId);
  const activeSnap = await active.get();
  const snap = activeSnap.exists ? activeSnap : await archived.get();
  if (!snap.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });

  const current = { id: snap.id, ...(snap.data() as Omit<PurchaseInvoice, "id">) } as PurchaseInvoice;
  const next = commitInvoiceTotalEdit(current, body.draft, {
    at: new Date().toISOString(),
    actor: auth.email,
    reason: body.reason || "עריכה ידנית",
    addAdjustment: body.addAdjustment === true,
  });
  if (!productPricesUnchanged(current.lines ?? [], next.lines)) {
    return Response.json({ error: "LINE_PRICES_LOCKED", code: "LINE_PRICES_LOCKED" }, { status: 409 });
  }
  await snap.ref.set(sanitizeFirestoreData({ ...next, id: snap.id }), { merge: true });
  return Response.json({ ok: true, invoice: { ...next, id: snap.id } });
}
