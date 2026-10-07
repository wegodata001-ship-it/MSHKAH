"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { liveCostPreview } from "@/lib/costing/units";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import type { PurchasePriceRecord, Supplier, SupplierOffer } from "@/lib/inventory/types";
import { SupplierOffersEditor } from "@/features/admin/inventory/inventory-hub";
import { cn } from "@/lib/utils";

const UNITS: PurchaseUnit[] = ["kg", "g", "liter", "ml", "unit"];
const LAST_UNIT_KEY = "mishkah.costing.lastPurchaseUnit";

function readLastUnit(): PurchaseUnit {
  if (typeof window === "undefined") return "kg";
  const stored = window.localStorage.getItem(LAST_UNIT_KEY);
  return UNITS.includes(stored as PurchaseUnit) ? (stored as PurchaseUnit) : "kg";
}

export type IngredientFormValue = {
  name: string;
  category: string;
  purchasePrice: string;
  purchaseQuantity: string;
  purchaseUnit: PurchaseUnit;
  supplier: string;
  notes: string;
};

export function emptyIngredientForm(): IngredientFormValue {
  return {
    name: "",
    category: "",
    purchasePrice: "",
    purchaseQuantity: "",
    purchaseUnit: readLastUnit(),
    supplier: "",
    notes: "",
  };
}

export function formFromIngredient(item: CostingIngredient): IngredientFormValue {
  return {
    name: item.name,
    category: item.category ?? "",
    purchasePrice: String(item.purchasePrice),
    purchaseQuantity: String(item.purchaseQuantity),
    purchaseUnit: item.purchaseUnit,
    supplier: item.supplier ?? "",
    notes: item.notes ?? "",
  };
}

export function IngredientFormModal({
  open,
  mode,
  title,
  initial,
  saving,
  formError,
  impactNote,
  onClose,
  onSave,
  product,
  suppliers = [],
  offers = [],
  records = [],
  onToast,
}: {
  open: boolean;
  mode: "create" | "edit";
  title: string;
  initial: IngredientFormValue;
  saving: boolean;
  formError?: string | null;
  impactNote?: string;
  onClose: () => void;
  onSave: (value: IngredientFormValue) => Promise<boolean>;
  product?: CostingIngredient | null;
  suppliers?: Supplier[];
  offers?: SupplierOffer[];
  records?: PurchasePriceRecord[];
  onToast?: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const [showExtra, setShowExtra] = useState(Boolean(initial.category || initial.supplier || initial.notes));
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const preview = useMemo(() => {
    return liveCostPreview(Number(form.purchasePrice), Number(form.purchaseQuantity), form.purchaseUnit);
  }, [form.purchasePrice, form.purchaseQuantity, form.purchaseUnit]);

  const valid = form.name.trim().length > 0;

  const persistLastUnit = (unit: PurchaseUnit) => {
    window.localStorage.setItem(LAST_UNIT_KEY, unit);
  };

  const submit = async () => {
    if (saving || !valid) {
      setLocalError(t("admin.costing.validationRequired"));
      return;
    }
    setLocalError(null);
    persistLastUnit(form.purchaseUnit);
    const ok = await onSave(form);
    if (ok && mode === "create") setSaved(true);
    if (ok && mode === "edit") onClose();
  };

  const addAnother = () => {
    setForm({ ...emptyIngredientForm(), purchaseUnit: form.purchaseUnit });
    setSaved(false);
    setShowExtra(false);
    setLocalError(null);
  };

  return (
    <AdminModal
      open={open}
      onOpenChange={(next) => !next && !saving && onClose()}
      size="sm"
      preventOverlayClose={saving}
      className="h-[calc(100dvh-8px)] w-[calc(100vw-8px)] sm:h-auto sm:w-[min(440px,calc(100vw-48px))] sm:max-h-[calc(100dvh-48px)]"
    >
      <AdminModalHeader onClose={saving ? undefined : onClose}>
        <AdminModalTitle>{title}</AdminModalTitle>
        <p className="mt-1 text-xs text-coffee/55">{t("admin.costing.addHint")}</p>
      </AdminModalHeader>
      <AdminModalBody>
        {saved ? (
          <div className="space-y-4 text-center">
            <p className="font-medium text-emerald-700">{t("admin.costing.addedSuccess")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" className="h-12 flex-1" onClick={onClose}>
                {t("admin.costing.done")}
              </Button>
              <Button type="button" variant="turquoise" className="h-12 flex-1" onClick={addAnother}>
                {t("admin.costing.addAnother")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div>
              <Label>{t("admin.costing.ingredientName")} *</Label>
              <Input
                className="mt-1 h-12"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>{t("admin.costing.paidPrice")}</Label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-coffee/45">₪</span>
                  <Input
                    className="h-12 ps-8"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.purchasePrice}
                    onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>{t("admin.costing.howMuchBought")}</Label>
                <Input
                  className="mt-1 h-12"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={form.purchaseQuantity}
                  onChange={(e) => setForm({ ...form, purchaseQuantity: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>{t("admin.costing.unit")} *</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => {
                      setForm({ ...form, purchaseUnit: unit });
                      persistLastUnit(unit);
                    }}
                    className={cn(
                      "h-11 min-w-[3.2rem] flex-1 rounded-xl border px-2 text-sm font-medium transition-colors",
                      form.purchaseUnit === unit
                        ? "border-turquoise bg-turquoise/10 text-turquoise"
                        : "border-beige-dark/30 bg-warm-white text-coffee/70"
                    )}
                  >
                    {t(unitLabelKey(unit))}
                  </button>
                ))}
              </div>
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

            <button
              type="button"
              onClick={() => setShowExtra((value) => !value)}
              className="flex items-center gap-1 text-sm font-medium text-coffee/65"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", showExtra && "rotate-180")} />
              {t("admin.costing.moreDetails")}
            </button>
            {showExtra && (
              <div className="grid gap-3">
                <div>
                  <Label>{t("admin.costing.category")}</Label>
                  <Input
                    className="mt-1"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("admin.costing.supplier")}</Label>
                  <Input
                    className="mt-1"
                    value={form.supplier}
                    onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("admin.costing.notes")}</Label>
                  <Textarea
                    className="mt-1"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
            )}

            {!form.supplier.trim() && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{t("admin.inventory.missingSupplierWarning")}</p>
            )}
            {mode === "edit" && product && onToast && (
              <SupplierOffersEditor
                product={product}
                suppliers={suppliers}
                offers={offers}
                records={records}
                onToast={onToast}
              />
            )}
            {impactNote && <p className="text-sm text-coffee/65">{impactNote}</p>}
            {(localError || formError) && (
              <p className="text-sm text-red-600">{localError || formError}</p>
            )}
          </div>
        )}
      </AdminModalBody>
      {!saved && (
        <AdminModalFooter className="flex-col-reverse sm:flex-row">
          <Button type="button" variant="outline" className="h-12 w-full sm:w-auto" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="turquoise"
            className="h-12 w-full sm:w-auto"
            disabled={saving || !valid}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.costing.saveIngredient")}
          </Button>
        </AdminModalFooter>
      )}
    </AdminModal>
  );
}
