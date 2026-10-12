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
  originalDescription: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  unitPriceNet: number | null;
  unitPriceGross: number | null;
  discount: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  priceBeforeVat: number | null;
  vatAmount: number | null;
  priceIncludingVat: number | null;
  lineTotal: number | null;
  lineNet: number | null;
  lineGross: number | null;
  sku: string | null;
  barcode: string | null;
  vatType: VatType | null;
  vatRate: number | null;
  conversionNote: string | null;
  conversionFactor: number | null;
  confidence: number | null;
};

export type ExtractedInvoice = {
  supplierName: ExtractedField<string | null>;
  businessName: ExtractedField<string | null>;
  taxId: ExtractedField<string | null>;
  supplierVatNumber: ExtractedField<string | null>;
  supplierPhone: ExtractedField<string | null>;
  supplierAddress: ExtractedField<string | null>;
  invoiceNumber: ExtractedField<string | null>;
  invoiceDate: ExtractedField<string | null>;
  dueDate: ExtractedField<string | null>;
  currency: ExtractedField<string | null>;
  documentType: ExtractedField<PurchaseDocumentType | null>;
  paymentMethod: ExtractedField<string | null>;
  paymentTerms: ExtractedField<string | null>;
  headerDiscount: ExtractedField<number | null>;
  vatRate: ExtractedField<number | null>;
  subtotal: ExtractedField<number | null>;
  vatTotal: ExtractedField<number | null>;
  grandTotal: ExtractedField<number | null>;
  subtotalBeforeDiscount: ExtractedField<number | null>;
  discountTotal: ExtractedField<number | null>;
  shipping: ExtractedField<number | null>;
  delivery: ExtractedField<number | null>;
  serviceCharge: ExtractedField<number | null>;
  rounding: ExtractedField<number | null>;
  otherCharges: ExtractedField<number | null>;
  vatStatus: "detected" | "needs_review";
  lines: ExtractedInvoiceLine[];
};

export type InvoiceExtractResponse = {
  ok?: boolean;
  configured: boolean;
  provider?: "gemini";
  model?: string;
  reachable?: boolean;
  requestId?: string;
  code?: string;
  message?: string;
  providerStatus?: number | null;
  providerError?: string | null;
  extraction?: ExtractedInvoice;
  invoice?: PurchaseInvoice;
  error?: string;
  errorCode?: string;
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
  if (/unknown|לא זוהה|غير واضح/.test(raw)) return "unknown";
  if (/exempt|פטור|معفى/.test(raw)) return "exempt";
  if (/exclusive|לפני|לא כולל|قبل|ex-vat|before/.test(raw)) return "exclusive";
  if (/inclusive|כולל|شامل|inc/.test(raw)) return "inclusive";
  return null;
}
