"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, PackageX, Trash2 } from "lucide-react";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { CostingIngredient } from "@/lib/costing/types";
import type { InventoryMovement, PurchaseInvoice } from "@/lib/inventory/types";
import {
  planInvoiceCancellation,
  type CancelMovementPlan,
  type CancelPlan,
} from "@/lib/inventory/invoice-cancel";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";

type Props = {
  invoice: PurchaseInvoice | null;
  movements: InventoryMovement[];
  ingredients: CostingIngredient[];
  onClose: () => void;
  onConfirmed: (invoice: PurchaseInvoice) => void;
  /**
   * Cancellation side-effect. The parent service wires this to the real
   * `/api/admin/inventory/invoice/cancel` POST. We keep it in a prop so the
   * dialog can be rendered in Storybook / tests without the real auth stack.
   */
  cancelFn: (input: { invoiceId: string; reason?: string }) => Promise<
    | { ok: true; invoice: PurchaseInvoice }
    | { ok: false; code: string; detail?: unknown }
  >;
};

type UiState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; code: string; detail?: unknown };

export function InvoiceCancelDialog({
  invoice,
  movements,
  ingredients,
  onClose,
  onConfirmed,
  cancelFn,
}: Props) {
  const t = useT();
  const [state, setState] = useState<UiState>({ kind: "idle" });
  const [reason, setReason] = useState("");

  const plan = useMemo<CancelPlan | null>(() => {
    if (!invoice) return null;
    return planInvoiceCancellation({ invoice, movements });
  }, [invoice, movements]);

  const ingredientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const ingredient of ingredients) map.set(ingredient.id, ingredient.name);
    return map;
  }, [ingredients]);

  if (!invoice || !plan) return null;

  const canExecute = plan.status === "ready" || plan.status === "no-stock";
  const blocked = state.kind === "working";

  async function handleConfirm() {
    if (!invoice || blocked) return;
    setState({ kind: "working" });
    const result = await cancelFn({
      invoiceId: invoice.id,
      reason: reason.trim() || undefined,
    });
    if (result.ok) {
      onConfirmed(result.invoice);
      return;
    }
    setState({ kind: "error", code: result.code, detail: result.detail });
  }

  function headerLabel() {
    const number = invoice?.invoiceNumber?.trim() || t("admin.invoice.cancel.unknownNumber");
    const supplier = invoice?.supplierName?.trim() || t("admin.invoice.cancel.unknownSupplier");
    return t("admin.invoice.cancel.confirmTitle")
      .replace("{number}", number)
      .replace("{supplier}", supplier);
  }

  function reasonLabel(code: string): string {
    return t(`admin.invoice.cancel.broken.${code}`);
  }

  return (
    <AdminModal
      open={!!invoice}
      onOpenChange={(open) => {
        if (!open && !blocked) onClose();
      }}
      size="lg"
      preventOverlayClose={blocked}
    >
      <AdminModalHeader onClose={blocked ? undefined : onClose}>
        <AdminModalTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-red-600" />
          {t("admin.invoice.cancel.title")}
        </AdminModalTitle>
        <p className="mt-2 text-sm text-coffee/70">{headerLabel()}</p>
      </AdminModalHeader>

      <AdminModalBody className="space-y-4">
        {plan.status === "already-cancelled" ? (
          <StatusNote
            tone="stone"
            icon={<PackageX className="h-4 w-4" />}
            title={t("admin.invoice.cancel.alreadyCancelled")}
            hint={t("admin.invoice.cancel.alreadyCancelledHint")}
          />
        ) : null}

        {plan.status === "no-stock" ? (
          <StatusNote
            tone="emerald"
            icon={<PackageX className="h-4 w-4" />}
            title={t("admin.invoice.cancel.noStockImpact")}
            hint={t("admin.invoice.cancel.noStockImpactHint")}
          />
        ) : null}

        {plan.status === "already-reversed" ? (
          <StatusNote
            tone="stone"
            icon={<PackageX className="h-4 w-4" />}
            title={t("admin.invoice.cancel.alreadyReversed")}
            hint={t("admin.invoice.cancel.alreadyReversedHint")}
          />
        ) : null}

        {plan.status === "broken-link" ? (
          <StatusNote
            tone="red"
            icon={<AlertTriangle className="h-4 w-4" />}
            title={t("admin.invoice.cancel.brokenLinkTitle")}
            hint={t("admin.invoice.cancel.brokenLinkHint")}
          >
            <ul className="mt-2 space-y-1 text-xs text-red-900/90">
              {plan.brokenLinks.map((link) => (
                <li key={link.invoiceLineKey}>
                  • {link.rawName || link.invoiceLineKey} — {reasonLabel(link.reason)}
                </li>
              ))}
            </ul>
          </StatusNote>
        ) : null}

        {plan.movements.length > 0 ? (
          <ImpactTable plan={plan} ingredientNames={ingredientNames} />
        ) : null}

        {plan.negativeAfter.length > 0 ? (
          <StatusNote
            tone="amber"
            icon={<AlertTriangle className="h-4 w-4" />}
            title={t("admin.invoice.cancel.negativeWarningTitle")}
            hint={t("admin.invoice.cancel.negativeWarningHint")}
          />
        ) : null}

        <label className="block text-sm text-coffee/70">
          <span className="mb-1 block text-xs text-coffee/55">
            {t("admin.invoice.cancel.reasonLabel")}
          </span>
          <input
            type="text"
            value={reason}
            disabled={blocked}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("admin.invoice.cancel.reasonPlaceholder")}
            className="h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm text-dark-brown focus:outline-none focus:ring-2 focus:ring-turquoise/30 disabled:opacity-60"
          />
        </label>

        {state.kind === "error" ? (
          <StatusNote
            tone="red"
            icon={<AlertTriangle className="h-4 w-4" />}
            title={t("admin.invoice.cancel.errorTitle")}
            hint={t(`admin.invoice.cancel.err.${state.code}`) || state.code}
          />
        ) : null}

        <p className="text-xs text-coffee/60">
          {t("admin.invoice.cancel.sideEffectsHint")}
        </p>
      </AdminModalBody>

      <AdminModalFooter>
        <Button type="button" variant="outline" disabled={blocked} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={blocked || !canExecute}
          onClick={handleConfirm}
          className="min-w-[140px]"
        >
          {blocked ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("admin.invoice.cancel.working")}
            </span>
          ) : (
            t("admin.invoice.cancel.confirmButton")
          )}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}

// ──────────────────────────────────────────────────────────────
// Impact table
// ──────────────────────────────────────────────────────────────

function ImpactTable({
  plan,
  ingredientNames,
}: {
  plan: CancelPlan;
  ingredientNames: Map<string, string>;
}) {
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-2xl border border-beige-dark/15 bg-warm-white">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-beige/50 text-xs text-coffee/60">
          <tr className="h-10">
            <th className="px-3 text-start font-medium">
              {t("admin.invoice.cancel.cols.ingredient")}
            </th>
            <th className="px-3 text-end font-medium">
              {t("admin.invoice.cancel.cols.qtyToReverse")}
            </th>
            <th className="px-3 text-end font-medium">
              {t("admin.invoice.cancel.cols.currentBalance")}
            </th>
            <th className="px-3 text-end font-medium">
              {t("admin.invoice.cancel.cols.afterBalance")}
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.movements.map((movement) => (
            <ImpactRow
              key={movement.sourceId}
              movement={movement}
              name={ingredientNames.get(movement.productId) || movement.productId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImpactRow({
  movement,
  name,
}: {
  movement: CancelMovementPlan;
  name: string;
}) {
  const t = useT();
  const unit = unitLabel(movement.baseUnit, t);
  const negative = movement.expectedAfter < -0.0001;
  const alreadyReversed = movement.alreadyReversedBase > 0.0001;
  return (
    <tr className="h-12 border-t border-beige-dark/10">
      <td className="px-3">
        <div className="truncate font-medium text-dark-brown">{name}</div>
        {alreadyReversed ? (
          <div className="text-[11px] text-coffee/55">
            {t("admin.invoice.cancel.partiallyReversedPrev")}
          </div>
        ) : null}
      </td>
      <td className="px-3 text-end tabular-nums font-semibold text-red-700">
        -{formatQty(movement.remainingBaseQty)} {unit}
      </td>
      <td className="px-3 text-end tabular-nums text-coffee/80">
        {formatQty(movement.currentBalance)} {unit}
      </td>
      <td
        className={cn(
          "px-3 text-end tabular-nums font-semibold",
          negative ? "text-amber-900" : "text-dark-brown"
        )}
      >
        {formatQty(movement.expectedAfter)} {unit}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function unitLabel(baseUnit: "g" | "ml" | "unit", t: (key: string) => string): string {
  return t(unitLabelKey(baseUnit));
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1000) / 1000;
  if (Math.abs(rounded) >= 100) return rounded.toFixed(0);
  if (Math.abs(rounded) >= 10) return rounded.toFixed(1);
  return rounded.toFixed(2);
}

function StatusNote({
  tone,
  icon,
  title,
  hint,
  children,
}: {
  tone: "red" | "amber" | "emerald" | "stone";
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  const toneStyles: Record<string, string> = {
    red: "border-red-200 bg-red-50 text-red-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    stone: "border-stone-200 bg-stone-50 text-stone-700",
  };
  return (
    <div className={cn("flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm", toneStyles[tone])}>
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="font-semibold">{title}</div>
        {hint ? <div className="text-xs opacity-90">{hint}</div> : null}
        {children}
      </div>
    </div>
  );
}
