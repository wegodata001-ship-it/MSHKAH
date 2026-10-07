"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import type { Order } from "@/types";
import { findPaidPaymentForOrder, permanentlyDeleteOrder } from "@/services/inventoryService";

const REASONS = ["duplicate", "test", "mistake", "other"] as const;

export function PermanentDeleteOrderDialog({
  order,
  open,
  onOpenChange,
  onDeleted,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [reason, setReason] = useState<(typeof REASONS)[number]>("test");
  const [confirmed, setConfirmed] = useState(false);
  const [hypConfirmed, setHypConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paidPayment, setPaidPayment] = useState<{ id: string; provider?: string } | null>(null);
  const hasHyp = Boolean(
    paidPayment ||
      order?.paymentStatus === "paid" ||
      order?.paymentProvider === "HYP" ||
      order?.paidAt
  );

  useEffect(() => {
    if (!open || !order) return;
    setReason("test");
    setConfirmed(false);
    setHypConfirmed(false);
    setPaidPayment(null);
    void findPaidPaymentForOrder(order.id).then(setPaidPayment);
  }, [open, order?.id]);

  return (
    <AdminModal open={open} onOpenChange={(next) => !saving && onOpenChange(next)} size="sm">
      <AdminModalHeader onClose={() => onOpenChange(false)}>
        <AdminModalTitle>
          {t("admin.orders.permanentDeleteTitle").replace("{number}", order?.orderNumber ?? "")}
        </AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-3">
        <p className="text-sm text-red-700">{t("admin.orders.permanentDeleteWarning")}</p>
        {REASONS.map((value) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-beige-dark/20 px-3 py-2">
            <input type="radio" name="delete-reason" checked={reason === value} onChange={() => setReason(value)} />
            <span>{t(`admin.orders.deleteReason.${value}`)}</span>
          </label>
        ))}
        {hasHyp && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("admin.orders.hypPaymentWarning")}</p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
          {t("admin.orders.permanentDeleteConfirm")}
        </label>
        {hasHyp && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={hypConfirmed} onChange={(e) => setHypConfirmed(e.target.checked)} className="mt-1" />
            {t("admin.orders.hypPaymentConfirm")}
          </label>
        )}
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
          {t("common.back")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={saving || !confirmed || (hasHyp && !hypConfirmed) || !order}
          onClick={async () => {
            if (!order) return;
            setSaving(true);
            const result = await permanentlyDeleteOrder(order.id);
            setSaving(false);
            if (result.success) {
              onDeleted();
              onOpenChange(false);
            }
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.orders.permanentDelete")}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}
