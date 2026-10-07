"use client";

import { ChevronDown, Clock, Copy, FileText, Layers, Loader2, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/providers/locale-provider";
import { effectivePaymentStatus } from "@/lib/orders/operations";
import {
  OPERATIONAL_FILTERS,
  nextOperationalStatus,
  operationalStatusOf,
  toStoredOrderStatus,
  type OperationalOrderStatus,
} from "@/lib/orders/status";
import { ageIsAtLeastOneDay, formatJerusalemDateTime } from "@/lib/orders/time";
import { formatDuration, formatOrderAge } from "@/lib/orders/format-age";
import { orderAgeMs, overdueLevel, stageAgeMs } from "@/lib/orders/overdue";
import { formatDate, formatPrice, cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";

const STATUS_STYLE: Record<OperationalOrderStatus, string> = {
  received: "border-amber-300 bg-amber-50 text-amber-800",
  preparing: "border-violet-300 bg-violet-50 text-violet-800",
  ready: "border-emerald-300 bg-emerald-50 text-emerald-800",
  delivered: "border-stone-300 bg-stone-100 text-stone-700",
  cancelled: "border-red-300 bg-red-50 text-red-700",
};

const STATUS_BORDER: Record<OperationalOrderStatus, string> = {
  received: "border-s-amber-500",
  preparing: "border-s-violet-500",
  ready: "border-s-emerald-500",
  delivered: "border-s-stone-500",
  cancelled: "border-s-red-500",
};

function OrderItems({
  order,
  expanded,
  onEditItem,
}: {
  order: Order;
  expanded: boolean;
  onEditItem?: (index: number) => void;
}) {
  const items = expanded ? order.items : order.items.slice(0, 3);

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.productId}-${index}`} className="text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-dark-brown dark:text-warm-white">
              {item.quantity}× {item.productName}
            </p>
            {expanded && onEditItem && order.status !== "delivered" && order.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => onEditItem(index)}
                className="rounded-lg p-1.5 text-coffee/50 hover:bg-beige/50 hover:text-turquoise"
                aria-label="Edit extras"
              >
                <Layers className="h-4 w-4" />
              </button>
            )}
          </div>
          {item.modifiers?.map((modifier) => (
            <p key={`${modifier.groupId}-${modifier.optionId}`} className="ps-4 text-xs text-coffee/65">
              + {modifier.groupName ? `${modifier.groupName}: ` : ""}
              {modifier.optionName}
              {modifier.quantity > 1 ? ` ×${modifier.quantity}` : ""}
              {modifier.kitchenNote ? ` — ${modifier.kitchenNote}` : ""}
            </p>
          ))}
          {item.kitchenNotes?.map((note) => (
            <p key={note} className="ps-4 text-xs font-medium text-violet-700">
              • {note}
            </p>
          ))}
          {item.notes && <p className="ps-4 text-xs italic text-coffee/60">{item.notes}</p>}
        </div>
      ))}
      {!expanded && order.items.length > items.length && (
        <p className="text-xs text-coffee/45">+{order.items.length - items.length}</p>
      )}
    </div>
  );
}

export function OrderCard({
  order,
  expanded,
  updating,
  now = Date.now(),
  onToggle,
  onStatusChange,
  onCancel,
  onPrint,
  onThermalReprint,
  onResendCustomerEmail,
  onResendAdminEmail,
  onExportPdf,
  onCopyNumber,
  onEditItem,
  onPermanentDelete,
}: {
  order: Order;
  expanded: boolean;
  updating: boolean;
  now?: number;
  onToggle: () => void;
  onStatusChange: (status: OrderStatus) => void;
  onCancel: () => void;
  onPrint: () => void;
  onThermalReprint?: () => void;
  onResendCustomerEmail?: () => void;
  onResendAdminEmail?: () => void;
  onExportPdf?: () => void;
  onCopyNumber?: () => void;
  onEditItem?: (index: number) => void;
  onPermanentDelete?: () => void;
}) {
  const t = useT();
  const status = operationalStatusOf(order);
  const next = nextOperationalStatus(status);
  const ageMs = orderAgeMs(order, now);
  const stageMs = stageAgeMs(order, now);
  const delay = overdueLevel(order, now);
  const paymentStatus = effectivePaymentStatus(order);
  const paidByCard =
    paymentStatus === "paid" &&
    (order.paymentProvider === "HYP" || (order.paymentMethod || "").toLowerCase() === "card");
  const paymentLabelKey = paidByCard ? "admin.payment.paidCard" : `admin.payment.${paymentStatus}`;

  return (
    <article
      className={cn(
        "rounded-2xl border border-beige-dark/15 border-s-4 bg-warm-white p-4 shadow-soft dark:border-white/10 dark:bg-white/5",
        STATUS_BORDER[status],
        delay === "warning" && "ring-2 ring-amber-400/50",
        delay === "critical" && "ring-2 ring-red-400/60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-start">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-dark-brown dark:text-warm-white">{order.orderNumber}</span>
            <Badge variant="outline" className={STATUS_STYLE[status]}>
              {t(`admin.status.${status}`)}
            </Badge>
            {delay === "warning" && (
              <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800">
                {t("admin.orders.warning")}
              </Badge>
            )}
            {delay === "critical" && (
              <Badge variant="outline" className="border-red-400 bg-red-50 text-red-700">
                {t("admin.orders.critical")}
              </Badge>
            )}
            {order.isTestOrder && (
              <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800">
                TEST
              </Badge>
            )}
            <Badge
              variant="outline"
              className={
                paymentStatus === "paid"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : paymentStatus === "failed"
                    ? "border-red-300 bg-red-50 text-red-700"
                    : paymentStatus === "refunded"
                      ? "border-slate-300 bg-slate-100 text-slate-700"
                      : "border-amber-300 bg-amber-50 text-amber-700"
              }
            >
              {t(paymentLabelKey)}
            </Badge>
            <ChevronDown
              className={cn("h-4 w-4 text-coffee/40 transition-transform", expanded && "rotate-180")}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-coffee/55">
            <span className="font-medium text-coffee/75">{order.customerName}</span>
            <span title={formatJerusalemDateTime(order.createdAt)}>
              {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span
              className={cn("inline-flex items-center gap-1", delay !== "normal" && "font-bold text-amber-800")}
              title={formatJerusalemDateTime(order.createdAt)}
            >
              <Clock className="h-3.5 w-3.5" />
              {formatOrderAge(t, ageMs)}
            </span>
            {ageIsAtLeastOneDay(ageMs) && (
              <span className="text-coffee/45">{formatJerusalemDateTime(order.createdAt)}</span>
            )}
            {(status === "received" || status === "preparing" || status === "ready") && (
              <span className="text-coffee/70">
                {t(`admin.orders.stage.${status}`).replace("{age}", formatDuration(t, stageMs))}
              </span>
            )}
          </div>
        </button>

        <div className="text-end">
          <p className="text-xl font-bold text-coffee">{formatPrice(order.total)}</p>
          {order.orderType && (
            <p className="text-xs text-coffee/45">{t(`admin.orders.type.${order.orderType}`)}</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-cream/55 p-3 dark:bg-white/5">
        <OrderItems order={order} expanded={expanded} onEditItem={onEditItem} />
      </div>

      {expanded && (
        <div className="mt-4 grid gap-4 border-t border-beige-dark/15 pt-4 text-sm md:grid-cols-2">
          <div className="space-y-1">
            <p className="font-semibold">{t("orders.customer")}</p>
            <p>{order.customerFullName || order.customerName}</p>
            {order.customerPhone && <p dir="ltr" className="text-start">{order.customerPhone}</p>}
            {order.customerEmail && <p dir="ltr" className="text-start">{order.customerEmail}</p>}
            {order.deliveryAddress && <p>{order.deliveryAddress}</p>}
          </div>
          <div className="space-y-1">
            <p className="font-semibold">{t("orders.date")}</p>
            <p>{formatDate(order.createdAt)}</p>
            <p>
              {t("admin.orders.paymentMethod")}:{" "}
              {order.paymentProvider === "HYP" || (order.paymentMethod || "").toLowerCase() === "card"
                ? t("admin.payment.methodCardHyp")
                : t("admin.payment.methodCash")}
            </p>
            {order.paymentProvider && (
              <p>{t("admin.payment.provider")}: {order.paymentProvider}</p>
            )}
            {paymentStatus === "paid" && (
              <p>{t("admin.payment.paidAmount")}: {formatPrice(order.total)}</p>
            )}
            {order.paymentTransactionId && (
              <p dir="ltr" className="text-start">
                {t("admin.payment.transaction")}: {order.paymentTransactionId}
              </p>
            )}
            <p>
              {t("admin.payment.customerEmail")}:{" "}
              {t(`admin.payment.notify.${order.customerConfirmationStatus || "PENDING"}`)}
            </p>
            <p>
              {t("admin.payment.adminEmail")}:{" "}
              {t(`admin.payment.notify.${order.adminNotificationStatus || "PENDING"}`)}
            </p>
            <p>{t("admin.payment.invoice")}: {t("admin.payment.notify.PROVIDER_REQUIRED")}</p>
            <p>{t("admin.payment.message")}: {t("admin.payment.notify.NOT_CONFIGURED")}</p>
          </div>
          {order.notes && (
            <div className="rounded-xl bg-amber-50 p-3 text-amber-900 md:col-span-2">
              <p className="font-semibold">{t("builder.notes")}</p>
              <p className="whitespace-pre-line">{order.notes}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(value) => onStatusChange(toStoredOrderStatus(value as OperationalOrderStatus))}
          disabled={updating}
        >
          <SelectTrigger className="h-10 w-[145px]">
            {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <SelectValue />}
          </SelectTrigger>
          <SelectContent>
            {OPERATIONAL_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`admin.status.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {next && (
          <Button
            type="button"
            className="min-h-10 flex-1 rounded-xl sm:flex-none"
            disabled={updating}
            onClick={() => onStatusChange(toStoredOrderStatus(next))}
          >
            {t(`admin.orders.next.${status}`)}
          </Button>
        )}

        <Button type="button" variant="outline" size="icon" onClick={onPrint} title={t("admin.orders.printTicket")}>
          <Printer className="h-4 w-4" />
        </Button>
        {onThermalReprint && (
          <Button
            type="button"
            variant="outline"
            onClick={onThermalReprint}
            title={t("admin.orders.thermalReprint", "הדפס מחדש")}
          >
            {t("admin.orders.thermalReprint", "הדפס מחדש")}
          </Button>
        )}
        {onResendCustomerEmail && order.customerEmail && (
          <Button type="button" variant="outline" onClick={onResendCustomerEmail}>
            {t("admin.payment.resendEmail")}
          </Button>
        )}
        {onResendAdminEmail && (
          <Button type="button" variant="outline" onClick={onResendAdminEmail}>
            {t("admin.payment.resendAdminEmail")}
          </Button>
        )}
        {expanded && onExportPdf && (
          <Button type="button" variant="outline" size="icon" onClick={onExportPdf} title={t("admin.orders.exportPdf")}>
            <FileText className="h-4 w-4" />
          </Button>
        )}
        {expanded && onCopyNumber && (
          <Button type="button" variant="outline" size="icon" onClick={onCopyNumber} title={t("admin.orders.copyNumber")}>
            <Copy className="h-4 w-4" />
          </Button>
        )}
        {status !== "cancelled" && status !== "delivered" && (
          <Button type="button" variant="ghost" className="text-red-600" onClick={onCancel}>
            {t("admin.orders.cancel")}
          </Button>
        )}
        {onPermanentDelete && (
          <Button type="button" variant="ghost" className="text-red-700" onClick={onPermanentDelete}>
            {t("admin.orders.permanentDelete")}
          </Button>
        )}
      </div>
    </article>
  );
}
