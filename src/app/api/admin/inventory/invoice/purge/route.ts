import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { InvoiceRemovalError, purgeInvoices } from "@/lib/inventory/invoice-removal-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { ids?: string[]; phrase?: string } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean).slice(0, 500) : [];
  if (!ids.length) return Response.json({ error: "INVOICE_REQUIRED", code: "INVOICE_REQUIRED" }, { status: 400 });
  try {
    const result = await purgeInvoices(getAdminDb(), {
      ids,
      actor: auth.email,
      phrase: body?.phrase ?? "",
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof InvoiceRemovalError) {
      const status = error.code === "PHRASE_REQUIRED" ? 400 : error.code === "NOT_FOUND" ? 404 : 409;
      return Response.json({ error: error.code, code: error.code, detail: error.detail ?? null }, { status });
    }
    return Response.json({ error: "PURGE_FAILED", code: "PURGE_FAILED" }, { status: 500 });
  }
}
