import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { roundMoney } from "@/lib/costing/money";
import type { PurchaseUnit } from "@/lib/costing/types";
import { splitVat } from "@/lib/inventory/vat";
import type { VatType } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    productId?: string;
    unitPrice?: number;
    basis?: "including" | "excluding" | "exempt";
    vatRate?: number;
    supplierId?: string;
    purchaseUnit?: PurchaseUnit;
    reason?: string;
    invoiceId?: string;
    updatePurchaseRecord?: boolean;
  } | null;
  const productId = String(body?.productId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const unitPrice = Number(body?.unitPrice);
  const basis = body?.basis ?? "excluding";
  if (!productId || !reason || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }
  const db = getAdminDb();
  const product = await db.collection(COLLECTIONS.ingredients).doc(productId).get();
  if (!product.exists) return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
  const vatType: VatType = basis === "including" ? "inclusive" : basis === "exempt" ? "exempt" : "exclusive";
  const vat = splitVat({ amount: unitPrice, vatType, vatRate: body?.vatRate ?? 0.18 });
  const now = new Date().toISOString();
  const correction = {
    unitPriceExcludingVat: vat.priceBeforeVat,
    unitPriceIncludingVat: vat.priceIncludingVat,
    basis,
    supplierId: body?.supplierId?.trim() || null,
    reason,
    at: now,
    actor: auth.email,
    invoiceId: body?.invoiceId?.trim() || null,
  };
  const before = {
    purchaseUnit: product.get("purchaseUnit") ?? null,
    lastSupplierId: product.get("lastSupplierId") ?? null,
    adminPriceCorrection: product.get("adminPriceCorrection") ?? null,
  };
  await db.collection(COLLECTIONS.ingredients).doc(productId).set(sanitizeFirestoreData({
    adminPriceCorrection: correction,
    ...(body?.supplierId ? { lastSupplierId: body.supplierId.trim() } : {}),
    ...(body?.purchaseUnit ? { purchaseUnit: body.purchaseUnit } : {}),
    updatedAt: now,
  }), { merge: true });
  await db.collection(COLLECTIONS.invoiceAuditLog).add(sanitizeFirestoreData({
    action: "admin-price-correction",
    actor: auth.email,
    at: now,
    productId,
    before,
    after: correction,
    reason,
    unitPrice: roundMoney(unitPrice),
  }));
  return Response.json({ ok: true, correction, invoiceUnchanged: true });
}
