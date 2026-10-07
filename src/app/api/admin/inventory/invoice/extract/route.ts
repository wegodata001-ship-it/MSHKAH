import { createHash, randomUUID } from "crypto";
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
import { buildReviewedInvoice, findDuplicateInvoice } from "@/lib/inventory/invoice-smart-match";
import type { CostingIngredient } from "@/lib/costing/types";
import type { PurchaseInvoice, PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  }
) {
  return Response.json(
    {
      ok: false,
      configured: code !== "AI_NOT_CONFIGURED",
      reachable: false,
      code,
      message: extra.message,
      requestId: extra.requestId,
      provider: "gemini",
      model: extra.model ?? null,
      providerStatus: extra.providerStatus ?? null,
      providerError: extra.providerError ?? null,
      error: code,
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
  if (!isGeminiConfigured()) {
    logExtract({ requestId, event: "not-configured", provider: "gemini" });
    return fail("AI_NOT_CONFIGURED", {
      message: "Invoice scanning is not configured",
      requestId,
    });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("INVALID_FILE", { message: "Invoice file is required", requestId });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return fail("INVALID_FILE", {
      message: "Invoice file size is not supported",
      requestId,
      fileSize: file.size,
    });
  }
  const mimeType = mimeFor(file);
  if (!mimeType) {
    return fail("INVALID_FILE", {
      message: "Invoice file type is not supported",
      requestId,
      fileType: file.type || file.name,
      fileSize: file.size,
    });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(file.name).update(bytes).digest("hex");
  logExtract({
    requestId,
    event: "started",
    fileType: mimeType,
    fileSize: file.size,
    provider: "gemini",
  });

  try {
    const { extraction, model, httpStatus } = await extractInvoiceWithGemini({
      bytes,
      mimeType,
      requestId,
    });
    logExtract({
      requestId,
      event: "provider-ok",
      provider: "gemini",
      model,
      providerStatus: httpStatus,
      duration: Date.now() - started,
    });
    const db = getAdminDb();
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
      fileName: file.name,
      fileHash,
      actor: auth.email,
    });
    invoice.aiModel = model;
    invoice.duplicateOf = findDuplicateInvoice(
      invoicesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PurchaseInvoice),
      invoice
    );
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
      });
      return fail(error.code, {
        message: error.message,
        requestId: error.requestId,
        providerStatus: error.providerStatus,
        providerError: error.providerError,
        model: error.model,
        fileType: mimeType,
        fileSize: file.size,
      });
    }
    logExtract({
      requestId,
      event: "post-extract-error",
      duration: Date.now() - started,
    });
    return fail("EXTRACTION_FAILED", {
      message: "Invoice scanning failed after the AI response",
      requestId,
      fileType: mimeType,
      fileSize: file.size,
    });
  }
}
