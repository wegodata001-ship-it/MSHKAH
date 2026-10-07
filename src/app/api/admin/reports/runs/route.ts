import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { ReportType } from "@/lib/reports/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    type?: ReportType;
    periodFrom?: string;
    periodTo?: string;
  };
  if (!body.type) return Response.json({ error: "type-required" }, { status: 400 });

  const db = getAdminDb();
  const ref = await db.collection(COLLECTIONS.reportRuns).add({
    type: body.type,
    periodFrom: body.periodFrom || null,
    periodTo: body.periodTo || null,
    generatedAt: new Date().toISOString(),
    generatedBy: auth.uid,
    generatedByName: auth.displayName || auth.email,
  });
  return Response.json({ id: ref.id });
}
