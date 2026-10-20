export type ReportKind =
  | "invoices"
  | "invoice"
  | "suppliers"
  | "inventory"
  | "movements"
  | "alerts"
  | "dishes"
  | "breakeven"
  | "cashflow"
  | "z"
  | "compare"
  | "prices"
  | "zip";

export type ReportFormat = "pdf" | "xlsx" | "zip";

export type ReportValue = string | number | null;

export type ReportColumnKind = "text" | "money" | "number" | "date" | "percent";

export type ReportColumn = {
  header: string;
  kind?: ReportColumnKind;
  width?: number;
};

export type ReportSheet = {
  name: string;
  columns: ReportColumn[];
  rows: ReportValue[][];
  totals?: boolean;
};

export type ReportDocument = {
  kind: ReportKind;
  title: string;
  reportId: string;
  period: string;
  generatedAt: string;
  landscape?: boolean;
  sheets: ReportSheet[];
};

export type ExportFilters = {
  supplierId?: string;
  from?: string;
  to?: string;
  query?: string;
  status?: string;
  source?: "all" | "with" | "without";
  invoiceScope?: "active" | "archive" | "both";
};

export type ExportRequest = {
  kind: ReportKind;
  format: ReportFormat;
  scope: "all" | "filtered";
  ids?: string[];
  filters?: ExportFilters;
};
