import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { persistCompareGroup, persistComparePack, persistComparePurchaseBasis } from "@/lib/inventory/compare-group-admin-write";
import type { PurchaseUnit } from "@/lib/costing/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "save-group";
        groupId?: string;
        name?: string;
        memberIds?: string[];
      }
    | {
        action: "save-pack";
        productId?: string;
        supplierId?: string;
        packageQuantity?: number;
        purchaseUnit?: PurchaseUnit;
      }
    | {
        action: "complete-basis";
        productId?: string;
        supplierId?: string;
        price?: number;
        packageQuantity?: number;
        purchaseUnit?: PurchaseUnit;
        vatMode?: "net" | "gross";
      }
    | null;
  if (!body?.action && !body?.name) {
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  }
  try {
    const db = getAdminDb();
    if (body.action === "save-pack") {
      await persistComparePack(db, {
        productId: String(body.productId ?? ""),
        supplierId: String(body.supplierId ?? ""),
        packageQuantity: Number(body.packageQuantity),
        purchaseUnit: body.purchaseUnit as PurchaseUnit,
      });
      return Response.json({ ok: true });
    }
    if (body.action === "complete-basis") {
      await persistComparePurchaseBasis(db, {
        productId: String(body.productId ?? ""),
        supplierId: String(body.supplierId ?? ""),
        price: Number(body.price),
        packageQuantity: Number(body.packageQuantity),
        purchaseUnit: body.purchaseUnit as PurchaseUnit,
        vatMode: body.vatMode === "gross" ? "gross" : "net",
      });
      return Response.json({ ok: true });
    }
    const saved = await persistCompareGroup(db, {
      groupId: body.groupId,
      name: String(body.name ?? ""),
      memberIds: Array.isArray(body.memberIds) ? body.memberIds.map(String) : [],
    });
    return Response.json({ ok: true, id: saved.id, name: saved.name, memberIds: saved.memberIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SAVE_FAILED";
    const code = message === "VALIDATION" || message === "SAVE_INCOMPLETE" ? message : "SAVE_FAILED";
    return Response.json({ error: code, code }, { status: code === "VALIDATION" ? 400 : 500 });
  }
}
