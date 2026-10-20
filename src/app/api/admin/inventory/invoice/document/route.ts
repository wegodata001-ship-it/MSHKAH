import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { loadInvoiceDocument, mapStoredInvoice, InvoiceRemovalError } from "@/lib/inventory/invoice-removal-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { invoiceId?: string; listArchive?: boolean } | null;
  const db = getAdminDb();
  if (body?.listArchive) {
    const snap = await db.collection(COLLECTIONS.archivePurchaseInvoices).get();
    const invoices = snap.docs.map((doc) => mapStoredInvoice(doc.id, doc.data() as Record<string, unknown>));
    return Response.json({ ok: true, invoices });
  }
  if (!body?.invoiceId) return Response.json({ error: "INVOICE_REQUIRED", code: "INVOICE_REQUIRED" }, { status: 400 });
  try {
    const payload = await loadInvoiceDocument(db, body.invoiceId);
    return Response.json({ ok: true, ...payload });
  } catch (error) {
    const code = error instanceof InvoiceRemovalError ? error.code : "DOCUMENT_FAILED";
    const status = code === "NOT_FOUND" ? 404 : 500;
    return Response.json({ error: code, code }, { status });
  }
}
