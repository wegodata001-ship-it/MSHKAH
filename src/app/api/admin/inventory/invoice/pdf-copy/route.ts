import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminBucket, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { invoiceId?: string; pdfBase64?: string } | null;
  if (!body?.invoiceId || !body.pdfBase64) {
    return Response.json({ error: "INVOICE_REQUIRED", code: "INVOICE_REQUIRED" }, { status: 400 });
  }
  const bytes = Buffer.from(body.pdfBase64, "base64");
  if (bytes.length < 500 || bytes.length > 15_000_000) {
    return Response.json({ error: "INVALID_PDF", code: "INVALID_PDF" }, { status: 400 });
  }
  const db = getAdminDb();
  let collection: string = COLLECTIONS.purchaseInvoices;
  let snap = await db.collection(collection).doc(body.invoiceId).get();
  if (!snap.exists) {
    collection = COLLECTIONS.archivePurchaseInvoices;
    snap = await db.collection(collection).doc(body.invoiceId).get();
  }
  if (!snap.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
  const existing = Array.isArray(snap.data()?.generatedDocuments) ? snap.data()?.generatedDocuments : [];
  const version = existing.length + 1;
  const storagePath = `invoice-files/system/${body.invoiceId}/v${version}.pdf`;
  await getAdminBucket().file(storagePath).save(bytes, {
    contentType: "application/pdf",
    resumable: false,
    metadata: { metadata: { invoiceId: body.invoiceId, version: String(version), kind: "system-invoice-document" } },
  });
  const record = {
    version,
    storagePath,
    createdAt: new Date().toISOString(),
    createdBy: auth.email,
    bytes: bytes.length,
  };
  await db.collection(collection).doc(body.invoiceId).set({ generatedDocuments: [...existing, record] }, { merge: true });
  return Response.json({ ok: true, version, storagePath });
}
