import type { PurchaseUnit } from "@/lib/costing/types";

export type VatType = "inclusive" | "exclusive" | "exempt";
export type FoodCostVatMode = "before" | "including";
export type CostBasis = "latest" | "weighted";

export type InventoryMovementType =
  | "PURCHASE_IN"
  | "SALE_OUT"
  | "ADJUSTMENT"
  | "REVERSAL"
  | "OPENING";

export type SupplierPriceSource = "MANUAL" | "PURCHASE_INVOICE" | "PURCHASE_ORDER";

export type Supplier = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
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
  active?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PurchasePriceRecord = {
  id: string;
  productId: string;
  supplierId?: string;
  invoiceId?: string;
  purchaseDate: string;
  quantity: number;
  packageQuantity: number;
  unit: PurchaseUnit;
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
  unitCost?: number;
  note?: string;
  invoiceDate?: string;
  receivedAt: string;
  createdAt: string;
};

export type PurchaseInvoiceStatus = "draft" | "needs_review" | "approving" | "approved" | "rejected";
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
  conversion?: number;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseInvoiceLine = {
  key: string;
  rawName: string;
  productId?: string;
  quantity: number | null;
  unit: PurchaseUnit | null;
  unitPrice: number | null;
  discount: number | null;
  lineTotal: number | null;
  vatType: VatType;
  vatRate: number;
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
};

export type PurchaseInvoice = {
  id: string;
  supplierId?: string;
  supplierName: string;
  supplierTaxId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  receivedAt: string;
  documentType?: PurchaseDocumentType;
  currency?: string;
  subtotal?: number | null;
  vatTotal?: number | null;
  grandTotal?: number | null;
  vatStatus?: InvoiceVatStatus;
  status: PurchaseInvoiceStatus;
  lines: PurchaseInvoiceLine[];
  fileName?: string;
  fileUrl?: string;
  fileHash?: string;
  notes?: string;
  aiProvider?: string;
  aiModel?: string;
  audit?: InvoiceAuditEvent[];
  duplicateOf?: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
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
