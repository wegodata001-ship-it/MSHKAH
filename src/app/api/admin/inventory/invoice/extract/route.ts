import { createHash, randomUUID } from "crypto";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import {
  GeminiRequestError,
  httpStatusForAiCode,
  isGeminiConfigured,
  type InvoiceAiCode,
} from "@/lib/ai/gemini-config";
import { extractInvoiceWithGemini } from "@/lib/ai/gemini-invoice";
import { prepareInvoiceImage, sniffImageOrPdfMime } from "@/lib/ai/image-prep";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { mergeScannedInvoice, publicScanErrorCode } from "@/lib/inventory/invoice-archive";
import { findUndefinedPaths, sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { readInvoiceSourceBytes, saveInvoiceSourceFile } from "@/lib/inventory/invoice-source-store";
import { buildReviewedInvoice, findExistingInvoice, isEditableInvoice, isPostedInvoice } from "@/lib/inventory/invoice-smart-match";
import type { CostingIngredient } from "@/lib/costing/types";
import type { InvoiceScanAttempt, PurchaseInvoice, PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Resolve the request MIME in three stages, from most trustworthy to least:
 *   1. magic bytes (fail-safe for WhatsApp blobs that lie about their type)
 *   2. declared `file.type` from the browser
 *   3. filename extension
 */
function mimeFor(file: File, bytes: Buffer): string | null {
  const sniffed = sniffImageOrPdfMime(bytes);
  if (sniffed) return sniffed;
  const type = file.type || "";
  const name = file.name.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

/**
 * In-process concurrency guard with a self-cleaning TTL. The TTL matters on
 * serverless: when a scan crashes between the `set` and the `finally`,
 * stale keys would otherwise block retries forever.
 */
type InflightEntry = { requestId: string; startedAt: number };
const INFLIGHT_TTL_MS = 150_000;
const inflightScans = new Map<string, InflightEntry>();

function isInflight(key: string): InflightEntry | null {
  const entry = inflightScans.get(key);
  if (!entry) return null;
  if (Date.now() - entry.startedAt > INFLIGHT_TTL_MS) {
    inflightScans.delete(key);
    return null;
  }
  return entry;
}

function fail(
  code: InvoiceAiCode,
  extra: {
    message: string;
    requestId: string;
    providerStatus?: number | null;
    providerError?: string | null;
    model?: string | null;
    fileType?: string | null;
    fileSize?: number;
    invoice?: PurchaseInvoice | null;
    retryAfterSeconds?: number | null;
  }
) {
  const errorCode = publicScanErrorCode(code, extra.providerStatus);
  const headers = extra.retryAfterSeconds ? { "Retry-After": String(extra.retryAfterSeconds) } : undefined;
  return Response.json(
    {
      ok: false,
      configured: code !== "AI_NOT_CONFIGURED" && code !== "PROVIDER_NOT_CONFIGURED",
      reachable: false,
      code,
      errorCode,
      message: extra.message,
      requestId: extra.requestId,
      provider: "gemini",
      model: extra.model ?? null,
      providerStatus: extra.providerStatus ?? null,
      providerError: extra.providerError ?? null,
      error: errorCode,
      retryAfterSeconds: extra.retryAfterSeconds ?? null,
      invoice: extra.invoice ?? undefined,
    },
    { status: httpStatusForAiCode(code, extra.providerStatus), headers }
  );
}

function logExtract(fields: Record<string, unknown>) {
  console.info("[invoice-extract]", fields);
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const started = Date.now();
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get("file");
  const existingId = String(form.get("invoiceId") || "").trim();
  const db = getAdminDb();

  let invoiceRef = existingId ? db.collection(COLLECTIONS.purchaseInvoices).doc(existingId) : db.collection(COLLECTIONS.purchaseInvoices).doc();
  let existing = existingId ? ((await invoiceRef.get()).data() as PurchaseInvoice | undefined) : undefined;
  if (existingId && !existing) {
    return fail("INVALID_FILE", { message: "Invoice was not found", requestId });
  }

  let bytes: Buffer | null = null;
  let mimeType: string | null = null;
  let fileName = existing?.sourceFile?.originalFilename || existing?.fileName || "invoice";
  let fileHash = existing?.fileHash || "";
  let sourceFile = existing?.sourceFile;

  if (file instanceof File) {
    if (file.size <= 0) {
      return fail("UNSUPPORTED_FILE", { message: "Invoice file is required", requestId, invoice: existing as PurchaseInvoice });
    }
    if (file.size > MAX_BYTES) {
      return fail("FILE_TOO_LARGE", { message: "Invoice file is too large", requestId, fileSize: file.size, invoice: existing as PurchaseInvoice });
    }
    const rawBytes = Buffer.from(await file.arrayBuffer());
    mimeType = mimeFor(file, rawBytes);
    if (!mimeType) {
      return fail("UNSUPPORTED_FILE", {
        message: "Invoice file type is not supported",
        requestId,
        fileType: file.type || file.name,
        fileSize: file.size,
        invoice: existing as PurchaseInvoice,
      });
    }
    bytes = rawBytes;
    fileName = file.name;
    fileHash = createHash("sha256").update(file.name).update(bytes).digest("hex");
    if (!sourceFile) {
      try {
        sourceFile = await saveInvoiceSourceFile({
          invoiceId: invoiceRef.id,
          bytes,
          filename: file.name,
          mimeType,
          uploadedBy: auth.email,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Storage upload failed";
        const storageCode = /402|billing|payment/i.test(message) ? 402 : /403|denied/i.test(message) ? 403 : 502;
        logExtract({ requestId, event: "storage-failed", message, invoiceId: invoiceRef.id });
        await invoiceRef.set(
          {
            id: invoiceRef.id,
            supplierName: existing?.supplierName || "",
            invoiceNumber: existing?.invoiceNumber || "",
            invoiceDate: existing?.invoiceDate || "",
            receivedAt: new Date().toISOString().slice(0, 10),
            status: "draft",
            scanStatus: "failed",
            stockStatus: "none",
            lines: existing?.lines || [],
            fileName,
            fileHash,
            createdBy: auth.email,
            uploadedAt: new Date().toISOString(),
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            audit: FieldValue.arrayUnion({ at: new Date().toISOString(), actor: auth.email, action: "UPLOADED", detail: "STORAGE_FAILED" }),
          },
          { merge: true }
        );
        return fail("STORAGE_FAILED", {
          message,
          requestId,
          providerStatus: storageCode,
          providerError: message,
          fileType: mimeType,
          fileSize: file.size,
          invoice: { id: invoiceRef.id, fileName, fileHash, scanStatus: "failed" } as PurchaseInvoice,
        });
      }
    }
  } else if (existing?.sourceFile?.storagePath) {
    try {
      const stored = await readInvoiceSourceBytes(existing.sourceFile.storagePath);
      bytes = stored.bytes;
      mimeType = stored.mimeType;
    } catch {
      return fail("STORAGE_FAILED", { message: "Could not read the archived source file", requestId, invoice: existing });
    }
  } else {
    return fail("UNSUPPORTED_FILE", { message: "Invoice file is required", requestId });
  }

  const uploadedInvoice: Partial<PurchaseInvoice> = {
    id: invoiceRef.id,
    supplierName: existing?.supplierName || "",
    invoiceNumber: existing?.invoiceNumber || "",
    invoiceDate: existing?.invoiceDate || "",
    receivedAt: existing?.receivedAt || new Date().toISOString().slice(0, 10),
    status: existing?.status || "draft",
    scanStatus: "scanning",
    stockStatus: existing?.stockStatus || "none",
    lines: existing?.lines || [],
    sourceFile,
    fileName,
    fileUrl: sourceFile?.downloadUrl || existing?.fileUrl,
    fileHash,
    createdBy: existing?.createdBy || auth.email,
    uploadedAt: existing?.uploadedAt || new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await invoiceRef.set(
    {
      ...sanitizeFirestoreData(uploadedInvoice),
      audit: FieldValue.arrayUnion({
        at: new Date().toISOString(),
        actor: auth.email,
        action: existing ? "RESCANNED" : "UPLOADED",
        detail: sourceFile?.originalFilename,
      }),
    },
    { merge: true }
  );

  const scanKey = existingId || fileHash || invoiceRef.id;
  const existingInflight = isInflight(scanKey);
  if (existingInflight) {
    logExtract({ requestId, event: "inflight-blocked", scanKey, holder: existingInflight.requestId });
    return fail("PROVIDER_RATE_LIMIT", {
      message: "A scan is already running for this document.",
      requestId,
      retryAfterSeconds: 15,
      invoice: { ...uploadedInvoice, id: invoiceRef.id, scanStatus: "scanning" } as PurchaseInvoice,
    });
  }
  inflightScans.set(scanKey, { requestId, startedAt: Date.now() });

  if (!isGeminiConfigured()) {
    inflightScans.delete(scanKey);
    await invoiceRef.set({ scanStatus: "failed", updatedAt: new Date().toISOString() }, { merge: true });
    return fail("PROVIDER_NOT_CONFIGURED", {
      message: "Invoice scanning is not configured. The original file was saved.",
      requestId,
      invoice: { ...uploadedInvoice, scanStatus: "failed" } as PurchaseInvoice,
    });
  }

  logExtract({
    requestId,
    event: "started",
    fileType: mimeType,
    fileSize: bytes.length,
    invoiceId: invoiceRef.id,
    rescan: Boolean(existingId),
    fileSource: file instanceof File ? "upload" : "storage",
  });

  try {
    // Normalise phone-photo EXIF rotation and limit extreme resolutions
    // before handing off to Gemini. Any sharp failure falls back to the
    // raw buffer so we never block a scan on preparation issues.
    const prep = await prepareInvoiceImage({
      bytes,
      declaredMime: mimeType!,
      filename: fileName,
    });
    logExtract({
      requestId,
      event: "prepared",
      sniffedMime: prep.mimeType,
      declaredMime: mimeType,
      originalBytes: prep.originalBytes,
      preparedBytes: prep.bytes.length,
      rotated: prep.rotated,
      resized: prep.resized,
      reencoded: prep.reencoded,
      width: prep.width,
      height: prep.height,
    });
    const { extraction, rawText, model, httpStatus } = await extractInvoiceWithGemini({
      bytes: prep.bytes,
      mimeType: prep.mimeType,
      requestId,
    });
    const [ingredientsSnap, suppliersSnap, offersSnap, recordsSnap, mapsSnap, invoicesSnap] = await Promise.all([
      db.collection(COLLECTIONS.ingredients).limit(800).get(),
      db.collection(COLLECTIONS.suppliers).limit(400).get(),
      db.collection(COLLECTIONS.supplierOffers).limit(800).get(),
      db.collection(COLLECTIONS.purchasePriceRecords).limit(800).get(),
      db.collection(COLLECTIONS.supplierItemMaps).limit(800).get(),
      db.collection(COLLECTIONS.purchaseInvoices).limit(400).get(),
    ]);
    const invoice = buildReviewedInvoice({
      extraction,
      ingredients: ingredientsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as CostingIngredient),
      suppliers: suppliersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Supplier),
      offers: offersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SupplierOffer),
      records: recordsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PurchasePriceRecord),
      maps: mapsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SupplierItemMap),
      fileName,
      fileHash,
      fileUrl: sourceFile?.downloadUrl,
      actor: auth.email,
    });
    invoice.id = invoiceRef.id;
    invoice.sourceFile = sourceFile;
    invoice.aiModel = model;
    invoice.createdBy = auth.email;
    invoice.uploadedAt = uploadedInvoice.uploadedAt;
    const others = invoicesSnap.docs
      .filter((doc) => doc.id !== invoiceRef.id)
      .map((doc) => ({ id: doc.id, ...doc.data() }) as PurchaseInvoice);
    const existingHit = findExistingInvoice(others, invoice);
    if (existingHit && !existingId && isEditableInvoice(existingHit)) {
      const reused = mergeScannedInvoice(existingHit, { ...invoice, id: existingHit.id }, []);
      reused.id = existingHit.id;
      reused.sourceFile = sourceFile ?? existingHit.sourceFile;
      reused.duplicateOf = undefined;
      reused.duplicateSnapshot = undefined;
      invoiceRef = db.collection(COLLECTIONS.purchaseInvoices).doc(existingHit.id);
      existing = existingHit;
      Object.assign(invoice, reused);
      try {
        await db.collection(COLLECTIONS.purchaseInvoices).doc(uploadedInvoice.id as string).delete();
      } catch {
        /* stub leftover is harmless */
      }
    } else if (existingHit) {
      invoice.duplicateOf = existingHit.id;
      invoice.duplicateSnapshot = {
        id: existingHit.id,
        invoiceNumber: existingHit.invoiceNumber,
        supplierName: existingHit.supplierName,
        invoiceDate: existingHit.invoiceDate,
        status: existingHit.status,
        stockStatus: existingHit.stockStatus,
        posted: isPostedInvoice(existingHit),
      };
    }
    const attempt: InvoiceScanAttempt = {
      id: requestId,
      provider: "gemini",
      model,
      timestamp: new Date().toISOString(),
      status: "ok",
      requestId,
      rawExtraction: safeJson(rawText),
      normalizedExtraction: extraction,
      validationResult: invoice.validation,
    };
    invoice.scanAttempts = [...(existing?.scanAttempts ?? []), attempt].slice(-8);
    const persisted = await persistExtractedInvoice({
      invoiceRef,
      invoice,
      sourceFile,
      actor: auth.email,
      requestId,
    });
    logExtract({
      requestId,
      event: "provider-ok",
      provider: "gemini",
      model,
      providerStatus: httpStatus,
      duration: Date.now() - started,
      invoiceId: invoiceRef.id,
      documentNumber: extraction.invoiceNumber.value,
      lines: extraction.lines.length,
      subtotal: extraction.subtotal.value,
      vat: extraction.vatTotal.value,
      total: extraction.grandTotal.value,
      persisted,
    });
    return Response.json({
      ok: true,
      configured: true,
      provider: "gemini",
      model,
      reachable: true,
      requestId,
      persistWarning: persisted ? undefined : true,
      extraction,
      invoice,
    });
  } catch (error) {
    const attempt: InvoiceScanAttempt = {
      id: requestId,
      provider: "gemini",
      timestamp: new Date().toISOString(),
      status: "failed",
      requestId,
      code: error instanceof GeminiRequestError ? error.code : "SCAN_FAILED",
    };
    await invoiceRef.set(
      {
        scanStatus: "failed",
        scanAttempts: FieldValue.arrayUnion(attempt),
        updatedAt: new Date().toISOString(),
        audit: FieldValue.arrayUnion({ at: new Date().toISOString(), actor: auth.email, action: "SCANNED", detail: attempt.code }),
      },
      { merge: true }
    );
    if (error instanceof GeminiRequestError) {
      logExtract({
        requestId: error.requestId,
        event: "provider-error",
        provider: "gemini",
        model: error.model,
        providerStatus: error.providerStatus,
        providerError: error.providerError,
        code: error.code,
        duration: Date.now() - started,
        invoiceId: invoiceRef.id,
      });
      return fail(error.code, {
        message: "We could not scan the invoice. The original file was saved and you can try again.",
        requestId: error.requestId,
        providerStatus: error.providerStatus,
        providerError: error.providerError,
        model: error.model,
        fileType: mimeType,
        fileSize: bytes.length,
        retryAfterSeconds: error.retryAfterSeconds,
        invoice: {
          ...uploadedInvoice,
          ...existing,
          id: invoiceRef.id,
          sourceFile,
          fileName,
          fileHash,
          scanStatus: "failed",
        } as PurchaseInvoice,
      });
    }
    logExtract({
      requestId,
      event: "post-extract-error",
      duration: Date.now() - started,
      invoiceId: invoiceRef.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return fail("SCAN_FAILED", {
      message: "We could not scan the invoice. The original file was saved and you can try again.",
      requestId,
      fileType: mimeType,
      fileSize: bytes.length,
      invoice: {
        ...uploadedInvoice,
        ...existing,
        id: invoiceRef.id,
        sourceFile,
        fileName,
        fileHash,
        scanStatus: "failed",
      } as PurchaseInvoice,
    });
  } finally {
    inflightScans.delete(scanKey);
  }
}

async function persistExtractedInvoice(input: {
  invoiceRef: DocumentReference;
  invoice: PurchaseInvoice;
  sourceFile: PurchaseInvoice["sourceFile"];
  actor: string;
  requestId: string;
}): Promise<boolean> {
  const payload = sanitizeFirestoreData({
    ...input.invoice,
    sourceFile: input.sourceFile,
    scanAttempts: input.invoice.scanAttempts,
    updatedAt: new Date().toISOString(),
  });
  const leftover = findUndefinedPaths(payload);
  if (leftover.length) {
    logExtract({ requestId: input.requestId, event: "undefined-after-sanitize", leftover });
  }
  try {
    await input.invoiceRef.set(
      {
        ...payload,
        audit: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          actor: input.actor,
          action: "SCANNED",
          detail: input.requestId,
        }),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    logExtract({
      requestId: input.requestId,
      event: "persist-failed",
      invoiceId: input.invoice.id,
      message: error instanceof Error ? error.message : String(error),
    });
    try {
      const slim = sanitizeFirestoreData({
        ...input.invoice,
        sourceFile: input.sourceFile,
        scanAttempts: undefined,
        audit: undefined,
        lines: input.invoice.lines.map((line) => ({ ...line, candidates: undefined })),
        updatedAt: new Date().toISOString(),
      });
      await input.invoiceRef.set(slim, { merge: true });
      return true;
    } catch (retryError) {
      logExtract({
        requestId: input.requestId,
        event: "persist-retry-failed",
        invoiceId: input.invoice.id,
        message: retryError instanceof Error ? retryError.message : String(retryError),
      });
      return false;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
  } catch {
    return { raw: text.slice(0, 4000) };
  }
}
