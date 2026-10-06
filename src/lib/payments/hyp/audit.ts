import { hypLogFields } from "@/lib/payments/hyp/query";

export const PAYMENT_EVENTS = [
  "PAYMENT_CREATED",
  "HYP_REDIRECT_CREATED",
  "HYP_RETURN_RECEIVED",
  "HYP_VERIFY_SUCCESS",
  "HYP_VERIFY_FAILED",
  "PAYMENT_CONFIRMED",
  "ORDER_CONFIRMED",
  "CUSTOMER_EMAIL_SENT",
  "CUSTOMER_EMAIL_FAILED",
  "ADMIN_EMAIL_SENT",
  "INVOICE_CREATED",
  "INVOICE_FAILED",
  "PRINT_JOB_CREATED",
  "MESSAGE_SENT",
  "MESSAGE_FAILED",
] as const;

export type PaymentAuditEvent = (typeof PAYMENT_EVENTS)[number];

export function paymentAudit(
  event: PaymentAuditEvent,
  fields: {
    orderId?: string;
    paymentAttemptId?: string;
    providerErrorCode?: string;
    extra?: Record<string, string | number | undefined>;
  }
): void {
  console.info(`[PAYMENT] ${event}`, hypLogFields(fields));
}
