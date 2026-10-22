"use client";

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminModal, AdminModalBody, AdminModalFooter, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { isAdminRole } from "@/lib/auth/roles";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { formatIls } from "@/lib/costing/money";
import { compareInvoiceTotals } from "@/lib/inventory/invoice-finance";
import {
  changedTotalFields,
  commitInvoiceTotalEdit,
  draftIsValid,
  editTotalField,
  parseInvoiceMoney,
  parseVatPercent,
  totalDraftFromInvoice,
  type TotalDraft,
  type TotalField,
} from "@/lib/inventory/invoice-total-edit";
import type { PurchaseInvoice } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

const FIELDS: Array<{ key: TotalField; label: string; percent?: boolean }> = [
  { key: "net", label: "admin.inventory.totals.fieldNet" },
  { key: "vat", label: "admin.inventory.totals.fieldVat" },
  { key: "vatPercent", label: "admin.inventory.totals.fieldRate", percent: true },
  { key: "discount", label: "admin.inventory.totals.fieldDiscount" },
  { key: "adjustment", label: "admin.inventory.totals.fieldAdjustment" },
  { key: "total", label: "admin.inventory.totals.fieldTotal" },
];

function moneyText(value: number | null | undefined, missing: string): string {
  if (value == null || !Number.isFinite(value)) return missing;
  return formatIls(value);
}

export function InvoiceTotalCard({
  invoice,
  locked,
  showLineActions = true,
  onReplace,
  onPersist,
  onToast,
}: {
  invoice: PurchaseInvoice;
  locked?: boolean;
  showLineActions?: boolean;
  onReplace: (invoice: PurchaseInvoice) => void;
  onPersist?: (invoice: PurchaseInvoice) => Promise<void>;
  onToast?: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const canEdit = isAdminRole(user?.role || "");
  const check = compareInvoiceTotals(invoice);
  const matched = check.validationStatus === "pass";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TotalDraft>(() => totalDraftFromInvoice(invoice));
  const [text, setText] = useState<Record<TotalField, string>>(() => blankText(totalDraftFromInvoice(invoice)));
  const [invalid, setInvalid] = useState<TotalField | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const disabled = locked || !canEdit || saving;
  const gap = check.differenceAmount;
  const percent = invoice.vatRate == null || !Number.isFinite(invoice.vatRate) ? null : invoice.vatRate > 1 ? invoice.vatRate : Math.round(invoice.vatRate * 10000) / 100;

  function openEditor() {
    const next = totalDraftFromInvoice(invoice);
    setDraft(next);
    setText(blankText(next));
    setInvalid(null);
    setReason("");
    setOpen(true);
  }

  function changeField(field: TotalField, raw: string) {
    setText((current) => ({ ...current, [field]: raw }));
    const parsed = field === "vatPercent" ? parseVatPercent(raw) : parseInvoiceMoney(raw);
    if (!parsed.ok) {
      setInvalid(field);
      return;
    }
    if ((field === "discount") && parsed.value < 0) {
      setInvalid(field);
      return;
    }
    setInvalid(null);
    setDraft((current) => editTotalField(current, field, parsed.value).draft);
  }

  async function confirm(addAdjustment = false, source?: TotalDraft) {
    const nextDraft = source ?? draft;
    if (!draftIsValid(nextDraft) || (!source && invalid)) {
      onToast?.(t("admin.inventory.totals.invalidAmount"), "error");
      return;
    }
    setSaving(true);
    try {
      const note = reason.trim() || t("admin.inventory.totals.defaultReason");
      if (invoice.id) {
        const result = await clientAdminFetch<{ invoice: PurchaseInvoice }>("/api/admin/inventory/invoice/totals", {
          invoiceId: invoice.id,
          draft: nextDraft,
          reason: note,
          addAdjustment,
        });
        if (!result.ok || !result.data?.invoice) {
          onToast?.(result.status === 401 || result.status === 403 ? t("admin.inventory.totals.adminOnly") : t("admin.inventory.totals.saveFailed"), "error");
          return;
        }
        onReplace(result.data.invoice);
      } else {
        const next = commitInvoiceTotalEdit(invoice, nextDraft, {
          at: new Date().toISOString(),
          actor: user?.email || undefined,
          reason: note,
          addAdjustment,
        });
        onReplace(next);
        if (onPersist) await onPersist(next);
        else onToast?.(t("admin.inventory.totals.saved"), "success");
      }
      if (invoice.id) onToast?.(t("admin.inventory.totals.saved"), "success");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const preview = changedTotalFields(totalDraftFromInvoice(invoice), draft);
  const sourceDiffers = check.sourceGross != null && check.payable != null && Math.abs(check.sourceGross - check.payable) > 0.001;

  return (
    <div className={cn("mt-3 rounded-2xl border p-3 text-sm", matched ? "border-beige-dark/20 bg-beige/40" : "border-amber-200 bg-amber-50")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-semibold text-dark-brown">{t("admin.inventory.totals.summaryTitle")}</p>
        {invoice.manuallyEdited ? <span className="text-xs text-coffee/60">{t("admin.inventory.totals.editedMark")}</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <p>{t("admin.inventory.smart.totalBeforeVat")}: {moneyText(check.workingNet, t("admin.inventory.smart.notDetected"))}</p>
        <p>{percent != null ? t("admin.inventory.totals.vatWithRate").replace("{rate}", String(percent)) : t("admin.inventory.smart.totalVat")}: {moneyText(check.workingVat, t("admin.inventory.smart.notDetected"))}</p>
        <p className="font-semibold">
          {t("admin.inventory.totals.payable")}: {moneyText(check.payable, t("admin.inventory.smart.notDetected"))}
          <button type="button" className="ms-2 inline-flex align-middle text-coffee/70 disabled:opacity-40" disabled={disabled} onClick={openEditor} aria-label={t("admin.inventory.totals.editTotals")}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </p>
        <p>{t("admin.inventory.smart.calculatedLinesTotal")}: {moneyText(check.calculatedLinesTotal, t("admin.inventory.smart.notDetected"))}</p>
        {sourceDiffers ? <p>{t("admin.inventory.totals.sourceTotal")}: {moneyText(check.sourceGross, t("admin.inventory.smart.notDetected"))}</p> : null}
        <p>{t("admin.inventory.smart.difference")}: {moneyText(gap, t("admin.inventory.smart.notDetected"))}</p>
        <p className="sm:col-span-2">{t("admin.inventory.smart.validationStatus")}: {matched ? t("admin.inventory.smart.statusMatch") : check.validationStatus === "missing" ? t("admin.inventory.smart.notDetected") : t("admin.inventory.smart.statusReview")}</p>
        <p className="sm:col-span-2 font-medium">
          {matched
            ? t("admin.inventory.smart.matchMessage")
            : gap != null
              ? t("admin.inventory.totals.mismatchOf").replace("{amount}", formatIls(Math.abs(gap)))
              : t("admin.inventory.smart.mismatchMessage")}
        </p>
      </div>
      {!matched && gap != null ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" className="h-9 justify-start text-xs" disabled={disabled} onClick={openEditor}>{t("admin.inventory.totals.editFinal")}</Button>
          {showLineActions ? (
            <Button type="button" variant="outline" className="h-9 justify-start text-xs" onClick={() => document.getElementById("invoice-lines")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{t("admin.inventory.totals.editLines")}</Button>
          ) : null}
          <Button type="button" variant="outline" className="h-9 justify-start text-xs" disabled={disabled || gap == null} onClick={() => {
            if (gap == null) return;
            const amount = formatIls(Math.round(-gap * 100) / 100);
            const accepted = window.confirm(t("admin.inventory.totals.adjustmentConfirm").replace("{amount}", amount));
            if (!accepted) return;
            void confirm(true, totalDraftFromInvoice(invoice));
          }}>{t("admin.inventory.totals.addAdjustment")}</Button>
          <Button type="button" variant="outline" className="h-9 justify-start text-xs" disabled={saving || !onPersist} onClick={() => void onPersist?.(invoice)}>{t("admin.inventory.totals.saveWithDifference")}</Button>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <Button type="button" className="h-9" disabled={disabled} onClick={openEditor}>{t("admin.inventory.totals.editTotals")}</Button>
        {showLineActions ? <Button type="button" variant="outline" className="h-9" onClick={() => document.getElementById("invoice-lines")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{t("admin.inventory.totals.reviewLines")}</Button> : null}
        <Button type="button" variant="outline" className="h-9" disabled={saving || !onPersist} onClick={() => void onPersist?.(invoice)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.totals.save")}</Button>
      </div>
      {!canEdit ? <p className="mt-2 text-xs text-coffee/60">{t("admin.inventory.totals.adminOnly")}</p> : null}

      <AdminModal open={open} onOpenChange={setOpen} size="sm" title={t("admin.inventory.totals.editTotals")}>
        <AdminModalHeader onClose={() => setOpen(false)}>
          <AdminModalTitle>{t("admin.inventory.totals.editTotals")}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody className="grid grid-cols-1 gap-3">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <Label>{t(field.label)}</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={text[field.key]}
                onChange={(event) => changeField(field.key, event.target.value)}
              />
              {invalid === field.key ? <p className="mt-1 text-xs text-red-700">{t("admin.inventory.totals.invalidAmount")}</p> : null}
            </div>
          ))}
          <div>
            <Label>{t("admin.inventory.totals.reason")}</Label>
            <Input className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className="rounded-xl bg-beige/50 p-3 text-xs text-coffee/80">
            <p className="font-medium">{t("admin.inventory.totals.preview")}</p>
            {preview.length === 0 ? <p className="mt-1">{t("admin.inventory.totals.noChange")}</p> : preview.map((field) => (
              <p key={field} className="mt-1">{t(FIELDS.find((item) => item.key === field)?.label || field)}: {moneyText(totalDraftFromInvoice(invoice)[field], "—")} → {moneyText(draft[field], "—")}</p>
            ))}
            <p className="mt-2">{t("admin.inventory.totals.originalKept")}</p>
          </div>
        </AdminModalBody>
        <AdminModalFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button type="button" disabled={disabled || invalid != null} onClick={() => void confirm(false)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.totals.confirm")}
          </Button>
        </AdminModalFooter>
      </AdminModal>
    </div>
  );
}

function blankText(draft: TotalDraft): Record<TotalField, string> {
  return {
    net: draft.net == null ? "" : draft.net.toFixed(2),
    vat: draft.vat == null ? "" : draft.vat.toFixed(2),
    vatPercent: draft.vatPercent == null ? "" : String(draft.vatPercent),
    discount: draft.discount == null ? "" : draft.discount.toFixed(2),
    adjustment: draft.adjustment == null ? "" : draft.adjustment.toFixed(2),
    total: draft.total == null ? "" : draft.total.toFixed(2),
  };
}
