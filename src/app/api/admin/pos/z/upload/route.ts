import { createHash, randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { savePosZSourceFile } from "@/lib/inventory/invoice-source-store";
import { findDuplicateZReport } from "@/lib/inventory/pos-z";
import type { PosZReport } from "@/lib/inventory/types";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 60;

const inflightHashes = new Set<string>();

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
  const requestId = randomUUID();
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  const attachToId = String(form.get("attachToId") || "").trim();
  if (!files.length) return Response.json({ ok: false, error: "file-required", requestId }, { status: 400 });

  const db = getAdminDb();
  const existingSnap = await db.collection(COLLECTIONS.posZReports).limit(400).get();
  const existing = existingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PosZReport);

  const reports: PosZReport[] = [];
  for (const file of files) {
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: "file-size", requestId }, { status: 400 });
    }
    const mimeType = mimeFor(file);
    if (!mimeType) return Response.json({ ok: false, error: "file-type", requestId }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const byHash = existing.find((item) => item.fileHash && item.fileHash === fileHash);
    if (byHash && !attachToId) {
      return Response.json({
        ok: true,
        duplicate: true,
        existingId: byHash.id,
        existingStatus: byHash.status,
        requestId,
      });
    }
    if (!attachToId && inflightHashes.has(fileHash)) {
      return Response.json({ ok: false, error: "UPLOAD_IN_PROGRESS", requestId }, { status: 409 });
    }
    if (!attachToId) inflightHashes.add(fileHash);

    try {
    const ref = attachToId
      ? db.collection(COLLECTIONS.posZReports).doc(attachToId)
      : db.collection(COLLECTIONS.posZReports).doc(`zup-${fileHash.slice(0, 40)}`);
    const current = ((await ref.get()).data() as PosZReport | undefined) ?? undefined;
    if (current?.status === "posted") {
      return Response.json({ ok: false, error: "already-posted", requestId, existingId: ref.id }, { status: 409 });
    }
    if (current?.fileHash === fileHash && (current.sourceFiles?.length ?? 0) > 0 && !attachToId) {
      reports.push({ ...current, id: ref.id });
      continue;
    }

    const probe: PosZReport = {
      id: ref.id,
      status: current?.status ?? "draft",
      fileHash: current?.fileHash || fileHash,
      createdAt: current?.createdAt || new Date().toISOString(),
    };
    const duplicate = findDuplicateZReport(existing, probe);
    if (duplicate && !attachToId) {
      return Response.json({
        ok: true,
        duplicate: true,
        existingId: duplicate.id,
        existingStatus: duplicate.status,
        requestId,
      });
    }

    const sourceFile = await savePosZSourceFile({
      reportId: ref.id,
      bytes,
      filename: file.name,
      mimeType,
      uploadedBy: auth.uid,
    });

    const draft: PosZReport = {
      id: ref.id,
      status: "draft",
      scanStatus: current?.scanStatus && current.scanStatus !== "failed" ? current.scanStatus : "uploaded",
      lastScanError: current?.lastScanError ?? null,
      financeEntryId: current?.financeEntryId ?? null,
      sourceFiles: [...(current?.sourceFiles ?? []), sourceFile],
      fileHash: current?.fileHash || fileHash,
      reportNumber: current?.reportNumber ?? null,
      registerId: current?.registerId ?? null,
      payments: current?.payments ?? [],
      extraAmounts: current?.extraAmounts ?? [],
      fields: current?.fields ?? [],
      checks: current?.checks ?? [],
      duplicateOf: duplicate?.id ?? null,
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await ref.set(
      sanitizeFirestoreData({
        ...draft,
        createdAt: current ? current.createdAt : FieldValue.serverTimestamp(),
      }),
      { merge: true }
    );
    reports.push(draft);
    existing.push(draft);
    } finally {
      if (!attachToId) inflightHashes.delete(fileHash);
    }
  }

  return Response.json({ ok: true, reports, requestId });
}
