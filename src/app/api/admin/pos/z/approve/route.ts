import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import {
  canPostZReport,
  financeTenders,
  findDuplicateZReport,
  overlappingPostedZReports,
  overlapRequiresAck,
  overlapReviewRequired,
  websiteSalesOverlap,
  zAmountToPost,
  zFinanceIdempotencyKey,
  zVatBasis,
} from "@/lib/inventory/pos-z";
import type { PosFinanceEntry, PosZReport } from "@/lib/inventory/types";
import type { Order } from "@/types";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    reportId?: string;
    report?: Partial<PosZReport>;
    overlapAcknowledged?: boolean;
    periodOverlapAcknowledged?: boolean;
    overlapReviewAcknowledged?: boolean;
  };
  const reportId = String(body.reportId || "").trim();
  if (!reportId) return Response.json({ ok: false, error: "report-required" }, { status: 400 });

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.posZReports).doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  const stored = { id: snap.id, ...snap.data() } as PosZReport;
  const merged: PosZReport = {
    ...stored,
    ...body.report,
    id: stored.id,
    status: stored.status,
    financeEntryId: stored.financeEntryId,
    sourceFiles: stored.sourceFiles,
  };

  const check = canPostZReport(merged, { overlapReviewAcknowledged: body.overlapReviewAcknowledged });
  if (!check.ok) {
    return Response.json({ ok: false, error: check.reason, existingId: stored.financeEntryId }, { status: 409 });
  }

  const othersSnap = await db.collection(COLLECTIONS.posZReports).limit(400).get();
  const others = othersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PosZReport);
  const duplicate = findDuplicateZReport(others, merged);
  if (duplicate) {
    return Response.json({
      ok: false,
      error: "duplicate",
      existingId: duplicate.id,
      existingStatus: duplicate.status,
    }, { status: 409 });
  }

  const periodOverlaps = overlappingPostedZReports(others, merged);
  if (periodOverlaps.length && !body.periodOverlapAcknowledged) {
    return Response.json({
      ok: false,
      error: "period-overlap",
      overlappingIds: periodOverlaps.map((item) => item.id),
    }, { status: 409 });
  }

  const ordersSnap = await db.collection(COLLECTIONS.orders).limit(800).get();
  const orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Order);
  let overlap;
  try {
    overlap = websiteSalesOverlap(orders, merged.periodFrom ?? merged.businessDate, merged.periodTo ?? merged.businessDate);
  } catch (error) {
    console.error("[pos-z-approve] overlap-failed", error);
    return Response.json({
      ok: false,
      error: "overlap-incomplete",
      message: "נדרש בירור חפיפה — קיימות הזמנות ללא תאריך תקין",
    }, { status: 409 });
  }
  if (overlapReviewRequired(overlap) && !body.overlapReviewAcknowledged && !merged.overlapReviewResolved) {
    return Response.json({
      ok: false,
      error: "overlap-incomplete",
      overlap,
      message: "נדרש בירור חפיפה — קיימות הזמנות ללא תאריך תקין",
    }, { status: 409 });
  }
  if (overlapRequiresAck(overlap) && !body.overlapAcknowledged) {
    return Response.json({ ok: false, error: "website-overlap", overlap }, { status: 409 });
  }

  const financeId = zFinanceIdempotencyKey(merged.id);
  const financeRef = db.collection(COLLECTIONS.posFinanceEntries).doc(financeId);
  const existingFinance = await financeRef.get();
  if (existingFinance.exists || stored.status === "posted") {
    return Response.json({
      ok: false,
      error: "already-posted",
      existingId: stored.id,
      financeEntryId: existingFinance.exists ? financeRef.id : stored.financeEntryId,
    }, { status: 409 });
  }

  const amount = zAmountToPost(merged);
  if (amount == null) return Response.json({ ok: false, error: "missing-amount" }, { status: 400 });
  const businessDate = merged.periodFrom || merged.businessDate;
  if (!businessDate) return Response.json({ ok: false, error: "missing-date" }, { status: 400 });

  const entry: PosFinanceEntry = {
    id: financeId,
    zReportId: merged.id,
    kind: "z-post",
    businessDate,
    amount,
    vatBasis: zVatBasis(merged),
    vatTotal: merged.vatTotal ?? null,
    payments: financeTenders(merged.payments),
    sourceFilePaths: (merged.sourceFiles ?? []).map((file) => file.storagePath),
    postedAt: new Date().toISOString(),
    postedBy: auth.uid,
  };

  const batch = db.batch();
  batch.set(financeRef, sanitizeFirestoreData(entry));
  batch.set(
    ref,
    sanitizeFirestoreData({
      ...merged,
      status: "posted",
      financeEntryId: financeId,
      websiteOverlap: overlap,
      overlapReviewResolved: overlap.status === "incomplete" ? true : merged.overlapReviewResolved,
      postedAt: FieldValue.serverTimestamp(),
      postedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    { merge: true }
  );
  await batch.commit();

  return Response.json({ ok: true, financeEntryId: financeId, amount, businessDate, overlap });
}
