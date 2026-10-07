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

export type Supplier = {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SupplierOffer = {
  id: string;
  productId: string;
  supplierId: string;
  lastPriceIncludingVat?: number;
  lastPriceBeforeVat?: number;
  lastUnitCost?: number;
  lastPurchaseDate?: string;
  lastPackageQuantity?: number;
  lastUnit?: PurchaseUnit;
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

export type PurchaseInvoiceStatus = "draft" | "approved";

export type PurchaseInvoiceLine = {
  key: string;
  rawName: string;
  productId?: string;
  createNew?: boolean;
  ignored?: boolean;
  quantity: number | null;
  unit: PurchaseUnit | null;
  lineTotal: number | null;
  vatType: VatType;
  vatRate: number;
  priceBeforeVat: number | null;
  vatAmount: number | null;
  priceIncludingVat: number | null;
  matchKind: "exact" | "suggest" | "new" | "none";
};

export type PurchaseInvoice = {
  id: string;
  supplierId?: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  receivedAt: string;
  status: PurchaseInvoiceStatus;
  lines: PurchaseInvoiceLine[];
  fileName?: string;
  notes?: string;
  createdAt: string;
  approvedAt?: string;
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
