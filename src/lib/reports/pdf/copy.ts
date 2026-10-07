import { formatReportDate, formatReportDateTime, formatReportIls } from "@/lib/reports/format";
import type {
  ExceptionKind,
  InventoryStatus,
  ReportFilters,
  ReportPayload,
  ReportScope,
} from "@/lib/reports/types";

export type ReportCopy = {
  brandEn: string;
  brandAr: string;
  title: string;
  generatedLabel: string;
  generatedAt: string;
  generatedTime: string;
  periodLabel: string;
  periodValue: string;
  branchLabel: string;
  branchValue: string;
  pageOf: (page: number, total: number) => string;
  filters: { label: string; value: string }[];
  kpis: { label: string; value: string }[];
  status: Record<InventoryStatus, string>;
  exception: Record<ExceptionKind, string>;
  action: Record<string, string>;
  col: Record<string, string>;
};

type Translate = (key: string) => string;

const STATUS_KEYS: Record<InventoryStatus, string> = {
  ok: "admin.reports.status.ok",
  low: "admin.reports.status.low",
  out: "admin.reports.status.out",
  "no-supplier": "admin.reports.status.noSupplier",
  "needs-attention": "admin.reports.status.attention",
};

export const EXCEPTION_KEYS: Record<ExceptionKind, string> = {
  out: "admin.reports.ex.out",
  "below-min": "admin.reports.ex.below",
  "near-min": "admin.reports.ex.near",
  "no-supplier": "admin.reports.ex.noSupplier",
  "no-price": "admin.reports.ex.noPrice",
  negative: "admin.reports.ex.negative",
  "count-gap": "admin.reports.ex.gap",
  stale: "admin.reports.ex.stale",
  "bad-unit": "admin.reports.ex.badUnit",
};

export const ACTION_KEYS: Record<string, string> = {
  order: "admin.reports.action.order",
  watch: "admin.reports.action.watch",
  "link-supplier": "admin.reports.action.link",
  "record-price": "admin.reports.action.price",
  adjust: "admin.reports.action.adjust",
  recount: "admin.reports.action.recount",
  "fix-unit": "admin.reports.action.fixUnit",
};

const SCOPE_KEYS: Record<ReportScope, string> = {
  all: "admin.reports.scope.all",
  exceptions: "admin.reports.scope.exceptions",
  "no-supplier": "admin.reports.scope.noSupplier",
  "to-order": "admin.reports.scope.toOrder",
};

export function buildReportCopy(
  payload: ReportPayload,
  filters: ReportFilters,
  t: Translate
): ReportCopy {
  const generated = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
  const time = formatReportDateTime(payload.generatedAt);
  const filtersList: { label: string; value: string }[] = [];
  if (filters.from || filters.to) {
    filtersList.push({
      label: t("admin.reports.period"),
      value: `${formatReportDate(filters.from || payload.periodFrom)} – ${formatReportDate(filters.to || payload.periodTo)}`,
    });
  }
  if (filters.category) filtersList.push({ label: t("admin.reports.filter.category"), value: filters.category });
  if (filters.supplierId) {
    const name = payload.suppliers.find((item) => item.id === filters.supplierId)?.name ?? filters.supplierId;
    filtersList.push({ label: t("admin.reports.filter.supplier"), value: name });
  }
  if (filters.productId) {
    const name = payload.products.find((item) => item.id === filters.productId)?.name ?? filters.productId;
    filtersList.push({ label: t("admin.reports.filter.product"), value: name });
  }
  if (filters.status && filters.status !== "all") {
    filtersList.push({ label: t("admin.reports.filter.status"), value: t(EXCEPTION_KEYS[filters.status]) });
  }
  if (filters.scope && filters.scope !== "all") {
    filtersList.push({ label: t("admin.reports.filter.scope"), value: t(SCOPE_KEYS[filters.scope]) });
  }
  if (filters.search) filtersList.push({ label: t("admin.reports.search"), value: filters.search });
  if (filters.shift) filtersList.push({ label: t("admin.reports.blank.shift"), value: filters.shift });

  return {
    brandEn: "MISHKAT CAFE",
    brandAr: "مشكاة كافيه",
    title: t(`admin.reports.type.${payload.type}`),
    generatedLabel: t("admin.reports.generated"),
    generatedAt: formatReportDate(payload.generatedAt),
    generatedTime: time.includes(" ") ? time.split(" ").slice(1).join(" ") : time,
    periodLabel: t("admin.reports.period"),
    periodValue: `${formatReportDate(payload.periodFrom)} – ${formatReportDate(payload.periodTo)}`,
    branchLabel: t("admin.reports.branch"),
    branchValue: payload.branchName || "Mishkat Cafe",
    pageOf: (page, total) => t("admin.reports.pageOf").replace("{page}", String(page)).replace("{total}", String(total)),
    filters: filtersList,
    kpis: reportKpis(payload, t),
    status: {
      ok: t(STATUS_KEYS.ok),
      low: t(STATUS_KEYS.low),
      out: t(STATUS_KEYS.out),
      "no-supplier": t(STATUS_KEYS["no-supplier"]),
      "needs-attention": t(STATUS_KEYS["needs-attention"]),
    },
    exception: Object.fromEntries(
      (Object.keys(EXCEPTION_KEYS) as ExceptionKind[]).map((key) => [key, t(EXCEPTION_KEYS[key])])
    ) as Record<ExceptionKind, string>,
    action: Object.fromEntries(Object.entries(ACTION_KEYS).map(([key, value]) => [key, t(value)])),
    col: {
      product: t("admin.inventory.product"),
      category: t("admin.costing.category"),
      unit: t("admin.costing.unit"),
      opening: t("admin.inventory.opening"),
      incoming: t("admin.inventory.stockIn"),
      consumption: t("admin.inventory.consumption"),
      current: t("admin.inventory.current"),
      min: t("admin.reports.min"),
      toOrder: t("admin.reports.toOrder"),
      lastSupplier: t("admin.inventory.lastSupplier"),
      lastPrice: t("admin.inventory.lastPrice"),
      normalized: t("admin.inventory.normalizedPrice"),
      stockValue: t("admin.reports.stockValue"),
      status: t("admin.inventory.status"),
      issue: t("admin.reports.issue"),
      action: t("admin.reports.recommendedAction"),
      suppliers: t("admin.reports.suppliers"),
      cheapest: t("admin.inventory.cheapest"),
      hash: "#",
      systemQty: t("admin.reports.systemQty"),
      actualQty: t("admin.reports.actualQty"),
      gap: t("admin.reports.gap"),
      notes: t("admin.costing.notes"),
      purchases: t("admin.inventory.stockIn"),
      otherIn: t("admin.reports.otherIn"),
      sales: t("admin.inventory.consumption"),
      expected: t("admin.reports.expected"),
      actual: t("admin.reports.actual"),
      gapCost: t("admin.reports.gapCost"),
      date: t("admin.inventory.date"),
      invoice: t("admin.inventory.invoice"),
      qty: t("admin.costing.purchaseQty"),
      netUnit: t("admin.reports.netUnit"),
      vat: t("admin.inventory.vat"),
      grossUnit: t("admin.reports.grossUnit"),
      total: t("admin.reports.total"),
      subtotal: t("admin.reports.subtotal"),
      beforeVat: t("admin.inventory.costBeforeVat"),
      includingVat: t("admin.inventory.costIncludingVat"),
      phone: t("admin.reports.phone"),
      taxId: t("admin.reports.taxId"),
      invoiceCount: t("admin.reports.invoices"),
      pack: t("admin.reports.pack"),
      price: t("admin.inventory.lastPrice"),
      bestOffer: t("admin.reports.bestOffer"),
      savings: t("admin.reports.savings"),
      consumptionTotal: t("admin.reports.kpi.consumptionTotal"),
      gapPositive: t("admin.reports.kpi.gapPositive"),
      gapNegative: t("admin.reports.kpi.gapNegative"),
      gapValue: t("admin.reports.kpi.gapValue"),
      formTitle: t("admin.reports.type.blank-count"),
      formDate: t("admin.reports.blank.date"),
      formTime: t("admin.reports.blank.time"),
      formWorker: t("admin.reports.blank.worker"),
      formSign: t("admin.reports.blank.sign"),
      counterName: t("admin.reports.blank.counter"),
      approverName: t("admin.reports.blank.approver"),
      inStock: t("admin.reports.kpi.inStock"),
      purchaseValue: t("admin.reports.kpi.purchases"),
    },
  };
}

function reportKpis(payload: ReportPayload, t: Translate): { label: string; value: string }[] {
  if (payload.type === "purchases" && payload.purchaseSummary) {
    return [
      { label: t("admin.reports.invoices"), value: String(payload.purchaseSummary.invoiceCount ?? "—") },
      { label: t("admin.inventory.costBeforeVat"), value: formatReportIls(payload.purchaseSummary.totalBefore) },
      { label: t("admin.inventory.vat"), value: formatReportIls(payload.purchaseSummary.totalVat) },
      { label: t("admin.inventory.costIncludingVat"), value: formatReportIls(payload.purchaseSummary.totalIncluding) },
      { label: t("admin.reports.products"), value: String(payload.purchaseSummary.productCount ?? "—") },
    ];
  }
  if (payload.type === "count-consumption" && payload.countTotals) {
    return [
      { label: t("admin.reports.kpi.consumptionTotal"), value: String(payload.countTotals.consumption ?? "—") },
      { label: t("admin.reports.kpi.gapPositive"), value: String(payload.countTotals.gapPositive ?? "—") },
      { label: t("admin.reports.kpi.gapNegative"), value: String(payload.countTotals.gapNegative ?? "—") },
      { label: t("admin.reports.kpi.gapValue"), value: formatReportIls(payload.countTotals.gapValue) },
    ];
  }
  if (payload.type === "supplier-compare") {
    const items = payload.priceCompare ?? [];
    const savings = items.map((item) => item.savings).filter((n): n is number => n != null);
    return [
      { label: t("admin.reports.products"), value: String(items.length || "—") },
      { label: t("admin.reports.kpi.withOffers"), value: String(items.filter((item) => item.offers.length > 1).length || "—") },
      { label: t("admin.reports.savings"), value: savings.length ? formatReportIls(savings.reduce((sum, n) => sum + n, 0)) : "—" },
    ];
  }
  if (payload.type === "exceptions") {
    const rows = payload.exceptions ?? [];
    return [
      { label: t("admin.reports.kpi.exceptions"), value: String(rows.length || "—") },
      { label: t("admin.reports.ex.below"), value: String(rows.filter((row) => row.kind === "below-min").length) },
      { label: t("admin.reports.ex.out"), value: String(rows.filter((row) => row.kind === "out").length) },
      { label: t("admin.reports.ex.noSupplier"), value: String(rows.filter((row) => row.kind === "no-supplier").length) },
      { label: t("admin.reports.ex.stale"), value: String(rows.filter((row) => row.kind === "stale").length) },
    ];
  }
  const kpis = payload.kpis;
  return [
    { label: t("admin.reports.kpi.items"), value: String(kpis.itemCount ?? "—") },
    { label: t("admin.reports.kpi.inStock"), value: String(kpis.inStockCount ?? "—") },
    { label: t("admin.reports.kpi.below"), value: String(kpis.belowMinCount ?? "—") },
    { label: t("admin.reports.kpi.noSupplier"), value: String(kpis.missingSupplierCount ?? "—") },
    { label: t("admin.reports.kpi.value"), value: formatReportIls(kpis.stockValue) },
    { label: t("admin.reports.kpi.purchases"), value: formatReportIls(kpis.monthPurchases) },
  ];
}
