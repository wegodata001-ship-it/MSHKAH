import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { correctPostedInvoiceQuantity } from "@/lib/inventory/invoice-admin-write";

export const runtime = "nodejs";

const inflight = new Set<string>();

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json().catch(() => null)) as {
    invoiceId?: string;
    lineKey?: string;
    correctedQuantity?: number;
  } | null;
  const invoiceId = body?.invoiceId?.trim();
  const lineKey = body?.lineKey?.trim();
  if (!invoiceId || !lineKey || body?.correctedQuantity == null) {
    return Response.json({ ok: false, code: "VALIDATION" }, { status: 400 });
  }

  const lockKey = `${invoiceId}:${lineKey}`;
  if (inflight.has(lockKey)) {
    return Response.json({ ok: false, code: "CORRECTION_IN_PROGRESS" }, { status: 409 });
  }
  inflight.add(lockKey);
  try {
    const result = await correctPostedInvoiceQuantity(getAdminDb(), {
      invoiceId,
      lineKey,
      correctedQuantity: Number(body.correctedQuantity),
      actor: auth.email,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CORRECTION_FAILED";
    const status =
      message === "NOT_FOUND" || message === "MOVEMENT_MISSING" || message === "LINE_NOT_POSTED"
        ? 404
        : message === "INVOICE_CANCELLED"
          ? 409
          : message === "INVALID_QUANTITY" || message === "INVALID_ORIGINAL" || message === "INVALID_CORRECTED"
            ? 400
            : 500;
    return Response.json({ ok: false, code: message }, { status });
  } finally {
    inflight.delete(lockKey);
  }
}
