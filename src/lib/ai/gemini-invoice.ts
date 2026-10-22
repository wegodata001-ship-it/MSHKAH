import { geminiGenerateJson } from "@/lib/ai/gemini-client";
import { GeminiRequestError } from "@/lib/ai/gemini-config";
import { toDateOnly } from "@/lib/dates/normalize";
import type { ExtractedInvoice, ExtractedInvoiceLine } from "@/lib/inventory/invoice-extract";
import { asVatType } from "@/lib/inventory/invoice-extract";
import type { InvoiceLineType, PurchaseDocumentType } from "@/lib/inventory/types";

const PROMPT = `Extract a supplier purchase document from ALL pages. Return JSON only.

This document may be a Hebrew / Arabic / English Israeli invoice (RTL).
Do not assume a fixed field layout. Numbers may appear left of the Hebrew labels.
Read labels such as: מספר חשבונית, חשבונית מס, קבלה, סה"כ ללא מע"מ, לפני מע"מ,
מע"מ, שיעור מע"מ, סה"כ לתשלום, כולל מע"מ, מחיר ליחידה, כמות, הנחה, ש"ח, ₪.

Read only what is visible. Never invent missing VAT, prices, quantities, currency, dates, suppliers, SKUs, or conversions.
If a field is not visible, use null. Do not use 0, "", or 18% as a guess.
0 is allowed only when the document actually prints 0.
Never choose the largest number on the page as the invoice total.

invoiceNumber / documentNumber must be the printed document number (example: 01/002182).
invoiceDate is תאריך חשבונית / תאריך. dueDate is מועד תשלום / לתשלום עד / תאריך פירעון.
subtotalBeforeDiscount is סה"כ לפני הנחה.
subtotalBeforeVat / subtotal is סה"כ לפני מע"מ, after discounts.
discountTotal is the printed הנחה.
vatTotal is the printed מע"מ amount, not a recalculation.
totalToPay is סה"כ לתשלום. totalIncludingVat is סה"כ כולל מע"מ.
grandTotal must be that same payable total, not a previous balance and not יתרה לתשלום.
If יתרה לתשלום is a different number, leave it out of grandTotal.
vatRate is the printed rate (18 or 0.18). Keep thousand separators out of JSON numbers.

Extract EVERY product table row. lines cannot be [] if a product table is visible.
Do not add the summary block (סה"כ, מע"מ, סה"כ לתשלום) as a product line.
For each line set lineType:
INVENTORY_ITEM | SERVICE | DISCOUNT | RETURN | DEPOSIT | SHIPPING | SUMMARY | GENERAL | UNKNOWN.
A printed line total is the source amount. Put the before-VAT line total in lineNet and the including-VAT line total in lineGross.
Do not replace a printed line total with quantity times unit price.
If those two disagree, still return both and set confidence below 0.8.

If the document says VAT included / כולל מע"מ / شامل الضريبة, taxMode=inclusive.
If it says VAT excluded / לא כולל מע"מ / قبل الضريبة, taxMode=exclusive.
If it says exempt / פטור / معفى, taxMode=exempt.
If VAT treatment is unclear, taxMode=unknown. Never assume 18%.
Dates as YYYY-MM-DD. Numbers as JSON numbers (13500 not "13,500.00").
Keep originalDescription / rawText exactly as printed.`;

const LINE_SCHEMA = {
  type: "OBJECT",
  properties: {
    lineNumber: { type: "NUMBER", nullable: true },
    sku: { type: "STRING", nullable: true },
    description: { type: "STRING", nullable: true },
    originalDescription: { type: "STRING", nullable: true },
    rawText: { type: "STRING", nullable: true },
    name: { type: "STRING", nullable: true },
    quantity: { type: "NUMBER", nullable: true },
    unit: { type: "STRING", nullable: true },
    purchaseUnit: { type: "STRING", nullable: true },
    unitPrice: { type: "NUMBER", nullable: true },
    unitPriceBeforeVat: { type: "NUMBER", nullable: true },
    unitPriceNet: { type: "NUMBER", nullable: true },
    unitPriceIncludingVat: { type: "NUMBER", nullable: true },
    unitPriceGross: { type: "NUMBER", nullable: true },
    discountPercent: { type: "NUMBER", nullable: true },
    discountAmount: { type: "NUMBER", nullable: true },
    discount: { type: "NUMBER", nullable: true },
    lineSubtotalBeforeVat: { type: "NUMBER", nullable: true },
    lineTotalBeforeVat: { type: "NUMBER", nullable: true },
    lineNet: { type: "NUMBER", nullable: true },
    vatRate: { type: "NUMBER", nullable: true },
    vatAmount: { type: "NUMBER", nullable: true },
    vat: { type: "NUMBER", nullable: true },
    lineTotalIncludingVat: { type: "NUMBER", nullable: true },
    lineGross: { type: "NUMBER", nullable: true },
    lineTotal: { type: "NUMBER", nullable: true },
    barcode: { type: "STRING", nullable: true },
    vatType: { type: "STRING", nullable: true },
    taxMode: { type: "STRING", nullable: true },
    lineType: { type: "STRING", nullable: true },
    conversionNote: { type: "STRING", nullable: true },
    conversionFactor: { type: "NUMBER", nullable: true },
    confidence: { type: "NUMBER", nullable: true },
  },
};

const INVOICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplierName: { type: "STRING", nullable: true },
    businessName: { type: "STRING", nullable: true },
    taxId: { type: "STRING", nullable: true },
    supplierBusinessNumber: { type: "STRING", nullable: true },
    supplierVatNumber: { type: "STRING", nullable: true },
    supplierPhone: { type: "STRING", nullable: true },
    supplierEmail: { type: "STRING", nullable: true },
    supplierAddress: { type: "STRING", nullable: true },
    documentType: { type: "STRING", nullable: true },
    documentNumber: { type: "STRING", nullable: true },
    invoiceNumber: { type: "STRING", nullable: true },
    invoiceDate: { type: "STRING", nullable: true },
    dueDate: { type: "STRING", nullable: true },
    currency: { type: "STRING", nullable: true },
    paymentMethod: { type: "STRING", nullable: true },
    paymentTerms: { type: "STRING", nullable: true },
    headerDiscount: { type: "NUMBER", nullable: true },
    discountAmount: { type: "NUMBER", nullable: true },
    discountTotal: { type: "NUMBER", nullable: true },
    vatRate: { type: "NUMBER", nullable: true },
    subtotal: { type: "NUMBER", nullable: true },
    subtotalBeforeVat: { type: "NUMBER", nullable: true },
    vatTotal: { type: "NUMBER", nullable: true },
    vatAmount: { type: "NUMBER", nullable: true },
    grandTotal: { type: "NUMBER", nullable: true },
    totalIncludingVat: { type: "NUMBER", nullable: true },
    totalToPay: { type: "NUMBER", nullable: true },
    subtotalBeforeDiscount: { type: "NUMBER", nullable: true },
    shipping: { type: "NUMBER", nullable: true },
    delivery: { type: "NUMBER", nullable: true },
    serviceCharge: { type: "NUMBER", nullable: true },
    rounding: { type: "NUMBER", nullable: true },
    otherCharges: { type: "NUMBER", nullable: true },
    vatStatus: { type: "STRING", enum: ["detected", "needs_review"] },
    lines: { type: "ARRAY", items: LINE_SCHEMA },
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

function unwrap(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "value" in (raw as object)) {
    return (raw as { value?: unknown }).value;
  }
  return raw;
}

function str(value: unknown): string | null {
  const raw = unwrap(value);
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function parseVisibleNumber(value: unknown): number | null {
  const raw = unwrap(value);
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let text = raw
    .trim()
    .replace(/[₪]/g, "")
    .replace(/ש["״']?ח/g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, "");
  if (!text || /^[-–—]+$/.test(text)) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",") && text.includes(".")) {
    text = text.replace(/,/g, "");
  } else if (/,\d{3}(\.\d+)?$/.test(text) || /,\d{3}/.test(text)) {
    text = text.replace(/,/g, "");
  } else if (text.includes(",") && !text.includes(".")) {
    text = text.replace(",", ".");
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function conf(value: unknown): number | null {
  const n = parseVisibleNumber(value);
  if (n == null) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function field<T>(raw: unknown, pick: (value: unknown) => T): { value: T; confidence: number | null } {
  if (raw == null) return { value: pick(null), confidence: null };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    return { value: pick(row.value !== undefined ? row.value : raw), confidence: conf(row.confidence) };
  }
  return { value: pick(raw), confidence: null };
}

function asLineType(value: string | null): InvoiceLineType | null {
  const raw = (value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw === "INVENTORY_ITEM" || raw === "PRODUCT" || raw === "ITEM") return "INVENTORY_ITEM";
  if (raw === "SERVICE") return "SERVICE";
  if (raw === "DISCOUNT") return "DISCOUNT";
  if (raw === "RETURN" || raw === "CREDIT") return "RETURN";
  if (raw === "DEPOSIT") return "DEPOSIT";
  if (raw === "SUMMARY" || raw === "TOTAL") return "SUMMARY";
  if (raw === "SHIPPING" || raw === "DELIVERY") return "SHIPPING";
  if (raw === "GENERAL") return "GENERAL";
  if (raw === "UNKNOWN") return "UNKNOWN";
  return "UNKNOWN";
}

function parseLine(item: Record<string, unknown>): ExtractedInvoiceLine {
  const original =
    str(item.originalDescription) ||
    str(item.description) ||
    str(item.name) ||
    str(item.rawName) ||
    str(item.rawText);
  const vatType = asVatType(str(item.taxMode) || str(item.vatType));
  const qty = parseVisibleNumber(item.quantity);
  const unitPrice =
    parseVisibleNumber(item.unitPriceNet) ??
    parseVisibleNumber(item.unitPriceBeforeVat) ??
    parseVisibleNumber(item.unitPrice);
  const lineNet =
    parseVisibleNumber(item.lineNet) ??
    parseVisibleNumber(item.lineSubtotalBeforeVat) ??
    parseVisibleNumber(item.lineTotalBeforeVat) ??
    parseVisibleNumber(item.priceBeforeVat);
  const lineGross =
    parseVisibleNumber(item.lineGross) ??
    parseVisibleNumber(item.lineTotalIncludingVat) ??
    parseVisibleNumber(item.priceIncludingVat);
  return {
    name: original || "",
    originalDescription: original,
    quantity: qty,
    unit: str(item.purchaseUnit) || str(item.unit),
    unitPrice,
    unitPriceNet: parseVisibleNumber(item.unitPriceNet) ?? parseVisibleNumber(item.unitPriceBeforeVat),
    unitPriceGross: parseVisibleNumber(item.unitPriceGross) ?? parseVisibleNumber(item.unitPriceIncludingVat),
    discount: parseVisibleNumber(item.discountAmount) ?? parseVisibleNumber(item.discount),
    discountPercent: parseVisibleNumber(item.discountPercent),
    discountAmount: parseVisibleNumber(item.discountAmount) ?? parseVisibleNumber(item.discount),
    priceBeforeVat: lineNet ?? parseVisibleNumber(item.unitPriceBeforeVat),
    vatAmount: parseVisibleNumber(item.vatAmount) ?? parseVisibleNumber(item.vat),
    priceIncludingVat: lineGross,
    lineTotal: lineGross ?? lineNet ?? parseVisibleNumber(item.lineTotal),
    lineNet,
    lineGross,
    sku: str(item.sku),
    barcode: str(item.barcode),
    vatType,
    vatRate: parseVisibleNumber(item.vatRate),
    conversionNote: str(item.conversionNote),
    conversionFactor: parseVisibleNumber(item.conversionFactor),
    confidence: conf(item.confidence),
    lineNumber: parseVisibleNumber(item.lineNumber),
    lineType: asLineType(str(item.lineType)),
    rawText: str(item.rawText) || original,
  };
}

function meaningfulLine(line: ExtractedInvoiceLine): boolean {
  return Boolean(
    line.name ||
      line.sku ||
      line.quantity != null ||
      line.lineNet != null ||
      line.lineGross != null ||
      line.lineTotal != null ||
      line.unitPrice != null
  );
}

export function isEmptyInvoiceExtraction(extraction: ExtractedInvoice): boolean {
  return (
    !extraction.invoiceNumber.value &&
    extraction.lines.length === 0 &&
    extraction.grandTotal.value == null &&
    extraction.subtotal.value == null &&
    extraction.vatTotal.value == null
  );
}

function choosePayableTotal(json: Record<string, unknown>): unknown {
  if (parseVisibleNumber(json.totalToPay) != null) return json.totalToPay;
  if (parseVisibleNumber(json.totalIncludingVat) != null) return json.totalIncludingVat;
  if (parseVisibleNumber(json.grandTotal) != null) return json.grandTotal;
  return null;
}

function rootObject(json: Record<string, unknown>): Record<string, unknown> {
  const nested = json.invoice ?? json.data ?? json.extraction ?? json.result;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return json;
}

function stripFences(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function parseInvoiceExtractionResult(text: string): {
  extraction: ExtractedInvoice;
  parseOk: boolean;
  empty: boolean;
} {
  const fallback = emptyExtraction();
  try {
    const parsed = JSON.parse(stripFences(text)) as Record<string, unknown>;
    const json = rootObject(parsed);
    const linesRaw = Array.isArray(unwrap(json.lines)) ? (unwrap(json.lines) as unknown[]) : [];
    const vatStatus = json.vatStatus === "detected" ? "detected" : "needs_review";
    const invoiceNumber = field(json.invoiceNumber ?? json.documentNumber, str);
    const extraction: ExtractedInvoice = {
      supplierName: field(json.supplierName, str),
      businessName: field(json.businessName, str),
      taxId: field(json.taxId ?? json.supplierBusinessNumber ?? json.supplierVatNumber, str),
      supplierVatNumber: field(json.supplierVatNumber ?? json.taxId ?? json.supplierBusinessNumber, str),
      supplierPhone: field(json.supplierPhone, str),
      supplierAddress: field(json.supplierAddress, str),
      invoiceNumber,
      invoiceDate: field(
        json.invoiceDate ?? json.documentDate ?? json.issueDate ?? json.taxInvoiceDate ?? json.date,
        (v) => toDateOnly(str(v) ?? unwrap(v))
      ),
      dueDate: field(
        json.dueDate ?? json.paymentDueDate ?? json.paymentDate ?? json.due,
        (v) => toDateOnly(str(v) ?? unwrap(v))
      ),
      currency: field(json.currency, str),
      documentType: field(json.documentType, (v) => {
        const value = str(v);
        return value ? (value as PurchaseDocumentType) : null;
      }),
      paymentMethod: field(json.paymentMethod, str),
      paymentTerms: field(json.paymentTerms, str),
      headerDiscount: field(json.headerDiscount ?? json.discountAmount ?? json.discountTotal, parseVisibleNumber),
      vatRate: field(json.vatRate, parseVisibleNumber),
      subtotal: field(json.subtotalBeforeVat ?? json.subtotal, parseVisibleNumber),
      vatTotal: field(json.vatTotal ?? json.vatAmount, parseVisibleNumber),
      grandTotal: field(choosePayableTotal(json), parseVisibleNumber),
      subtotalBeforeDiscount: field(json.subtotalBeforeDiscount, parseVisibleNumber),
      discountTotal: field(json.discountTotal ?? json.discountAmount ?? json.headerDiscount, parseVisibleNumber),
      shipping: field(json.shipping, parseVisibleNumber),
      delivery: field(json.delivery, parseVisibleNumber),
      serviceCharge: field(json.serviceCharge, parseVisibleNumber),
      rounding: field(json.rounding, parseVisibleNumber),
      otherCharges: field(json.otherCharges, parseVisibleNumber),
      vatStatus,
      lines: linesRaw
        .map((row) => parseLine((row && typeof row === "object" ? row : {}) as Record<string, unknown>))
        .filter(meaningfulLine),
    };
    return { extraction, parseOk: true, empty: isEmptyInvoiceExtraction(extraction) };
  } catch {
    return { extraction: fallback, parseOk: false, empty: true };
  }
}

export function parseInvoiceExtraction(text: string): ExtractedInvoice {
  return parseInvoiceExtractionResult(text).extraction;
}

function logExtract(event: string, fields: Record<string, unknown>) {
  console.info("[invoice-extract]", { event, ...fields });
}

export async function extractInvoiceWithGemini(input: {
  bytes: Buffer;
  mimeType: string;
  requestId?: string;
}): Promise<{ extraction: ExtractedInvoice; rawText: string; model: string; httpStatus: number; requestId: string }> {
  const requestId = input.requestId || crypto.randomUUID();
  const parts = [
    { text: PROMPT },
    { inlineData: { mimeType: input.mimeType, data: input.bytes.toString("base64") } },
  ];
  logExtract("AI_REQUEST_SENT", { requestId, mimeType: input.mimeType, bytes: input.bytes.length });

  const first = await geminiGenerateJson({
    parts,
    temperature: 0.1,
    schema: INVOICE_SCHEMA,
    requestId,
  });
  logExtract("AI_RESPONSE_RECEIVED", {
    requestId,
    model: first.model,
    httpStatus: first.httpStatus,
    textLength: first.text.length,
  });

  let parsed = parseInvoiceExtractionResult(first.text);
  let rawText = first.text;
  let model = first.model;
  let httpStatus = first.httpStatus;

  if (!parsed.parseOk) logExtract("AI_RESPONSE_PARSE_FAILED", { requestId, model });
  else logExtract("AI_RESPONSE_PARSE_SUCCESS", { requestId, model, empty: parsed.empty });

  if (parsed.empty) {
    logExtract("AI_REQUEST_SENT", { requestId, retry: "no-schema" });
    const retry = await geminiGenerateJson({ parts, temperature: 0, requestId });
    logExtract("AI_RESPONSE_RECEIVED", {
      requestId,
      model: retry.model,
      httpStatus: retry.httpStatus,
      textLength: retry.text.length,
      retry: "no-schema",
    });
    const retryParsed = parseInvoiceExtractionResult(retry.text);
    if (retryParsed.parseOk && !retryParsed.empty) {
      parsed = retryParsed;
      rawText = retry.text;
      model = retry.model;
      httpStatus = retry.httpStatus;
      logExtract("AI_RESPONSE_PARSE_SUCCESS", { requestId, model, retry: "no-schema" });
    } else if (!retryParsed.parseOk) {
      logExtract("AI_RESPONSE_PARSE_FAILED", { requestId, model: retry.model, retry: "no-schema" });
    }
  }

  const extraction = parsed.extraction;
  logExtract("EXTRACTED_DOCUMENT_NUMBER", { requestId, value: extraction.invoiceNumber.value });
  logExtract("EXTRACTED_LINES_COUNT", { requestId, value: extraction.lines.length });
  logExtract("EXTRACTED_SUBTOTAL", { requestId, value: extraction.subtotal.value });
  logExtract("EXTRACTED_VAT", { requestId, value: extraction.vatTotal.value });
  logExtract("EXTRACTED_TOTAL", { requestId, value: extraction.grandTotal.value });

  if (!parsed.parseOk || parsed.empty || isEmptyInvoiceExtraction(extraction)) {
    throw new GeminiRequestError({
      code: "EXTRACTION_FAILED",
      message: "The invoice image was saved but no document data could be extracted.",
      providerStatus: httpStatus || 200,
      providerError: parsed.parseOk ? "EMPTY_EXTRACTION" : "INVALID_JSON",
      model,
      requestId,
    });
  }

  return { extraction, rawText, model, httpStatus, requestId };
}
