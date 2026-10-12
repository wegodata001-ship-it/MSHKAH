import { createHash, randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import {
  GeminiRequestError,
  httpStatusForAiCode,
  isGeminiConfigured,
  type InvoiceAiCode,
} from "@/lib/ai/gemini-config";
import { extractInvoiceWithGemini } from "@/lib/ai/gemini-invoice";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { publicScanErrorCode } from "@/lib/inventory/invoice-archive";
import { readInvoiceSourceBytes, saveInvoiceSourceFile } from "@/lib/inventory/invoice-source-store";
import { buildReviewedInvoice, findDuplicateInvoice } from "@/lib/inventory/invoice-smart-match";
import type { CostingIngredient } from "@/lib/costing/types";
import type { InvoiceScanAttempt, PurchaseInvoice, PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";

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
  }
) {
  const errorCode = publicScanErrorCode(code, extra.providerStatus);
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
      invoice: extra.invoice ?? undefined,
    },
    { status: httpStatusForAiCode(code, extra.providerStatus) }
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
    mimeType = mimeFor(file);
    if (!mimeType) {
      return fail("UNSUPPORTED_FILE", {
        message: "Invoice file type is not supported",
        requestId,
        fileType: file.type || file.name,
        fileSize: file.size,
        invoice: existing as PurchaseInvoice,
      });
    }
    bytes = Buffer.from(await file.arrayBuffer());
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
      ...uploadedInvoice,
      audit: FieldValue.arrayUnion({
        at: new Date().toISOString(),
        actor: auth.email,
        action: existing ? "RESCANNED" : "UPLOADED",
        detail: sourceFile?.originalFilename,
      }),
    },
    { merge: true }
  );

  if (!isGeminiConfigured()) {
    await invoiceRef.set({ scanStatus: "failed", updatedAt: new Date().toISOString() }, { merge: true });
    return fail("PROVIDER_NOT_CONFIGURED", {
      message: "Invoice scanning is not configured. The original file was saved.",
      requestId,
      invoice: { ...uploadedInvoice, scanStatus: "failed" } as PurchaseInvoice,
    });
  }

  logExtract({ requestId, event: "started", fileType: mimeType, fileSize: bytes.length, invoiceId: invoiceRef.id, rescan: Boolean(existingId) });

  try {
    const { extraction, rawText, model, httpStatus } = await extractInvoiceWithGemini({
      bytes,
      mimeType: mimeType!,
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
    invoice.duplicateOf = findDuplicateInvoice(
      invoicesSnap.docs
        .filter((doc) => doc.id !== invoiceRef.id)
        .map((doc) => ({ id: doc.id, ...doc.data() }) as PurchaseInvoice),
      invoice
    );
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
    await invoiceRef.set(
      {
        ...invoice,
        sourceFile,
        scanAttempts: invoice.scanAttempts,
        updatedAt: new Date().toISOString(),
        audit: FieldValue.arrayUnion({ at: new Date().toISOString(), actor: auth.email, action: "SCANNED", detail: requestId }),
      },
      { merge: true }
    );
    logExtract({
      requestId,
      event: "provider-ok",
      provider: "gemini",
      model,
      providerStatus: httpStatus,
      duration: Date.now() - started,
      invoiceId: invoiceRef.id,
    });
    return Response.json({
      ok: true,
      configured: true,
      provider: "gemini",
      model,
      reachable: true,
      requestId,
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
        invoice: { ...uploadedInvoice, id: invoiceRef.id, scanStatus: "failed" } as PurchaseInvoice,
      });
    }
    logExtract({ requestId, event: "post-extract-error", duration: Date.now() - started, invoiceId: invoiceRef.id });
    return fail("SCAN_FAILED", {
      message: "We could not scan the invoice. The original file was saved and you can try again.",
      requestId,
      fileType: mimeType,
      fileSize: bytes.length,
      invoice: { ...uploadedInvoice, id: invoiceRef.id, scanStatus: "failed" } as PurchaseInvoice,
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
  } catch {
    return { raw: text.slice(0, 4000) };
  }
}
