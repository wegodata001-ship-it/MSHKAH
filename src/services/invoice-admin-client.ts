import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import type { RemovalSummary } from "@/lib/inventory/invoice-removal";
import type { InventoryMovement, PurchaseInvoice } from "@/lib/inventory/types";

export type InvoiceBundle = {
  invoice: PurchaseInvoice;
  movements: InventoryMovement[];
  paidAmount: number;
  paymentsIncluded: true;
  productNames: Record<string, string>;
};

type MovementRow = { id: string; data: Record<string, unknown> };

export async function fetchArchivedInvoices(): Promise<PurchaseInvoice[]> {
  const result = await clientAdminFetch<{ invoices: PurchaseInvoice[] }>("/api/admin/inventory/invoice/document", { listArchive: true });
  if (!result.ok || !result.data?.invoices) return [];
  return result.data.invoices;
}

export async function fetchInvoiceBundle(invoiceId: string): Promise<InvoiceBundle | null> {
  const result = await clientAdminFetch<{ invoice: PurchaseInvoice; movements: MovementRow[]; paidAmount: number; paymentsIncluded: true; productNames: Record<string, string> }>(
    "/api/admin/inventory/invoice/document",
    { invoiceId }
  );
  if (!result.ok || !result.data?.invoice) return null;
  return {
    invoice: result.data.invoice,
    movements: (result.data.movements ?? []).map(mapMovement),
    paidAmount: Number(result.data.paidAmount) || 0,
    paymentsIncluded: true,
    productNames: result.data.productNames ?? {},
  };
}

export async function fetchInvoiceSource(invoiceId: string): Promise<{ mimeType: string; filename?: string; bytes: Uint8Array } | null> {
  const result = await clientAdminFetch<{ available?: boolean; mimeType?: string; filename?: string; base64?: string }>(
    "/api/admin/inventory/invoice/source",
    { invoiceId }
  );
  if (!result.ok || !result.data?.available || !result.data.base64) return null;
  const binary = atob(result.data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mimeType: result.data.mimeType || "application/octet-stream", filename: result.data.filename, bytes };
}

export async function previewInvoiceRemoval(scope: "active" | "archive", ids?: string[]) {
  return clientAdminFetch<RemovalSummary & { ids: string[] }>("/api/admin/inventory/invoice/removal-preview", { scope, ids });
}

export async function archiveInvoices(ids: string[]) {
  return clientAdminFetch<{ archived: string[]; missing: string[] }>("/api/admin/inventory/invoice/archive", { ids, reason: "admin-archive" });
}

export async function purgeInvoices(ids: string[], phrase: string) {
  return clientAdminFetch<{ deleted: string[]; backupId: string }>("/api/admin/inventory/invoice/purge", { ids, phrase });
}

export async function saveInvoicePdfCopy(invoiceId: string, blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return clientAdminFetch<{ version: number; storagePath: string }>("/api/admin/inventory/invoice/pdf-copy", {
    invoiceId,
    pdfBase64: btoa(binary),
  });
}

function mapMovement(row: MovementRow): InventoryMovement {
  const data = row.data ?? {};
  return {
    id: row.id,
    productId: String(data.productId ?? ""),
    type: (data.type as InventoryMovement["type"]) || "PURCHASE_IN",
    quantity: Number(data.quantity) || 0,
    unit: (data.unit as InventoryMovement["unit"]) || "unit",
    quantityBase: Number(data.quantityBase) || 0,
    supplierId: data.supplierId ? String(data.supplierId) : undefined,
    invoiceId: data.invoiceId ? String(data.invoiceId) : undefined,
    invoiceLineId: data.invoiceLineId ? String(data.invoiceLineId) : undefined,
    invoiceLineKey: data.invoiceLineKey ? String(data.invoiceLineKey) : undefined,
    receivedAt: data.receivedAt ? String(data.receivedAt) : "",
    createdAt: data.createdAt ? String(data.createdAt) : "",
  };
}
