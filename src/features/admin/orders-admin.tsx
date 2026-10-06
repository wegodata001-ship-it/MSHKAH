"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, Search } from "lucide-react";
import { useOrders } from "@/hooks/useOrders";
import { updateOrderStatus } from "@/services";
import { useAuth } from "@/components/providers/auth-provider";
import { OrderItemExtrasDialog } from "@/features/admin/orders/order-item-extras-dialog";
import { OrderCard } from "@/features/admin/orders/order-card";
import { CancelOrderDialog } from "@/features/admin/orders/cancel-order-dialog";
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
  ACTIVE_ORDER_STATUSES,
  ORDER_STATUSES,
  averagePreparationMinutes,
  effectivePaymentStatus,
  isActiveOrder,
  isToday,
  orderSearchText,
} from "@/lib/orders/operations";
import { kitchenTicketHtml, printKitchenTicket } from "@/lib/orders/kitchen-ticket";
import { exportHtmlAsPdf } from "@/lib/export-pdf";
import { useT } from "@/components/providers/locale-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { AdminPageHeader } from "./components/admin-page-header";
import type { Order, OrderStatus, PaymentStatus } from "@/types";

type OrdersTab = "active" | "history";
type DateFilter = "today" | "week" | "all";

export function OrdersAdmin() {
  const t = useT();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const { orders, loading, error } = useOrders();
  const [tab, setTab] = useState<OrdersTab>("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<"pickup" | "delivery" | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, OrderStatus>>({});
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
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

  const todayOrders = useMemo(() => effectiveOrders.filter((order) => isToday(order.createdAt)), [effectiveOrders]);
  const averagePrep = useMemo(() => averagePreparationMinutes(todayOrders), [todayOrders]);
  const todayRevenue = useMemo(
    () =>
      todayOrders
        .filter((order) => order.status !== "cancelled")
        .reduce((sum, order) => sum + order.total, 0),
    [todayOrders]
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    return effectiveOrders
      .filter((order) => (tab === "active" ? isActiveOrder(order) : !isActiveOrder(order)))
      .filter((order) => {
        if (dateFilter === "today") return isToday(order.createdAt);
        if (dateFilter === "week") return now - new Date(order.createdAt).getTime() <= 7 * 86_400_000;
        return true;
      })
      .filter((order) => statusFilter === "all" || order.status === statusFilter)
      .filter((order) => paymentFilter === "all" || effectivePaymentStatus(order) === paymentFilter)
      .filter((order) => typeFilter === "all" || order.orderType === typeFilter)
      .filter((order) => !search || orderSearchText(order).includes(search))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [dateFilter, effectiveOrders, paymentFilter, search, statusFilter, tab, typeFilter]);

  const activeOrders = useMemo(
    () =>
      effectiveOrders
        .filter((order) => isActiveOrder(order) && isToday(order.createdAt))
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

  const kpis: { status: OrderStatus; value: number }[] = [
    { status: "pending", value: todayOrders.filter((order) => order.status === "pending").length },
    { status: "preparing", value: todayOrders.filter((order) => order.status === "preparing").length },
    { status: "ready", value: todayOrders.filter((order) => order.status === "ready").length },
    { status: "delivered", value: todayOrders.filter((order) => order.status === "delivered").length },
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

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(({ status, value }) => (
          <button
            key={status}
            type="button"
            onClick={() => {
              setTab(status === "delivered" ? "history" : "active");
              setDateFilter("today");
              setStatusFilter(status);
            }}
            className="rounded-2xl border border-beige-dark/15 bg-warm-white p-4 text-start shadow-soft transition hover:border-turquoise/40"
          >
            <p className="text-2xl font-bold text-dark-brown dark:text-warm-white">{value}</p>
            <p className="text-sm text-coffee/55">{t(`admin.status.${status}`)}</p>
          </button>
        ))}
        <div className="rounded-2xl border border-beige-dark/15 bg-warm-white p-4 shadow-soft">
          <p className="text-xl font-bold text-turquoise">{formatPrice(todayRevenue)}</p>
          <p className="text-sm text-coffee/55">{t("admin.orders.todayRevenue")}</p>
        </div>
        <div className="rounded-2xl border border-beige-dark/15 bg-warm-white p-4 shadow-soft">
          <p className="text-xl font-bold text-coffee">
            {averagePrep == null
              ? "—"
              : t("admin.orders.minutesShort").replace("{count}", String(averagePrep))}
          </p>
          <p className="text-sm text-coffee/55">{t("admin.orders.averagePrep")}</p>
        </div>
      </div>

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
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as OrderStatus | "all")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.status.all")}</SelectItem>
            {ORDER_STATUSES.map((status) => (
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
          {t(`admin.status.${statusFilter}`)} ×
        </button>
      )}

      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

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
              onToggle={() => setExpanded((current) => (current === order.id ? null : order.id))}
              onStatusChange={(status) =>
                status === "cancelled" ? setCancelOrder(order) : void changeStatus(order, status)
              }
              onCancel={() => setCancelOrder(order)}
              onPrint={() => printKitchenTicket(order)}
              onThermalReprint={() => void reprintThermal(order)}
              onResendCustomerEmail={() => void resendCustomerEmail(order)}
              onExportPdf={() => exportHtmlAsPdf(order.orderNumber, kitchenTicketHtml(order))}
              onCopyNumber={() => {
                void navigator.clipboard.writeText(order.orderNumber).then(
                  () => pushToast(t("admin.orders.numberCopied")),
                  () => pushToast(t("admin.orders.copyFailed"), "error")
                );
              }}
              onEditItem={(itemIndex) => setExtrasDialog({ order, itemIndex })}
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
      <OrderItemExtrasDialog
        order={extrasDialog?.order ?? null}
        itemIndex={extrasDialog?.itemIndex ?? null}
        open={extrasDialog != null}
        onOpenChange={(open) => !open && setExtrasDialog(null)}
      />
      <KitchenView
        open={kitchenOpen}
        orders={activeOrders}
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
