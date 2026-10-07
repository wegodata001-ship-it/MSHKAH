import type { ExtractedInvoice } from "@/lib/inventory/invoice-match";
import { DEFAULT_VAT_RATE } from "@/lib/inventory/vat";

const SCHEMA_HINT = `Return JSON only: {
  "supplierName": string,
  "invoiceNumber": string,
  "invoiceDate": "YYYY-MM-DD",
  "vatId": string,
  "lines": [{
    "name": string,
    "quantity": number,
    "unit": "kg"|"g"|"liter"|"ml"|"unit",
    "unitPrice": number,
    "lineTotal": number,
    "vatType": "inclusive"|"exclusive"|"exempt",
    "vatRate": number
  }]
}
Use vatRate as a fraction (0.18) unless the document shows a percent, then convert. Never invent products that are not on the invoice.`;

function parseJsonObject(text: string): ExtractedInvoice {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { lines: [] };
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as ExtractedInvoice;
    return {
      supplierName: raw.supplierName ? String(raw.supplierName) : "",
      invoiceNumber: raw.invoiceNumber ? String(raw.invoiceNumber) : "",
      invoiceDate: raw.invoiceDate ? String(raw.invoiceDate) : "",
      vatId: raw.vatId ? String(raw.vatId) : "",
      lines: Array.isArray(raw.lines)
        ? raw.lines.map((line) => ({
            name: String(line.name ?? ""),
            quantity: line.quantity ?? null,
            unit: line.unit ?? null,
            lineTotal: line.lineTotal ?? null,
            unitPrice: line.unitPrice ?? null,
            vatType: line.vatType ?? "inclusive",
            vatRate: line.vatRate ?? DEFAULT_VAT_RATE,
          }))
        : [],
    };
  } catch {
    return { lines: [] };
  }
}

async function extractWithOpenAi(bytes: Buffer, mime: string): Promise<ExtractedInvoice | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const body = {
    model: process.env.OPENAI_INVOICE_MODEL?.trim() || "gpt-4o-mini",
    messages: [
      { role: "system", content: SCHEMA_HINT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract this purchase invoice." },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` },
          },
        ],
      },
    ],
    temperature: 0,
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { lines: [] };
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return parseJsonObject(json.choices?.[0]?.message?.content ?? "");
}

async function extractWithGemini(bytes: Buffer, mime: string): Promise<ExtractedInvoice | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.GEMINI_INVOICE_MODEL?.trim() || "gemini-2.0-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SCHEMA_HINT },
              { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
            ],
          },
        ],
      }),
    }
  );
  if (!response.ok) return { lines: [] };
  const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  return parseJsonObject(text);
}

export async function extractPurchaseInvoice(bytes: Buffer, mime: string): Promise<{
  extracted: ExtractedInvoice;
  provider: "openai" | "gemini" | "manual";
}> {
  const openai = await extractWithOpenAi(bytes, mime);
  if (openai) return { extracted: openai, provider: "openai" };
  const gemini = await extractWithGemini(bytes, mime);
  if (gemini) return { extracted: gemini, provider: "gemini" };
  return { extracted: { lines: [] }, provider: "manual" };
}
