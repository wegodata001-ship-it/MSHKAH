import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { persistInvoiceDocument, postInvoiceStock } from "@/lib/inventory/invoice-admin-write";
import { getAdminDb } from "@/lib/firebase/admin";
import type { PurchaseInvoice } from "@/lib/inventory/types";

export const runtime = "nodejs";

const inflight = new Set<string>();

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    invoice?: PurchaseInvoice;
    lineKeys?: string[];
    skipFinanceSave?: boolean;
  } | null;
  if (!body?.invoice) return Response.json({ error: "Invoice required", code: "VALIDATION" }, { status: 400 });
  const db = getAdminDb();
  let current = body.invoice;
  try {
    if (!body.skipFinanceSave && current.status !== "saved" && current.status !== "approved") {
      const saved = await persistInvoiceDocument(db, current, "finance", auth.email);
      current = saved.invoice;
    } else if (!current.id) {
      const saved = await persistInvoiceDocument(db, current, "draft", auth.email);
      current = saved.invoice;
    }
    const lockKey = current.id || "missing";
    if (inflight.has(lockKey)) {
      return Response.json({ error: "POSTING_IN_PROGRESS", code: "POSTING_IN_PROGRESS", invoice: current }, { status: 409 });
    }
    inflight.add(lockKey);
    try {
      const posted = await postInvoiceStock(db, current, body.lineKeys, auth.email);
      return Response.json({
        ok: true,
        id: posted.invoice.id,
        invoice: posted.invoice,
        postedKeys: posted.postedKeys,
        reusedKeys: posted.reusedKeys,
      });
    } finally {
      inflight.delete(lockKey);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "STOCK_POST_FAILED";
    if (message === "DUPLICATE_INVOICE") {
      return Response.json({ error: "DUPLICATE_INVOICE", code: "DUPLICATE_INVOICE", invoice: current }, { status: 409 });
    }
    if (message === "NO_STOCK_LINES") {
      return Response.json({ error: "NO_STOCK_LINES", code: "NO_STOCK_LINES", invoice: current }, { status: 400 });
    }
    if (message === "INVOICE_CANCELLED") {
      return Response.json({ error: "INVOICE_CANCELLED", code: "INVOICE_CANCELLED", invoice: current }, { status: 409 });
    }
    if (message === "CREDIT_NO_AUTO_IN" || message === "ALREADY_RECEIVED") {
      return Response.json({ error: message, code: message, invoice: current }, { status: 409 });
    }
    if (message === "PACK_UNRESOLVED") {
      const detail = (error as Error & { detail?: unknown }).detail;
      return Response.json(
        { error: "PACK_UNRESOLVED", code: "PACK_UNRESOLVED", invoice: current, detail },
        { status: 400 }
      );
    }
    return Response.json({ error: message, code: "STOCK_POST_FAILED", invoice: current }, { status: 500 });
  }
}
