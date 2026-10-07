"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  Filter,
  MoreHorizontal,
  Printer,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useT } from "@/components/providers/locale-provider";
import { AdminEmptyState } from "@/features/admin/components/admin-empty-state";
import { BRAND } from "@/lib/brand";
import { downloadReportExcel } from "@/lib/reports/excel";
import { formatReportDate, formatReportDateTime, formatReportIls, formatReportQty } from "@/lib/reports/format";
import type { ExceptionKind, ReportFilters, ReportPayload, ReportType } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  out: "admin.reports.ex.out",
  "below-min": "admin.reports.ex.below",
  "near-min": "admin.reports.ex.near",
  "no-supplier": "admin.reports.ex.noSupplier",
  "no-price": "admin.reports.ex.noPrice",
  negative: "admin.reports.ex.negative",
  "count-gap": "admin.reports.ex.gap",
};

const ACTION_LABEL: Record<string, string> = {
  order: "admin.reports.action.order",
  watch: "admin.reports.action.watch",
  "link-supplier": "admin.reports.action.link",
  "record-price": "admin.reports.action.price",
  adjust: "admin.reports.action.adjust",
  recount: "admin.reports.action.recount",
};

export function ReportViewer({
  payload,
  filters,
  onFilters,
  onRun,
  onClose,
  loading,
}: {
  payload: ReportPayload;
  filters: ReportFilters;
  onFilters: (next: ReportFilters) => void;
  onRun: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const title = t(`admin.reports.type.${payload.type}`);

  const printReport = () => {
    document.body.setAttribute("data-report-orientation", payload.orientation);
    window.print();
    window.setTimeout(() => document.body.removeAttribute("data-report-orientation"), 500);
  };

  const filterFields = (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
      <Input type="date" value={filters.from ?? ""} onChange={(e) => onFilters({ ...filters, from: e.target.value || undefined })} />
      <Input type="date" value={filters.to ?? ""} onChange={(e) => onFilters({ ...filters, to: e.target.value || undefined })} />
      <select className="h-10 rounded-xl border border-beige-dark/30 bg-warm-white px-3 text-sm" value={filters.category ?? ""} onChange={(e) => onFilters({ ...filters, category: e.target.value || undefined })}>
        <option value="">{t("admin.reports.filter.category")}</option>
        {payload.categories.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      <select className="h-10 rounded-xl border border-beige-dark/30 bg-warm-white px-3 text-sm" value={filters.supplierId ?? ""} onChange={(e) => onFilters({ ...filters, supplierId: e.target.value || undefined })}>
        <option value="">{t("admin.reports.filter.supplier")}</option>
        {payload.suppliers.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      <select className="h-10 rounded-xl border border-beige-dark/30 bg-warm-white px-3 text-sm" value={filters.productId ?? ""} onChange={(e) => onFilters({ ...filters, productId: e.target.value || undefined })}>
        <option value="">{t("admin.reports.filter.product")}</option>
        {payload.products.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      {payload.type === "exceptions" ? (
        <select className="h-10 rounded-xl border border-beige-dark/30 bg-warm-white px-3 text-sm" value={filters.status ?? "all"} onChange={(e) => onFilters({ ...filters, status: e.target.value as ExceptionKind | "all" })}>
          <option value="all">{t("admin.reports.filter.status")}</option>
          {Object.keys(EXCEPTION_LABEL).map((key) => (
            <option key={key} value={key}>{t(EXCEPTION_LABEL[key as ExceptionKind])}</option>
          ))}
        </select>
      ) : (
        <Input value={filters.search ?? ""} onChange={(e) => onFilters({ ...filters, search: e.target.value || undefined })} placeholder={t("admin.reports.search")} />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="report-no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <button type="button" className="text-sm text-turquoise" onClick={onClose}>{t("common.back")}</button>
          <h2 className="font-display text-2xl font-semibold text-dark-brown">{title}</h2>
        </div>
        <div className="hidden flex-wrap gap-2 md:flex">
          <Button type="button" variant="outline" onClick={printReport}><Printer className="h-4 w-4" /> {t("admin.reports.print")}</Button>
          <Button type="button" variant="outline" onClick={printReport}>{t("admin.reports.pdf")}</Button>
          <Button type="button" variant="outline" onClick={() => void downloadReportExcel(payload, title)}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          <Button type="button" variant="outline" onClick={onRun}><RefreshCw className="h-4 w-4" /> {t("admin.reports.refresh")}</Button>
          <Button type="button" variant="ghost" onClick={() => onFilters({})}><RotateCcw className="h-4 w-4" /> {t("admin.reports.reset")}</Button>
        </div>
        <div className="flex gap-2 md:hidden">
          <Button type="button" variant="outline" onClick={() => setSheet(true)}><Filter className="h-4 w-4" /> {t("admin.reports.filter")}</Button>
          <Button type="button" variant="outline" onClick={() => setMenu((v) => !v)}><MoreHorizontal className="h-4 w-4" /></Button>
        </div>
      </div>
      {menu && (
        <div className="report-no-print grid gap-2 rounded-2xl border border-beige-dark/20 bg-warm-white p-3 md:hidden">
          <Button type="button" variant="outline" onClick={printReport}>{t("admin.reports.print")} / PDF</Button>
          <Button type="button" variant="outline" onClick={() => void downloadReportExcel(payload, title)}>Excel</Button>
          <Button type="button" variant="outline" onClick={onRun}>{t("admin.reports.refresh")}</Button>
        </div>
      )}
      <div className="report-no-print hidden rounded-2xl border border-beige-dark/15 bg-warm-white p-3 md:block">
        {filterFields}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onFilters({})}>{t("admin.reports.reset")}</Button>
          <Button type="button" variant="turquoise" onClick={onRun} disabled={loading}>{t("admin.reports.run")}</Button>
        </div>
      </div>
      <Drawer open={sheet} onOpenChange={setSheet}>
        <DrawerContent className="report-no-print px-4 pb-6">
          <DrawerHeader><DrawerTitle>{t("admin.reports.filter")}</DrawerTitle></DrawerHeader>
          {filterFields}
          <Button className="mt-4 w-full" variant="turquoise" onClick={() => { setSheet(false); onRun(); }}>{t("admin.reports.run")}</Button>
        </DrawerContent>
      </Drawer>

      <article
        className={cn("report-print rounded-2xl border border-beige-dark/15 bg-warm-white p-4 shadow-soft md:p-6", payload.orientation === "landscape" && "report-print-landscape")}
        data-orientation={payload.orientation}
      >
        <header className="report-print-header mb-5 flex items-start justify-between gap-4 border-b border-beige-dark/15 pb-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" className="h-12 w-auto" />
            <div>
              <p className="text-xs tracking-wide text-coffee/55">MISHKAT CAFE · مشكاة كافيه</p>
              <h1 className="font-display text-xl font-semibold text-dark-brown">{title}</h1>
            </div>
          </div>
          <div className="text-end text-xs text-coffee/60">
            <p>{t("admin.reports.period")}: {formatReportDate(payload.periodFrom)} – {formatReportDate(payload.periodTo)}</p>
            <p>{t("admin.reports.generated")}: {formatReportDateTime(payload.generatedAt)}</p>
          </div>
        </header>
        <ReportBody payload={payload} />
        <footer className="report-print-footer mt-6 border-t border-beige-dark/15 pt-3 text-xs text-coffee/50">
          Mishkat Cafe · {t("admin.reports.generated")}: {formatReportDateTime(payload.generatedAt)} · {t("admin.reports.systemDoc")}
        </footer>
      </article>
    </div>
  );
}

function ReportBody({ payload }: { payload: ReportPayload }) {
  const t = useT();
  const [page, setPage] = useState(0);
  const pageSize = 80;
  const end = (page + 1) * pageSize;
  const inventory = payload.inventory?.slice(0, end) ?? [];
  const exceptions = payload.exceptions?.slice(0, end) ?? [];
  const blank = payload.blank?.slice(0, end) ?? [];
  const counts = payload.counts?.slice(0, end) ?? [];
  const purchases = payload.purchases?.slice(0, end) ?? [];
  const total =
    (payload.inventory?.length ?? payload.exceptions?.length ?? payload.blank?.length ?? payload.counts?.length ?? payload.purchases?.length ?? 0);

  if (payload.type === "exceptions" && !payload.exceptions?.length) {
    return <AdminEmptyState icon={X} title={t("admin.reports.empty.exceptions")} className="border-0 shadow-none" />;
  }
  if (payload.type === "purchases" && !payload.purchases?.length) {
    return <AdminEmptyState icon={X} title={t("admin.reports.empty.purchases")} className="border-0 shadow-none" />;
  }
  if (payload.type === "inventory" && !payload.inventory?.length) {
    return <AdminEmptyState icon={X} title={t("admin.reports.empty.inventory")} className="border-0 shadow-none" />;
  }
  if (payload.type === "blank-count" && !payload.blank?.length) {
    return <AdminEmptyState icon={X} title={t("admin.reports.empty.inventory")} className="border-0 shadow-none" />;
  }
  if (payload.type === "count-consumption" && !payload.counts?.length) {
    return <AdminEmptyState icon={X} title={t("admin.reports.empty.counts")} className="border-0 shadow-none" />;
  }

  return (
    <div className="space-y-4">
      {payload.type === "blank-count" && (
        <div className="mb-4 grid gap-2 text-sm md:grid-cols-4">
          <p>{t("admin.reports.blank.date")}: __________</p>
          <p>{t("admin.reports.blank.time")}: __________</p>
          <p>{t("admin.reports.blank.worker")}: __________</p>
          <p>{t("admin.reports.blank.shift")}: __________</p>
        </div>
      )}
      {payload.type === "purchases" && payload.purchaseSummary && (
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
          <SummaryChip label={t("admin.reports.kpi.purchases")} value={formatReportIls(payload.purchaseSummary.totalIncluding)} />
          <SummaryChip label={t("admin.inventory.costBeforeVat")} value={formatReportIls(payload.purchaseSummary.totalBefore)} />
          <SummaryChip label={t("admin.inventory.vat")} value={formatReportIls(payload.purchaseSummary.totalVat)} />
          <SummaryChip label={t("admin.reports.invoices")} value={payload.purchaseSummary.invoiceCount == null ? "—" : String(payload.purchaseSummary.invoiceCount)} />
          <SummaryChip label={t("admin.reports.products")} value={payload.purchaseSummary.productCount == null ? "—" : String(payload.purchaseSummary.productCount)} />
        </div>
      )}
      <div className="report-table-wrap overflow-x-auto">
        <table className="report-table min-w-full text-sm">
          <thead>
            <TableHead type={payload.type} />
          </thead>
          <tbody>
            {inventory.map((row) => (
              <tr key={row.productId} className="report-row">
                <td>{row.category}</td>
                <td>{row.name}</td>
                <td>{row.unit}</td>
                <td className="num">{formatReportQty(row.opening)}</td>
                <td className="num">{formatReportQty(row.incoming)}</td>
                <td className="num">{formatReportQty(row.consumption)}</td>
                <td className="num">{formatReportQty(row.adjustments)}</td>
                <td className="num font-semibold">{formatReportQty(row.current)}</td>
                <td className="num">{formatReportQty(row.minStock)}</td>
                <td className="num">{formatReportQty(row.recommended)}</td>
                <td className="num">{formatReportQty(row.toOrder)}</td>
                <td>{row.lastSupplier ?? "—"}</td>
                <td className="num">{formatReportIls(row.lastPrice, 4)}</td>
                <td className="num">{formatReportIls(row.stockValue)}</td>
              </tr>
            ))}
            {exceptions.map((row) => (
              <tr key={`${row.productId}-${row.kind}`} className="report-row">
                <td>{row.name}</td>
                <td>{t(EXCEPTION_LABEL[row.kind])}</td>
                <td className="num">{formatReportQty(row.current)}</td>
                <td className="num">{formatReportQty(row.minStock)}</td>
                <td className="num">{formatReportQty(row.gap)}</td>
                <td>{row.supplier ?? "—"}</td>
                <td className="num">{formatReportIls(row.lastPrice, 4)}</td>
                <td>{t(ACTION_LABEL[row.action] ?? row.action)}</td>
              </tr>
            ))}
            {blank.map((row) => (
              <tr key={row.productId} className="report-row">
                <td>{row.category}</td>
                <td>{row.name}</td>
                <td>{row.unit}</td>
                <td className="count-blank" />
                <td className="count-blank" />
              </tr>
            ))}
            {counts.map((row) => (
              <tr key={row.productId} className={cn("report-row", row.tone === "ok" && "tone-ok", row.tone === "watch" && "tone-watch", row.tone === "critical" && "tone-critical")}>
                <td>{row.name}</td>
                <td className="num">{formatReportQty(row.opening)}</td>
                <td className="num">{formatReportQty(row.incoming)}</td>
                <td className="num">{formatReportQty(row.theoretical)}</td>
                <td className="num">{formatReportQty(row.expected)}</td>
                <td className="num">{formatReportQty(row.actual)}</td>
                <td className="num">{formatReportQty(row.gap)}</td>
                <td className="num">{row.deviation == null ? "—" : `${row.deviation.toFixed(2)}%`}</td>
              </tr>
            ))}
            {purchases.map((row, index) => (
              <tr key={`${row.invoice}-${row.product}-${index}`} className="report-row">
                <td>{formatReportDate(row.date)}</td>
                <td>{row.supplier}</td>
                <td>{row.invoice}</td>
                <td>{row.product}</td>
                <td className="num">{formatReportQty(row.quantity)}</td>
                <td>{row.unit}</td>
                <td className="num">{formatReportIls(row.unitPrice, 4)}</td>
                <td className="num">{formatReportIls(row.beforeVat)}</td>
                <td className="num">{formatReportIls(row.vat)}</td>
                <td className="num">{formatReportIls(row.includingVat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > end && (
        <Button type="button" variant="outline" className="report-no-print" onClick={() => setPage((n) => n + 1)}>
          {t("admin.reports.more")}
        </Button>
      )}
      {payload.type === "inventory" && payload.inventory && (
        <div className="report-summary grid gap-2 rounded-xl bg-beige/30 p-3 text-sm md:grid-cols-4">
          <p>{t("admin.reports.kpi.items")}: {payload.kpis.itemCount ?? "—"}</p>
          <p>{t("admin.reports.kpi.value")}: {formatReportIls(payload.kpis.stockValue)}</p>
          <p>{t("admin.reports.kpi.below")}: {payload.kpis.belowMinCount ?? "—"}</p>
          <p>{t("admin.reports.kpi.noSupplier")}: {payload.kpis.missingSupplierCount ?? "—"}</p>
        </div>
      )}
      {payload.priceCompare && payload.priceCompare.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold">{t("admin.reports.priceCompare")}</h3>
          {payload.priceCompare.map((item) => (
            <div key={item.productId} className="rounded-xl border border-beige-dark/15 p-3 text-sm">
              <p className="font-medium">{item.name}</p>
              {item.offers.map((offer) => (
                <p key={offer.supplierId}>
                  {offer.supplierName} {formatReportIls(offer.unitCost, 4)}
                  {offer.supplierId === item.cheapestSupplierId ? ` ← ${t("admin.inventory.cheapest")}` : ""}
                </p>
              ))}
              <p className="mt-1 text-coffee/55">
                {t("admin.inventory.lastPaid")}: {formatReportIls(item.latest, 4)} · min {formatReportIls(item.cheapest, 4)} · max {formatReportIls(item.highest, 4)} · avg {formatReportIls(item.average, 4)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-beige/40 px-3 py-2">
      <p className="text-[11px] text-coffee/55">{label}</p>
      <p className="font-semibold" dir="ltr">{value}</p>
    </div>
  );
}

function TableHead({ type }: { type: ReportType }) {
  const t = useT();
  if (type === "inventory") {
    return (
      <tr>
        <th>{t("admin.costing.category")}</th>
        <th>{t("admin.inventory.product")}</th>
        <th>{t("admin.costing.unit")}</th>
        <th>{t("admin.inventory.opening")}</th>
        <th>{t("admin.inventory.stockIn")}</th>
        <th>{t("admin.inventory.consumption")}</th>
        <th>{t("admin.reports.adjustments")}</th>
        <th>{t("admin.inventory.current")}</th>
        <th>{t("admin.reports.min")}</th>
        <th>{t("admin.reports.recommended")}</th>
        <th>{t("admin.reports.toOrder")}</th>
        <th>{t("admin.inventory.lastSupplier")}</th>
        <th>{t("admin.inventory.lastPrice")}</th>
        <th>{t("admin.reports.stockValue")}</th>
      </tr>
    );
  }
  if (type === "exceptions") {
    return (
      <tr>
        <th>{t("admin.inventory.product")}</th>
        <th>{t("admin.inventory.status")}</th>
        <th>{t("admin.inventory.current")}</th>
        <th>{t("admin.reports.min")}</th>
        <th>{t("admin.reports.gap")}</th>
        <th>{t("admin.costing.supplier")}</th>
        <th>{t("admin.inventory.lastPrice")}</th>
        <th>{t("admin.reports.recommendedAction")}</th>
      </tr>
    );
  }
  if (type === "blank-count") {
    return (
      <tr>
        <th>{t("admin.costing.category")}</th>
        <th>{t("admin.inventory.product")}</th>
        <th>{t("admin.costing.unit")}</th>
        <th>{t("admin.reports.actualQty")}</th>
        <th>{t("admin.costing.notes")}</th>
      </tr>
    );
  }
  if (type === "count-consumption") {
    return (
      <tr>
        <th>{t("admin.inventory.product")}</th>
        <th>{t("admin.inventory.opening")}</th>
        <th>{t("admin.inventory.stockIn")}</th>
        <th>{t("admin.reports.theoretical")}</th>
        <th>{t("admin.reports.expected")}</th>
        <th>{t("admin.reports.actual")}</th>
        <th>{t("admin.reports.gap")}</th>
        <th>{t("admin.reports.deviation")}</th>
      </tr>
    );
  }
  return (
    <tr>
      <th>{t("admin.inventory.date")}</th>
      <th>{t("admin.costing.supplier")}</th>
      <th>{t("admin.inventory.invoice")}</th>
      <th>{t("admin.inventory.product")}</th>
      <th>{t("admin.costing.purchaseQty")}</th>
      <th>{t("admin.costing.unit")}</th>
      <th>{t("admin.inventory.unitCost")}</th>
      <th>{t("admin.inventory.costBeforeVat")}</th>
      <th>{t("admin.inventory.vat")}</th>
      <th>{t("admin.inventory.costIncludingVat")}</th>
    </tr>
  );
}
