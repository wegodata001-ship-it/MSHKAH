import { sendViaBrevo } from "@/lib/email/brevo";
import {
  getAdminNotificationEmail,
  getBrevoConfig,
  getBusinessAlertRecipients,
  getMishkahNotificationEmails,
} from "@/lib/email/config";
import {
  renderCriticalCheckoutFailureEmail,
  renderNewOrderEmail,
  renderOrderCancelledEmail,
  renderOrderUpdatedEmail,
  renderOverdueOrderEmail,
  renderTestEmailHtml,
  type OrderEmailBase,
} from "@/lib/email/templates";
import type { OrderChange } from "@/lib/email/significant-diff";
import type { MishkahEmailKind, SendEmailResult } from "@/lib/email/types";

export type SendMishkahEmailOptions = {
  to?: string | string[];
  subject: string;
  html: string;
  text?: string;
  kind?: MishkahEmailKind;
};

/**
 * Central email entry-point for MISHKAH CAFE.
 * Always server-side. Never throw secrets.
 */
export async function sendMishkahEmail(
  options: SendMishkahEmailOptions
): Promise<SendEmailResult> {
  const defaultRecipients = getBusinessAlertRecipients();
  const to = options.to ?? defaultRecipients;

  const result = await sendViaBrevo({
    to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    tags: options.kind ? [`mishkah`, options.kind] : ["mishkah"],
  });

  if (!result.ok) {
    console.error("[email] Email notification failed", {
      kind: options.kind ?? "unknown",
      error: result.error,
      statusCode: result.statusCode,
      code: result.code,
      senderName: getBrevoConfig().senderName,
    });
  }

  return result;
}

export async function sendMishkahTestEmail(
  to?: string | string[]
): Promise<SendEmailResult & { recipients: string[] }> {
  const recipients = to
    ? (Array.isArray(to) ? to : [to]).map((e) => e.trim()).filter(Boolean)
    : getMishkahNotificationEmails().recipients;
  const content = renderTestEmailHtml();
  const result = await sendMishkahEmail({
    to: recipients,
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "test",
  });
  return { ...result, recipients };
}

export async function sendNewOrderNotificationEmail(
  payload: OrderEmailBase
): Promise<SendEmailResult> {
  const content = renderNewOrderEmail(payload);
  return sendMishkahEmail({
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "new_order",
  });
}

export async function sendOrderUpdatedNotificationEmail(
  payload: OrderEmailBase & { changes: OrderChange[] }
): Promise<SendEmailResult> {
  const content = renderOrderUpdatedEmail(payload);
  return sendMishkahEmail({
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "order_updated",
  });
}

export async function sendOrderCancelledNotificationEmail(
  payload: OrderEmailBase & { cancelReason?: string }
): Promise<SendEmailResult> {
  const content = renderOrderCancelledEmail(payload);
  return sendMishkahEmail({
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "order_cancelled",
  });
}

export async function sendOverdueOrderEmail(payload: {
  orderNumber: string;
  statusLabel: string;
  waitLabel: string;
  total: number;
  customerName: string;
  customerPhone?: string;
  createdAt: string;
  viewUrl: string;
  escalation?: boolean;
}): Promise<SendEmailResult> {
  const content = renderOverdueOrderEmail(payload);
  const to = getAdminNotificationEmail();
  return sendMishkahEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "overdue_order",
  });
}

export async function sendCriticalCheckoutFailureEmail(payload: {
  message: string;
  code?: string;
  occurredAt: string;
}): Promise<SendEmailResult> {
  const content = renderCriticalCheckoutFailureEmail(payload);
  return sendMishkahEmail({
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "system",
  });
}
