import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { readInvoiceSourceBytes } from "@/lib/inventory/invoice-source-store";
import { loadInvoiceDocument, InvoiceRemovalError } from "@/lib/inventory/invoice-removal-admin";

export const runtime = "nodejs";

const MAX_BYTES = 12_000_000;

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { invoiceId?: string } | null;
  if (!body?.invoiceId) return Response.json({ error: "INVOICE_REQUIRED", code: "INVOICE_REQUIRED" }, { status: 400 });
  try {
    const payload = await loadInvoiceDocument(getAdminDb(), body.invoiceId);
    const source = payload.invoice.sourceFile;
    if (!source?.storagePath) {
      return Response.json({ ok: true, available: false, reason: "MISSING" });
    }
    const file = await readInvoiceSourceBytes(source.storagePath);
    if (file.bytes.length > MAX_BYTES) {
      return Response.json({ ok: true, available: false, reason: "TOO_LARGE" });
    }
    return Response.json({
      ok: true,
      available: true,
      mimeType: file.mimeType || source.mimeType,
      filename: source.originalFilename,
      base64: file.bytes.toString("base64"),
    });
  } catch (error) {
    if (error instanceof InvoiceRemovalError && error.code === "NOT_FOUND") {
      return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ ok: true, available: false, reason: "UNREADABLE" });
  }
}

