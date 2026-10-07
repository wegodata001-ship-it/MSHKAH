import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { buildCostingTemplate, costingWorkbookFilename } from "@/lib/costing/import/workbook";
import { mapProduct } from "@/lib/mappers";
import type { Locale } from "@/lib/i18n/types";
import type { Product } from "@/types";
import type { FirestoreProduct } from "@/types/firestore";

export const runtime = "nodejs";

function asLocale(value: string | null): Locale {
  return value === "he" || value === "en" || value === "ar" ? value : "ar";
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const kind = request.nextUrl.searchParams.get("kind") === "menu" ? "menu" : "blank";
  const locale = asLocale(request.nextUrl.searchParams.get("locale"));
  let products: Product[] = [];
  if (kind === "menu") {
    const snap = await getAdminDb().collection(COLLECTIONS.products).get();
    products = snap.docs.map((doc) =>
      mapProduct({ id: doc.id, ...(doc.data() as FirestoreProduct) })
    );
  }
  const bytes = await buildCostingTemplate(kind, products, locale);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${costingWorkbookFilename(kind)}"`,
      "Cache-Control": "no-store",
    },
  });
}
