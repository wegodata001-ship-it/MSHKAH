import type { PurchaseUnit } from "@/lib/costing/types";

export type VatType = "inclusive" | "exclusive" | "exempt" | "unknown";
export type InvoiceTaxMode = "inclusive" | "exclusive" | "exempt" | "unknown";
export type InvoiceLineType = "INVENTORY_ITEM" | "SERVICE" | "DISCOUNT" | "SHIPPING" | "GENERAL" | "UNKNOWN";
export type InvoiceScanStatus =
  | "uploaded"
  | "scanning"
  | "needs_review"
  | "ready"
  | "approved"
  | "posted"
  | "failed"
  | "cancelled";
export type InvoiceSourceKind = "camera" | "jpg" | "png" | "pdf" | "other";

export type InvoiceSourceFile = {
  storagePath: string;
  downloadUrl: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploadedBy?: string;
  kind: InvoiceSourceKind;
};

export type InvoiceScanAttempt = {
  id: string;
  provider: string;
  model?: string;
  timestamp: string;
  status: "ok" | "failed";
  requestId?: string;
  code?: string;
  rawExtraction?: unknown;
  normalizedExtraction?: unknown;
  validationResult?: InvoiceTotalsValidation;
};

export type InvoiceTotalsValidation = {
  lineNetSum: number;
  lineVatSum: number;
  lineGrossSum: number;
  headerNet: number | null;
  headerVat: number | null;
  headerGross: number | null;
  computedGross: number | null;
  netDiff: number | null;
  vatDiff: number | null;
  grossDiff: number | null;
  hasMismatch: boolean;
};
export type FoodCostVatMode = "before" | "including";
export type CostBasis = "latest" | "weighted";

export type InventoryMovementType =
  | "PURCHASE_IN"
  | "SALE_OUT"
  | "ISSUE_OUT"
  | "ADJUSTMENT"
  | "REVERSAL"
  | "OPENING";

export type InventoryIssueReason = "kitchen" | "waste" | "return" | "recipe" | "other";

export type SupplierPriceSource = "MANUAL" | "PURCHASE_INVOICE" | "PURCHASE_ORDER";

export type Supplier = {
  id: string;
  name: string;
  companyName?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  address?: string;
  contactName?: string;
  paymentTerms?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SupplierOffer = {
  id: string;
  productId: string;
  supplierId: string;
  currentPrice?: number;
  vatType?: VatType;
  vatRate?: number;
  priceBeforeVat?: number;
  vatAmount?: number;
  priceIncludingVat?: number;
  packageQuantity?: number;
  purchaseUnit?: PurchaseUnit;
  normalizedPrice?: number;
  supplierSku?: string;
  notes?: string;
  lastQuotedAt?: string;
  lastPurchasedAt?: string;
  lastPurchasePrice?: number;
  lastPriceIncludingVat?: number;
  lastPriceBeforeVat?: number;
  lastUnitCost?: number;
  lastPurchaseDate?: string;
  lastPackageQuantity?: number;
  lastUnit?: PurchaseUnit;
  lastInvoiceId?: string;
  lastInvoiceNumber?: string;
  lastInvoiceLineId?: string;
  lastUnitPriceNet?: number;
  lastUnitPriceGross?: number;
  lastLineTotalNet?: number;
  lastLineTotalVat?: number;
  lastLineTotalGross?: number;
  active?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PurchasePriceRecord = {
  id: string;
  productId: string;
  supplierId?: string;
  invoiceId?: string;
  invoiceLineId?: string;
  invoiceLineKey?: string;
  purchaseDate: string;
  quantity: number;
  packageQuantity: number;
  purchaseQuantity?: number;
  unit: PurchaseUnit;
  purchaseUnit?: PurchaseUnit;
  unitPriceNet?: number;
  unitPriceGross?: number;
  lineTotalNet?: number;
  lineTotalVat?: number;
  lineTotalGross?: number;
  priceBeforeVat: number;
  vatAmount: number;
  priceIncludingVat: number;
  vatType: VatType;
  vatRate: number;
  unitCost: number;
  source?: SupplierPriceSource;
  createdAt: string;
};

export type InventoryMovement = {
  id: string;
  productId: string;
  type: InventoryMovementType;
  quantity: number;
  unit: PurchaseUnit;
  quantityBase: number;
  supplierId?: string;
  invoiceId?: string;
  posImportId?: string;
  orderId?: string;
  recipeId?: string;
  menuProductId?: string;
  dishCount?: number;
  reason?: InventoryIssueReason;
  actor?: string;
  issueBatchId?: string;
  idempotencyKey?: string;
  reversesId?: string;
  unitCost?: number;
  unitCostNet?: number;
  unitCostGross?: number;
  vatRate?: number;
  invoiceLineKey?: string;
  quantityBefore?: number;
  quantityIn?: number;
  quantityAfter?: number;
  note?: string;
  invoiceDate?: string;
  receivedAt: string;
  createdAt: string;
};

export type PurchaseInvoiceStatus = "draft" | "needs_review" | "saved" | "approving" | "approved" | "rejected";
export type InvoiceStockStatus = "none" | "partial" | "posted";
export type PurchaseDocumentType = "invoice" | "tax_invoice" | "receipt" | "tax_receipt" | "delivery" | "credit" | "other";
export type InvoiceLineMatchKind = "exact" | "suggest" | "mapped" | "new" | "none";
export type InvoiceRowStatus = "matched" | "review" | "new" | "unknown-unit" | "price-anomaly" | "unmapped";
export type InvoiceVatStatus = "detected" | "needs_review";

export type InvoiceAuditEvent = {
  at: string;
  actor?: string;
  action: string;
  detail?: string;
};

export type SupplierItemMap = {
  id: string;
  supplierId: string;
  supplierProductName: string;
  supplierSku?: string;
  inventoryProductId: string;
  purchaseUnit?: PurchaseUnit;
  packageQuantity?: number;
  conversion?: number;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseInvoiceLine = {
  key: string;
  rawName: string;
  originalDescription?: string;
  productId?: string;
  quantity: number | null;
  unit: PurchaseUnit | null;
  unitPrice: number | null;
  discount: number | null;
  discountPercent?: number | null;
  discountAmount?: number | null;
  lineTotal: number | null;
  lineNet?: number | null;
  lineGross?: number | null;
  vatType: VatType;
  taxMode?: InvoiceTaxMode;
  vatRate: number | null;
  priceBeforeVat: number | null;
  vatAmount: number | null;
  priceIncludingVat: number | null;
  confidence?: number | null;
  matchConfidence?: number | null;
  matchKind?: InvoiceLineMatchKind;
  sku?: string;
  barcode?: string;
  conversionNote?: string;
  conversionFactor?: number | null;
  needsReview?: boolean;
  rowStatus?: InvoiceRowStatus;
  previousNormalized?: number | null;
  newNormalized?: number | null;
  priceChangePercent?: number | null;
  cheaperSupplierName?: string;
  cheaperSupplierPrice?: number | null;
  category?: string;
  note?: string;
  matchConfirmed?: boolean;
  candidates?: { productId: string; name: string; score: number }[];
  unitPriceNet?: number | null;
  unitPriceGross?: number | null;
  netAmount?: number | null;
  grossAmount?: number | null;
  vatMode?: VatType;
  transferToInventory?: boolean;
  skipInventory?: boolean;
  lineType?: InvoiceLineType | null;
  lineNumber?: number | null;
  rawText?: string | null;
  postedToStock?: boolean;
  quantityBefore?: number | null;
  quantityIn?: number | null;
  quantityAfter?: number | null;
};

export type PurchaseInvoice = {
  id: string;
  supplierId?: string;
  supplierName: string;
  supplierTaxId?: string;
  supplierVatNumber?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierSnapshot?: Partial<Supplier>;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  receivedAt: string;
  documentType?: PurchaseDocumentType;
  currency?: string;
  paymentMethod?: string | null;
  paymentTerms?: string | null;
  headerDiscount?: number | null;
  vatRate?: number | null;
  vatMode?: VatType | null;
  netAmount?: number | null;
  vatAmount?: number | null;
  grossAmount?: number | null;
  subtotal?: number | null;
  vatTotal?: number | null;
  grandTotal?: number | null;
  subtotalBeforeDiscount?: number | null;
  discountTotal?: number | null;
  shipping?: number | null;
  delivery?: number | null;
  serviceCharge?: number | null;
  rounding?: number | null;
  otherCharges?: number | null;
  vatStatus?: InvoiceVatStatus;
  status: PurchaseInvoiceStatus;
  scanStatus?: InvoiceScanStatus;
  stockStatus?: InvoiceStockStatus;
  lines: PurchaseInvoiceLine[];
  sourceFile?: InvoiceSourceFile;
  scanAttempts?: InvoiceScanAttempt[];
  validation?: InvoiceTotalsValidation;
  headerConfidence?: Record<string, number | null>;
  fileName?: string;
  fileUrl?: string;
  fileHash?: string;
  notes?: string;
  aiProvider?: string;
  aiModel?: string;
  audit?: InvoiceAuditEvent[];
  duplicateOf?: string;
  createdAt: string;
  createdBy?: string;
  uploadedAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  inventoryPostedAt?: string;
  inventoryPostedBy?: string;
  inventoryPostingId?: string;
};

export type PosImportStatus = "draft" | "approved" | "blocked-duplicate";

export type PosSaleLine = {
  key: string;
  posCode: string;
  posName: string;
  quantity: number;
  unitPrice?: number;
  netTotal?: number;
  saleDate?: string;
  menuProductId?: string;
  matchKind: "exact" | "suggest" | "new" | "none";
};

export type PosImport = {
  id: string;
  fileName: string;
  fileHash: string;
  source: "pos-file";
  period: string;
  status: PosImportStatus;
  lines: PosSaleLine[];
  previousImportId?: string;
  createdAt: string;
  approvedAt?: string;
};

export type PosProductMap = {
  id: string;
  posCode: string;
  posName: string;
  menuProductId: string;
};

export type InventoryTaxSettings = {
  vatRate: number;
  foodCostVatMode: FoodCostVatMode;
  costBasis: CostBasis;
};
