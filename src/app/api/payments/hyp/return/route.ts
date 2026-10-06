import { NextRequest, NextResponse } from "next/server";
import { handleHypReturn } from "@/lib/payments/hyp/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rawSearch(request: NextRequest): string {
  try {
    return new URL(request.url).search.replace(/^\?/, "");
  } catch {
    return "";
  }
}

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function GET(request: NextRequest) {
  const { redirectPath } = await handleHypReturn(rawSearch(request));
  return redirectTo(request, redirectPath);
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let raw = rawSearch(request);
  if (!raw && contentType.includes("application/x-www-form-urlencoded")) {
    raw = await request.text();
  }
  const { redirectPath } = await handleHypReturn(raw);
  return redirectTo(request, redirectPath);
}
