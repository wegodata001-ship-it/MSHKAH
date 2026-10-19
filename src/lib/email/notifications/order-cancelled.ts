import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  claimNotification,
  markNotificationFailed,
  markNotificationSent,
} from "@/lib/email/notification-state";
import { firestoreOrderToEmailPayload } from "@/lib/email/order-email-payload";
import { sendOrderCancelledNotificationEmail } from "@/lib/email/send";
import type { NotifyResult } from "@/lib/email/notifications/new-order";
import type { FirestoreOrder } from "@/types/firestore";
import { refundOrderPoints } from "@/lib/loyalty/admin/members";
import { toMinor } from "@/lib/loyalty/points-math";

const FIELD = "orderCancelledEmail";

export async function notifyOrderCancelled(orderId: string): Promise<NotifyResult> {
  if (!orderId.trim()) return { status: "skipped", reason: "missing orderId" };

  const ref = getAdminDb().collection(COLLECTIONS.orders).doc(orderId);

  let data: FirestoreOrder;
  try {
    const snap = await ref.get();
    if (!snap.exists) return { status: "skipped", reason: "order_not_found" };
    data = snap.data() as FirestoreOrder;

    const claim = await claimNotification(ref, FIELD);
    if (!claim.ok) {
      if (claim.reason === "already_sent") return { status: "already_sent" };
      return { status: "in_progress" };
    }
  } catch (error) {
    console.error("[email] Email notification failed", {
      kind: "order_cancelled",
      stage: "claim",
      orderId,
      error: error instanceof Error ? error.message : "claim failed",
    });
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Failed to claim",
    };
  }

  // Reverse the loyalty points that were awarded when this order was paid.
  // The ledger entry is idempotent (`refund:${orderId}`), so even if the
  // admin flips the status back to cancelled a second time nothing moves.
  try {
    const refundedAmountMinor = toMinor(Number(data.total) || 0);
    await refundOrderPoints(getAdminDb(), {
      orderId,
      refundedAmountMinor,
    });
  } catch (error) {
    console.error("[loyalty] refund hook failed on cancel", {
      orderId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  const result = await sendOrderCancelledNotificationEmail({
    ...firestoreOrderToEmailPayload(orderId, data),
    cancelReason: data.cancelReason,
  });

  if (!result.ok) {
    await markNotificationFailed(ref, FIELD, { error: result.error }).catch(() => undefined);
    return { status: "failed", error: result.error };
  }

  await markNotificationSent(ref, FIELD, { messageId: result.messageId }).catch(
    () => undefined
  );
  return { status: "sent", messageId: result.messageId };
}
