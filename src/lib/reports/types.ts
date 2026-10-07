export type ReportType =
  | "inventory"
  | "exceptions"
  | "blank-count"
  | "count-consumption"
  | "purchases";

export type ExceptionKind =
  | "out"
  | "below-min"
  | "near-min"
  | "no-supplier"
  | "no-price"
  | "negative"
  | "count-gap";

export type VarianceTone = "ok" | "watch" | "critical" | "none";

export type ReportFilters = {
  from?: string;
  to?: string;
  category?: string;
  supplierId?: string;
  productId?: string;
  status?: ExceptionKind | "all";
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
  belowMinCount: number | null;
  missingSupplierCount: number | null;
  monthPurchases: number | null;
  monthConsumption: number | null;
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
  stockValue: number | null;
  missingSupplier: boolean;
};

export type ExceptionReportRow = {
  productId: string;
  name: string;
  kind: ExceptionKind;
  current: number | null;
  minStock: number | null;
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
};

export type CountConsumptionRow = {
  productId: string;
  name: string;
  opening: number | null;
  incoming: number | null;
  theoretical: number | null;
  counted: number | null;
  expected: number | null;
  actual: number | null;
  gap: number | null;
  deviation: number | null;
  tone: VarianceTone;
};

export type PurchaseReportRow = {
  date: string;
  supplier: string;
  invoice: string;
  product: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
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

export type SupplierPriceCompare = {
  productId: string;
  name: string;
  offers: { supplierId: string; supplierName: string; unitCost: number; lastDate?: string }[];
  latest: number | null;
  cheapest: number | null;
  highest: number | null;
  average: number | null;
  cheapestSupplierId?: string;
};

export type ReportPayload = {
  type: ReportType;
  generatedAt: string;
  periodFrom?: string;
  periodTo?: string;
  orientation: "portrait" | "landscape";
  kpis: ReportKpis;
  inventory?: InventoryReportRow[];
  exceptions?: ExceptionReportRow[];
  blank?: BlankCountRow[];
  counts?: CountConsumptionRow[];
  purchases?: PurchaseReportRow[];
  purchaseSummary?: PurchaseSummary;
  priceCompare?: SupplierPriceCompare[];
  categories: string[];
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string }[];
  runs?: ReportRun[];
};
