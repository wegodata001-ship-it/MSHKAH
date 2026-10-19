export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
};

export type SendEmailResult =
  | { ok: true; messageId?: string; statusCode: number }
  | { ok: false; error: string; statusCode?: number; code?: string };

export type MishkahEmailKind =
  | "test"
  | "new_order"
  | "order_updated"
  | "order_cancelled"
  | "customer_payment"
  | "customer_payment_success"
  | "customer_payment_failed"
  | "system"
  | "overdue_order"
  | "loyalty_verification"
  | "loyalty_welcome";

export type NewOrderEmailStatus = "SENDING" | "SENT" | "FAILED";

export type NewOrderEmailNotification = {
  status: NewOrderEmailStatus;
  provider?: "BREVO";
  claimedAt?: unknown;
  sentAt?: unknown;
  failedAt?: unknown;
  messageId?: string;
  lastError?: string;
};
