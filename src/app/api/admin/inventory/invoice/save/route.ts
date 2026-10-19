import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { persistInvoiceDocument } from "@/lib/inventory/invoice-admin-write";
import { getAdminDb } from "@/lib/firebase/admin";
import type { PurchaseInvoice } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { invoice?: PurchaseInvoice; mode?: "draft" | "finance" } | null;
  if (!body?.invoice) return Response.json({ error: "Invoice required", code: "VALIDATION" }, { status: 400 });
  try {
    const saved = await persistInvoiceDocument(getAdminDb(), body.invoice, body.mode === "finance" ? "finance" : "draft", auth.email);
    return Response.json({ ok: true, id: saved.id, invoice: saved.invoice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SAVE_FAILED";
    if (message === "DUPLICATE_INVOICE") {
      return Response.json({ error: "DUPLICATE_INVOICE", code: "DUPLICATE_INVOICE" }, { status: 409 });
    }
    if (message === "INVOICE_CANCELLED") {
      return Response.json({ error: "INVOICE_CANCELLED", code: "INVOICE_CANCELLED" }, { status: 409 });
    }
    return Response.json({ error: message, code: "SAVE_FAILED" }, { status: 500 });
  }
}
