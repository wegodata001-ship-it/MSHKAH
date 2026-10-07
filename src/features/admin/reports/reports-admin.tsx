"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  FileSpreadsheet,
  MoreHorizontal,
  Package,
  Shield,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { useT } from "@/components/providers/locale-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { canViewCosting } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { AdminKpiCard } from "@/features/admin/components/admin-kpi-card";
import { AdminCard } from "@/features/admin/components/admin-card";
import { adminCard } from "@/features/admin/components/admin-styles";
import { formatReportDate, formatReportDateTime, formatReportIls } from "@/lib/reports/format";
import type { ReportFilters, ReportPayload, ReportType } from "@/lib/reports/types";
import { ReportViewer } from "@/features/admin/reports/report-viewer";
import { cn } from "@/lib/utils";

const CARDS: { type: ReportType; icon: typeof Package; descKey: string }[] = [
  { type: "inventory", icon: Package, descKey: "admin.reports.card.inventory" },
  { type: "exceptions", icon: AlertTriangle, descKey: "admin.reports.card.exceptions" },
  { type: "blank-count", icon: ClipboardList, descKey: "admin.reports.card.blank" },
  { type: "count-consumption", icon: FileSpreadsheet, descKey: "admin.reports.card.counts" },
  { type: "purchases", icon: Truck, descKey: "admin.reports.card.purchases" },
];

export function ReportsAdmin({ initialType }: { initialType?: ReportType } = {}) {
  const t = useT();
  const { user, loading: authLoading } = useAuth();
  const authFetch = useAuthFetch();
  const [home, setHome] = useState<ReportPayload | null>(null);
  const [viewer, setViewer] = useState<ReportPayload | null>(null);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [activeType, setActiveType] = useState<ReportType | null>(initialType ?? null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (type: ReportType | "home", nextFilters = filters) => {
      setLoading(true);
      const params = new URLSearchParams({ type });
      if (nextFilters.from) params.set("from", nextFilters.from);
      if (nextFilters.to) params.set("to", nextFilters.to);
      if (nextFilters.category) params.set("category", nextFilters.category);
      if (nextFilters.supplierId) params.set("supplierId", nextFilters.supplierId);
      if (nextFilters.productId) params.set("productId", nextFilters.productId);
      if (nextFilters.status && nextFilters.status !== "all") params.set("status", nextFilters.status);
      if (nextFilters.shift) params.set("shift", nextFilters.shift);
      if (nextFilters.search) params.set("search", nextFilters.search);
      const response = await authFetch(`/api/admin/reports/data?${params.toString()}`);
      const json = (await response.json()) as ReportPayload;
      if (type === "home") setHome(json);
      else {
        setViewer({ ...json, type });
        await authFetch("/api/admin/reports/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, periodFrom: nextFilters.from, periodTo: nextFilters.to }),
        });
      }
      setLoading(false);
    },
    [authFetch, filters]
  );

  useEffect(() => {
    if (!user || !canViewCosting(user.role)) return;
    void load("home");
  }, [user, load]);

  useEffect(() => {
    if (initialType && user && canViewCosting(user.role)) {
      setActiveType(initialType);
      void load(initialType);
    }
  }, [initialType, user, load]);

  if (authLoading) return null;
  if (!user || !canViewCosting(user.role)) {
    return (
      <div className="py-12 text-center">
        <Shield className="mx-auto h-12 w-12 text-coffee/30" />
        <p className="mt-4 text-coffee/60">{t("admin.costing.noAccess")}</p>
      </div>
    );
  }

  if (activeType && viewer) {
    return (
      <ReportViewer
        payload={viewer}
        filters={filters}
        loading={loading}
        onFilters={setFilters}
        onRun={() => void load(activeType, filters)}
        onClose={() => {
          setActiveType(null);
          setViewer(null);
          void load("home");
        }}
      />
    );
  }

  const kpis = home?.kpis;
  const exceptions = home?.exceptions ?? [];
  const below = exceptions.filter((row) => row.kind === "below-min" || row.kind === "out").length;
  const noSupplier = exceptions.filter((row) => row.kind === "no-supplier").length;
  const gaps = exceptions.filter((row) => row.kind === "count-gap").length;

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("admin.reports.title")} subtitle={t("admin.reports.subtitle")} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <AdminKpiCard label={t("admin.reports.kpi.items")} value={kpis?.itemCount ?? "—"} icon={Package} loading={loading} />
        <AdminKpiCard label={t("admin.reports.kpi.value")} value={formatReportIls(kpis?.stockValue ?? null)} icon={ShoppingCart} loading={loading} />
        <AdminKpiCard label={t("admin.reports.kpi.below")} value={kpis?.belowMinCount ?? "—"} icon={AlertTriangle} colorClass="text-red-700" bgClass="bg-red-50" loading={loading} />
        <AdminKpiCard label={t("admin.reports.kpi.noSupplier")} value={kpis?.missingSupplierCount ?? "—"} icon={Truck} colorClass="text-amber-700" bgClass="bg-amber-50" loading={loading} />
        <AdminKpiCard label={t("admin.reports.kpi.purchases")} value={formatReportIls(kpis?.monthPurchases ?? null)} icon={FileSpreadsheet} loading={loading} />
        <AdminKpiCard label={t("admin.reports.kpi.consumption")} value={formatReportIls(kpis?.monthConsumption ?? null)} icon={ClipboardList} loading={loading} />
      </div>

      <div>
        <h2 className="mb-3 font-semibold text-dark-brown">{t("admin.reports.cards")}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CARDS.map((card) => {
            const last = home?.runs?.find((run) => run.type === card.type);
            const Icon = card.icon;
            return (
              <div key={card.type} className={cn(adminCard, "flex flex-col")}>
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-turquoise/10 text-turquoise">
                    <Icon className="h-5 w-5" />
                  </div>
                  <button type="button" className="rounded-lg p-1 text-coffee/40" aria-label={t("admin.reports.more")}>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
                <p className="font-semibold text-dark-brown">{t(`admin.reports.type.${card.type}`)}</p>
                <p className="mt-1 flex-1 text-sm text-coffee/55">{t(card.descKey)}</p>
                <p className="mt-2 text-xs text-coffee/45">
                  {t("admin.reports.lastRun")}: {last ? formatReportDateTime(last.generatedAt) : "—"}
                </p>
                <Button
                  className="mt-4"
                  type="button"
                  variant="turquoise"
                  onClick={() => {
                    setActiveType(card.type);
                    void load(card.type);
                  }}
                >
                  {t("admin.reports.open")}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <AdminCard title={t("admin.reports.alerts")}>
        {exceptions.length === 0 ? (
          <p className="text-sm text-emerald-700">{t("admin.reports.stockOk")}</p>
        ) : (
          <div className="space-y-2 text-sm">
            {below > 0 && <p>🔴 {below} {t("admin.reports.alert.below")}</p>}
            {noSupplier > 0 && <p>🟡 {noSupplier} {t("admin.reports.alert.noSupplier")}</p>}
            {gaps > 0 && <p>🟠 {gaps} {t("admin.reports.alert.gaps")}</p>}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setActiveType("exceptions");
                void load("exceptions");
              }}
            >
              {t("admin.reports.openExceptions")}
            </Button>
          </div>
        )}
      </AdminCard>

      <AdminCard title={t("admin.reports.recent")}>
        {!home?.runs?.length ? (
          <p className="text-sm text-coffee/55">{t("admin.reports.noRecent")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-coffee/55">
                  <th className="py-2 text-start">{t("admin.reports.reportName")}</th>
                  <th className="py-2 text-start">{t("admin.reports.period")}</th>
                  <th className="py-2 text-start">{t("admin.reports.generated")}</th>
                  <th className="py-2 text-start">{t("admin.reports.by")}</th>
                </tr>
              </thead>
              <tbody>
                {home.runs.map((run) => (
                  <tr key={run.id} className="border-t border-beige-dark/10">
                    <td className="py-2">{t(`admin.reports.type.${run.type}`)}</td>
                    <td className="py-2">{formatReportDate(run.periodFrom)} – {formatReportDate(run.periodTo)}</td>
                    <td className="py-2">{formatReportDateTime(run.generatedAt)}</td>
                    <td className="py-2">{run.generatedByName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
