import type { Order } from "@/types";
import { operationalStatusOf, type OperationalOrderStatus } from "@/lib/orders/status";
import { parseTimestamp } from "@/lib/orders/time";

export const STAGE_THRESHOLDS = {
  received: { warningMin: 10, criticalMin: 20 },
  preparing: { warningMin: 20, criticalMin: 40 },
  ready: { warningMin: 15, criticalMin: 30 },
} as const;

export const ESCALATION_THRESHOLDS = {
  preparing: 90,
  ready: 60,
} as const;

export type OverdueLevel = "normal" | "warning" | "critical";
export type OverdueAlertKey =
  | "receivedCritical"
  | "preparingCritical"
  | "readyCritical"
  | "preparingEscalation"
  | "readyEscalation";

export function stageStartedAt(order: Order, now = Date.now()): number {
  const status = operationalStatusOf(order);
  if (status === "preparing") {
    return parseTimestamp(order.preparationStartedAt) ?? parseTimestamp(order.confirmedAt) ?? parseTimestamp(order.createdAt) ?? now;
  }
  if (status === "ready") {
    return parseTimestamp(order.readyAt) ?? parseTimestamp(order.preparationStartedAt) ?? parseTimestamp(order.createdAt) ?? now;
  }
  if (status === "delivered") {
    return parseTimestamp(order.deliveredAt) ?? parseTimestamp(order.completedAt) ?? parseTimestamp(order.createdAt) ?? now;
  }
  if (status === "cancelled") {
    return parseTimestamp(order.cancelledAt) ?? parseTimestamp(order.createdAt) ?? now;
  }
  return parseTimestamp(order.receivedAt) ?? parseTimestamp(order.createdAt) ?? now;
}

export function stageAgeMs(order: Order, now = Date.now()): number {
  return Math.max(0, now - stageStartedAt(order, now));
}

export function orderAgeMs(order: Order, now = Date.now()): number {
  return Math.max(0, now - (parseTimestamp(order.createdAt) ?? now));
}

export function overdueLevel(order: Order, now = Date.now()): OverdueLevel {
  const status = operationalStatusOf(order);
  const threshold = STAGE_THRESHOLDS[status as keyof typeof STAGE_THRESHOLDS];
  if (!threshold) return "normal";
  const minutes = stageAgeMs(order, now) / 60_000;
  if (minutes >= threshold.criticalMin) return "critical";
  if (minutes >= threshold.warningMin) return "warning";
  return "normal";
}

export function isOverdueOrder(order: Order, now = Date.now()): boolean {
  return overdueLevel(order, now) !== "normal";
}

const EMAIL_CATCH_WINDOW_MIN = 90;

export function shouldSendCriticalEmail(order: Order, now = Date.now()): boolean {
  const status = operationalStatusOf(order);
  const threshold = STAGE_THRESHOLDS[status as keyof typeof STAGE_THRESHOLDS];
  if (!threshold || overdueLevel(order, now) !== "critical") return false;
  const minutes = stageAgeMs(order, now) / 60_000;
  return minutes <= threshold.criticalMin + EMAIL_CATCH_WINDOW_MIN;
}

export function shouldSendEscalationEmail(order: Order, now = Date.now()): boolean {
  const status = operationalStatusOf(order);
  const escalationMin = ESCALATION_THRESHOLDS[status as keyof typeof ESCALATION_THRESHOLDS];
  if (escalationMin == null || !escalationDue(order, now)) return false;
  return stageAgeMs(order, now) / 60_000 <= escalationMin + EMAIL_CATCH_WINDOW_MIN;
}

export function escalationDue(order: Order, now = Date.now()): boolean {
  const status = operationalStatusOf(order);
  const minutes = stageAgeMs(order, now) / 60_000;
  if (status === "preparing") return minutes >= ESCALATION_THRESHOLDS.preparing;
  if (status === "ready") return minutes >= ESCALATION_THRESHOLDS.ready;
  return false;
}

export function criticalAlertKey(status: OperationalOrderStatus): OverdueAlertKey | null {
  if (status === "received") return "receivedCritical";
  if (status === "preparing") return "preparingCritical";
  if (status === "ready") return "readyCritical";
  return null;
}

export function escalationAlertKey(status: OperationalOrderStatus): OverdueAlertKey | null {
  if (status === "preparing") return "preparingEscalation";
  if (status === "ready") return "readyEscalation";
  return null;
}
