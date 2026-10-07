import type { Order, OrderStatus, PaymentStatus } from "@/types";
import { orderAgeMs } from "@/lib/orders/overdue";
import { minutesBetween } from "@/lib/orders/time";

export { ORDER_STATUSES, nextOrderStatus, isActiveOrder } from "@/lib/orders/status";
export { effectivePaymentStatus } from "@/lib/orders/dashboard";
export { isJerusalemToday as isToday } from "@/lib/orders/time";

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
];

export function orderAgeMinutes(order: Order, now = Date.now()): number {
  return Math.max(0, Math.floor(orderAgeMs(order, now) / 60_000));
}

export function averagePreparationMinutes(orders: Order[]): number | null {
  const durations = orders.flatMap((order) => {
    if (order.isTestOrder) return [];
    const duration = minutesBetween(order.preparationStartedAt, order.readyAt);
    return duration == null ? [] : [duration];
  });
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

export function orderSearchText(order: Order): string {
  return [
    order.orderNumber,
    order.customerName,
    order.customerPhone,
    order.notes,
    ...order.items.flatMap((item) => [
      item.productName,
      item.notes,
      ...(item.modifiers?.flatMap((modifier) => [
        modifier.groupName,
        modifier.optionName,
        modifier.kitchenNote,
      ]) ?? []),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export type { OrderStatus, PaymentStatus };
