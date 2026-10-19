import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { readLoyaltySettings, writeLoyaltySettings } from "@/lib/loyalty/admin/members";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const settings = await readLoyaltySettings(getAdminDb());
  return Response.json({ ok: true, settings });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { patch?: Record<string, unknown> } | null;
  if (!body?.patch) {
    return Response.json({ error: "PATCH_REQUIRED", code: "VALIDATION" }, { status: 400 });
  }
  const settings = await writeLoyaltySettings(getAdminDb(), body.patch, auth.email);
  return Response.json({ ok: true, settings });
}
