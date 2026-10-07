import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { getAdminNotificationEmail, getPortalAdminOrderUrl } from "@/lib/email/config";
import { sendOverdueOrderEmail } from "@/lib/email/send";
import { mapOrder } from "@/lib/mappers";
import {
  criticalAlertKey,
  escalationAlertKey,
  shouldSendCriticalEmail,
  shouldSendEscalationEmail,
  stageAgeMs,
  type OverdueAlertKey,
} from "@/lib/orders/overdue";
import { isTestOrder, operationalStatusOf } from "@/lib/orders/status";
import { describeAge } from "@/lib/orders/time";
import type { FirestoreOrder } from "@/types/firestore";
import type { Order } from "@/types";

const ACTIVE_STORED = ["pending", "confirmed", "preparing", "ready"] as const;
const STALE_SENDING_MS = 2 * 60 * 1000;

const STATUS_AR: Record<string, string> = {
  received: "تم الاستلام",
  preparing: "قيد التحضير",
  ready: "جاهز",
};

function waitLabelAr(ms: number): string {
  const age = describeAge(ms);
  if (age.kind === "justNow") return "أقل من دقيقة";
  if (age.kind === "minutes") return `${age.count} دقيقة`;
  if (age.kind === "hourMinutes") return `ساعة و ${age.minutes} دقيقة`;
  if (age.kind === "hoursMinutes") return `${age.hours} ساعات و ${age.minutes} دقيقة`;
  if (age.kind === "dayHours") return `يوم و ${age.hours} ساعات`;
  if (age.kind === "daysHours") return `${age.days} أيام و ${age.hours} ساعة`;
  return `${age.days} أيام`;
}

function alertStatus(order: Order, key: OverdueAlertKey): string | undefined {
  return order.alerts?.[key]?.status;
}

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

async function claimAlert(orderId: string, key: OverdueAlertKey): Promise<"claimed" | "already_sent" | "in_progress"> {
  const ref = getAdminDb().collection(COLLECTIONS.orders).doc(orderId);
  return ref.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("order_not_found");
    const current = (snap.data() as FirestoreOrder).alerts?.[key];
    if (current?.status === "SENT") return "already_sent";
    if (current?.status === "SENDING") {
      const claimed = toMillis(current.claimedAt ?? current.lastAttemptAt) ?? 0;
      if (Date.now() - claimed <= STALE_SENDING_MS) return "in_progress";
    }
    tx.update(ref, {
      [`alerts.${key}`]: {
        status: "SENDING",
        attemptedAt: FieldValue.serverTimestamp(),
        claimedAt: FieldValue.serverTimestamp(),
        lastAttemptAt: FieldValue.serverTimestamp(),
        attempts: (current?.attempts ?? 0) + 1,
      },
    });
    return "claimed";
  });
}

async function markAlert(
  orderId: string,
  key: OverdueAlertKey,
  result: { ok: true; messageId?: string } | { ok: false; error: string }
) {
  const ref = getAdminDb().collection(COLLECTIONS.orders).doc(orderId);
  if (result.ok) {
    await ref.update({
      [`alerts.${key}`]: {
        status: "SENT",
        sentAt: FieldValue.serverTimestamp(),
        lastAttemptAt: FieldValue.serverTimestamp(),
        messageId: result.messageId ?? null,
      },
    });
    return;
  }
  await ref.update({
    [`alerts.${key}`]: {
      status: "FAILED",
      attemptedAt: FieldValue.serverTimestamp(),
      failedAt: FieldValue.serverTimestamp(),
      lastAttemptAt: FieldValue.serverTimestamp(),
      lastError: result.error.slice(0, 300),
    },
  });
}

async function sendIfNeeded(order: Order, key: OverdueAlertKey, escalation: boolean) {
  if (alertStatus(order, key) === "SENT") return { orderId: order.id, key, status: "already_sent" as const };
  const claim = await claimAlert(order.id, key);
  if (claim !== "claimed") return { orderId: order.id, key, status: claim };
  const result = await sendOverdueOrderEmail({
    orderNumber: order.orderNumber,
    statusLabel: STATUS_AR[operationalStatusOf(order)] ?? operationalStatusOf(order),
    waitLabel: waitLabelAr(stageAgeMs(order)),
    total: order.total,
    customerName: order.customerFullName || order.customerName,
    customerPhone: order.customerPhone,
    createdAt: order.createdAt,
    viewUrl: getPortalAdminOrderUrl(order.id),
    escalation,
  });
  if (result.ok) {
    await markAlert(order.id, key, { ok: true, messageId: result.messageId });
    return { orderId: order.id, key, status: "sent" as const };
  }
  await markAlert(order.id, key, { ok: false, error: result.error });
  return { orderId: order.id, key, status: "failed" as const, error: result.error };
}

export async function checkOverdueOrderAlerts(options?: { dryRun?: boolean }) {
  const recipient = getAdminNotificationEmail();
  const snap = await getAdminDb()
    .collection(COLLECTIONS.orders)
    .where("status", "in", [...ACTIVE_STORED])
    .get();

  const results: Array<Record<string, unknown>> = [];
  for (const doc of snap.docs) {
    const order = mapOrder({ id: doc.id, ...(doc.data() as FirestoreOrder) });
    if (isTestOrder(order)) continue;
    const status = operationalStatusOf(order);
    if (shouldSendCriticalEmail(order)) {
      const key = criticalAlertKey(status);
      if (key) {
        results.push(
          options?.dryRun
            ? { orderId: order.id, key, status: "dry_run", waitMin: Math.round(stageAgeMs(order) / 60_000) }
            : await sendIfNeeded(order, key, false)
        );
      }
    }
    if (shouldSendEscalationEmail(order)) {
      const key = escalationAlertKey(status);
      if (key) {
        results.push(
          options?.dryRun
            ? { orderId: order.id, key, status: "dry_run_escalation" }
            : await sendIfNeeded(order, key, true)
        );
      }
    }
  }

  return {
    scanned: snap.size,
    recipientMasked: recipient ? `${recipient.slice(0, 2)}***@${recipient.split("@")[1] ?? ""}` : "",
    usedCustomerEmail: false,
    results,
  };
}
