import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { InvoiceRemovalError, previewInvoiceRemoval } from "@/lib/inventory/invoice-removal-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    scope?: "active" | "archive";
    ids?: string[];
  } | null;
  const scope = body?.scope === "archive" ? "archive" : "active";
  try {
    const summary = await previewInvoiceRemoval(getAdminDb(), {
      scope,
      ids: Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 500) : undefined,
    });
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const code = error instanceof InvoiceRemovalError ? error.code : "PREVIEW_FAILED";
    return Response.json({ error: code, code }, { status: 500 });
  }
}
