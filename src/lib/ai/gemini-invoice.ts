import { geminiGenerateJson } from "@/lib/ai/gemini-client";
import type { ExtractedInvoice } from "@/lib/inventory/invoice-extract";
import type { PurchaseDocumentType, VatType } from "@/lib/inventory/types";

const PROMPT = `Extract a supplier purchase document. Return JSON only.
Read only what is visible. Do not invent missing VAT, prices, quantities, currency, dates, suppliers, or conversions.
If a field is unclear, use null and a lower confidence (0-1).
documentType must be one of: invoice, tax_invoice, receipt, tax_receipt, delivery, credit, other, or null.
vatType per line if visible: inclusive, exclusive, exempt, or null.
Dates as YYYY-MM-DD. Numbers as numbers.
Each line must include description, sku, barcode, quantity, purchaseUnit, unitPrice, discount, vat, lineTotal.`;

const FIELD = {
  type: "OBJECT",
  properties: {
    value: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER", nullable: true },
  },
};

const NUM_FIELD = {
  type: "OBJECT",
  properties: {
    value: { type: "NUMBER", nullable: true },
    confidence: { type: "NUMBER", nullable: true },
  },
};

const INVOICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplierName: FIELD,
    businessName: FIELD,
    taxId: FIELD,
    invoiceNumber: FIELD,
    invoiceDate: FIELD,
    currency: FIELD,
    documentType: FIELD,
    paymentMethod: FIELD,
    headerDiscount: NUM_FIELD,
    vatRate: NUM_FIELD,
    subtotal: NUM_FIELD,
    vatTotal: NUM_FIELD,
    grandTotal: NUM_FIELD,
    vatStatus: { type: "STRING", enum: ["detected", "needs_review"] },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING", nullable: true },
          name: { type: "STRING", nullable: true },
          quantity: { type: "NUMBER", nullable: true },
          purchaseUnit: { type: "STRING", nullable: true },
          unit: { type: "STRING", nullable: true },
          unitPrice: { type: "NUMBER", nullable: true },
          discount: { type: "NUMBER", nullable: true },
          vat: { type: "NUMBER", nullable: true },
          vatAmount: { type: "NUMBER", nullable: true },
          lineTotal: { type: "NUMBER", nullable: true },
          sku: { type: "STRING", nullable: true },
          barcode: { type: "STRING", nullable: true },
          vatType: { type: "STRING", nullable: true },
          conversionNote: { type: "STRING", nullable: true },
          conversionFactor: { type: "NUMBER", nullable: true },
          confidence: { type: "NUMBER", nullable: true },
        },
      },
    },
  },
};

function emptyExtraction(): ExtractedInvoice {
  const field = <T>(value: T): { value: T; confidence: number | null } => ({ value, confidence: null });
  return {
    supplierName: field(null),
    businessName: field(null),
    taxId: field(null),
    invoiceNumber: field(null),
    invoiceDate: field(null),
    currency: field(null),
    documentType: field(null),
    paymentMethod: field(null),
    headerDiscount: field(null),
    vatRate: field(null),
    subtotal: field(null),
    vatTotal: field(null),
    grandTotal: field(null),
    vatStatus: "needs_review",
    lines: [],
  };
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function conf(value: unknown): number | null {
  const n = num(value);
  if (n == null) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function field<T>(raw: unknown, pick: (value: unknown) => T): { value: T; confidence: number | null } {
  if (raw == null) return { value: pick(null), confidence: null };
  if (typeof raw !== "object") return { value: pick(raw), confidence: null };
  const row = raw as Record<string, unknown>;
  return { value: pick(row.value ?? row), confidence: conf(row.confidence) };
}

export function parseInvoiceExtraction(text: string): ExtractedInvoice {
  const fallback = emptyExtraction();
  try {
    const json = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim()) as Record<string, unknown>;
    const linesRaw = Array.isArray(json.lines) ? json.lines : [];
    const vatStatus = json.vatStatus === "detected" ? "detected" : "needs_review";
    return {
      supplierName: field(json.supplierName, str),
      businessName: field(json.businessName, str),
      taxId: field(json.taxId, str),
      invoiceNumber: field(json.invoiceNumber, str),
      invoiceDate: field(json.invoiceDate, str),
      currency: field(json.currency, str),
      documentType: field(json.documentType, (v) => {
        const value = str(v);
        return value ? (value as PurchaseDocumentType) : null;
      }),
      paymentMethod: field(json.paymentMethod, str),
      headerDiscount: field(json.headerDiscount, num),
      vatRate: field(json.vatRate, num),
      subtotal: field(json.subtotal, num),
      vatTotal: field(json.vatTotal, num),
      grandTotal: field(json.grandTotal, num),
      vatStatus,
      lines: linesRaw.map((row) => {
        const item = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
        return {
          name: str(item.description) || str(item.name) || str(item.rawName) || "",
          quantity: num(item.quantity),
          unit: str(item.purchaseUnit) || str(item.unit),
          unitPrice: num(item.unitPrice),
          discount: num(item.discount),
          priceBeforeVat: num(item.priceBeforeVat),
          vatAmount: num(item.vat) ?? num(item.vatAmount),
          priceIncludingVat: num(item.priceIncludingVat),
          lineTotal: num(item.lineTotal),
          sku: str(item.sku),
          barcode: str(item.barcode),
          vatType: (str(item.vatType) as VatType) || null,
          conversionNote: str(item.conversionNote),
          conversionFactor: num(item.conversionFactor),
          confidence: conf(item.confidence),
        };
      }),
    };
  } catch {
    return fallback;
  }
}

export async function extractInvoiceWithGemini(input: {
  bytes: Buffer;
  mimeType: string;
}): Promise<{ extraction: ExtractedInvoice; model: string; httpStatus: number }> {
  const { text, model, httpStatus } = await geminiGenerateJson({
    parts: [{ text: PROMPT }, { inlineData: { mimeType: input.mimeType, data: input.bytes.toString("base64") } }],
    temperature: 0.1,
    schema: INVOICE_SCHEMA,
  });
  return { extraction: parseInvoiceExtraction(text), model, httpStatus };
}
