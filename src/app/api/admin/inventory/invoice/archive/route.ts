import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { archiveInvoices, InvoiceRemovalError } from "@/lib/inventory/invoice-removal-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { ids?: string[]; reason?: string } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean).slice(0, 500) : [];
  if (!ids.length) return Response.json({ error: "INVOICE_REQUIRED", code: "INVOICE_REQUIRED" }, { status: 400 });
  try {
    const result = await archiveInvoices(getAdminDb(), {
      ids,
      actor: auth.email,
      reason: body?.reason?.slice(0, 200),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof InvoiceRemovalError ? error.code : "ARCHIVE_FAILED";
    const status = code === "PROTECTED_CHANGED" ? 409 : 500;
    return Response.json({ error: code, code }, { status });
  }
}
