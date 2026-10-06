import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  claimNotification,
  markNotificationFailed,
  markNotificationSent,
} from "@/lib/email/notification-state";
import { firestoreOrderToEmailPayload } from "@/lib/email/order-email-payload";
import { sendMishkahEmail } from "@/lib/email/send";
import { getBrevoDeliveryStatus } from "@/lib/email/brevo";
import {
  customerRetryUrl,
  renderCustomerPaymentFailedEmail,
  renderCustomerPaymentSuccessEmail,
} from "@/lib/email/customer-payment-templates";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import { paymentAudit } from "@/lib/payments/hyp/audit";
import type { FirestoreOrder } from "@/types/firestore";
import type { NotifyResult } from "@/lib/email/notifications/new-order";

const SUCCESS_FIELD = "customerConfirmationEmail";
const FAILURE_FIELD = "customerFailureEmail";

function localeOf(order: FirestoreOrder): "ar" | "he" | "en" {
  return order.locale === "ar" || order.locale === "en" ? order.locale : "he";
}

export async function notifyCustomerPaymentSuccess(
  orderId: string,
  options?: { force?: boolean }
): Promise<NotifyResult> {
  if (!orderId.trim()) return { status: "skipped", reason: "missing orderId" };
  const ref = getAdminDb().collection(COLLECTIONS.orders).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return { status: "skipped", reason: "order_not_found" };
  const data = snap.data() as FirestoreOrder;
  const email = normalizeCustomerEmail(data.customerEmail);
  if (!email) return { status: "skipped", reason: "no_customer_email" };
  if (email !== (data.customerEmail ?? "").trim().toLowerCase()) {
    await ref.update({ customerEmail: email }).catch(() => undefined);
  }

  const claim = await claimNotification(ref, SUCCESS_FIELD, {
    allowRetryFailed: true,
    forceResend: options?.force === true,
  });
  if (!claim.ok) {
    if (claim.reason === "already_sent") return { status: "already_sent" };
    return { status: "in_progress" };
  }

  const content = renderCustomerPaymentSuccessEmail(
    firestoreOrderToEmailPayload(orderId, data),
    localeOf(data)
  );
  const result = await sendMishkahEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "customer_payment",
  });

  if (!result.ok) {
    await markNotificationFailed(ref, SUCCESS_FIELD, { error: result.error }).catch(() => undefined);
    paymentAudit("CUSTOMER_EMAIL_FAILED", { orderId, providerErrorCode: result.error });
    return { status: "failed", error: result.error };
  }

  const deliveryStatus = await getBrevoDeliveryStatus(result.messageId);
  await markNotificationSent(ref, SUCCESS_FIELD, {
    messageId: result.messageId,
    deliveryStatus,
  }).catch(() => undefined);
  paymentAudit("CUSTOMER_EMAIL_SENT", { orderId, extra: { deliveryStatus } });
  return { status: "sent", messageId: result.messageId };
}

export async function notifyCustomerPaymentFailed(orderId: string): Promise<NotifyResult> {
  if (!orderId.trim()) return { status: "skipped", reason: "missing orderId" };
  const ref = getAdminDb().collection(COLLECTIONS.orders).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return { status: "skipped", reason: "order_not_found" };
  const data = snap.data() as FirestoreOrder;
  const email = normalizeCustomerEmail(data.customerEmail);
  if (!email) return { status: "skipped", reason: "no_customer_email" };

  const claim = await claimNotification(ref, FAILURE_FIELD, { allowRetryFailed: false });
  if (!claim.ok) {
    if (claim.reason === "already_sent") return { status: "already_sent" };
    return { status: "in_progress" };
  }

  const payload = {
    ...firestoreOrderToEmailPayload(orderId, data),
    retryUrl: customerRetryUrl(orderId, data.orderNumber),
  };
  const content = renderCustomerPaymentFailedEmail(payload, localeOf(data));
  const result = await sendMishkahEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "customer_payment",
  });

  if (!result.ok) {
    await markNotificationFailed(ref, FAILURE_FIELD, { error: result.error }).catch(() => undefined);
    paymentAudit("CUSTOMER_EMAIL_FAILED", { orderId, providerErrorCode: result.error });
    return { status: "failed", error: result.error };
  }

  await markNotificationSent(ref, FAILURE_FIELD, { messageId: result.messageId }).catch(() => undefined);
  paymentAudit("CUSTOMER_EMAIL_SENT", { orderId, extra: { kind: "failure" } });
  return { status: "sent", messageId: result.messageId };
}
