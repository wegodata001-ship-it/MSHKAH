import type { Order, PaymentStatus } from "@/types";
import {
  isActiveOrder,
  isTestOrder,
  operationalStatusOf,
  type OperationalOrderStatus,
} from "@/lib/orders/status";
import { isJerusalemToday, minutesBetween } from "@/lib/orders/time";
import { isOverdueOrder } from "@/lib/orders/overdue";

export type OrderDashboardStats = {
  loaded: number;
  received: number;
  preparing: number;
  ready: number;
  deliveredToday: number;
  overdue: number;
  todayRevenue: number;
  averagePrepMinutes: number | null;
};

function paidAt(order: Order): string | null {
  return order.paidAt || (order.paymentStatus === "paid" ? order.createdAt : null);
}

export function computeOrderDashboard(orders: Order[], now = new Date()): OrderDashboardStats {
  const business = orders.filter((order) => !isTestOrder(order));
  const received = business.filter((order) => operationalStatusOf(order) === "received").length;
  const preparing = business.filter((order) => operationalStatusOf(order) === "preparing").length;
  const ready = business.filter((order) => operationalStatusOf(order) === "ready").length;
  const deliveredToday = business.filter(
    (order) =>
      operationalStatusOf(order) === "delivered" &&
      isJerusalemToday(order.deliveredAt || order.completedAt || order.createdAt, now)
  ).length;
  const overdue = business.filter((order) => isActiveOrder(order) && isOverdueOrder(order, now.getTime())).length;
  const todayRevenue = business
    .filter((order) => {
      if (operationalStatusOf(order) === "cancelled") return false;
      if (order.paymentStatus !== "paid") return false;
      return isJerusalemToday(paidAt(order), now);
    })
    .reduce((sum, order) => sum + (order.total || 0), 0);

  const prepDurations = business.flatMap((order) => {
    const minutes = minutesBetween(order.preparationStartedAt, order.readyAt);
    return minutes == null ? [] : [minutes];
  });
  const averagePrepMinutes =
    prepDurations.length === 0
      ? null
      : Math.round(prepDurations.reduce((sum, value) => sum + value, 0) / prepDurations.length);

  return {
    loaded: orders.length,
    received,
    preparing,
    ready,
    deliveredToday,
    overdue,
    todayRevenue,
    averagePrepMinutes,
  };
}

export function matchesOperationalFilter(order: Order, filter: OperationalOrderStatus | "all" | "overdue"): boolean {
  if (filter === "all") return true;
  if (filter === "overdue") return isActiveOrder(order) && isOverdueOrder(order);
  return operationalStatusOf(order) === filter;
}

export function effectivePaymentStatus(order: Pick<Order, "paymentStatus">): PaymentStatus {
  return order.paymentStatus ?? "pending";
}
