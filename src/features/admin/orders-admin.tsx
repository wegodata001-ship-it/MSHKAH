"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, ChefHat, Inbox, PackageCheck, Search, Timer, Wallet } from "lucide-react";
import { useOrders } from "@/hooks/useOrders";
import { useClubMembers } from "@/hooks/useClubMembers";
import { updateOrderStatus } from "@/services";
import { subscribeToPaymentFacts } from "@/services/orderService";
import { useAuth } from "@/components/providers/auth-provider";
import { OrderItemExtrasDialog } from "@/features/admin/orders/order-item-extras-dialog";
import { OrderCard } from "@/features/admin/orders/order-card";
import { CancelOrderDialog } from "@/features/admin/orders/cancel-order-dialog";
import { PermanentDeleteOrderDialog } from "@/features/admin/orders/permanent-delete-dialog";
import { isAdminRole } from "@/lib/auth/roles";
import { KitchenView } from "@/features/admin/orders/kitchen-view";
import { AdminToastStack, createToast, type AdminToast } from "@/features/admin/components/admin-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice, cn } from "@/lib/utils";
import {
  effectivePaymentStatus,
  isActiveOrder,
  isToday,
  orderSearchText,
} from "@/lib/orders/operations";
import { computeOrderDashboard, matchesOperationalFilter, type OrderStatsPeriod, type VerifiedPayment } from "@/lib/orders/dashboard";
import {
  OPERATIONAL_FILTERS,
  type OperationalOrderStatus,
} from "@/lib/orders/status";
import { formatDuration } from "@/lib/orders/format-age";
import { kitchenTicketHtml, printKitchenTicket } from "@/lib/orders/kitchen-ticket";
import { exportHtmlAsPdf } from "@/lib/export-pdf";
import { useT } from "@/components/providers/locale-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { AdminPageHeader } from "./components/admin-page-header";
import type { Order, OrderStatus, PaymentStatus } from "@/types";

type OrdersTab = "active" | "history";
type DateFilter = "today" | "week" | "all";
type StatusFilter = OperationalOrderStatus | "all" | "overdue";

const PERIODS: OrderStatsPeriod[] = ["today", "yesterday", "7d", "30d", "all"];

export function OrdersAdmin() {
  const t = useT();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const { orders, loading, error } = useOrders();
  const { byEmail: clubMembersByEmail } = useClubMembers();
  const [tab, setTab] = useState<OrdersTab>("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [statsPeriod, setStatsPeriod] = useState<OrderStatsPeriod>("today");
  const [payments, setPayments] = useState<VerifiedPayment[] | null>(null);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [now, setNow] = useState(() => Date.now());
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<"pickup" | "delivery" | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, OrderStatus>>({});
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [deleteOrder, setDeleteOrder] = useState<Order | null>(null);
  const [kitchenOpen, setKitchenOpen] = useState(false);
  const [toasts, setToasts] = useState<AdminToast[]>([]);
  const [extrasDialog, setExtrasDialog] = useState<{ order: Order; itemIndex: number } | null>(null);
  const knownOrderIds = useRef<Set<string>>(new Set());
  const realtimeReady = useRef(false);
  const updatesInFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim().toLocaleLowerCase()), 275);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return subscribeToPaymentFacts(
      (rows) => {
        setPayments(rows);
        setPaymentsError(null);
      },
      (message) => {
        setPayments(null);
        setPaymentsError(message);
      }
    );
  }, []);

  useEffect(() => {
    if (!realtimeReady.current) {
      knownOrderIds.current = new Set(orders.map((order) => order.id));
      if (!loading) realtimeReady.current = true;
      return;
    }
    const newOrders = orders.filter((order) => !knownOrderIds.current.has(order.id));
    newOrders.forEach((order) => {
      setToasts((current) => [
        ...current,
        createToast(
          `${t("admin.orders.newReceived")} — ${order.orderNumber} · ${formatPrice(order.total)}`
        ),
      ]);
    });
    knownOrderIds.current = new Set(orders.map((order) => order.id));
  }, [orders, loading, t]);

  useEffect(() => {
    setOptimistic((current) => {
      const next = { ...current };
      let changed = false;
      orders.forEach((order) => {
        if (next[order.id] === order.status) {
          delete next[order.id];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [orders]);

  const effectiveOrders = useMemo(
    () => orders.map((order) => ({ ...order, status: optimistic[order.id] ?? order.status })),
    [orders, optimistic]
  );

  const stats = useMemo(
    () => computeOrderDashboard(effectiveOrders, new Date(now), { period: statsPeriod, payments }),
    [effectiveOrders, now, payments, statsPeriod]
  );
  const statsUnavailable = Boolean(error) && orders.length === 0;

  const filtered = useMemo(() => {
    return effectiveOrders
      .filter((order) => (tab === "active" ? isActiveOrder(order) : !isActiveOrder(order)))
      .filter((order) => {
        if (dateFilter === "today") return isToday(order.createdAt);
        if (dateFilter === "week") return now - new Date(order.createdAt).getTime() <= 7 * 86_400_000;
        return true;
      })
      .filter((order) => matchesOperationalFilter(order, statusFilter))
      .filter((order) => paymentFilter === "all" || effectivePaymentStatus(order) === paymentFilter)
      .filter((order) => typeFilter === "all" || order.orderType === typeFilter)
      .filter((order) => !search || orderSearchText(order).includes(search))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [dateFilter, effectiveOrders, now, paymentFilter, search, statusFilter, tab, typeFilter]);

  const activeOrders = useMemo(
    () =>
      effectiveOrders
        .filter((order) => isActiveOrder(order))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [effectiveOrders]
  );

  const pushToast = (message: string, type: "success" | "error" = "success") =>
    setToasts((current) => [...current, createToast(message, type)]);

  const changeStatus = async (order: Order, status: OrderStatus, cancelReason?: string) => {
    if (updatesInFlight.current.has(order.id) || order.status === status) return false;
    updatesInFlight.current.add(order.id);
    setUpdatingIds((current) => new Set(current).add(order.id));
    setOptimistic((current) => ({ ...current, [order.id]: status }));

    const result = await updateOrderStatus(order.id, status, {
      cancelReason,
      cancelledBy: user?.email ?? user?.uid ?? "admin",
    });
    if (!result.success) {
      setOptimistic((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      pushToast(t("admin.orders.statusError"), "error");
    } else {
      pushToast(t("admin.orders.statusSaved"));
    }
    setUpdatingIds((current) => {
      const next = new Set(current);
      next.delete(order.id);
      return next;
    });
    updatesInFlight.current.delete(order.id);
    return result.success;
  };

  const resendCustomerEmail = async (order: Order) => {
    try {
      const res = await authFetch(`/api/admin/orders/${order.id}/retry-customer-email`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        pushToast(json.error || t("admin.payment.resendEmail"), "error");
        return;
      }
      pushToast(t("admin.payment.resendEmail"));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Email retry failed", "error");
    }
  };

  const resendAdminEmail = async (order: Order) => {
    try {
      const res = await authFetch(`/api/admin/orders/${order.id}/retry-admin-email`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        pushToast(json.error || t("admin.payment.resendAdminEmail"), "error");
        return;
      }
      pushToast(t("admin.payment.resendAdminEmail"));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Admin email retry failed", "error");
    }
  };

  const reprintThermal = async (order: Order) => {
    try {
      const res = await authFetch("/api/admin/printer/reprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, locale: order.locale }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        pushToast(json.error || t("admin.printer.reprint", "Reprint"), "error");
        return;
      }
      pushToast(t("admin.orders.thermalReprint", "הדפס מחדש"));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Reprint failed", "error");
    }
  };

  const periodLabel = t(
    statsPeriod === "today"
      ? "admin.orders.today"
      : statsPeriod === "yesterday"
        ? "admin.orders.period.yesterday"
        : statsPeriod === "7d"
          ? "admin.orders.lastWeek"
          : statsPeriod === "30d"
            ? "admin.orders.period.days30"
            : "admin.orders.period.all"
  );
  const countText = (value: number) => (statsUnavailable || (loading && orders.length === 0) ? "—" : value);
  const kpis: { key: StatusFilter; icon: typeof Inbox; value: string | number; hint: string }[] = [
    { key: "received", icon: Inbox, value: countText(stats.received), hint: t("admin.orders.kpi.receivedHint") },
    { key: "preparing", icon: ChefHat, value: countText(stats.preparing), hint: t("admin.orders.kpi.preparingHint") },
    { key: "ready", icon: BadgeCheck, value: countText(stats.ready), hint: t("admin.orders.kpi.readyHint") },
    { key: "delivered", icon: PackageCheck, value: countText(stats.deliveredToday), hint: t("admin.orders.kpi.deliveredHint") },
  ];

  return (
    <div>
      <AdminPageHeader
        title={t("admin.orders.title")}
        subtitle={t("admin.orders.operationsSubtitle")}
        actions={
          <Button variant="turquoise" onClick={() => setKitchenOpen(true)}>
            <ChefHat className="h-4 w-4" />
            {t("admin.orders.kitchenView")}
          </Button>
        }
      />

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-coffee/60">{periodLabel}</p>
        <Select value={statsPeriod} onValueChange={(value) => setStatsPeriod(value as OrderStatsPeriod)}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(
                  value === "today"
                    ? "admin.orders.today"
                    : value === "yesterday"
                      ? "admin.orders.period.yesterday"
                      : value === "7d"
                        ? "admin.orders.lastWeek"
                        : value === "30d"
                          ? "admin.orders.period.days30"
                          : "admin.orders.period.all"
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {statsUnavailable && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      {paymentsError && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{t("admin.orders.paymentsError")}</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(({ key, icon: Icon, value, hint }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key === "delivered" ? "history" : "active");
              setDateFilter(statsPeriod === "today" ? "today" : statsPeriod === "7d" ? "week" : "all");
              setStatusFilter(key);
            }}
            className={cn(
              "min-w-0 rounded-2xl border bg-warm-white p-4 text-start shadow-soft transition hover:border-turquoise/40",
              statusFilter === key ? "border-turquoise" : "border-beige-dark/15"
            )}
          >
            <Icon className="mb-2 h-4 w-4 text-turquoise" />
            <p className="text-2xl font-bold text-dark-brown dark:text-warm-white">{loading && orders.length === 0 ? <Skeleton className="h-8 w-16" /> : value}</p>
            <p className="text-sm text-coffee/55">{t(`admin.status.${key}`)}</p>
            <p className="mt-1 text-[11px] leading-4 text-coffee/40">{hint}</p>
            <p className="mt-1 text-[11px] text-coffee/35">{periodLabel}</p>
          </button>
        ))}
        <div className="min-w-0 rounded-2xl border border-beige-dark/15 bg-warm-white p-4 shadow-soft">
          <Wallet className="mb-2 h-4 w-4 text-turquoise" />
          <p className="text-xl font-bold text-turquoise">
            {loading && orders.length === 0 ? <Skeleton className="h-7 w-20" /> : stats.todayRevenue == null ? "—" : formatPrice(stats.todayRevenue)}
          </p>
          <p className="text-sm text-coffee/55">{statsPeriod === "today" ? t("admin.orders.todayRevenue") : t("admin.orders.periodRevenue")}</p>
          {stats.cashRevenue != null && stats.cardRevenue != null && (
            <p className="mt-1 text-[11px] leading-4 text-coffee/50">
              {t("admin.orders.cashCard").replace("{cash}", formatPrice(stats.cashRevenue)).replace("{card}", formatPrice(stats.cardRevenue))}
            </p>
          )}
          <p className="mt-1 text-[11px] leading-4 text-coffee/40">{t("admin.orders.kpi.revenueHint")}</p>
          <p className="mt-1 text-[11px] text-coffee/35">{periodLabel}</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-beige-dark/15 bg-warm-white p-4 shadow-soft">
          <Timer className="mb-2 h-4 w-4 text-turquoise" />
          <p className="text-xl font-bold text-coffee">
            {loading && orders.length === 0 ? (
              <Skeleton className="h-7 w-16" />
            ) : stats.averagePrepMinutes == null ? (
              "—"
            ) : (
              formatDuration(t, stats.averagePrepMinutes * 60_000)
            )}
          </p>
          <p className="text-sm text-coffee/55">{t("admin.orders.averagePrep")}</p>
          <p className="mt-1 text-[11px] leading-4 text-coffee/40">{t("admin.orders.kpi.prepHint")}</p>
          <p className="mt-1 text-[11px] text-coffee/35">{periodLabel}</p>
        </div>
      </div>
      {stats.overdue > 0 && !statsUnavailable && (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-amber-800"
          onClick={() => {
            setTab("active");
            setStatusFilter("overdue");
          }}
        >
          {t("admin.orders.overdue")}: {stats.overdue}
        </button>
      )}

      <div className="mt-5 flex gap-2 border-b border-beige-dark/20">
        {(["active", "history"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
              setStatusFilter("all");
            }}
            className={cn(
              "border-b-2 px-4 py-3 text-sm font-semibold",
              tab === value ? "border-turquoise text-turquoise" : "border-transparent text-coffee/55"
            )}
          >
            {t(`admin.orders.tab.${value}`)}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl bg-warm-white p-3 shadow-soft sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("admin.orders.searchV2")}
            className="h-10 w-full rounded-xl border border-beige-dark/30 bg-warm-white ps-10 pe-3 text-sm"
          />
        </div>
        <Select value={dateFilter} onValueChange={(value) => setDateFilter(value as DateFilter)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">{t("admin.orders.today")}</SelectItem>
            <SelectItem value="week">{t("admin.orders.lastWeek")}</SelectItem>
            <SelectItem value="all">{t("admin.status.all")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.status.all")}</SelectItem>
            <SelectItem value="overdue">{t("admin.orders.overdue")}</SelectItem>
            {OPERATIONAL_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>{t(`admin.status.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentFilter} onValueChange={(value) => setPaymentFilter(value as PaymentStatus | "all")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.orders.allPayments")}</SelectItem>
            {(["pending", "paid", "failed", "refunded"] as PaymentStatus[]).map((status) => (
              <SelectItem key={status} value={status}>{t(`admin.payment.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.orders.allTypes")}</SelectItem>
            <SelectItem value="pickup">{t("admin.orders.type.pickup")}</SelectItem>
            <SelectItem value="delivery">{t("admin.orders.type.delivery")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {statusFilter !== "all" && (
        <button className="mt-3 text-sm text-turquoise" onClick={() => setStatusFilter("all")}>
          {statusFilter === "overdue" ? t("admin.orders.overdue") : t(`admin.status.${statusFilter}`)} ×
        </button>
      )}

      {error && orders.length > 0 && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-beige-dark/30 p-12 text-center text-coffee/55">
          {t("admin.orders.noResults")}
        </div>
      ) : (
        <div className="mt-5 grid items-start gap-4 md:grid-cols-2">
          {filtered.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              expanded={expanded === order.id}
              updating={updatingIds.has(order.id)}
              now={now}
              onToggle={() => setExpanded((current) => (current === order.id ? null : order.id))}
              onStatusChange={(status) =>
                status === "cancelled" ? setCancelOrder(order) : void changeStatus(order, status)
              }
              onCancel={() => setCancelOrder(order)}
              onPrint={() => printKitchenTicket(order)}
              onThermalReprint={() => void reprintThermal(order)}
              onResendCustomerEmail={() => void resendCustomerEmail(order)}
              onResendAdminEmail={() => void resendAdminEmail(order)}
              onExportPdf={() => exportHtmlAsPdf(order.orderNumber, kitchenTicketHtml(order))}
              onCopyNumber={() => {
                void navigator.clipboard.writeText(order.orderNumber).then(
                  () => pushToast(t("admin.orders.numberCopied")),
                  () => pushToast(t("admin.orders.copyFailed"), "error")
                );
              }}
              onEditItem={(itemIndex) => setExtrasDialog({ order, itemIndex })}
              onPermanentDelete={user && isAdminRole(user.role) ? () => setDeleteOrder(order) : undefined}
              isClubMember={(() => {
                const email = order.customerEmail?.trim().toLowerCase();
                if (!email) return false;
                return clubMembersByEmail.get(email)?.status === "active";
              })()}
            />
          ))}
        </div>
      )}

      <CancelOrderDialog
        order={cancelOrder}
        open={cancelOrder != null}
        saving={cancelOrder ? updatingIds.has(cancelOrder.id) : false}
        onOpenChange={(open) => !open && setCancelOrder(null)}
        onConfirm={(reason) => {
          if (!cancelOrder) return;
          void changeStatus(cancelOrder, "cancelled", reason).then((saved) => {
            if (saved) setCancelOrder(null);
          });
        }}
      />
      <PermanentDeleteOrderDialog
        order={deleteOrder}
        open={deleteOrder != null}
        onOpenChange={(open) => !open && setDeleteOrder(null)}
        onDeleted={() => pushToast(t("admin.orders.permanentlyDeleted"))}
      />
      <OrderItemExtrasDialog
        order={extrasDialog?.order ?? null}
        itemIndex={extrasDialog?.itemIndex ?? null}
        open={extrasDialog != null}
        onOpenChange={(open) => !open && setExtrasDialog(null)}
      />
      <KitchenView
        open={kitchenOpen}
        orders={activeOrders}
        now={now}
        updatingIds={updatingIds}
        onClose={() => setKitchenOpen(false)}
        onStatusChange={(order, status) =>
          status === "cancelled" ? setCancelOrder(order) : void changeStatus(order, status)
        }
        onCancel={setCancelOrder}
        onPrint={printKitchenTicket}
        onThermalReprint={(order) => void reprintThermal(order)}
      />
      <AdminToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </div>
  );
}
