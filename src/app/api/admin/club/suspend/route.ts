import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { suspendMember } from "@/lib/loyalty/admin/members";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { memberId?: string } | null;
  if (!body?.memberId) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }
  await suspendMember(getAdminDb(), { memberId: body.memberId, actor: auth.email });
  return Response.json({ ok: true });
}
