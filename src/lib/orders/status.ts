import type { Order, OrderStatus } from "@/types";

export const BUSINESS_TIMEZONE = "Asia/Jerusalem";

export const OPERATIONAL_STATUSES = [
  "received",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
] as const;

export type OperationalOrderStatus = (typeof OPERATIONAL_STATUSES)[number];

const RECEIVED_ALIASES = new Set([
  "pending",
  "confirmed",
  "received",
  "new",
  "placed",
  "accepted",
  "open",
]);
const PREPARING_ALIASES = new Set([
  "preparing",
  "in_progress",
  "in-progress",
  "cooking",
  "prep",
]);
const READY_ALIASES = new Set(["ready", "done", "awaiting_pickup", "awaiting-pickup"]);
const DELIVERED_ALIASES = new Set([
  "delivered",
  "completed",
  "complete",
  "closed",
  "picked_up",
  "picked-up",
]);
const CANCELLED_ALIASES = new Set(["cancelled", "canceled", "void"]);

export function normalizeOrderStatus(raw: unknown): OperationalOrderStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (RECEIVED_ALIASES.has(value)) return "received";
  if (PREPARING_ALIASES.has(value)) return "preparing";
  if (READY_ALIASES.has(value)) return "ready";
  if (DELIVERED_ALIASES.has(value)) return "delivered";
  if (CANCELLED_ALIASES.has(value)) return "cancelled";
  return "received";
}

export function toStoredOrderStatus(status: OperationalOrderStatus): OrderStatus {
  if (status === "received") return "pending";
  return status;
}

export function operationalStatusOf(order: Pick<Order, "status">): OperationalOrderStatus {
  return normalizeOrderStatus(order.status);
}

export function isActiveOperationalStatus(status: OperationalOrderStatus): boolean {
  return status === "received" || status === "preparing" || status === "ready";
}

export function isActiveOrder(order: Pick<Order, "status">): boolean {
  return isActiveOperationalStatus(operationalStatusOf(order));
}

export function isTestOrder(order: Pick<Order, "isTestOrder">): boolean {
  return order.isTestOrder === true;
}

export function nextOperationalStatus(
  status: OperationalOrderStatus
): OperationalOrderStatus | null {
  if (status === "received") return "preparing";
  if (status === "preparing") return "ready";
  if (status === "ready") return "delivered";
  return null;
}

export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
  const next = nextOperationalStatus(normalizeOrderStatus(status));
  return next ? toStoredOrderStatus(next) : null;
}

export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
];

export const OPERATIONAL_FILTERS: OperationalOrderStatus[] = [...OPERATIONAL_STATUSES];
