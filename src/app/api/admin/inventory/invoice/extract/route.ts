import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { isGeminiConfigured } from "@/lib/ai/gemini-config";
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

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  if (!isGeminiConfigured()) {
    return Response.json({ configured: false, error: "ai-not-configured" }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file-required" }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) return Response.json({ error: "file-size" }, { status: 400 });
  const mimeType = mimeFor(file);
  if (!mimeType) return Response.json({ error: "unsupported-type" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(file.name).update(bytes).digest("hex");

  try {
    const { extraction, model } = await extractInvoiceWithGemini({ bytes, mimeType });
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
      configured: true,
      provider: "gemini",
      model,
      reachable: true,
      extraction,
      invoice,
    });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("ai-") ? error.message : "ai-unavailable";
    return Response.json({ configured: true, reachable: false, error: code, fileName: file.name, fileHash }, { status: 502 });
  }
}
