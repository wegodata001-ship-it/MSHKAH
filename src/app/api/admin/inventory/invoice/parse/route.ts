import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { extractPurchaseInvoice } from "@/lib/inventory/invoice-ai";
import { draftInvoiceLines, emptyInvoiceDraft } from "@/lib/inventory/invoice-match";
import { DEFAULT_VAT_RATE } from "@/lib/inventory/vat";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";

export const runtime = "nodejs";

const ALLOWED = /\.(jpe?g|png|pdf)$/i;

function mapIngredient(id: string, data: FirebaseFirestore.DocumentData): CostingIngredient {
  return {
    id,
    name: String(data.name ?? ""),
    category: data.category ? String(data.category) : undefined,
    purchasePrice: Number(data.purchasePrice ?? 0),
    purchaseQuantity: Number(data.purchaseQuantity ?? 1),
    purchaseUnit: (data.purchaseUnit as PurchaseUnit) || "kg",
    baseUnit: (data.baseUnit as CostingIngredient["baseUnit"]) || "g",
    costPerBaseUnit: Number(data.costPerBaseUnit ?? 0),
    supplier: data.supplier ? String(data.supplier) : undefined,
    active: data.active !== false,
    createdAt: "",
    updatedAt: "",
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file-required" }, { status: 400 });
  }
  if (!ALLOWED.test(file.name) || file.size <= 0 || file.size > 8 * 1024 * 1024) {
    return Response.json({ error: "file-type" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const { extracted, provider } = await extractPurchaseInvoice(buffer, mime);

  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.ingredients).limit(800).get();
  const products = snap.docs.map((doc) => mapIngredient(doc.id, doc.data()));
  const settings = await db.collection(COLLECTIONS.costingSettings).doc("default").get();
  const vatRate = Number(settings.data()?.vatRate ?? DEFAULT_VAT_RATE);

  const draft = emptyInvoiceDraft(file.name);
  return Response.json({
    provider,
    draft: {
      ...draft,
      supplierName: extracted.supplierName || "",
      invoiceNumber: extracted.invoiceNumber || "",
      invoiceDate: extracted.invoiceDate || draft.invoiceDate,
      lines: draftInvoiceLines(extracted.lines, products, vatRate),
    },
  });
}
