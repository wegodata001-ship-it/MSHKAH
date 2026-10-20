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
  aliases?: string[];
  active: boolean;
  mergedInto?: string;
  audit?: InvoiceAuditEvent[];
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
  cancelledAt?: string;
  cancelledBy?: string;
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
  posSourceRow?: number;
  orderId?: string;
  recipeId?: string;
  menuProductId?: string;
  dishCount?: number;
  reason?: InventoryIssueReason;
  actor?: string;
  issueBatchId?: string;
  idempotencyKey?: string;
  reversesId?: string;
  /** Set on an ADJUSTMENT that changes the posted quantity of a purchase movement. */
  correctsMovementId?: string;
  unitCost?: number;
  unitCostNet?: number;
  unitCostGross?: number;
  vatRate?: number;
  invoiceLineId?: string;
  invoiceLineKey?: string;
  conversionFactor?: number | null;
  lineTotalNet?: number | null;
  lineTotalGross?: number | null;
  quantityBefore?: number;
  quantityIn?: number;
  quantityAfter?: number;
  note?: string;
  invoiceDate?: string;
  receivedAt: string;
  createdAt: string;
};

export type PurchaseInvoiceStatus =
  | "draft"
  | "needs_review"
  | "saved"
  | "approving"
  | "approved"
  | "rejected"
  | "cancelled";
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
  before?: string;
  after?: string;
};

export type InvoiceGeneratedDocument = {
  version: number;
  storagePath: string;
  createdAt: string;
  createdBy?: string;
  bytes?: number;
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
  compareGroupId?: string;
  compareGroupName?: string;
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
  categoryId?: string;
  packCount?: number | null;
  packContentUnit?: PurchaseUnit | null;
  customUnitId?: string;
  note?: string;
  matchConfirmed?: boolean;
  plannedProductName?: string;
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
  sourceNet?: number | null;
  sourceVat?: number | null;
  sourceGross?: number | null;
  computedNet?: number | null;
  computedVat?: number | null;
  computedGross?: number | null;
  coveredByInvoiceId?: string;
  coversDeliveryIds?: string[];
  duplicateOf?: string;
  duplicateSnapshot?: {
    id: string;
    invoiceNumber?: string;
    supplierName?: string;
    invoiceDate?: string;
    status?: PurchaseInvoiceStatus;
    stockStatus?: InvoiceStockStatus;
    posted?: boolean;
  };
  createdAt: string;
  createdBy?: string;
  uploadedAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  inventoryPostedAt?: string;
  inventoryPostedBy?: string;
  inventoryPostingId?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  cancellationId?: string;
  cancelReversedMovementIds?: string[];
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  generatedDocuments?: InvoiceGeneratedDocument[];
};

export type PosImportStatus = "draft" | "saved" | "approved" | "blocked-duplicate";
export type PosImportKind = "excel-info" | "z-report";
export type PosFinanceStatus = "none" | "draft" | "posted";

export type PosSaleLine = {
  key: string;
  sourceRow?: number;
  posCode: string;
  posName: string;
  quantity: number;
  unitPrice?: number;
  netTotal?: number;
  reportedRevenue?: number | null;
  transactionCount?: number | null;
  posCost?: number | null;
  posProfit?: number | null;
  saleDate?: string;
  menuProductId?: string;
  matchKind: "exact" | "suggest" | "new" | "none";
  reviewReason?: "missing-source-name" | "zero-quantity" | null;
  computedUnitPrice?: number | null;
  sourceUnitPrice?: number | null;
  priceGap?: number | null;
  lineKind?: "sale" | "return";
  excluded?: boolean;
};

export type PosImport = {
  id: string;
  kind?: PosImportKind;
  fileName: string;
  fileHash: string;
  source: "pos-file" | "z-scan";
  period: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  sourcePeriodFrom?: string | null;
  sourcePeriodTo?: string | null;
  reportGeneratedAt?: string | null;
  uploadedAt?: string;
  periodNeedsReview?: boolean;
  periodConfirmed?: boolean;
  status: PosImportStatus;
  financeStatus?: PosFinanceStatus;
  infoOnly?: boolean;
  inventoryStatus?: "none" | "partial" | "posted";
  applyProgress?: {
    productsCreated?: string[];
    pricesUpdated?: string[];
    movementIds?: string[];
    lastError?: string;
  };
  lines: PosSaleLine[];
  itemCount?: number;
  quantitySum?: number;
  reportedRevenueSum?: number | null;
  sheetName?: string | null;
  headerRow?: number | null;
  sourceFile?: InvoiceSourceFile;
  previousImportId?: string;
  excludedKeys?: string[];
  sourceTotals?: { itemCount: number | null; quantitySum: number | null; reportedRevenueSum: number | null } | null;
  createdAt: string;
  approvedAt?: string;
};

export type PosColumnTemplate = {
  id: string;
  headers: string[];
  columnMap: Partial<Record<string, number>>;
  sheetName?: string | null;
  headerRow?: number | null;
  createdAt: string;
};

export type PosZPaymentRole = "tender" | "tender-summary";
export type PosZScanStatus = "uploaded" | "scanning" | "ready" | "partial" | "failed";
export type PosZFieldRole = "header" | "payment" | "payment-summary" | "sales" | "extra" | "other";

export type PosZPayment = {
  method: string;
  sourceLabel?: string;
  amount: number | null;
  count?: number | null;
  role?: PosZPaymentRole;
};

export type PosZExtraAmount = {
  sourceLabel: string;
  amount: number | null;
  role: "extra";
};

export type PosZExtractedField = {
  key: string;
  sourceLabel: string;
  value: string | number | null;
  kind: "text" | "money" | "count" | "date" | "datetime";
  role: PosZFieldRole;
  needsReview: boolean;
};

export type PosZCheck = {
  id: string;
  label: string;
  left: number | null;
  right: number | null;
  gap: number | null;
  ok: boolean;
};

export type WebsiteSalesOverlap = {
  orderCount: number;
  amount: number;
  status: "ok" | "incomplete";
  invalidOrderCount?: number;
  invalidOrderIds?: string[];
};

export type PosZReport = {
  id: string;
  reportNumber?: string | null;
  reportType?: string | null;
  registerId?: string | null;
  cashier?: string | null;
  branch?: string | null;
  businessName?: string | null;
  businessDate?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  printedAt?: string | null;
  salesBeforeVat?: number | null;
  salesTotal?: number | null;
  salesIncludingVat?: number | null;
  vatTotal?: number | null;
  vatRate?: number | null;
  receiptsTotal?: number | null;
  receiptsCount?: number | null;
  returnsTotal?: number | null;
  discountsTotal?: number | null;
  cashExpected?: number | null;
  payments?: PosZPayment[];
  extraAmounts?: PosZExtraAmount[];
  fields?: PosZExtractedField[];
  checks?: PosZCheck[];
  periodConfirmed?: boolean;
  scanStatus?: PosZScanStatus;
  lastScanError?: string | null;
  extractionModel?: string | null;
  status: "draft" | "posted";
  financeEntryId?: string | null;
  sourceFiles?: InvoiceSourceFile[];
  fileHash?: string;
  duplicateOf?: string | null;
  websiteOverlap?: WebsiteSalesOverlap | null;
  overlapReviewResolved?: boolean;
  periodOverlapIds?: string[];
  createdAt: string;
  updatedAt?: string;
  postedAt?: string;
  postedBy?: string;
};

export type PosFinanceEntry = {
  id: string;
  zReportId: string;
  kind?: "z-post" | "z-correction";
  businessDate: string;
  amount: number;
  vatBasis: "before" | "including" | "unknown";
  vatTotal?: number | null;
  payments?: PosZPayment[];
  sourceFilePaths?: string[];
  postedAt: string;
  postedBy?: string;
  correctionOf?: string | null;
  reason?: string | null;
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
