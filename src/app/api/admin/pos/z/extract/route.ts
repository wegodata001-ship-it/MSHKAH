import { createHash, randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { extractZReportWithGemini } from "@/lib/ai/gemini-z-report";
import { GeminiRequestError, httpStatusForAiCode, isGeminiConfigured } from "@/lib/ai/gemini-config";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { readInvoiceSourceBytes, savePosZSourceFile } from "@/lib/inventory/invoice-source-store";
import { findDuplicateZReport, isEmptyZExtraction, overlappingPostedZReports, websiteSalesOverlap } from "@/lib/inventory/pos-z";
import type { PosZReport } from "@/lib/inventory/types";
import type { Order } from "@/types";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 12 * 1024 * 1024;

function mimeFor(file: File): string | null {
  const type = file.type || "";
  const name = file.name.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

async function readJsonOrForm(request: NextRequest): Promise<{ reportId: string; files: File[] }> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { reportId?: string };
    return { reportId: String(body.reportId || "").trim(), files: [] };
  }
  const form = await request.formData();
  return {
    reportId: String(form.get("reportId") || form.get("attachToId") || "").trim(),
    files: form.getAll("file").filter((item): item is File => item instanceof File),
  };
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  if (!isGeminiConfigured()) {
    return Response.json({ ok: false, code: "AI_NOT_CONFIGURED", requestId }, { status: 503 });
  }

  const { reportId, files } = await readJsonOrForm(request);
  if (!reportId && !files.length) {
    return Response.json({ ok: false, error: "report-required", requestId }, { status: 400 });
  }

  const db = getAdminDb();
  const existingSnap = await db.collection(COLLECTIONS.posZReports).limit(400).get();
  const existing = existingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PosZReport);
  const ordersSnap = await db.collection(COLLECTIONS.orders).limit(800).get();
  const orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Order);

  const ref = reportId ? db.collection(COLLECTIONS.posZReports).doc(reportId) : db.collection(COLLECTIONS.posZReports).doc();
  const current = reportId ? ((await ref.get()).data() as PosZReport | undefined) : undefined;
  if (reportId && !current) {
    return Response.json({ ok: false, error: "not-found", requestId }, { status: 404 });
  }
  if (current?.status === "posted") {
    return Response.json({ ok: false, error: "already-posted", requestId, existingId: ref.id }, { status: 409 });
  }

  const attachments: { bytes: Buffer; mimeType: string }[] = [];
  const addedSources = [...(current?.sourceFiles ?? [])];

  for (const file of files) {
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: "file-size", requestId }, { status: 400 });
    }
    const mimeType = mimeFor(file);
    if (!mimeType) return Response.json({ ok: false, error: "file-type", requestId }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const sourceFile = await savePosZSourceFile({
      reportId: ref.id,
      bytes,
      filename: file.name,
      mimeType,
      uploadedBy: auth.uid,
    });
    addedSources.push(sourceFile);
    attachments.push({ bytes, mimeType });
    if (!current?.fileHash) {
      await ref.set({ fileHash, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }

  if (!attachments.length) {
    for (const source of addedSources) {
      try {
        attachments.push(await readInvoiceSourceBytes(source.storagePath));
      } catch {
        /* skip unreadable source; others may still scan */
      }
    }
  }

  if (!attachments.length) {
    return Response.json({ ok: false, error: "file-required", requestId }, { status: 400 });
  }

  await ref.set(
    sanitizeFirestoreData({
      id: ref.id,
      status: "draft",
      scanStatus: "scanning",
      lastScanError: null,
      sourceFiles: addedSources,
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    { merge: true }
  );

  let extracted;
  try {
    extracted = await extractZReportWithGemini({ attachments, requestId });
  } catch (error) {
    const message = error instanceof GeminiRequestError ? error.message : "סריקת AI נכשלה";
    const failed: Partial<PosZReport> = {
      scanStatus: "failed",
      lastScanError: message,
      status: "draft",
      sourceFiles: addedSources,
      updatedAt: new Date().toISOString(),
    };
    await ref.set(sanitizeFirestoreData(failed), { merge: true });
    if (error instanceof GeminiRequestError) {
      return Response.json(
        { ok: false, code: error.code, requestId, message, report: { id: ref.id, ...current, ...failed } },
        { status: httpStatusForAiCode(error.code, error.providerStatus) }
      );
    }
    return Response.json({ ok: false, error: "scan-failed", requestId, message, report: { id: ref.id, ...current, ...failed } }, { status: 422 });
  }

  if (isEmptyZExtraction(extracted.report)) {
    const emptyDraft: PosZReport = {
      id: ref.id,
      ...extracted.report,
      status: "draft",
      scanStatus: "failed",
      lastScanError: "הסריקה לא חילצה נתונים מהדוח",
      financeEntryId: current?.financeEntryId ?? null,
      sourceFiles: addedSources,
      fileHash: current?.fileHash,
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await ref.set(
      sanitizeFirestoreData({
        ...emptyDraft,
        extractionModel: extracted.model,
        createdAt: current ? current.createdAt : FieldValue.serverTimestamp(),
      }),
      { merge: true }
    );
    return Response.json({ ok: false, error: "empty-extract", requestId, report: emptyDraft }, { status: 422 });
  }

  const overlap = websiteSalesOverlap(
    orders,
    extracted.report.periodFrom ?? extracted.report.businessDate,
    extracted.report.periodTo ?? extracted.report.businessDate
  );
  const draft: PosZReport = {
    id: ref.id,
    ...extracted.report,
    status: "draft",
    financeEntryId: current?.financeEntryId ?? null,
    sourceFiles: addedSources,
    fileHash: current?.fileHash,
    duplicateOf: null,
    websiteOverlap: overlap,
    periodOverlapIds: overlappingPostedZReports(existing, {
      ...extracted.report,
      id: ref.id,
      status: "draft",
      createdAt: current?.createdAt || new Date().toISOString(),
    }).map((item) => item.id),
    extractionModel: extracted.model,
    lastScanError: null,
    createdAt: current?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const duplicate = findDuplicateZReport(existing, draft);
  if (duplicate && duplicate.id !== draft.id) {
    draft.duplicateOf = duplicate.id;
  }

  await ref.set(
    sanitizeFirestoreData({
      ...draft,
      createdAt: current ? current.createdAt : FieldValue.serverTimestamp(),
    }),
    { merge: true }
  );

  return Response.json({ ok: true, reports: [draft], report: draft, requestId });
}
