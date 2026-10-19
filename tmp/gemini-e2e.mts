import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function loadGeminiEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.startsWith("GEMINI_")) continue;
        const i = line.indexOf("=");
        const key = line.slice(0, i);
        if (!process.env[key]) process.env[key] = line.slice(i + 1).replace(/^"|"$/g, "");
      }
    } catch {
      // missing
    }
  }
}

loadGeminiEnv();

const { pingGemini } = await import("../src/lib/ai/gemini-client.ts");
const { extractInvoiceWithGemini } = await import("../src/lib/ai/gemini-invoice.ts");
const { suggestRecipeIngredientsFromGemini, buildRecipeSuggestions } = await import("../src/lib/ai/gemini-recipe.ts");

const outDir = join("tmp", "ai-fixtures");
mkdirSync(outDir, { recursive: true });

const invoiceText = [
  "TAX INVOICE",
  "Supplier: Barilla Israel Ltd",
  "Tax ID: 512345678",
  "Invoice #: INV-7788",
  "Date: 2026-10-01",
  "Currency: ILS",
  "Barilla Pasta 5KG  x2  unit  25.00  VAT 4.50  line 50.00",
  "Cooking Cream 1L    x6  unit  12.00  VAT 12.96 line 72.00",
  "Subtotal 103.54",
  "VAT 18.46",
  "Total 122.00",
];

const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
invoiceText.forEach((line, index) => {
  page.drawText(line, { x: 48, y: 780 - index * 22, size: 14, font, color: rgb(0, 0, 0) });
});
writeFileSync(join(outDir, "invoice.pdf"), Buffer.from(await pdf.save()));
spawnSync("powershell", ["-NoProfile", "-File", join(outDir, "make-images.ps1")], { stdio: "ignore" });

const health = await pingGemini(true);
console.log(
  `HEALTH configured=${health.configured} reachable=${health.reachable} httpStatus=${health.httpStatus} reason=${health.reason} model=${health.model}`
);

async function tryExtract(label: string, file: string, mime: string) {
  if (!existsSync(file)) {
    console.log(`${label} MISSING_FILE`);
    return;
  }
  try {
    const result = await extractInvoiceWithGemini({ bytes: readFileSync(file), mimeType: mime });
    const e = result.extraction;
    console.log(
      `${label} HTTP=${result.httpStatus} supplier=${e.supplierName.value ?? "null"} number=${e.invoiceNumber.value ?? "null"} date=${e.invoiceDate.value ?? "null"} vat=${e.vatTotal.value ?? "null"} total=${e.grandTotal.value ?? "null"} lines=${e.lines.length}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    console.log(`${label} FAIL ${message}`);
  }
}

await tryExtract("JPG", join(outDir, "invoice.jpg"), "image/jpeg");
await tryExtract("PNG", join(outDir, "invoice.png"), "image/png");
await tryExtract("PDF", join(outDir, "invoice.pdf"), "application/pdf");

try {
  const dish = await suggestRecipeIngredientsFromGemini({
    dishName: "פסטה שמנת פטריות",
    description: "פסטה ברוטב שמנת עם פטריות ופרמזן / Pasta with cream mushrooms and parmesan",
    inventoryNames: ["פסטה", "שמנת", "פטריות", "פרמזן", "חלב", "סוכר", "קפה"],
  });
  const matched = buildRecipeSuggestions(dish.suggestions, [
    { id: "pasta", name: "פסטה", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "kg", baseUnit: "g", costPerBaseUnit: 0.005, active: true, createdAt: "", updatedAt: "" },
    { id: "cream", name: "שמנת", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "liter", baseUnit: "ml", costPerBaseUnit: 0.012, active: true, createdAt: "", updatedAt: "" },
    { id: "mush", name: "פטריות", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "kg", baseUnit: "g", costPerBaseUnit: 0.02, active: true, createdAt: "", updatedAt: "" },
    { id: "parm", name: "פרמזן", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "kg", baseUnit: "g", costPerBaseUnit: 0.08, active: true, createdAt: "", updatedAt: "" },
    { id: "milk", name: "חלב", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "liter", baseUnit: "ml", costPerBaseUnit: 0.006, active: true, createdAt: "", updatedAt: "" },
    { id: "sugar", name: "סוכר", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "kg", baseUnit: "g", costPerBaseUnit: 0.004, active: true, createdAt: "", updatedAt: "" },
    { id: "coffee", name: "קפה", purchasePrice: 1, purchaseQuantity: 1, purchaseUnit: "kg", baseUnit: "g", costPerBaseUnit: 0.07, active: true, createdAt: "", updatedAt: "" },
  ]);
  console.log(`DISH HTTP=${dish.httpStatus} names=${matched.map((item) => item.name).join("|") || "none"}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "failed";
  console.log(`DISH FAIL ${message}`);
}
