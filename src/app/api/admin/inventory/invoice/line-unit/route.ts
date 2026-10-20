import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { isInvoiceLineUnit, lineMoneyUnchanged, withLineUnit } from "@/lib/inventory/invoice-line-unit";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

export const runtime = "nodejs";

const INVOICE_COLLECTIONS = [COLLECTIONS.purchaseInvoices, "archivePurchaseInvoices"] as const;
const MOVEMENT_COLLECTIONS = [COLLECTIONS.inventoryMovements, "archiveInventoryMovements"] as const;

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { invoiceId?: string; lineKey?: string; unit?: string } | null;
  const invoiceId = String(body?.invoiceId ?? "").trim();
  const lineKey = String(body?.lineKey ?? "").trim();
  const unit = String(body?.unit ?? "").trim();
  if (!invoiceId || !lineKey || !isInvoiceLineUnit(unit)) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }

  const db = getAdminDb();
  let ref = db.collection(INVOICE_COLLECTIONS[0]).doc(invoiceId);
  let snap = await ref.get();
  if (!snap.exists) {
    ref = db.collection(INVOICE_COLLECTIONS[1]).doc(invoiceId);
    snap = await ref.get();
  }
  if (!snap.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
  const data = snap.data() ?? {};
  if (data.status === "cancelled") return Response.json({ error: "CANCELLED", code: "CANCELLED" }, { status: 409 });
  const lines = Array.isArray(data.lines) ? (data.lines as PurchaseInvoiceLine[]) : [];
  const before = lines.find((line) => line.key === lineKey);
  const nextLines = before ? withLineUnit(lines, lineKey, unit) : null;
  if (!before || !nextLines) return Response.json({ error: "LINE_NOT_FOUND", code: "LINE_NOT_FOUND" }, { status: 404 });
  const after = nextLines.find((line) => line.key === lineKey)!;
  if (!lineMoneyUnchanged(before, after)) {
    return Response.json({ error: "TOTALS_CHANGED", code: "TOTALS_CHANGED" }, { status: 409 });
  }
  await ref.update({ lines: nextLines, updatedAt: new Date().toISOString() });

  const movementId = invoicePurchaseMovementId(invoiceId, lineKey);
  for (const name of MOVEMENT_COLLECTIONS) {
    const direct = db.collection(name).doc(movementId);
    const directSnap = await direct.get();
    const queried = directSnap.exists
      ? [directSnap]
      : (await db.collection(name).where("invoiceId", "==", invoiceId).where("invoiceLineKey", "==", lineKey).get()).docs;
    for (const movement of queried) {
      const row = movement.data() ?? {};
      await movement.ref.update({ unit });
      const saved = await movement.ref.get();
      const next = saved.data() ?? {};
      if (next.quantity !== row.quantity || next.quantityBase !== row.quantityBase) {
        await movement.ref.update({ quantity: row.quantity, quantityBase: row.quantityBase });
      }
    }
  }

  return Response.json({ ok: true, unit, quantity: after.quantity, unitPrice: after.unitPrice, lineTotal: after.lineTotal });
}
