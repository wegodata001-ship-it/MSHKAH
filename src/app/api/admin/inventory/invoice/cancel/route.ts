import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { cancelInvoice, InvoiceCancelError } from "@/lib/inventory/invoice-cancel-admin";

export const runtime = "nodejs";

// Process-wide in-memory lock so a double-click can't fire the cancellation
// twice before the first `tx.set` completes. The real idempotency guarantee
// still lives on Firestore (counter-movement doc ids are deterministic), but
// this short-circuits the second attempt with a clean 409 response.
const inflight = new Set<string>();

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json().catch(() => null)) as {
    invoiceId?: string;
    reason?: string;
  } | null;
  if (!body?.invoiceId) {
    return Response.json({ error: "INVOICE_REQUIRED", code: "VALIDATION" }, { status: 400 });
  }

  const lockKey = body.invoiceId;
  if (inflight.has(lockKey)) {
    return Response.json(
      { error: "CANCEL_IN_PROGRESS", code: "CANCEL_IN_PROGRESS" },
      { status: 409 }
    );
  }
  inflight.add(lockKey);

  try {
    const db = getAdminDb();
    const result = await cancelInvoice(db, body.invoiceId, {
      actor: auth.email,
      reason: body.reason?.slice(0, 200),
    });
    return Response.json({
      ok: true,
      invoice: result.invoice,
      plan: result.plan,
      reversedIds: result.reversedIds,
    });
  } catch (error) {
    if (error instanceof InvoiceCancelError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "BROKEN_LINK" ? 409 : 400;
      return Response.json(
        { error: error.code, code: error.code, detail: error.detail ?? null },
        { status }
      );
    }
    const message = error instanceof Error ? error.message : "CANCEL_FAILED";
    return Response.json({ error: message, code: "CANCEL_FAILED" }, { status: 500 });
  } finally {
    inflight.delete(lockKey);
  }
}
