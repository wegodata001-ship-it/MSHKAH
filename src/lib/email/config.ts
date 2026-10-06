/**
 * Server-side email configuration for MISHKAH CAFE.
 * Never import this module from client components.
 */

export type MailProvider = "BREVO" | "NONE";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export function getMailProvider(): MailProvider {
  const value = env("MAIL_PROVIDER", "BREVO").toUpperCase();
  return value === "BREVO" ? "BREVO" : "NONE";
}

export function getBrevoConfig() {
  return {
    apiKey: env("BREVO_API_KEY"),
    baseUrl: env("BREVO_BASE_URL", "https://api.brevo.com/v3").replace(/\/$/, ""),
    senderName: env("BREVO_SENDER_NAME", "MISHKAH CAFE"),
    senderEmail: env("BREVO_SENDER_EMAIL", "email@mishkatcafe.dev"),
    replyTo: env("BREVO_REPLY_TO", "mishkahcaffe@gmail.com"),
  };
}

export function getMishkahNotificationEmails() {
  const notification = env("MISHKAH_NOTIFICATION_EMAIL", "mishkahcaffe@gmail.com");
  const admin = env("MISHKAH_ADMIN_EMAIL", "abulieltasneem23@gmail.com");
  const recipients = [notification, admin].filter(Boolean);
  return {
    notification,
    admin,
    /** Unique list for broadcast / test emails */
    recipients: [...new Set(recipients)],
  };
}

/** Canonical Mishkat inbox. Prefer notification, then admin. */
export function getAdminNotificationEmail(): string {
  const { notification, admin } = getMishkahNotificationEmails();
  return notification || admin || "";
}

/** Unique configured business alert recipients. */
export function getAdminNotificationEmails(): string[] {
  const { recipients } = getMishkahNotificationEmails();
  return recipients;
}

/** Business order alerts — configured café inboxes */
export function getBusinessAlertRecipients(): string[] {
  const recipients = getAdminNotificationEmails();
  if (recipients.length === 0) {
    console.error("[email] ADMIN_NOTIFICATION_EMAIL_MISSING");
  }
  return recipients;
}

export function getPublicSiteUrl(): string {
  return env("NEXT_PUBLIC_SITE_URL", "https://mishkatcafe.dev").replace(/\/$/, "");
}

export function getPortalAdminOrderUrl(orderId: string): string {
  const portal =
    env("NEXT_PUBLIC_PORTAL_URL") ||
    `https://${env("NEXT_PUBLIC_PORTAL_HOST", "portal.mishkatcafe.dev")}`;
  const base = `${portal.replace(/\/$/, "")}/orders`;
  return orderId ? `${base}?order=${encodeURIComponent(orderId)}` : base;
}

export function assertBrevoReady(): { ok: true } | { ok: false; error: string } {
  if (getMailProvider() !== "BREVO") {
    return { ok: false, error: "MAIL_PROVIDER is not BREVO" };
  }
  const cfg = getBrevoConfig();
  if (!cfg.apiKey) {
    return { ok: false, error: "BREVO_API_KEY is missing" };
  }
  if (!cfg.senderEmail) {
    return { ok: false, error: "BREVO_SENDER_EMAIL is missing" };
  }
  if (!cfg.senderName) {
    return { ok: false, error: "BREVO_SENDER_NAME is missing" };
  }
  return { ok: true };
}
