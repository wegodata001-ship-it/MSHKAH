import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { zAmountToPost, zVatBasis } from "@/lib/inventory/pos-z";
import type { PosFinanceEntry, PosZReport } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    reportId?: string;
    reason?: string;
    report?: Partial<PosZReport>;
  };
  const reportId = String(body.reportId || "").trim();
  const reason = String(body.reason || "").trim();
  if (!reportId || !reason) return Response.json({ ok: false, error: "reason-required" }, { status: 400 });

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.posZReports).doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  const stored = { id: snap.id, ...snap.data() } as PosZReport;
  if (stored.status !== "posted" || !stored.financeEntryId) {
    return Response.json({ ok: false, error: "not-posted" }, { status: 409 });
  }

  const merged: PosZReport = { ...stored, ...body.report, id: stored.id, status: "posted", financeEntryId: stored.financeEntryId };
  const nextAmount = zAmountToPost(merged);
  if (nextAmount == null) return Response.json({ ok: false, error: "missing-amount" }, { status: 400 });
  const previous = await db.collection(COLLECTIONS.posFinanceEntries).doc(stored.financeEntryId).get();
  const previousAmount = previous.exists ? Number(previous.data()?.amount) || 0 : 0;
  const delta = nextAmount - previousAmount;
  if (Math.abs(delta) < 0.0001) {
    await ref.set(sanitizeFirestoreData({ ...merged, updatedAt: new Date().toISOString() }), { merge: true });
    return Response.json({ ok: true, unchanged: true, financeEntryId: stored.financeEntryId });
  }

  const correctionId = `z-correction-${stored.id}-${Date.now()}`;
  const entry: PosFinanceEntry = {
    id: correctionId,
    zReportId: stored.id,
    kind: "z-correction",
    businessDate: merged.businessDate || merged.periodFrom || stored.businessDate || "",
    amount: delta,
    vatBasis: zVatBasis(merged),
    vatTotal: merged.vatTotal ?? null,
    payments: merged.payments ?? [],
    sourceFilePaths: (merged.sourceFiles ?? []).map((file) => file.storagePath),
    postedAt: new Date().toISOString(),
    postedBy: auth.uid,
    correctionOf: stored.financeEntryId,
    reason,
  };
  await db.collection(COLLECTIONS.posFinanceEntries).doc(correctionId).set(sanitizeFirestoreData(entry));
  await ref.set(
    sanitizeFirestoreData({
      ...merged,
      status: "posted",
      updatedAt: new Date().toISOString(),
    }),
    { merge: true }
  );
  return Response.json({ ok: true, financeEntryId: correctionId, amount: delta });
}
