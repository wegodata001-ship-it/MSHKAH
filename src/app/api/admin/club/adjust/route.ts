import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { adjustMemberPoints } from "@/lib/loyalty/admin/members";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    memberId?: string;
    delta?: number;
    reason?: string;
    idempotencyKey?: string;
  } | null;
  if (!body?.memberId || typeof body.delta !== "number" || !body.reason?.trim() || !body.idempotencyKey) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }
  try {
    const result = await adjustMemberPoints(getAdminDb(), {
      memberId: body.memberId,
      delta: Math.floor(body.delta),
      reason: body.reason,
      actor: auth.email,
      idempotencyKey: body.idempotencyKey,
    });
    return Response.json({ ok: true, newBalance: result.newBalance });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ADJUST_FAILED";
    const status = code === "member_not_found" ? 404 : code === "reason_required" ? 400 : 500;
    return Response.json({ error: code, code }, { status });
  }
}
