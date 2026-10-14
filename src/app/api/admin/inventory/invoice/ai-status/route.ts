import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { pingGemini } from "@/lib/ai/gemini-client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const health = await pingGemini(false);
  return Response.json({
    configured: health.configured,
    provider: health.provider,
    model: health.model,
    reachable: health.reachable,
    httpStatus: health.httpStatus,
    reason: health.reason,
  });
}
