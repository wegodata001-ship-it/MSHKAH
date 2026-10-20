import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument, PDFName } from "pdf-lib";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildReport, filterInvoices } from "@/lib/reports/export/documents";
import { loadReportSource } from "@/lib/reports/export/load";
import { appendInvoiceSource } from "@/lib/reports/export/pdf";
import { readInvoiceSourceBytes } from "@/lib/inventory/invoice-source-store";
import { renderDocument, renderReportZip } from "@/lib/reports/export/zip";

const outDir = path.join(process.cwd(), "tests", "output", "report-export");

async function count(name: string): Promise<number> {
  const snap = await getAdminDb().collection(name).count().get();
  return snap.data().count;
}

async function main() {
  const before = {
    archive: await count("archivePurchaseInvoices"),
    active: await count("purchaseInvoices"),
    orders: await count("orders"),
    products: await count("products"),
  };
  const source = await loadReportSource(getAdminDb());
  const sari = source.invoices.find((invoice) => invoice.invoiceNumber === "127833" && invoice.supplierName?.includes("SARI"));
  if (!sari) throw new Error("SARI 127833 was not found");
  const period = "2026-10";
  mkdirSync(outDir, { recursive: true });

  const single = buildReport("invoice", source, [sari], period);
  let pdf = await renderDocument(single, "pdf");
  if (sari.sourceFile?.storagePath) {
    const file = await readInvoiceSourceBytes(sari.sourceFile.storagePath);
    pdf = await appendInvoiceSource(pdf, file.bytes, file.mimeType || sari.sourceFile.mimeType || "");
  }
  const xlsx = await renderDocument(single, "xlsx");
  const allInvoices = filterInvoices(source.invoices);
  const list = buildReport("invoices", source, allInvoices, period);
  const listPdf = await renderDocument(list, "pdf");
  const listXlsx = await renderDocument(list, "xlsx");
  const inventory = await renderDocument(buildReport("inventory", source, source.invoices, period), "pdf");
  const suppliers = await renderDocument(buildReport("suppliers", source, source.invoices, period), "xlsx");
  const dishes = await renderDocument(buildReport("dishes", source, source.invoices, period), "pdf");
  const cashflow = await renderDocument(buildReport("cashflow", source, source.invoices, period), "xlsx");
  const zipBytes = await renderReportZip(source, period);

  const files = {
    "MISHKAT_Invoice_SARI-127833.pdf": pdf,
    "MISHKAT_Invoice_SARI-127833.xlsx": xlsx,
    "MISHKAT_Invoices_2026-10.pdf": listPdf,
    "MISHKAT_Invoices_2026-10.xlsx": listXlsx,
    "MISHKAT_Inventory.pdf": inventory,
    "MISHKAT_Suppliers.xlsx": suppliers,
    "MISHKAT_Dishes.pdf": dishes,
    "MISHKAT_Cashflow.xlsx": cashflow,
    "MISHKAT_Reports.zip": zipBytes,
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(outDir, name), bytes);

  const openedPdf = await PDFDocument.load(pdf);
  const resources = openedPdf.getPage(0).node.Resources();
  if (!resources?.has(PDFName.of("Font")) || !resources.has(PDFName.of("XObject"))) throw new Error("PDF font or logo missing");
  if (openedPdf.getPageCount() < 2) throw new Error("Invoice PDF should include the source image page");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  for (const required of ["פרטי חשבונית", "סיכום", "חשבוניות", "שורות", "ספקים", "מע״מ", "תנועות מלאי"]) {
    if (!names.includes(required)) throw new Error(`Missing sheet ${required}`);
  }
  const lineText = JSON.stringify(workbook.getWorksheet("שורות")?.getSheetValues() ?? []);
  if (!lineText.includes("דלי")) throw new Error("Bucket unit missing");
  if (!lineText.includes("168")) throw new Error("Unit price missing");
  const summaryText = JSON.stringify(workbook.getWorksheet("סיכום")?.getSheetValues() ?? []);
  if (!summaryText.includes("398")) throw new Error("Gross total missing");
  if (!summaryText.includes("337.27")) throw new Error("Net total missing");
  if (summaryText.includes("http://") || summaryText.includes("https://")) throw new Error("Public URL leaked into Excel");

  const zip = await JSZip.loadAsync(zipBytes);
  const paths = Object.keys(zip.files);
  for (const folder of ["01-Invoices", "02-Suppliers", "03-Inventory", "04-Stock-Movements", "05-Menu-Costing", "06-Break-Even", "07-Cashflow", "08-Z-Reports"]) {
    if (!paths.some((item) => item.includes(`MISHKAT-REPORTS/${folder}/`) && item.endsWith(".pdf"))) throw new Error(`ZIP missing ${folder}`);
  }

  const after = {
    archive: await count("archivePurchaseInvoices"),
    active: await count("purchaseInvoices"),
    orders: await count("orders"),
    products: await count("products"),
  };
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Counts changed ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  console.log(JSON.stringify({
    outDir,
    pages: openedPdf.getPageCount(),
    sheets: names,
    invoices: allInvoices.length,
    sariLines: sari.lines?.length ?? 0,
    counts: after,
    zipEntries: paths.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
