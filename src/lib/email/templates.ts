import { BRAND_COLORS } from "@/lib/brand";
import { getPublicSiteUrl } from "@/lib/email/config";
import type { OrderChange } from "@/lib/email/significant-diff";

const COLORS = {
  primary: BRAND_COLORS.primary,
  accent: BRAND_COLORS.accent,
  cream: BRAND_COLORS.cream,
  warmWhite: BRAND_COLORS.warmWhite,
  muted: "#6B5A52",
  border: "#E6D9C8",
  danger: "#B42318",
  warning: "#B54708",
  info: "#026AA2",
};

export type EmailBadgeKind = "new" | "updated" | "cancelled" | "critical" | "test";

const BADGE: Record<EmailBadgeKind, { bg: string; color: string; label: string }> = {
  new: { bg: "#E6F6F7", color: COLORS.accent, label: "הזמנה חדשה" },
  updated: { bg: "#EFF8FF", color: COLORS.info, label: "עדכון הזמנה" },
  cancelled: { bg: "#FEF3F2", color: COLORS.danger, label: "ביטול הזמנה" },
  critical: { bg: "#FFFAEB", color: COLORS.warning, label: "תקלה" },
  test: { bg: "#F5F0EA", color: COLORS.muted, label: "בדיקה" },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailShell(opts: {
  title: string;
  preheader?: string;
  badge?: EmailBadgeKind;
  bodyHtml: string;
}): string {
  const siteUrl = getPublicSiteUrl();
  const logoUrl = `${siteUrl}/logo-transparent.png`;
  const badge = opts.badge ? BADGE[opts.badge] : null;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.preheader)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.cream};font-family:Arial,Helvetica,sans-serif;color:${COLORS.primary};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLORS.warmWhite};border-radius:16px;overflow:hidden;border:1px solid ${COLORS.border};">
          <tr>
            <td style="background:${COLORS.primary};padding:22px 24px;text-align:center;">
              <img src="${logoUrl}" alt="MISHKAH CAFE" width="72" height="63" style="display:inline-block;border:0;outline:none;max-width:72px;height:auto;" />
              <div style="margin-top:10px;font-size:20px;font-weight:700;letter-spacing:0.04em;color:${COLORS.warmWhite};">MISHKAH CAFE</div>
              ${
                badge
                  ? `<div style="margin-top:12px;display:inline-block;padding:6px 14px;border-radius:999px;background:${badge.bg};color:${badge.color};font-size:12px;font-weight:700;">${escapeHtml(badge.label)}</div>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px;background:${COLORS.cream};border-top:1px solid ${COLORS.border};text-align:center;">
              <div style="font-size:13px;font-weight:700;color:${COLORS.primary};">MISHKAH CAFE</div>
              <div style="margin-top:4px;font-size:12px;color:${COLORS.muted};">Coffee • Crêpes • Desserts</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(url: string, label: string): string {
  return `
    <div style="margin-top:24px;text-align:center;">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:700;">
        ${escapeHtml(label)}
      </a>
    </div>`;
}

export function renderTestEmailHtml(): { subject: string; html: string; text: string } {
  const subject = "MISHKAH CAFE — בדיקת מערכת המיילים";
  const html = emailShell({
    title: subject,
    badge: "test",
    preheader: "מערכת המיילים מחוברת בהצלחה",
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${COLORS.primary};text-align:center;">MISHKAH CAFE</h1>
      <p style="margin:0 0 10px;font-size:16px;line-height:1.6;text-align:center;color:${COLORS.primary};">
        מערכת המיילים מחוברת בהצלחה.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6;text-align:center;color:${COLORS.muted};">
        זהו מייל בדיקה שנשלח באמצעות Brevo.
      </p>
    `,
  });
  return {
    subject,
    html,
    text: "MISHKAH CAFE\n\nמערכת המיילים מחוברת בהצלחה.\nזהו מייל בדיקה שנשלח באמצעות Brevo.",
  };
}

export type OrderEmailItem = {
  productName: string;
  quantity: number;
  price: number;
  modifiers?: Array<{ optionName: string; quantity?: number }>;
  notes?: string;
  kitchenNotes?: string[];
};

export type OrderEmailBase = {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  items: OrderEmailItem[];
  total: number;
  paymentMethod?: string;
  paymentStatus?: string;
  orderType?: "pickup" | "delivery";
  status?: string;
  notes?: string;
  viewUrl: string;
};

function formatIls(amount: number): string {
  return `${amount.toFixed(2)} ₪`;
}

function formatDateHe(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" };
  return {
    date: d.toLocaleDateString("he-IL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    time: d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
  };
}

function paymentLabel(method?: string): string {
  if (!method) return "—";
  if (method === "cash") return "מזומן";
  if (method === "card") return "כרטיס אשראי";
  return method;
}

function fulfillmentLabel(type?: "pickup" | "delivery"): string {
  if (type === "delivery") return "משלוח";
  return "איסוף עצמי מהעסק";
}

function statusLabel(status?: string): string {
  const map: Record<string, string> = {
    pending: "ממתין",
    confirmed: "אושר",
    preparing: "בהכנה",
    ready: "מוכן",
    delivered: "הושלם",
    cancelled: "בוטל",
  };
  return status ? map[status] ?? status : "—";
}

function itemsHtml(items: OrderEmailItem[]): string {
  return items
    .map((item) => {
      const modifiers = (item.modifiers ?? [])
        .map(
          (m) =>
            `<div style="padding-right:14px;font-size:13px;color:${COLORS.muted};line-height:1.5;">${escapeHtml(m.optionName)}</div>`
        )
        .join("");
      const notes = [...(item.kitchenNotes ?? []), ...(item.notes ? [item.notes] : [])]
        .filter(Boolean)
        .map(
          (n) =>
            `<div style="padding-right:14px;font-size:12px;color:${COLORS.muted};font-style:italic;">${escapeHtml(n)}</div>`
        )
        .join("");
      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid ${COLORS.border};vertical-align:top;">
            <div style="font-size:15px;font-weight:700;color:${COLORS.primary};">
              ${item.quantity} × ${escapeHtml(item.productName)}
            </div>
            ${modifiers}
            ${notes}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid ${COLORS.border};vertical-align:top;text-align:left;white-space:nowrap;font-size:14px;color:${COLORS.primary};">
            ${formatIls(item.price * item.quantity)}
          </td>
        </tr>`;
    })
    .join("");
}

function customerBlock(payload: OrderEmailBase, extraRows?: string): string {
  const { date, time } = formatDateHe(payload.createdAt);
  return `
    <div style="margin-bottom:18px;padding:14px 16px;border-radius:12px;background:${COLORS.cream};border:1px solid ${COLORS.border};">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:${COLORS.muted};margin-bottom:10px;">פרטי הזמנה</div>
      <div style="font-size:14px;line-height:1.7;color:${COLORS.primary};">
        <div><strong>שם:</strong> ${escapeHtml(payload.customerName)}</div>
        ${payload.customerPhone ? `<div><strong>טלפון:</strong> ${escapeHtml(payload.customerPhone)}</div>` : ""}
        ${payload.customerEmail ? `<div><strong>אימייל:</strong> ${escapeHtml(payload.customerEmail)}</div>` : ""}
        <div><strong>תאריך:</strong> ${escapeHtml(date)}</div>
        ${time ? `<div><strong>שעה:</strong> ${escapeHtml(time)}</div>` : ""}
        <div><strong>סוג:</strong> ${escapeHtml(fulfillmentLabel(payload.orderType))}</div>
        <div><strong>תשלום:</strong> ${escapeHtml(paymentLabel(payload.paymentMethod))}</div>
        <div><strong>סטטוס:</strong> ${escapeHtml(statusLabel(payload.status))}</div>
        ${extraRows ?? ""}
      </div>
    </div>`;
}

function notesBlock(notes?: string): string {
  if (!notes?.trim()) return "";
  return `
    <div style="margin:18px 0 0;padding:14px 16px;border-radius:12px;background:#FFF4E5;border:1px solid #F0D2A8;">
      <div style="font-size:12px;font-weight:700;color:${COLORS.primary};margin-bottom:6px;">הערת הזמנה</div>
      <div style="font-size:14px;line-height:1.55;color:${COLORS.primary};white-space:pre-wrap;">${escapeHtml(notes.trim())}</div>
    </div>`;
}

function totalBlock(total: number): string {
  return `
    <div style="margin-top:16px;padding-top:14px;border-top:2px solid ${COLORS.primary};text-align:center;">
      <div style="font-size:13px;color:${COLORS.muted};">סה״כ לתשלום</div>
      <div style="font-size:24px;font-weight:700;color:${COLORS.primary};margin-top:4px;">${formatIls(total)}</div>
    </div>`;
}

/** @deprecated use OrderEmailBase */
export type NewOrderEmailPayload = OrderEmailBase;
/** @deprecated use OrderEmailItem */
export type NewOrderEmailItem = OrderEmailItem;

export function renderNewOrderEmail(payload: OrderEmailBase): {
  subject: string;
  html: string;
  text: string;
} {
  const paidCard =
    payload.paymentMethod === "card" || payload.paymentStatus === "paid";
  const subject = paidCard
    ? `הזמנה חדשה שולמה — #${payload.orderNumber} — ${payload.total.toFixed(2)} ₪`
    : `הזמנה חדשה #${payload.orderNumber} | MISHKAH CAFE`;
  const html = emailShell({
    title: subject,
    badge: "new",
    preheader: `התקבלה הזמנה חדשה #${payload.orderNumber}`,
    bodyHtml: `
      <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;text-align:center;color:${COLORS.primary};">הזמנה חדשה התקבלה</h1>
      <p style="margin:0 0 22px;text-align:center;font-size:15px;color:${COLORS.accent};font-weight:700;">
        הזמנה #${escapeHtml(payload.orderNumber)}
      </p>
      ${customerBlock(payload)}
      <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:${COLORS.muted};margin-bottom:8px;">פרטי ההזמנה</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml(payload.items)}</table>
      ${totalBlock(payload.total)}
      ${notesBlock(payload.notes)}
      ${ctaButton(payload.viewUrl, "פתיחת ההזמנה")}
    `,
  });
  return {
    subject,
    html,
    text: `MISHKAH CAFE\nהזמנה חדשה #${payload.orderNumber}\nלקוח: ${payload.customerName}\nסה״כ: ${formatIls(payload.total)}\n${payload.viewUrl}`,
  };
}

export function renderOrderUpdatedEmail(
  payload: OrderEmailBase & { changes: OrderChange[] }
): { subject: string; html: string; text: string } {
  const subject = `הזמנה #${payload.orderNumber} עודכנה | MISHKAH CAFE`;
  const changesHtml = payload.changes
    .map(
      (c) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.border};font-size:14px;">
          <div style="font-weight:700;color:${COLORS.primary};">${escapeHtml(c.label)}</div>
          <div style="color:${COLORS.muted};margin-top:4px;">${escapeHtml(c.before)} → <strong style="color:${COLORS.primary};">${escapeHtml(c.after)}</strong></div>
        </td>
      </tr>`
    )
    .join("");

  const html = emailShell({
    title: subject,
    badge: "updated",
    preheader: `הזמנה #${payload.orderNumber} עודכנה`,
    bodyHtml: `
      <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;text-align:center;color:${COLORS.primary};">הזמנה עודכנה</h1>
      <p style="margin:0 0 22px;text-align:center;font-size:15px;color:${COLORS.info};font-weight:700;">
        הזמנה #${escapeHtml(payload.orderNumber)}
      </p>
      ${customerBlock(payload)}
      <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:${COLORS.muted};margin-bottom:8px;">מה השתנה</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${changesHtml}</table>
      <div style="margin-top:18px;font-size:12px;font-weight:700;letter-spacing:0.04em;color:${COLORS.muted};margin-bottom:8px;">מצב נוכחי</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml(payload.items)}</table>
      ${totalBlock(payload.total)}
      ${notesBlock(payload.notes)}
      ${ctaButton(payload.viewUrl, "פתיחת ההזמנה")}
    `,
  });
  return {
    subject,
    html,
    text: `MISHKAH CAFE\nהזמנה #${payload.orderNumber} עודכנה\n${payload.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`).join("\n")}`,
  };
}

export function renderOrderCancelledEmail(
  payload: OrderEmailBase & { cancelReason?: string }
): { subject: string; html: string; text: string } {
  const subject = `הזמנה #${payload.orderNumber} בוטלה | MISHKAH CAFE`;
  const reasonRow = payload.cancelReason
    ? `<div><strong>סיבת ביטול:</strong> ${escapeHtml(payload.cancelReason)}</div>`
    : "";
  const html = emailShell({
    title: subject,
    badge: "cancelled",
    preheader: `הזמנה #${payload.orderNumber} בוטלה`,
    bodyHtml: `
      <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;text-align:center;color:${COLORS.danger};">הזמנה בוטלה</h1>
      <p style="margin:0 0 22px;text-align:center;font-size:15px;color:${COLORS.danger};font-weight:700;">
        הזמנה #${escapeHtml(payload.orderNumber)}
      </p>
      ${customerBlock(payload, reasonRow)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml(payload.items)}</table>
      ${totalBlock(payload.total)}
      ${notesBlock(payload.notes)}
      ${ctaButton(payload.viewUrl, "פתיחת ההזמנה")}
    `,
  });
  return {
    subject,
    html,
    text: `MISHKAH CAFE\nהזמנה #${payload.orderNumber} בוטלה\n${payload.cancelReason ?? ""}\n${payload.viewUrl}`,
  };
}

export function renderCriticalCheckoutFailureEmail(payload: {
  message: string;
  code?: string;
  occurredAt: string;
}): { subject: string; html: string; text: string } {
  const subject = "תקלה בתהליך הזמנה | MISHKAH CAFE";
  const { date, time } = formatDateHe(payload.occurredAt);
  const html = emailShell({
    title: subject,
    badge: "critical",
    preheader: "תקלה בתהליך הזמנה",
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;text-align:center;color:${COLORS.warning};">תקלה בתהליך הזמנה</h1>
      <p style="margin:0 0 16px;text-align:center;font-size:14px;color:${COLORS.muted};">
        לקוח ניסה לבצע הזמנה והמערכת נכשלה לפני שמירה מוצלחת.
      </p>
      <div style="padding:14px 16px;border-radius:12px;background:#FFFAEB;border:1px solid #FEDF89;font-size:14px;line-height:1.7;color:${COLORS.primary};">
        <div><strong>זמן:</strong> ${escapeHtml(date)}${time ? ` ${escapeHtml(time)}` : ""}</div>
        ${payload.code ? `<div><strong>קוד:</strong> ${escapeHtml(payload.code)}</div>` : ""}
        <div><strong>פירוט:</strong> ${escapeHtml(payload.message.slice(0, 400))}</div>
      </div>
    `,
  });
  return {
    subject,
    html,
    text: `MISHKAH CAFE\nתקלה בתהליך הזמנה\n${payload.code ?? ""}\n${payload.message}`,
  };
}
