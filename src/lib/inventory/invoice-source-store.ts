import { randomUUID } from "crypto";
import { getAdminBucket } from "@/lib/firebase/admin";
import { invoiceSourcePath, sourceKindFromFile } from "@/lib/inventory/invoice-archive";
import type { InvoiceSourceFile } from "@/lib/inventory/types";

export async function saveInvoiceSourceFile(input: {
  invoiceId: string;
  bytes: Buffer;
  filename: string;
  mimeType: string;
  uploadedBy?: string;
}): Promise<InvoiceSourceFile> {
  const path = invoiceSourcePath(input.invoiceId, input.filename);
  const token = randomUUID();
  const bucket = getAdminBucket();
  const file = bucket.file(path);
  await file.save(input.bytes, {
    contentType: input.mimeType,
    resumable: false,
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
        originalFilename: input.filename,
      },
    },
  });
  const bucketName = bucket.name;
  return {
    storagePath: path,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
    originalFilename: input.filename,
    mimeType: input.mimeType,
    size: input.bytes.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    kind: sourceKindFromFile({ name: input.filename, type: input.mimeType }),
  };
}

export function posZSourcePath(reportId: string, filename: string, at = new Date()): string {
  const ext = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() || "bin" : "bin";
  const safeExt = ["pdf", "jpg", "jpeg", "png"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "bin";
  const stamp = `${at.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  return `pos-z-reports/${at.getFullYear()}/${String(at.getMonth() + 1).padStart(2, "0")}/${reportId}/${stamp}.${safeExt}`;
}

export async function savePosZSourceFile(input: {
  reportId: string;
  bytes: Buffer;
  filename: string;
  mimeType: string;
  uploadedBy?: string;
}): Promise<InvoiceSourceFile> {
  const path = posZSourcePath(input.reportId, input.filename);
  const token = randomUUID();
  const bucket = getAdminBucket();
  const file = bucket.file(path);
  await file.save(input.bytes, {
    contentType: input.mimeType,
    resumable: false,
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
        originalFilename: input.filename,
      },
    },
  });
  return {
    storagePath: path,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
    originalFilename: input.filename,
    mimeType: input.mimeType,
    size: input.bytes.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    kind: sourceKindFromFile({ name: input.filename, type: input.mimeType }),
  };
}

export async function readInvoiceSourceBytes(storagePath: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const file = getAdminBucket().file(storagePath);
  const [bytes] = await file.download();
  const [meta] = await file.getMetadata();
  return { bytes, mimeType: String(meta.contentType || "application/octet-stream") };
}
