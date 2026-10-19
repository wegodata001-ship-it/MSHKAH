import { readFileSync } from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { extractInvoiceWithGemini } from "../src/lib/ai/gemini-invoice";
import { geminiModel, isGeminiConfigured } from "../src/lib/ai/gemini-config";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line.startsWith("GEMINI_")) continue;
  const index = line.indexOf("=");
  const key = line.slice(0, index);
  process.env[key] = line.slice(index + 1).replace(/^"|"$/g, "");
}

if (!isGeminiConfigured()) {
  console.log("GEMINI_CONFIGURED=NO");
  process.exit(2);
}

console.log("GEMINI_CONFIGURED=YES");
console.log(`MODEL=${geminiModel()}`);

const canvas = createCanvas(800, 500);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, 800, 500);
ctx.fillStyle = "#000";
ctx.font = "28px sans-serif";
ctx.fillText("TAX INVOICE", 40, 50);
ctx.font = "20px sans-serif";
ctx.fillText("Supplier: ABC Foods Ltd", 40, 100);
ctx.fillText("VAT ID: 512345678", 40, 130);
ctx.fillText("Invoice No: INV-1042", 40, 160);
ctx.fillText("Date: 2026-10-07", 40, 190);
ctx.fillText("Pasta Barilla 5 kg    qty 1    24.00 ILS incl VAT", 40, 250);
ctx.fillText("Subtotal 20.34   VAT 3.66   Total 24.00 ILS", 40, 320);

try {
  const result = await extractInvoiceWithGemini({ bytes: canvas.toBuffer("image/png"), mimeType: "image/png" });
  console.log("EXTRACT_OK=YES");
  console.log(`HAS_SUPPLIER=${Boolean(result.extraction.supplierName.value)}`);
  console.log(`HAS_NUMBER=${Boolean(result.extraction.invoiceNumber.value)}`);
  console.log(`HAS_DATE=${Boolean(result.extraction.invoiceDate.value)}`);
  console.log(`LINE_COUNT=${result.extraction.lines.length}`);
  console.log(`HAS_TOTAL=${result.extraction.grandTotal.value != null}`);
} catch (error) {
  console.log("EXTRACT_OK=NO");
  console.log(`EXTRACT_ERROR=${error instanceof Error ? error.message : "failed"}`);
  process.exit(1);
}
