import { geminiGenerateJson } from "@/lib/ai/gemini-client";
import type { ExtractedInvoice, ExtractedInvoiceLine } from "@/lib/inventory/invoice-extract";
import { asVatType } from "@/lib/inventory/invoice-extract";
import type { PurchaseDocumentType } from "@/lib/inventory/types";

const PROMPT = `Extract a supplier purchase document from ALL pages. Return JSON only.
Read only what is visible. Never invent missing VAT, prices, quantities, currency, dates, suppliers, SKUs, or conversions.
If a field is not visible, use null and a lower confidence (0-1). Do not use 0, 1, or 18% as a guess.
If the document says VAT included / כולל מע"מ / شامل الضريبة, taxMode=inclusive.
If it says VAT excluded / לא כולל מע"מ / قبل الضريبة, taxMode=exclusive.
If it says exempt / פטור / معفى, taxMode=exempt.
If VAT treatment is unclear, taxMode=unknown. Never assume 18%.
A document may mix VAT rates across lines. Extract each line independently.
Extract every product line from every page, not only page 1.
Separate net (before VAT), VAT amount, and gross (including VAT) at header and line level when visible.
Dates as YYYY-MM-DD. Numbers as numbers. Keep originalDescription exactly as printed.`;

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
    supplierVatNumber: FIELD,
    supplierPhone: FIELD,
    supplierAddress: FIELD,
    invoiceNumber: FIELD,
    invoiceDate: FIELD,
    dueDate: FIELD,
    currency: FIELD,
    documentType: FIELD,
    paymentMethod: FIELD,
    paymentTerms: FIELD,
    headerDiscount: NUM_FIELD,
    vatRate: NUM_FIELD,
    subtotal: NUM_FIELD,
    vatTotal: NUM_FIELD,
    grandTotal: NUM_FIELD,
    subtotalBeforeDiscount: NUM_FIELD,
    discountTotal: NUM_FIELD,
    shipping: NUM_FIELD,
    delivery: NUM_FIELD,
    serviceCharge: NUM_FIELD,
    rounding: NUM_FIELD,
    otherCharges: NUM_FIELD,
    vatStatus: { type: "STRING", enum: ["detected", "needs_review"] },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING", nullable: true },
          originalDescription: { type: "STRING", nullable: true },
          name: { type: "STRING", nullable: true },
          quantity: { type: "NUMBER", nullable: true },
          purchaseUnit: { type: "STRING", nullable: true },
          unit: { type: "STRING", nullable: true },
          unitPrice: { type: "NUMBER", nullable: true },
          unitPriceBeforeVat: { type: "NUMBER", nullable: true },
          unitPriceNet: { type: "NUMBER", nullable: true },
          unitPriceIncludingVat: { type: "NUMBER", nullable: true },
          unitPriceGross: { type: "NUMBER", nullable: true },
          discount: { type: "NUMBER", nullable: true },
          discountPercent: { type: "NUMBER", nullable: true },
          discountAmount: { type: "NUMBER", nullable: true },
          vat: { type: "NUMBER", nullable: true },
          vatRate: { type: "NUMBER", nullable: true },
          vatAmount: { type: "NUMBER", nullable: true },
          lineTotal: { type: "NUMBER", nullable: true },
          lineTotalBeforeVat: { type: "NUMBER", nullable: true },
          lineNet: { type: "NUMBER", nullable: true },
          lineTotalIncludingVat: { type: "NUMBER", nullable: true },
          lineGross: { type: "NUMBER", nullable: true },
          sku: { type: "STRING", nullable: true },
          barcode: { type: "STRING", nullable: true },
          vatType: { type: "STRING", nullable: true },
          taxMode: { type: "STRING", nullable: true },
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
    supplierVatNumber: field(null),
    supplierPhone: field(null),
    supplierAddress: field(null),
    invoiceNumber: field(null),
    invoiceDate: field(null),
    dueDate: field(null),
    currency: field(null),
    documentType: field(null),
    paymentMethod: field(null),
    paymentTerms: field(null),
    headerDiscount: field(null),
    vatRate: field(null),
    subtotal: field(null),
    vatTotal: field(null),
    grandTotal: field(null),
    subtotalBeforeDiscount: field(null),
    discountTotal: field(null),
    shipping: field(null),
    delivery: field(null),
    serviceCharge: field(null),
    rounding: field(null),
    otherCharges: field(null),
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

function parseLine(item: Record<string, unknown>): ExtractedInvoiceLine {
  const original = str(item.originalDescription) || str(item.description) || str(item.name) || str(item.rawName);
  const vatType = asVatType(str(item.taxMode) || str(item.vatType));
  return {
    name: original || "",
    originalDescription: original,
    quantity: num(item.quantity),
    unit: str(item.purchaseUnit) || str(item.unit),
    unitPrice: num(item.unitPriceNet) ?? num(item.unitPriceBeforeVat) ?? num(item.unitPrice),
    unitPriceNet: num(item.unitPriceNet) ?? num(item.unitPriceBeforeVat),
    unitPriceGross: num(item.unitPriceGross) ?? num(item.unitPriceIncludingVat),
    discount: num(item.discountAmount) ?? num(item.discount),
    discountPercent: num(item.discountPercent),
    discountAmount: num(item.discountAmount) ?? num(item.discount),
    priceBeforeVat: num(item.lineNet) ?? num(item.lineTotalBeforeVat) ?? num(item.priceBeforeVat) ?? num(item.unitPriceBeforeVat),
    vatAmount: num(item.vatAmount) ?? num(item.vat),
    priceIncludingVat: num(item.lineGross) ?? num(item.lineTotalIncludingVat) ?? num(item.priceIncludingVat) ?? num(item.unitPriceIncludingVat),
    lineTotal: num(item.lineGross) ?? num(item.lineTotalIncludingVat) ?? num(item.lineNet) ?? num(item.lineTotalBeforeVat) ?? num(item.lineTotal),
    lineNet: num(item.lineNet) ?? num(item.lineTotalBeforeVat),
    lineGross: num(item.lineGross) ?? num(item.lineTotalIncludingVat),
    sku: str(item.sku),
    barcode: str(item.barcode),
    vatType,
    vatRate: num(item.vatRate),
    conversionNote: str(item.conversionNote),
    conversionFactor: num(item.conversionFactor),
    confidence: conf(item.confidence),
  };
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
      supplierVatNumber: field(json.supplierVatNumber ?? json.taxId, str),
      supplierPhone: field(json.supplierPhone, str),
      supplierAddress: field(json.supplierAddress, str),
      invoiceNumber: field(json.invoiceNumber, str),
      invoiceDate: field(json.invoiceDate, str),
      dueDate: field(json.dueDate, str),
      currency: field(json.currency, str),
      documentType: field(json.documentType, (v) => {
        const value = str(v);
        return value ? (value as PurchaseDocumentType) : null;
      }),
      paymentMethod: field(json.paymentMethod, str),
      paymentTerms: field(json.paymentTerms, str),
      headerDiscount: field(json.headerDiscount, num),
      vatRate: field(json.vatRate, num),
      subtotal: field(json.subtotal, num),
      vatTotal: field(json.vatTotal, num),
      grandTotal: field(json.grandTotal, num),
      subtotalBeforeDiscount: field(json.subtotalBeforeDiscount, num),
      discountTotal: field(json.discountTotal, num),
      shipping: field(json.shipping, num),
      delivery: field(json.delivery, num),
      serviceCharge: field(json.serviceCharge, num),
      rounding: field(json.rounding, num),
      otherCharges: field(json.otherCharges, num),
      vatStatus,
      lines: linesRaw.map((row) => parseLine((row && typeof row === "object" ? row : {}) as Record<string, unknown>)),
    };
  } catch {
    return fallback;
  }
}

export async function extractInvoiceWithGemini(input: {
  bytes: Buffer;
  mimeType: string;
  requestId?: string;
}): Promise<{ extraction: ExtractedInvoice; rawText: string; model: string; httpStatus: number; requestId: string }> {
  const { text, model, httpStatus, requestId } = await geminiGenerateJson({
    parts: [
      { text: PROMPT },
      { inlineData: { mimeType: input.mimeType, data: input.bytes.toString("base64") } },
    ],
    temperature: 0.1,
    schema: INVOICE_SCHEMA,
    requestId: input.requestId,
  });
  return { extraction: parseInvoiceExtraction(text), rawText: text, model, httpStatus, requestId };
}
