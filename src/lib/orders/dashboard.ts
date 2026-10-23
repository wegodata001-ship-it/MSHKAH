import type { Order, PaymentStatus } from "@/types";
import {
  isActiveOrder,
  isTestOrder,
  operationalStatusOf,
  type OperationalOrderStatus,
} from "@/lib/orders/status";
import { isInJerusalemPeriod, minutesBetween, type OrderStatsPeriod } from "@/lib/orders/time";
import { isOverdueOrder } from "@/lib/orders/overdue";

export type { OrderStatsPeriod };

export type VerifiedPayment = {
  orderId: string;
  status?: string | null;
  amount?: number | null;
  paidAt?: string | null;
  refundAmount?: number | null;
  provider?: string | null;
};

export type OrderDashboardStats = {
  loaded: number;
  received: number;
  preparing: number;
  ready: number;
  deliveredToday: number;
  overdue: number;
  /** Verified net revenue for the selected period. Null when payment data has not loaded. */
  todayRevenue: number | null;
  cashRevenue: number | null;
  cardRevenue: number | null;
  averagePrepMinutes: number | null;
};

function uniqueOrders(orders: Order[]): Order[] {
  const seen = new Set<string>();
  return orders.filter((order) => {
    if (!order.id || seen.has(order.id)) return false;
    seen.add(order.id);
    return true;
  });
}

function during(
  value: string | null | undefined,
  period: OrderStatsPeriod,
  now: Date
): boolean {
  return isInJerusalemPeriod(value, period, now);
}

function isCardOrder(order: Order, payments: VerifiedPayment[]): boolean {
  const method = (order.paymentMethod || "").toLowerCase();
  if (order.paymentProvider === "HYP" || method === "card" || /card|credit|אשראי/.test(method)) return true;
  return payments.some((payment) => payment.provider === "HYP" || payment.provider === "card");
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function revenueForOrder(
  order: Order,
  payments: VerifiedPayment[],
  period: OrderStatsPeriod,
  now: Date
): { cash: number; card: number } | null {
  if (isTestOrder(order) || operationalStatusOf(order) === "cancelled") return { cash: 0, card: 0 };
  const related = payments.filter((payment) => payment.orderId === order.id);
  const paidDocs = related.filter((payment) => payment.status === "paid");
  const status = order.paymentStatus ?? "pending";
  const verified = status === "paid" || status === "refunded" || paidDocs.length > 0;
  if (!verified || (status === "pending" && paidDocs.length === 0)) return { cash: 0, card: 0 };
  const paidAt =
    order.paidAt ||
    paidDocs.find((payment) => payment.paidAt)?.paidAt ||
    (status === "paid" ? order.createdAt : null);
  if (!paidAt || !during(paidAt, period, now)) return { cash: 0, card: 0 };
  const refunded = related.reduce((sum, payment) => sum + (Number(payment.refundAmount) || 0), 0);
  const base = status === "refunded" ? 0 : Number(order.total) || Number(paidDocs[0]?.amount) || 0;
  const net = roundMoney(Math.max(0, base - refunded));
  return isCardOrder(order, paidDocs) ? { cash: 0, card: net } : { cash: net, card: 0 };
}

export function computeOrderDashboard(
  orders: Order[],
  now = new Date(),
  options?: { period?: OrderStatsPeriod; payments?: VerifiedPayment[] | null }
): OrderDashboardStats {
  const period = options?.period ?? "today";
  const payments = options?.payments === undefined ? [] : options.payments;
  const business = uniqueOrders(orders).filter((order) => !isTestOrder(order));
  const open = (order: Order) => operationalStatusOf(order) !== "cancelled";

  const received = business.filter((order) => {
    if (!open(order)) return false;
    return during(order.receivedAt || order.createdAt, period, now);
  }).length;

  const preparing = business.filter((order) => {
    if (!open(order)) return false;
    if (order.preparationStartedAt) return during(order.preparationStartedAt, period, now);
    return period === "all" && operationalStatusOf(order) === "preparing";
  }).length;

  const ready = business.filter((order) => {
    if (!open(order)) return false;
    if (order.readyAt) return during(order.readyAt, period, now);
    return period === "all" && operationalStatusOf(order) === "ready";
  }).length;

  const deliveredToday = business.filter((order) => {
    if (operationalStatusOf(order) !== "delivered") return false;
    const at = order.deliveredAt || order.completedAt;
    if (at) return during(at, period, now);
    return period === "all";
  }).length;

  const overdue = business.filter((order) => isActiveOrder(order) && isOverdueOrder(order, now.getTime())).length;

  const paymentsKnown = payments !== null;
  let cashRevenue: number | null = paymentsKnown ? 0 : null;
  let cardRevenue: number | null = paymentsKnown ? 0 : null;
  if (paymentsKnown && cashRevenue != null && cardRevenue != null) {
    for (const order of business) {
      const part = revenueForOrder(order, payments, period, now);
      if (!part) continue;
      cashRevenue = roundMoney(cashRevenue + part.cash);
      cardRevenue = roundMoney(cardRevenue + part.card);
    }
  }

  const prepDurations = business.flatMap((order) => {
    if (!open(order)) return [];
    const minutes = minutesBetween(order.preparationStartedAt, order.readyAt);
    if (minutes == null || !order.readyAt || !during(order.readyAt, period, now)) return [];
    return [minutes];
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
    todayRevenue: cashRevenue == null || cardRevenue == null ? null : roundMoney(cashRevenue + cardRevenue),
    cashRevenue,
    cardRevenue,
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
