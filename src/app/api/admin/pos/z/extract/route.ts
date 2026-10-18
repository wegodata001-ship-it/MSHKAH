import { createHash, randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { extractZReportWithGemini } from "@/lib/ai/gemini-z-report";
import { GeminiRequestError, httpStatusForAiCode, isGeminiConfigured } from "@/lib/ai/gemini-config";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { readInvoiceSourceBytes, savePosZSourceFile } from "@/lib/inventory/invoice-source-store";
import {
  canReuseZExtract,
  findDuplicateZReport,
  isEmptyZExtraction,
  overlappingPostedZReports,
  refreshZDerived,
  websiteSalesOverlap,
} from "@/lib/inventory/pos-z";
import type { PosZReport, WebsiteSalesOverlap } from "@/lib/inventory/types";
import type { Order } from "@/types";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 12 * 1024 * 1024;
const inflight = new Set<string>();

function mimeFor(file: File): string | null {
  const type = file.type || "";
  const name = file.name.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function fail(input: {
  status: number;
  requestId: string;
  code: string;
  message: string;
  report?: Partial<PosZReport> | null;
  extra?: Record<string, unknown>;
}) {
  return Response.json(
    {
      ok: false,
      code: input.code,
      error: input.code,
      message: input.message,
      requestId: input.requestId,
      report: input.report ?? undefined,
      ...input.extra,
    },
    { status: input.status }
  );
}

async function readJsonOrForm(request: NextRequest): Promise<{
  reportId: string;
  files: File[];
  recheckOverlap: boolean;
  forceAi: boolean;
}> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { reportId?: string; recheckOverlap?: boolean; forceAi?: boolean };
    return {
      reportId: String(body.reportId || "").trim(),
      files: [],
      recheckOverlap: body.recheckOverlap === true,
      forceAi: body.forceAi === true,
    };
  }
  const form = await request.formData();
  return {
    reportId: String(form.get("reportId") || form.get("attachToId") || "").trim(),
    files: form.getAll("file").filter((item): item is File => item instanceof File),
    recheckOverlap: String(form.get("recheckOverlap") || "") === "true",
    forceAi: String(form.get("forceAi") || "") === "true",
  };
}

function computeOverlap(orders: Order[], report: Pick<PosZReport, "periodFrom" | "periodTo" | "businessDate">): WebsiteSalesOverlap {
  try {
    return websiteSalesOverlap(orders, report.periodFrom ?? report.businessDate, report.periodTo ?? report.businessDate);
  } catch (error) {
    console.error("[pos-z-extract] overlap-failed", error);
    return {
      orderCount: 0,
      amount: 0,
      status: "incomplete",
      invalidOrderCount: orders.length,
    };
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const auth = await requireAdminOnly(request);
    if (auth instanceof Response) return auth;
    if (!isGeminiConfigured()) {
      return fail({ status: 503, requestId, code: "AI_NOT_CONFIGURED", message: "סריקת AI אינה מוגדרת" });
    }

    const { reportId, files, recheckOverlap, forceAi } = await readJsonOrForm(request);
    if (!reportId && !files.length) {
      return fail({ status: 400, requestId, code: "report-required", message: "חסר דוח לסריקה" });
    }

    const db = getAdminDb();
    const existingSnap = await db.collection(COLLECTIONS.posZReports).limit(400).get();
    const existing = existingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PosZReport);
    const ordersSnap = await db.collection(COLLECTIONS.orders).limit(800).get();
    const orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Order);

    const ref = reportId ? db.collection(COLLECTIONS.posZReports).doc(reportId) : db.collection(COLLECTIONS.posZReports).doc();
    const current = reportId ? ((await ref.get()).data() as PosZReport | undefined) : undefined;
    if (reportId && !current) {
      return fail({ status: 404, requestId, code: "not-found", message: "הדוח לא נמצא" });
    }
    if (current?.status === "posted") {
      return fail({
        status: 409,
        requestId,
        code: "already-posted",
        message: "הדוח כבר נרשם בכספים",
        extra: { existingId: ref.id },
        report: current,
      });
    }

    const lockKey = ref.id;
    if (inflight.has(lockKey)) {
      return fail({
        status: 409,
        requestId,
        code: "SCAN_IN_PROGRESS",
        message: "סריקה כבר רצה לדוח זה",
        report: current ? { id: ref.id, ...current } : { id: ref.id },
      });
    }
    inflight.add(lockKey);

    try {
      const attachments: { bytes: Buffer; mimeType: string }[] = [];
      const addedSources = [...(current?.sourceFiles ?? [])];

      for (const file of files) {
        if (file.size <= 0 || file.size > MAX_BYTES) {
          return fail({ status: 400, requestId, code: "file-size", message: "גודל הקובץ אינו תקין" });
        }
        const mimeType = mimeFor(file);
        if (!mimeType) return fail({ status: 400, requestId, code: "file-type", message: "סוג הקובץ אינו נתמך" });
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

      const reuse = canReuseZExtract(current ? { ...current, id: ref.id } : undefined, files, { recheckOverlap, forceAi });
      if (!reuse && !attachments.length) {
        for (const source of addedSources) {
          try {
            attachments.push(await readInvoiceSourceBytes(source.storagePath));
          } catch {
            /* skip unreadable source; others may still scan */
          }
        }
      }

      if (!reuse && !attachments.length) {
        return fail({ status: 400, requestId, code: "file-required", message: "חסר קובץ לסריקה", report: current ? { id: ref.id, ...current } : { id: ref.id } });
      }

      let extractedReport: PosZReport;
      let extractionModel = current?.extractionModel ?? null;
      let reused = false;

      if (reuse && current) {
        reused = true;
        extractedReport = refreshZDerived({
          ...current,
          id: ref.id,
          sourceFiles: addedSources,
          lastScanError: null,
        });
      } else {
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
        try {
          const extracted = await extractZReportWithGemini({ attachments, requestId });
          extractedReport = refreshZDerived({
            id: ref.id,
            ...extracted.report,
            status: "draft",
            financeEntryId: current?.financeEntryId ?? null,
            sourceFiles: addedSources,
            fileHash: current?.fileHash,
            createdAt: current?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          extractionModel = extracted.model;
        } catch (error) {
          const message = error instanceof GeminiRequestError ? error.message : "סריקת AI נכשלה";
          console.error("[pos-z-extract] ai-failed", { requestId, reportId: ref.id, message, error });
          const failed: Partial<PosZReport> = {
            scanStatus: "failed",
            lastScanError: message,
            status: "draft",
            sourceFiles: addedSources,
            updatedAt: new Date().toISOString(),
          };
          await ref.set(sanitizeFirestoreData(failed), { merge: true });
          if (error instanceof GeminiRequestError) {
            return fail({
              status: httpStatusForAiCode(error.code, error.providerStatus),
              requestId,
              code: error.code,
              message,
              report: { id: ref.id, ...current, ...failed },
            });
          }
          return fail({
            status: 422,
            requestId,
            code: "scan-failed",
            message,
            report: { id: ref.id, ...current, ...failed },
          });
        }

        if (isEmptyZExtraction(extractedReport)) {
          const emptyDraft: PosZReport = {
            ...extractedReport,
            scanStatus: "failed",
            lastScanError: "הסריקה לא חילצה נתונים מהדוח",
          };
          await ref.set(
            sanitizeFirestoreData({
              ...emptyDraft,
              extractionModel,
              createdAt: current ? current.createdAt : FieldValue.serverTimestamp(),
            }),
            { merge: true }
          );
          return fail({ status: 422, requestId, code: "empty-extract", message: emptyDraft.lastScanError || "empty-extract", report: emptyDraft });
        }

        await ref.set(
          sanitizeFirestoreData({
            ...extractedReport,
            extractionModel,
            lastScanError: null,
            createdAt: current ? current.createdAt : FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }),
          { merge: true }
        );
      }

      const overlap = computeOverlap(orders, extractedReport);
      const draft: PosZReport = {
        ...extractedReport,
        id: ref.id,
        status: "draft",
        financeEntryId: current?.financeEntryId ?? null,
        sourceFiles: addedSources,
        fileHash: current?.fileHash ?? extractedReport.fileHash,
        duplicateOf: null,
        websiteOverlap: overlap,
        overlapReviewResolved: overlap.status === "incomplete" ? false : current?.overlapReviewResolved,
        periodOverlapIds: overlappingPostedZReports(existing, draftLike(extractedReport, ref.id, current)).map((item) => item.id),
        extractionModel,
        lastScanError: null,
        createdAt: current?.createdAt || extractedReport.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const duplicate = findDuplicateZReport(existing, draft);
      if (duplicate && duplicate.id !== draft.id) draft.duplicateOf = duplicate.id;

      await ref.set(
        sanitizeFirestoreData({
          ...draft,
          createdAt: current ? current.createdAt : FieldValue.serverTimestamp(),
        }),
        { merge: true }
      );

      return Response.json({
        ok: true,
        reused,
        reports: [draft],
        report: draft,
        requestId,
        overlapStatus: overlap.status,
      });
    } finally {
      inflight.delete(lockKey);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "extract-failed";
    console.error("[pos-z-extract] unexpected", { requestId, message, error });
    return fail({
      status: 500,
      requestId,
      code: "EXTRACT_FAILED",
      message: "סריקת דוח Z נכשלה. הטיוטה והקובץ נשמרו אם כבר הועלו.",
    });
  }
}

function draftLike(report: PosZReport, id: string, current?: PosZReport): PosZReport {
  return {
    ...report,
    id,
    status: "draft",
    createdAt: current?.createdAt || report.createdAt || new Date().toISOString(),
  };
}
