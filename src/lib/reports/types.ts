export type ReportType =
  | "inventory"
  | "exceptions"
  | "blank-count"
  | "count-consumption"
  | "purchases"
  | "supplier-compare";

export type ExceptionKind =
  | "out"
  | "below-min"
  | "near-min"
  | "no-supplier"
  | "no-price"
  | "negative"
  | "count-gap"
  | "stale"
  | "bad-unit";

export type VarianceTone = "ok" | "watch" | "critical" | "none";

export type InventoryStatus = "ok" | "low" | "out" | "no-supplier" | "needs-attention";

export type ReportScope = "all" | "exceptions" | "no-supplier" | "to-order";

export type ReportFilters = {
  from?: string;
  to?: string;
  category?: string;
  supplierId?: string;
  productId?: string;
  status?: ExceptionKind | "all";
  scope?: ReportScope;
  shift?: string;
  search?: string;
};

export type StockCount = {
  id: string;
  productId: string;
  countedAt: string;
  quantityBase: number;
  shift?: string;
  countedBy?: string;
  note?: string;
};

export type ReportRun = {
  id: string;
  type: ReportType;
  periodFrom?: string;
  periodTo?: string;
  generatedAt: string;
  generatedBy?: string;
  generatedByName?: string;
};

export type ReportKpis = {
  itemCount: number | null;
  stockValue: number | null;
  inStockCount: number | null;
  belowMinCount: number | null;
  missingSupplierCount: number | null;
  monthPurchases: number | null;
  monthConsumption: number | null;
};

export type InventorySupplierLine = {
  supplierId: string;
  supplierName: string;
  price: number | null;
  lastPurchaseDate?: string;
  cheapest?: boolean;
};

export type InventoryReportRow = {
  productId: string;
  category: string;
  name: string;
  unit: string;
  opening: number | null;
  incoming: number | null;
  consumption: number | null;
  adjustments: number | null;
  current: number | null;
  minStock: number | null;
  recommended: number | null;
  toOrder: number | null;
  lastSupplier: string | null;
  lastPrice: number | null;
  normalizedPrice: number | null;
  lastPurchaseDate: string | null;
  stockValue: number | null;
  missingSupplier: boolean;
  invalidUnit: boolean;
  status: InventoryStatus;
  supplierLines: InventorySupplierLine[];
};

export type ExceptionReportRow = {
  productId: string;
  name: string;
  kind: ExceptionKind;
  current: number | null;
  minStock: number | null;
  toOrder: number | null;
  gap: number | null;
  supplier: string | null;
  lastPrice: number | null;
  action: string;
};

export type BlankCountRow = {
  productId: string;
  category: string;
  name: string;
  unit: string;
  systemQty: number | null;
};

export type CountConsumptionRow = {
  productId: string;
  name: string;
  opening: number | null;
  incoming: number | null;
  otherIn: number | null;
  sales: number | null;
  theoretical: number | null;
  counted: number | null;
  expected: number | null;
  actual: number | null;
  gap: number | null;
  gapCost: number | null;
  deviation: number | null;
  tone: VarianceTone;
};

export type CountTotals = {
  consumption: number | null;
  gapPositive: number | null;
  gapNegative: number | null;
  gapValue: number | null;
};

export type PurchaseReportRow = {
  date: string;
  supplierId?: string;
  supplier: string;
  invoice: string;
  product: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  netUnitPrice: number | null;
  vatUnit: number | null;
  grossUnitPrice: number | null;
  beforeVat: number | null;
  vat: number | null;
  includingVat: number | null;
};

export type PurchaseSummary = {
  totalIncluding: number | null;
  totalBefore: number | null;
  totalVat: number | null;
  invoiceCount: number | null;
  productCount: number | null;
};

export type PurchaseSupplierGroup = {
  supplierId: string;
  supplierName: string;
  phone?: string;
  taxId?: string;
  invoiceCount: number;
  totalBefore: number;
  totalVat: number;
  totalIncluding: number;
  rows: PurchaseReportRow[];
};

export type SupplierCompareOffer = {
  supplierId: string;
  supplierName: string;
  packageQty?: number;
  unit?: string;
  price: number | null;
  unitCost: number;
  lastDate?: string;
};

export type SupplierPriceCompare = {
  productId: string;
  name: string;
  offers: SupplierCompareOffer[];
  latest: number | null;
  cheapest: number | null;
  highest: number | null;
  average: number | null;
  cheapestSupplierId?: string;
  savings?: number | null;
  savingsPct?: number | null;
};

export type ReportSupplierRef = {
  id: string;
  name: string;
  phone?: string;
  taxId?: string;
};

export type ReportPayload = {
  type: ReportType;
  generatedAt: string;
  periodFrom?: string;
  periodTo?: string;
  orientation: "portrait" | "landscape";
  branchName?: string;
  kpis: ReportKpis;
  inventory?: InventoryReportRow[];
  exceptions?: ExceptionReportRow[];
  blank?: BlankCountRow[];
  counts?: CountConsumptionRow[];
  countTotals?: CountTotals;
  purchases?: PurchaseReportRow[];
  purchaseGroups?: PurchaseSupplierGroup[];
  purchaseSummary?: PurchaseSummary;
  priceCompare?: SupplierPriceCompare[];
  categories: string[];
  suppliers: ReportSupplierRef[];
  products: { id: string; name: string }[];
  runs?: ReportRun[];
};
