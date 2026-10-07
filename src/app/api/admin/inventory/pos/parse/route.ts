import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { parsePosBuffer, validatePosFile } from "@/lib/inventory/pos-parse";
import { posDelta, posPeriod } from "@/lib/inventory/pos";
import type { PosImport, PosProductMap } from "@/lib/inventory/types";
import type { Product } from "@/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file-required" }, { status: 400 });
  }
  const invalid = validatePosFile(file.name, file.size, file.type);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const db = getAdminDb();
  const [productsSnap, mapsSnap] = await Promise.all([
    db.collection(COLLECTIONS.products).limit(800).get(),
    db.collection(COLLECTIONS.posProductMaps).limit(800).get(),
  ]);
  const products = productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Product);
  const maps = mapsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PosProductMap);
  const { lines, fileHash } = await parsePosBuffer(bytes, file.name, products, maps);
  const period = posPeriod(lines, file.name);

  const hashSnap = await db.collection(COLLECTIONS.posImports).where("fileHash", "==", fileHash).limit(1).get();
  if (!hashSnap.empty) {
    return Response.json({
      duplicate: true,
      fileHash,
      fileName: file.name,
      period,
      message: "duplicate-file",
    });
  }

  const periodSnap = await db
    .collection(COLLECTIONS.posImports)
    .where("period", "==", period)
    .where("status", "==", "approved")
    .limit(5)
    .get();
  const previous = periodSnap.docs[0]
    ? ({ id: periodSnap.docs[0].id, ...periodSnap.docs[0].data() } as PosImport)
    : null;

  return Response.json({
    duplicate: false,
    fileHash,
    fileName: file.name,
    period,
    lines,
    previousImportId: previous?.id,
    delta: previous ? posDelta(previous.lines ?? [], lines) : null,
  });
}
