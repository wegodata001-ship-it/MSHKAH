import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/verify-admin";
import { notifyNewOrder } from "@/lib/email/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;
  const orderId = id?.trim();
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });
  }

  const result = await notifyNewOrder(orderId, { force: true });
  if (result.status === "sent" || result.status === "already_sent") {
    return NextResponse.json({ ok: true, status: result.status });
  }
  if (result.status === "skipped") {
    return NextResponse.json({ ok: false, status: "SKIPPED", reason: result.reason }, { status: 400 });
  }
  return NextResponse.json(
    { ok: false, status: result.status, error: "error" in result ? result.error : result.status },
    { status: 502 }
  );
}
