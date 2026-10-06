import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  claimNotification,
  markNotificationFailed,
  markNotificationSent,
} from "@/lib/email/notification-state";
import { firestoreOrderToEmailPayload } from "@/lib/email/order-email-payload";
import { sendNewOrderNotificationEmail } from "@/lib/email/send";
import { getBrevoDeliveryStatus } from "@/lib/email/brevo";
import type { FirestoreOrder } from "@/types/firestore";

export type NotifyResult =
  | { status: "sent"; messageId?: string }
  | { status: "already_sent" }
  | { status: "in_progress" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

const FIELD = "newOrderEmail";

/** New order business alert — once per orderId. */
export async function notifyNewOrder(
  orderId: string,
  options?: { force?: boolean }
): Promise<NotifyResult> {
  if (!orderId.trim()) return { status: "skipped", reason: "missing orderId" };

  const ref = getAdminDb().collection(COLLECTIONS.orders).doc(orderId);

  let data: FirestoreOrder;
  try {
    const snap = await ref.get();
    if (!snap.exists) return { status: "skipped", reason: "order_not_found" };
    data = snap.data() as FirestoreOrder;

    // Legacy boolean support
    const legacy = (snap.data() as { notifications?: { newOrderEmailSent?: boolean } })
      .notifications?.newOrderEmailSent;
    if (legacy === true && options?.force !== true) return { status: "already_sent" };

    const claim = await claimNotification(ref, FIELD, { forceResend: options?.force === true });
    if (!claim.ok) {
      if (claim.reason === "already_sent") return { status: "already_sent" };
      return { status: "in_progress" };
    }
  } catch (error) {
    console.error("[email] Email notification failed", {
      kind: "new_order",
      stage: "claim",
      orderId,
      error: error instanceof Error ? error.message : "claim failed",
    });
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Failed to claim",
    };
  }

  const result = await sendNewOrderNotificationEmail(
    firestoreOrderToEmailPayload(orderId, data)
  );

  if (!result.ok) {
    await markNotificationFailed(ref, FIELD, { error: result.error }).catch(() => undefined);
    // Keep legacy false
    await ref.update({ "notifications.newOrderEmailSent": false }).catch(() => undefined);
    return { status: "failed", error: result.error };
  }

  const deliveryStatus = await getBrevoDeliveryStatus(result.messageId);
  await markNotificationSent(ref, FIELD, {
    messageId: result.messageId,
    deliveryStatus,
  }).catch(() => undefined);
  await ref
    .update({ "notifications.newOrderEmailSent": true })
    .catch(() => undefined);

  return { status: "sent", messageId: result.messageId };
}

/** @deprecated use notifyNewOrder */
export const notifyNewOrderEmail = notifyNewOrder;
