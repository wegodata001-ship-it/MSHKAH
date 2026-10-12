"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardList, Package, Scale, Truck } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useT } from "@/components/providers/locale-provider";
import { useAdminPath } from "@/hooks/useAdminPath";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { canViewCosting } from "@/lib/auth/roles";
import { AdminCard } from "@/features/admin/components/admin-card";
import { formatReportIls } from "@/lib/reports/format";
import type { ReportPayload } from "@/lib/reports/types";
import { adminCard } from "@/features/admin/components/admin-styles";

export function DashboardReportsWidget() {
  const t = useT();
  const adminPath = useAdminPath();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [data, setData] = useState<ReportPayload | null>(null);

  useEffect(() => {
    if (!user || !canViewCosting(user.role)) return;
    void authFetch("/api/admin/reports/data?type=home")
      .then((response) => response.json())
      .then(setData)
      .catch(() => setData(null));
  }, [user, authFetch]);

  if (!user || !canViewCosting(user.role)) return null;

  const exceptions = data?.exceptions ?? [];
  const href = (type: string) => `${adminPath("reports")}?type=${type}`;

  return (
    <AdminCard
      title={t("admin.reports.widget")}
      action={
        <Link href={adminPath("reports")} className="text-xs font-medium text-turquoise hover:underline">
          {t("admin.dashboard.viewAll")}
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {[
          { type: "inventory", icon: Package, label: t("admin.reports.type.inventory") },
          { type: "exceptions", icon: AlertTriangle, label: t("admin.reports.type.exceptions") },
          { type: "blank-count", icon: ClipboardList, label: t("admin.reports.type.blank-count") },
          { type: "count-consumption", icon: ClipboardList, label: t("admin.reports.type.count-consumption") },
          { type: "purchases", icon: Truck, label: t("admin.reports.type.purchases") },
          { type: "supplier-compare", icon: Scale, label: t("admin.reports.type.supplier-compare") },
          { type: "breakeven", icon: Scale, label: t("admin.reports.type.breakeven") },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.type} href={href(item.type)} className={adminCard + " !p-3 text-sm"}>
              <Icon className="mb-2 h-4 w-4 text-turquoise" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-4 text-sm">
        {exceptions.length === 0 ? (
          <p className="text-emerald-700">{t("admin.reports.stockOk")}</p>
        ) : (
          <div className="space-y-1">
            <p className="text-amber-800">⚠ {t("admin.reports.alert.need").replace("{count}", String(exceptions.length))}</p>
            <p className="text-coffee/55">
              {t("admin.reports.kpi.purchases")}: {formatReportIls(data?.kpis.monthPurchases ?? null)}
            </p>
            <Link href={href("exceptions")} className="text-turquoise hover:underline">
              {t("admin.reports.openExceptions")}
            </Link>
          </div>
        )}
      </div>
    </AdminCard>
  );
}
