import { NextResponse } from "next/server";
import { isHypConfigured, logHypEnvStatus } from "@/lib/payments/hyp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public flag only — never expose keys, PassP, or Masof. */
export async function GET() {
  const enabled = isHypConfigured();
  if (!enabled) logHypEnvStatus();
  return NextResponse.json({ enabled });
}
