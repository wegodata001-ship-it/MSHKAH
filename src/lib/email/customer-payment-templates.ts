import { BRAND_COLORS } from "@/lib/brand";
import { emailShell, escapeHtml, type OrderEmailBase } from "@/lib/email/templates";
import { getPublicSiteUrl } from "@/lib/email/config";

const COLORS = {
  primary: BRAND_COLORS.primary,
  accent: BRAND_COLORS.accent,
};

type MailLocale = "ar" | "he" | "en";

function formatIls(amount: number): string {
  return `${amount.toFixed(2)} ₪`;
}

function copy(locale: MailLocale) {
  if (locale === "ar") {
    return {
      successSubject: (n: string) => `تم تأكيد طلبك من مشكاة كافيه — #${n}`,
      successTitle: "شكراً لطلبك",
      successLead: "تم الدفع بنجاح ✓",
      paymentMethod: "بطاقة ائتمان",
      paymentStatus: "تم الدفع",
      failSubject: (n: string) => `لم نتمكن من إتمام الدفع للطلب #${n}`,
      failTitle: "لم يكتمل الدفع",
      failLead: "لم يُسجَّل تأكيد نجاح للدفع. يمكنك المحاولة مرة أخرى بأمان.",
      retry: "إعادة محاولة الدفع",
      pickup: "استلام ذاتي من المحل",
      total: "المبلغ المدفوع",
      payment: "الدفع",
    };
  }
  if (locale === "en") {
    return {
      successSubject: (n: string) => `Your Mishkat Cafe order is confirmed — #${n}`,
      successTitle: "Thank you for your order",
      successLead: "Paid successfully ✓",
      paymentMethod: "Credit Card",
      paymentStatus: "Paid",
      failSubject: (n: string) => `We could not complete payment for order #${n}`,
      failTitle: "Payment was not completed",
      failLead: "No successful payment was recorded. You can retry safely.",
      retry: "Retry payment",
      pickup: "Pickup at Mishkat",
      total: "Amount paid",
      payment: "Payment",
    };
  }
  return {
    successSubject: (n: string) => `ההזמנה ממשקאה אושרה — #${n}`,
    successTitle: "תודה על ההזמנה",
      successLead: "התשלום בוצע בהצלחה ✓",
      paymentMethod: "אשראי",
      paymentStatus: "שולם",
    failSubject: (n: string) => `לא הצלחנו להשלים את התשלום עבור הזמנה #${n}`,
    failTitle: "התשלום לא הושלם",
    failLead: "לא נרשם אישור הצלחה. אפשר לנסות שוב בבטחה.",
    retry: "נסה לשלם שוב",
    pickup: "איסוף עצמי ממשקאה",
    total: "סכום ששולם",
    payment: "תשלום",
  };
}

function itemsText(items: OrderEmailBase["items"]): string {
  return items
    .map((item) => {
      const extras = item.modifiers?.map((m) => m.optionName).filter(Boolean).join(", ");
      return `${item.quantity}× ${item.productName}${extras ? ` (${extras})` : ""} — ${formatIls(item.price * item.quantity)}`;
    })
    .join("\n");
}

function itemsHtml(items: OrderEmailBase["items"]): string {
  return items
    .map((item) => {
      const extras = item.modifiers?.map((m) => escapeHtml(m.optionName)).join(" · ");
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #E6D9C8;font-size:14px;">
          <div><strong>${escapeHtml(item.productName)}</strong> × ${item.quantity}</div>
          ${extras ? `<div style="color:#6B5A52;font-size:12px;">${extras}</div>` : ""}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #E6D9C8;text-align:start;font-weight:700;">${formatIls(item.price * item.quantity)}</td>
      </tr>`;
    })
    .join("");
}

export function renderCustomerPaymentSuccessEmail(
  payload: OrderEmailBase,
  locale: MailLocale = "he"
): { subject: string; html: string; text: string } {
  const t = copy(locale);
  const subject = t.successSubject(payload.orderNumber);
  const html = emailShell({
    title: subject,
    badge: "new",
    preheader: `${t.successLead} #${payload.orderNumber}`,
    bodyHtml: `
      <h1 style="margin:0 0 8px;font-size:22px;text-align:center;color:${COLORS.primary};">${t.successTitle}</h1>
      <p style="margin:0 0 18px;text-align:center;font-size:15px;color:${COLORS.accent};font-weight:700;">${t.successLead}</p>
      <p style="text-align:center;font-size:16px;font-weight:700;">#${escapeHtml(payload.orderNumber)}</p>
      <p style="text-align:center;font-size:14px;color:#6B5A52;">${escapeHtml(payload.customerName)}</p>
      <p style="text-align:center;font-size:13px;color:#6B5A52;">${t.payment}: ${t.paymentMethod} · ${t.paymentStatus}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml(payload.items)}</table>
      <p style="margin:16px 0 0;text-align:center;font-size:13px;color:#6B5A52;">${t.pickup}</p>
      <p style="margin:8px 0 0;text-align:center;font-size:22px;font-weight:700;color:${COLORS.primary};">${t.total}: ${formatIls(payload.total)}</p>
    `,
  });
  return {
    subject,
    html,
    text: `MISHKAT CAFE\n${t.successTitle}\n#${payload.orderNumber}\n${t.payment}: ${t.successLead}\n${itemsText(payload.items)}\n${t.total}: ${formatIls(payload.total)}\n${t.pickup}`,
  };
}

export function renderCustomerPaymentFailedEmail(
  payload: OrderEmailBase & { retryUrl: string },
  locale: MailLocale = "he"
): { subject: string; html: string; text: string } {
  const t = copy(locale);
  const subject = t.failSubject(payload.orderNumber);
  const html = emailShell({
    title: subject,
    badge: "cancelled",
    preheader: t.failLead,
    bodyHtml: `
      <h1 style="margin:0 0 8px;font-size:22px;text-align:center;color:${COLORS.primary};">${t.failTitle}</h1>
      <p style="margin:0 0 18px;text-align:center;font-size:15px;">${t.failLead}</p>
      <p style="text-align:center;font-weight:700;">#${escapeHtml(payload.orderNumber)}</p>
      <p style="text-align:center;margin:22px 0 0;">
        <a href="${escapeHtml(payload.retryUrl)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${COLORS.accent};color:#fff;text-decoration:none;font-weight:700;">${t.retry}</a>
      </p>
    `,
  });
  return {
    subject,
    html,
    text: `MISHKAT CAFE\n${t.failTitle}\n#${payload.orderNumber}\n${t.failLead}\n${payload.retryUrl}`,
  };
}

export function customerRetryUrl(orderId: string, orderNumber: string): string {
  const origin = getPublicSiteUrl().replace(/\/$/, "");
  const params = new URLSearchParams({ orderId, order: orderNumber });
  return `${origin}/payment/failed?${params.toString()}`;
}
