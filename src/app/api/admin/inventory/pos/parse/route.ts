import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { canConfirmExcelImport } from "@/lib/inventory/pos-excel";
import { parsePosBuffer, validatePosFile, type PosColumnMap, type PosExcelField } from "@/lib/inventory/pos-parse";
import { mapProduct } from "@/lib/mappers";
import type { PosColumnTemplate, PosImport, PosProductMap } from "@/lib/inventory/types";
import type { FirestoreDoc, FirestoreProduct } from "@/types/firestore";

export const runtime = "nodejs";

function parseColumnMap(raw: FormDataEntryValue | null): PosColumnMap | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const map: PosColumnMap = {};
    for (const [field, index] of Object.entries(parsed)) {
      if (typeof index === "number" && Number.isFinite(index)) map[field as PosExcelField] = index;
    }
    return map;
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  try {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "file-required" }, { status: 400 });
  }
  const invalid = validatePosFile(file.name, file.size, file.type);
  if (invalid) return Response.json({ ok: false, error: invalid }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const db = getAdminDb();
  const [productsSnap, mapsSnap, templatesSnap] = await Promise.all([
    db.collection(COLLECTIONS.products).limit(800).get(),
    db.collection(COLLECTIONS.posProductMaps).limit(800).get(),
    db.collection(COLLECTIONS.posColumnMaps).limit(50).get(),
  ]);
  const products = productsSnap.docs.map((doc) =>
    mapProduct({ id: doc.id, ...doc.data() } as FirestoreDoc<FirestoreProduct>)
  );
  const maps = mapsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PosProductMap);
  const templates = templatesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PosColumnTemplate);
  const headerRow = Number(form.get("headerRow"));
  const requestedMap = parseColumnMap(form.get("columnMap"));
  let parsed = await parsePosBuffer(bytes, file.name, products, maps, {
    sheetName: String(form.get("sheetName") || "") || undefined,
    headerRow: Number.isFinite(headerRow) && headerRow > 0 ? headerRow : undefined,
    columnMap: requestedMap,
  });
  const template = templates.find(
    (item) =>
      item.headers?.length === parsed.rawHeaders.length &&
      item.headers.every((header, index) => header === parsed.rawHeaders[index])
  );
  if (parsed.needsMapping && !requestedMap && template?.columnMap) {
    parsed = await parsePosBuffer(bytes, file.name, products, maps, {
      sheetName: template.sheetName || parsed.selectedSheet || undefined,
      headerRow: template.headerRow || parsed.headerRow || undefined,
      columnMap: template.columnMap as PosColumnMap,
    });
  }
  const confirm = canConfirmExcelImport({ lineCount: parsed.lines.length });

  const hashSnap = await db.collection(COLLECTIONS.posImports).where("fileHash", "==", parsed.fileHash).limit(1).get();
  const existing = hashSnap.empty ? null : ({ id: hashSnap.docs[0].id, ...hashSnap.docs[0].data() } as PosImport);
  const existingEmpty = Boolean(existing && !(existing.lines?.length));

  return Response.json({
    ok: true,
    duplicate: Boolean(existing && !existingEmpty),
    existingId: existing?.id,
    fileHash: parsed.fileHash,
    fileName: file.name,
    period: parsed.period.period,
    periodFrom: parsed.period.periodFrom,
    periodTo: parsed.period.periodTo,
    sourcePeriodFrom: parsed.period.periodFrom,
    sourcePeriodTo: parsed.period.periodTo,
    reportGeneratedAt: parsed.period.reportGeneratedAt,
    periodNeedsReview: parsed.period.periodNeedsReview,
    uploadedAt: new Date().toISOString(),
    lines: parsed.lines.length ? parsed.lines : existing?.lines?.length ? existing.lines : parsed.lines,
    summary: parsed.summary,
    sourceTotals: parsed.sourceTotals,
    gaps: parsed.gaps,
    sheets: parsed.sheets,
    selectedSheet: parsed.selectedSheet,
    headerRow: parsed.headerRow,
    headerDetected: parsed.headerDetected,
    rawHeaders: parsed.rawHeaders,
    rawPreview: parsed.rawPreview,
    columnMap: parsed.columnMap,
    needsMapping: parsed.needsMapping,
    templateId: template?.id,
    canApprove: confirm.ok,
    empty: parsed.lines.length === 0,
    infoOnly: true,
    financeStatus: "none",
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : "parse-failed";
    return Response.json({ ok: false, error: "parse-failed", message }, { status: 500 });
  }
}
