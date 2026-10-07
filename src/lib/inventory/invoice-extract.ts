import type { PurchaseDocumentType, PurchaseInvoice, PurchaseInvoiceLine, VatType } from "@/lib/inventory/types";
import type { PurchaseUnit } from "@/lib/costing/types";

export const LOW_CONFIDENCE = 0.8;
export const PRICE_ANOMALY_RATIO = 0.4;

export type ExtractedField<T> = {
  value: T;
  confidence: number | null;
};

export type ExtractedInvoiceLine = {
  name: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  discount: number | null;
  priceBeforeVat: number | null;
  vatAmount: number | null;
  priceIncludingVat: number | null;
  lineTotal: number | null;
  sku: string | null;
  barcode: string | null;
  vatType: VatType | null;
  conversionNote: string | null;
  conversionFactor: number | null;
  confidence: number | null;
};

export type ExtractedInvoice = {
  supplierName: ExtractedField<string | null>;
  businessName: ExtractedField<string | null>;
  taxId: ExtractedField<string | null>;
  invoiceNumber: ExtractedField<string | null>;
  invoiceDate: ExtractedField<string | null>;
  currency: ExtractedField<string | null>;
  documentType: ExtractedField<PurchaseDocumentType | null>;
  subtotal: ExtractedField<number | null>;
  vatTotal: ExtractedField<number | null>;
  grandTotal: ExtractedField<number | null>;
  vatStatus: "detected" | "needs_review";
  lines: ExtractedInvoiceLine[];
};

export type InvoiceExtractResponse = {
  configured: boolean;
  provider?: "gemini";
  model?: string;
  reachable?: boolean;
  extraction?: ExtractedInvoice;
  invoice?: PurchaseInvoice;
  error?: string;
};

export function needsReview(confidence: number | null | undefined): boolean {
  return confidence == null || confidence < LOW_CONFIDENCE;
}

export function guessUnit(raw: string | null | undefined): PurchaseUnit | null {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return null;
  if (/kg|ק.?ג|كيلو/.test(value)) return "kg";
  if (/^g\b|גרם|غرام/.test(value)) return "g";
  if (/l\b|ליטר|لتر/.test(value)) return "liter";
  if (/ml|מ.?ל|مل/.test(value)) return "ml";
  if (/unit|יח|pcs|piece|carton|קרטון|علبة|קארטון/.test(value)) return "unit";
  return null;
}

export function asVatType(value: string | null | undefined): VatType | null {
  const raw = (value || "").toLowerCase();
  if (!raw) return null;
  if (/exempt|פטור|معفى/.test(raw)) return "exempt";
  if (/exclusive|לפני|قبل|ex-vat|before/.test(raw)) return "exclusive";
  if (/inclusive|כולל|شامل|inc/.test(raw)) return "inclusive";
  return null;
}
