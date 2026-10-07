"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { findDuplicateIngredient } from "@/lib/costing/names";
import { liveCostPreview, PURCHASE_UNITS } from "@/lib/costing/units";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { emptyIngredientForm } from "@/features/admin/costing/ingredient-form";
import { createIngredient } from "@/services/costingService";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { cn } from "@/lib/utils";

const LAST_UNIT_KEY = "mishkah.costing.lastPurchaseUnit";

export function QuickCreateIngredientPanel({
  open,
  initialName,
  existing,
  onClose,
  onCreated,
  onUseExisting,
}: {
  open: boolean;
  initialName?: string;
  existing: CostingIngredient[];
  onClose: () => void;
  onCreated: (item: CostingIngredient) => void;
  onUseExisting: (item: CostingIngredient) => void;
}) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState(initialName ?? "");
  const [category, setCategory] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseQuantity, setPurchaseQuantity] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState<PurchaseUnit>(emptyIngredientForm().purchaseUnit);
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<CostingIngredient | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    setCategory("");
    setPurchasePrice("");
    setPurchaseQuantity("");
    setPurchaseUnit(emptyIngredientForm().purchaseUnit);
    setSupplier("");
    setError(null);
    setDuplicate(null);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!saving) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, saving, onClose]);

  const preview = useMemo(
    () => liveCostPreview(Number(purchasePrice), Number(purchaseQuantity), purchaseUnit),
    [purchasePrice, purchaseQuantity, purchaseUnit]
  );

  const valid = name.trim().length > 0 && preview != null;

  const submit = async () => {
    if (saving || !valid) {
      setError(t("admin.costing.validationRequired"));
      return;
    }
    const match = findDuplicateIngredient(name, existing);
    if (match) {
      setDuplicate(match);
      setError(t("admin.costing.duplicateName"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      window.localStorage.setItem(LAST_UNIT_KEY, purchaseUnit);
      const result = await createIngredient({
        name,
        category,
        purchasePrice: Number(purchasePrice),
        purchaseQuantity: Number(purchaseQuantity),
        purchaseUnit,
        supplier,
      });
      if (!result.success) {
        setError(
          result.code === "PERMISSION_DENIED"
            ? t("admin.costing.permissionError")
            : t("admin.costing.saveFailed")
        );
        return;
      }
      onCreated(result.data);
    } finally {
      setSaving(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/35" style={{ zIndex: 1040 }} aria-hidden />
      <div
        className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-6"
        style={{ zIndex: 1050 }}
        role="dialog"
        aria-modal="true"
        aria-label={t("admin.costing.quickCreateTitle")}
      >
        <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] border border-black/[0.06] bg-white shadow-elevated sm:w-[min(420px,calc(100vw-48px))] sm:rounded-[20px]">
          <div className="relative border-b border-beige-dark/15 px-5 py-4 pe-12">
            <h2 className="font-display text-lg font-semibold text-dark-brown">
              {t("admin.costing.quickCreateTitle")}
            </h2>
            <button
              type="button"
              className="absolute end-4 top-4 rounded-lg p-1 text-coffee/55 hover:bg-beige/60"
              onClick={onClose}
              disabled={saving}
              aria-label={t("common.cancel")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <div>
              <Label>{t("admin.costing.ingredientName")} *</Label>
              <Input
                className="mt-1 h-11"
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setDuplicate(null);
                }}
              />
            </div>
            <div>
              <Label>{t("admin.costing.category")}</Label>
              <Input className="mt-1 h-11" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("admin.costing.purchasePrice")} *</Label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-coffee/45">
                    ₪
                  </span>
                  <Input
                    className="h-11 ps-8"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>{t("admin.costing.purchaseQty")} *</Label>
                <Input
                  className="mt-1 h-11"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={purchaseQuantity}
                  onChange={(e) => setPurchaseQuantity(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>{t("admin.costing.purchaseUnit")} *</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PURCHASE_UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setPurchaseUnit(unit)}
                    className={cn(
                      "h-10 min-w-[3rem] flex-1 rounded-xl border px-2 text-sm font-medium",
                      purchaseUnit === unit
                        ? "border-turquoise bg-turquoise/10 text-turquoise"
                        : "border-beige-dark/30 bg-warm-white text-coffee/70"
                    )}
                  >
                    {t(unitLabelKey(unit))}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>{t("admin.costing.supplier")}</Label>
              <Input className="mt-1 h-11" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div className="rounded-2xl bg-turquoise/8 px-4 py-3">
              <p className="text-xs font-semibold text-turquoise">{t("admin.costing.computedCost")}</p>
              {preview ? (
                <div className="mt-1 space-y-0.5 text-sm font-medium text-dark-brown">
                  <p>
                    {formatIls(preview.purchaseUnitCost)} / {t(unitLabelKey(preview.purchaseUnit))}
                  </p>
                  {preview.showBase && (
                    <p>
                      {formatIls(preview.baseUnitCost, 4)} / {t(unitLabelKey(preview.baseUnit))}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-coffee/45">—</p>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {duplicate && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                onClick={() => onUseExisting(duplicate)}
              >
                {t("admin.costing.useExisting")}: {duplicate.name}
              </Button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-beige-dark/15 px-5 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="h-11" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="turquoise"
              className="h-11"
              disabled={saving || !valid}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.costing.saveAndAddToRecipe")}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
