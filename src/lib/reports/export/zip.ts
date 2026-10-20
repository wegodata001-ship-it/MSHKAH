import JSZip from "jszip";
import { buildReport, type ReportSource } from "@/lib/reports/export/documents";
import { renderReportPdf } from "@/lib/reports/export/pdf";
import { reportFilename } from "@/lib/reports/export/safe";
import type { ReportDocument, ReportKind } from "@/lib/reports/export/types";
import { renderReportWorkbook } from "@/lib/reports/export/xlsx";

const FOLDERS: { kind: ReportKind; folder: string }[] = [
  { kind: "invoices", folder: "01-Invoices" },
  { kind: "suppliers", folder: "02-Suppliers" },
  { kind: "compare", folder: "02-Suppliers" },
  { kind: "prices", folder: "02-Suppliers" },
  { kind: "inventory", folder: "03-Inventory" },
  { kind: "alerts", folder: "03-Inventory" },
  { kind: "movements", folder: "04-Stock-Movements" },
  { kind: "dishes", folder: "05-Menu-Costing" },
  { kind: "breakeven", folder: "06-Break-Even" },
  { kind: "cashflow", folder: "07-Cashflow" },
  { kind: "z", folder: "08-Z-Reports" },
];

export async function renderReportZip(source: ReportSource, period: string): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder("MISHKAT-REPORTS");
  if (!root) throw new Error("ZIP_FAILED");
  for (const item of FOLDERS) {
    const folder = root.folder(item.folder);
    if (!folder) continue;
    try {
      const document = buildReport(item.kind, source, source.invoices, period);
      const pdf = await renderReportPdf(document);
      const xlsx = await renderReportWorkbook(document);
      folder.file(reportFilename({ kind: item.kind, ext: "pdf" }), pdf);
      folder.file(reportFilename({ kind: item.kind, ext: "xlsx" }), xlsx);
    } catch (error) {
      folder.file("EXPORT-ERROR.txt", error instanceof Error ? error.message : "EXPORT_FAILED");
    }
  }
  return zip.generateAsync({ type: "uint8array" });
}

export async function renderDocument(document: ReportDocument, format: "pdf" | "xlsx"): Promise<Uint8Array> {
  return format === "pdf" ? renderReportPdf(document) : renderReportWorkbook(document);
}
