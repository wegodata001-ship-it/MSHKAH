"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Equal, HelpCircle } from "lucide-react";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { Button } from "@/components/ui/button";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { formatIls, formatPercent } from "@/lib/costing/money";
import { lineRecipeCost, asPurchaseUnit } from "@/lib/costing/units";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { PurchaseUnit, BaseUnit } from "@/lib/costing/types";
import {
  pricePerPurchaseUnit,
  type IngredientPriceSummary,
  type PriceComparison,
} from "@/lib/costing/price-change";
import { cn } from "@/lib/utils";

type Direction = "up" | "down" | "flat";

function toneForDirection(direction: Direction): {
  badgeClass: string;
  icon: React.ReactNode;
} {
  if (direction === "up") {
    return {
      badgeClass: "bg-red-50 text-red-700 ring-red-200",
      icon: <ArrowUpRight className="h-3.5 w-3.5" />,
    };
  }
  if (direction === "down") {
    return {
      badgeClass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      icon: <ArrowDownRight className="h-3.5 w-3.5" />,
    };
  }
  return {
    badgeClass: "bg-stone-100 text-coffee/70 ring-stone-200",
    icon: <Equal className="h-3.5 w-3.5" />,
  };
}

function baseUnitLabel(t: (key: string) => string, baseUnit: BaseUnit): string {
  if (baseUnit === "g") return t(unitLabelKey("g"));
  if (baseUnit === "ml") return t(unitLabelKey("ml"));
  return t(unitLabelKey("unit"));
}

function formatBasePriceLabel(
  t: (key: string) => string,
  pricePerBase: number,
  baseUnit: BaseUnit,
  purchaseUnit: PurchaseUnit
): string {
  if (!(pricePerBase > 0)) return "—";
  // Show kg/liter price when the purchase unit is kg/liter and base is g/ml,
  // which matches the spec example "₪24/kg".
  const scaled = pricePerPurchaseUnit(pricePerBase, purchaseUnit);
  const displayUnit = purchaseUnit === "kg" || purchaseUnit === "liter" ? purchaseUnit : baseUnit;
  const unitLabel = displayUnit === "kg" || displayUnit === "liter"
    ? t(unitLabelKey(displayUnit))
    : baseUnitLabel(t, baseUnit);
  const amount = displayUnit === "kg" || displayUnit === "liter" ? scaled : pricePerBase;
  return `${formatIls(amount)} ${t("admin.recipe.price.per")} ${unitLabel}`;
}

export function IngredientPriceInfo({
  summary,
  quantity,
  recipeUnit,
  purchaseUnit,
  dishCost,
}: {
  summary: IngredientPriceSummary;
  quantity: number;
  recipeUnit: PurchaseUnit | string | undefined;
  purchaseUnit: PurchaseUnit;
  dishCost: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const basePrice = formatBasePriceLabel(t, summary.pricePerBase, summary.baseUnit, purchaseUnit);
  const hasPrice = summary.pricePerBase > 0;
  const comparison = summary.comparison;
  const direction: Direction | null =
    comparison.kind === "missing-data" ? null : comparison.direction;
  const changeTone = direction ? toneForDirection(direction) : null;

  const changeLabel = (() => {
    if (comparison.kind === "missing-data") {
      return summary.current ? t("admin.recipe.price.compareUnavailable") : t("admin.recipe.price.noPriceYet");
    }
    if (comparison.direction === "flat") return t("admin.recipe.price.flat");
    const pct = comparison.deltaPct != null ? Math.round(Math.abs(comparison.deltaPct) * 100) : null;
    const key = comparison.direction === "up" ? "admin.recipe.price.up" : "admin.recipe.price.down";
    return pct != null ? `${t(key)} ${pct}%` : t(key);
  })();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-coffee/70">
      {hasPrice ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-beige/50 px-2 py-0.5 text-coffee/70">
          {basePrice}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-900 ring-1 ring-amber-200">
          {t("admin.recipe.price.missing")}
        </span>
      )}
      {hasPrice && quantity > 0 ? (
        <span className="font-medium text-dark-brown">
          {quantity} {t(unitLabelKey(asPurchaseUnit(recipeUnit)))} × {basePrice} = {formatIls(dishCost)}
        </span>
      ) : null}
      {summary.priceDate ? (
        <span className="text-coffee/55">
          {summary.priceDate}
          {summary.supplierName ? ` · ${summary.supplierName}` : ""}
          {summary.source === "manual" ? ` · ${t("admin.recipe.price.manualSource")}` : ""}
        </span>
      ) : summary.source === "manual" ? (
        <span className="text-coffee/55">{t("admin.recipe.price.manualSource")}</span>
      ) : null}
      {changeTone ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition hover:brightness-105",
            changeTone.badgeClass
          )}
        >
          {changeTone.icon}
          <span>{changeLabel}</span>
          {comparison.kind === "cross-supplier" ? (
            <span className="ms-1 text-[10px] opacity-70">({t("admin.recipe.price.crossSupplierShort")})</span>
          ) : null}
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-coffee/60 ring-1 ring-stone-200"
          title={t("admin.recipe.price.compareUnavailableHint")}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          {changeLabel}
        </span>
      )}
      {open ? (
        <PriceDeltaDialog
          summary={summary}
          quantity={quantity}
          recipeUnit={recipeUnit}
          purchaseUnit={purchaseUnit}
          dishCost={dishCost}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PriceDeltaDialog({
  summary,
  quantity,
  recipeUnit,
  purchaseUnit,
  dishCost,
  onClose,
}: {
  summary: IngredientPriceSummary;
  quantity: number;
  recipeUnit: PurchaseUnit | string | undefined;
  purchaseUnit: PurchaseUnit;
  dishCost: number;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const comparison = summary.comparison;
  const isComparable = comparison.kind !== "missing-data";
  const newBase = isComparable ? comparison.currentBase : summary.pricePerBase;
  const prevBase = isComparable ? comparison.previousBase : null;
  const nextCost = quantity > 0 && newBase > 0
    ? lineRecipeCost(quantity, recipeUnit, newBase)
    : null;
  const prevCost = quantity > 0 && prevBase != null && prevBase > 0
    ? lineRecipeCost(quantity, recipeUnit, prevBase)
    : null;

  return (
    <AdminModal open onOpenChange={(next) => { if (!next) onClose(); }} size="sm">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.recipe.price.deltaTitle")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <div className="space-y-3 text-sm text-dark-brown">
          {isComparable ? (
            <>
              <DeltaRow
                label={t("admin.recipe.price.previousPrice")}
                value={formatBasePriceLabel(t, comparison.previousBase, summary.baseUnit, purchaseUnit)}
                sub={comparison.previous.purchaseDate}
              />
              <DeltaRow
                label={t("admin.recipe.price.newPrice")}
                value={formatBasePriceLabel(t, comparison.currentBase, summary.baseUnit, purchaseUnit)}
                sub={comparison.current.purchaseDate}
              />
              <DeltaRow
                label={t("admin.recipe.price.delta")}
                value={`${comparison.deltaIls >= 0 ? "+" : ""}${formatIls(comparison.deltaIls)} ${t("admin.recipe.price.per")} ${baseUnitLabel(t, summary.baseUnit)}`}
                tone={comparison.direction === "up" ? "up" : comparison.direction === "down" ? "down" : "flat"}
                sub={
                  comparison.deltaPct != null
                    ? `${comparison.deltaPct >= 0 ? "+" : ""}${formatPercent(comparison.deltaPct * 100)}`
                    : undefined
                }
              />
              <DeltaRow
                label={t("admin.recipe.price.supplier")}
                value={comparison.current.supplierName ?? "—"}
                sub={
                  comparison.kind === "cross-supplier"
                    ? `${t("admin.recipe.price.crossSupplierNote")} · ${comparison.previous.supplierName ?? "—"}`
                    : undefined
                }
              />
              {comparison.current.invoiceNumber ? (
                <DeltaRow
                  label={t("admin.recipe.price.invoice")}
                  value={comparison.current.invoiceNumber}
                  sub={comparison.previous.invoiceNumber ? `${t("admin.recipe.price.previousInvoice")}: ${comparison.previous.invoiceNumber}` : undefined}
                />
              ) : null}
              {nextCost != null && prevCost != null ? (
                <div className="rounded-xl bg-beige/40 px-3 py-2 text-sm">
                  <p className="text-xs text-coffee/60">{t("admin.recipe.price.dishImpactLabel")}</p>
                  <p className="mt-1 font-medium">
                    {t("admin.recipe.price.dishImpactLine").replace("{from}", formatIls(prevCost)).replace("{to}", formatIls(nextCost))}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              <p>{t("admin.recipe.price.compareUnavailable")}</p>
              <p className="mt-1 text-xs text-amber-900/80">{t("admin.recipe.price.compareUnavailableHint")}</p>
              {summary.current ? (
                <p className="mt-2 text-xs text-coffee/70">
                  {t("admin.recipe.price.currentOnly")}: {formatBasePriceLabel(t, summary.pricePerBase, summary.baseUnit, purchaseUnit)} · {summary.priceDate}
                </p>
              ) : null}
            </div>
          )}
          {quantity > 0 && dishCost > 0 ? (
            <p className="text-xs text-coffee/55">
              {t("admin.recipe.price.dishQuantityNote").replace("{qty}", `${quantity} ${t(unitLabelKey(asPurchaseUnit(recipeUnit)))}`)}
            </p>
          ) : null}
          <p className="text-xs text-coffee/55">{t("admin.recipe.price.vatBasisNote." + (summary.comparison.kind !== "missing-data" ? summary.comparison.basis : "before"))}</p>
          <p className="text-xs text-coffee/40 sr-only">{locale}</p>
        </div>
      </AdminModalBody>
      <AdminModalFooter>
        <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
      </AdminModalFooter>
    </AdminModal>
  );
}

function DeltaRow({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-warm-white px-3 py-2 shadow-soft">
      <div>
        <p className="text-xs text-coffee/60">{label}</p>
        <p
          className={cn(
            "mt-0.5 text-sm font-semibold tabular-nums",
            tone === "up" && "text-red-700",
            tone === "down" && "text-emerald-700",
            !tone && "text-dark-brown"
          )}
        >
          {value}
        </p>
      </div>
      {sub ? <p className="text-xs text-coffee/55">{sub}</p> : null}
    </div>
  );
}
