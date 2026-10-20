import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { readInvoiceSourceBytes } from "@/lib/inventory/invoice-source-store";
import { buildReport, filterInvoices } from "@/lib/reports/export/documents";
import { loadReportSource } from "@/lib/reports/export/load";
import { appendInvoiceSource } from "@/lib/reports/export/pdf";
import { reportFilename } from "@/lib/reports/export/safe";
import type { ExportFilters, ExportRequest, ReportKind } from "@/lib/reports/export/types";
import { renderDocument, renderReportZip } from "@/lib/reports/export/zip";

export const runtime = "nodejs";

const KINDS = new Set<ReportKind>(["invoices", "invoice", "suppliers", "inventory", "movements", "alerts", "dishes", "breakeven", "cashflow", "z", "compare", "prices", "zip"]);

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as ExportRequest | null;
  if (!body || !KINDS.has(body.kind) || !["pdf", "xlsx", "zip"].includes(body.format)) {
    return Response.json({ error: "EXPORT_INVALID", code: "EXPORT_INVALID" }, { status: 400 });
  }
  try {
    const source = await loadReportSource(getAdminDb());
    const period = periodOf(body.filters);
    if (body.format === "zip" || body.kind === "zip") {
      const bytes = await renderReportZip(source, period);
      return fileResponse(bytes, reportFilename({ kind: "zip", ext: "zip" }), "application/zip");
    }
    const filters = body.scope === "all" ? undefined : body.filters;
    const ids = body.scope === "filtered" ? body.ids : undefined;
    const invoices = filterInvoices(source.invoices, filters, ids);
    if ((body.kind === "invoice" || body.kind === "invoices") && body.ids?.length && !invoices.length) {
      return Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    }
    const document = buildReport(body.kind === "invoice" ? "invoice" : body.kind, source, invoices, period);
    let bytes = await renderDocument(document, body.format);
    const sampleSource = invoices.length === 1 ? invoices[0]?.sourceFile : null;
    if (body.format === "pdf" && sampleSource?.storagePath && !sampleSource.storagePath.includes("..")) {
      try {
        const file = await readInvoiceSourceBytes(sampleSource.storagePath);
        if (file.bytes.length <= 12_000_000) bytes = await appendInvoiceSource(bytes, file.bytes, file.mimeType || sampleSource.mimeType || "");
      } catch {
        // The report stays valid when the private source file cannot be read.
      }
    }
    const sample = invoices[0];
    const filename = reportFilename({
      kind: body.kind === "invoice" ? "invoice" : body.kind,
      ext: body.format,
      supplier: sample?.supplierName,
      number: sample?.invoiceNumber,
    });
    const type = body.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return fileResponse(bytes, filename, type);
  } catch (error) {
    const message = error instanceof Error ? error.message : "EXPORT_FAILED";
    return Response.json({ error: message, code: "EXPORT_FAILED" }, { status: 500 });
  }
}

function periodOf(filters?: ExportFilters): string {
  if (filters?.from || filters?.to) return `${filters.from || "…"}–${filters.to || "…"}`;
  return new Date().toISOString().slice(0, 7);
}

function fileResponse(bytes: Uint8Array, filename: string, type: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
