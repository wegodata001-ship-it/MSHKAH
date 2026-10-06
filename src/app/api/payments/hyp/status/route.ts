import { NextResponse } from "next/server";
import { getHypMissingEnvNames, isHypConfigured, logHypEnvStatus } from "@/lib/payments/hyp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public flag only — never expose keys, PassP, or Masof values. */
export async function GET() {
  const enabled = isHypConfigured();
  if (enabled) return NextResponse.json({ enabled: true });
  logHypEnvStatus();
  const missing = getHypMissingEnvNames().filter((name) =>
    name === "HYP_MASOF" || name === "HYP_API_KEY" || name === "HYP_PASSP"
  );
  return NextResponse.json({ enabled: false, missing });
}
