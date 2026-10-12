"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Package,
  ClipboardList,
  Users,
  TrendingUp,
  Calendar,
  Star,
  Activity,
  Layers,
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { useProducts } from "@/hooks/useProducts";
import { useCustomers } from "@/hooks/useCustomers";
import { useOrders } from "@/hooks/useOrders";
import { useAllCategories } from "@/hooks/useProducts";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/components/providers/locale-provider";
import { useAdminPath } from "@/hooks/useAdminPath";
import { AdminPageHeader } from "./components/admin-page-header";
import { AdminKpiCard } from "./components/admin-kpi-card";
import { AdminCard } from "./components/admin-card";
import { AdminEmptyState } from "./components/admin-empty-state";
import { QrLinksGrid } from "./qr-links-admin";
import { DashboardReportsWidget } from "@/features/admin/reports/dashboard-reports-widget";
import { FinanceDashboardWidget } from "@/features/admin/finance-dashboard-widget";
import { BreakEvenDashboardWidget } from "@/features/admin/breakeven/breakeven-widget";
import { isActiveOrder } from "@/lib/orders/status";
import { isJerusalemToday } from "@/lib/orders/time";
import type { OrderStatus } from "@/types";

function isToday(iso: string) {
  return isJerusalemToday(iso);
}

function isThisMonth(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}


export function AdminDashboard() {
  const t = useT();
  const adminPath = useAdminPath();
  const { products, loading: productsLoading } = useProducts();
  const { categories, loading: categoriesLoading } = useAllCategories();
  const { customers, loading: customersLoading } = useCustomers();
  const { orders, loading: ordersLoading } = useOrders();

  const loading = productsLoading || customersLoading || ordersLoading || categoriesLoading;

  const metrics = useMemo(() => {
    const delivered = orders.filter((o) => o.status === "delivered");
    const todayOrders = orders.filter((o) => isToday(o.createdAt));
    const monthOrders = orders.filter((o) => isThisMonth(o.createdAt));
    const activeOrders = orders.filter((o) => isActiveOrder(o));
    const todaySales = todayOrders.reduce((s, o) => s + o.total, 0);
    const monthSales = monthOrders.reduce((s, o) => s + o.total, 0);
    const totalRevenue = delivered.reduce((s, o) => s + o.total, 0);

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const label = d.toLocaleDateString("he-IL", { weekday: "short" });
      const dayOrders = orders.filter(
        (o) => new Date(o.createdAt).toDateString() === d.toDateString()
      );
      return {
        day: label,
        sales: dayOrders.reduce((s, o) => s + o.total, 0),
        orders: dayOrders.length,
      };
    });

    const popularProducts = products
      .filter((p) => p.isPopular)
      .slice(0, 6)
      .map((p) => ({
        name: (p.name_he || p.name_ar || p.name_en).slice(0, 14),
        count: 1,
      }));

    const topCategories = categories.slice(0, 6).map((c) => ({
      name: (c.name_he || c.name_ar || c.name_en).slice(0, 14),
      count: products.filter((p) => p.categoryId === c.id).length,
    }));

    return {
      todaySales,
      monthSales,
      totalRevenue,
      todayOrders: todayOrders.length,
      activeOrders: activeOrders.length,
      chartData: last7Days,
      popularProducts: popularProducts.length ? popularProducts : [{ name: "—", count: 0 }],
      topCategories: topCategories.length ? topCategories : [{ name: "—", count: 0 }],
    };
  }, [orders, products, categories]);

  const statusLabel = (status: OrderStatus) => t(`admin.status.${status}`);

  const statsCards = [
    {
      label: t("admin.totalRevenue"),
      value: formatPrice(metrics.totalRevenue),
      icon: Activity,
      colorClass: "text-gold",
      bgClass: "bg-gold/10",
    },
    {
      label: t("admin.dashboard.todaySales"),
      value: formatPrice(metrics.todaySales),
      icon: Calendar,
      colorClass: "text-turquoise",
      bgClass: "bg-turquoise/10",
    },
    {
      label: t("admin.dashboard.monthSales"),
      value: formatPrice(metrics.monthSales),
      icon: TrendingUp,
      colorClass: "text-coffee",
      bgClass: "bg-coffee/10",
    },
    {
      label: t("admin.dashboard.ordersToday"),
      value: metrics.todayOrders,
      icon: ClipboardList,
      colorClass: "text-turquoise",
      bgClass: "bg-turquoise/10",
    },
    {
      label: t("admin.dashboard.activeOrders"),
      value: metrics.activeOrders,
      icon: Layers,
      colorClass: "text-amber-600",
      bgClass: "bg-amber-500/10",
    },
    {
      label: t("admin.dashboard.customers"),
      value: customers.length,
      icon: Users,
      colorClass: "text-coffee",
      bgClass: "bg-coffee/10",
    },
    {
      label: t("admin.dashboard.products"),
      value: products.length,
      icon: Package,
      colorClass: "text-turquoise",
      bgClass: "bg-turquoise/10",
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("admin.dashboard.title")} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 md:gap-4">
        {statsCards.map((card, i) => (
          <AdminKpiCard key={card.label} {...card} loading={loading} index={i} />
        ))}
      </div>

      <FinanceDashboardWidget />

      <BreakEvenDashboardWidget />

      <DashboardReportsWidget />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-dark-brown dark:text-warm-white">{t("admin.qr.title")}</h2>
        <QrLinksGrid />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCard title={t("admin.dashboard.salesChart")} delay={0.15}>
          <div className="h-52 md:h-56">
            {loading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.chartData}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#007A80" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#007A80" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#3D2B2440" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#3D2B2440" />
                  <Tooltip formatter={(v) => formatPrice(Number(v))} />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="#007A80"
                    fill="url(#salesGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </AdminCard>

        <AdminCard title={t("admin.dashboard.ordersChart")} delay={0.18}>
          <div className="h-52 md:h-56">
            {loading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.chartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#3D2B2440" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#3D2B2440" />
                  <Tooltip />
                  <Bar dataKey="orders" fill="#3D2B24" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </AdminCard>

        <AdminCard
          title={t("admin.dashboard.popularProducts")}
          icon={<Star className="h-4 w-4 text-gold" />}
          delay={0.2}
        >
          <div className="h-52 md:h-56">
            {loading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.popularProducts}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#3D2B2440" />
                  <YAxis hide />
                  <Tooltip />
                  <Bar dataKey="count" fill="#D4A76A" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </AdminCard>

        <AdminCard title={t("admin.dashboard.topCategories")} delay={0.22}>
          <div className="h-52 md:h-56">
            {loading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.topCategories}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#3D2B2440" />
                  <YAxis hide />
                  <Tooltip />
                  <Bar dataKey="count" fill="#007A80" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </AdminCard>
      </div>

      <AdminCard
        title={t("admin.dashboard.recentOrders")}
        action={
          <Link href={adminPath("orders")} className="text-xs font-medium text-turquoise transition-colors hover:underline">
            {t("admin.dashboard.viewAll")}
          </Link>
        }
        delay={0.25}
      >
        <div className="space-y-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))
          ) : orders.length === 0 ? (
            <AdminEmptyState icon={ClipboardList} title={t("admin.dashboard.noOrders")} className="border-0 shadow-none" />
          ) : (
            orders.slice(0, 8).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-xl border border-beige-dark/10 bg-beige/20 px-4 py-3 transition-colors hover:bg-beige/40 dark:border-white/5 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-dark-brown dark:text-warm-white">
                    {order.orderNumber}
                  </p>
                  <p className="truncate text-xs text-coffee/50">{order.customerName}</p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-sm font-bold text-coffee dark:text-warm-white">{formatPrice(order.total)}</p>
                  <p className="text-[10px] text-coffee/50">{statusLabel(order.status)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </AdminCard>
    </div>
  );
}
