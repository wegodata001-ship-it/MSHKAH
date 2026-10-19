import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { existsSync, readFileSync } from "fs";
import { extractInvoiceWithGemini, isEmptyInvoiceExtraction } from "../src/lib/ai/gemini-invoice";

const file = existsSync("tmp/ai-fixtures/invoice.jpg") ? "tmp/ai-fixtures/invoice.jpg" : "tmp/ai-fixtures/invoice.pdf";

async function main() {
  const mime = file.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
  const result = await extractInvoiceWithGemini({
    bytes: readFileSync(file),
    mimeType: mime,
    requestId: `scan-verify-${Date.now()}`,
  });
  const e = result.extraction;
  console.log(
    JSON.stringify({
      file,
      empty: isEmptyInvoiceExtraction(e),
      number: e.invoiceNumber.value,
      date: e.invoiceDate.value,
      supplier: e.supplierName.value,
      net: e.subtotal.value,
      vat: e.vatTotal.value,
      total: e.grandTotal.value,
      lines: e.lines.map((line) => ({ name: line.name, qty: line.quantity, net: line.lineNet, gross: line.lineGross })),
    })
  );
}

void main();
