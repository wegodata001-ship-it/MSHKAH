"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { baseUnitFor, costPerBaseUnit } from "@/lib/costing/units";
import { perUnitKey, unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";

const UNITS: PurchaseUnit[] = ["kg", "g", "liter", "ml", "unit"];

export type IngredientFormValue = {
  name: string;
  category: string;
  purchasePrice: string;
  purchaseQuantity: string;
  purchaseUnit: PurchaseUnit;
  supplier: string;
};

export function emptyIngredientForm(): IngredientFormValue {
  return {
    name: "",
    category: "",
    purchasePrice: "",
    purchaseQuantity: "",
    purchaseUnit: "kg",
    supplier: "",
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
  };
}

export function IngredientFormModal({
  open,
  title,
  initial,
  saving,
  impactNote,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: IngredientFormValue;
  saving: boolean;
  impactNote?: string;
  onClose: () => void;
  onSave: (value: IngredientFormValue) => void;
}) {
  const t = useT();
  const [form, setForm] = useState(initial);

  const preview = useMemo(() => {
    const price = Number(form.purchasePrice);
    const qty = Number(form.purchaseQuantity);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price < 0 || qty <= 0) return null;
    return costPerBaseUnit(price, qty, form.purchaseUnit);
  }, [form.purchasePrice, form.purchaseQuantity, form.purchaseUnit]);

  return (
    <AdminModal open={open} onOpenChange={(next) => !next && onClose()} size="md">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{title}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <div className="grid gap-4">
          <div>
            <Label>{t("admin.costing.ingredientName")}</Label>
            <Input
              className="mt-1"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>{t("admin.costing.purchasePrice")}</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="0.01"
                value={form.purchasePrice}
                onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.costing.purchaseQty")}</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="0.01"
                value={form.purchaseQuantity}
                onChange={(e) => setForm({ ...form, purchaseQuantity: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.costing.purchaseUnit")}</Label>
              <select
                className="mt-1 h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
                value={form.purchaseUnit}
                onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value as PurchaseUnit })}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(unitLabelKey(unit))}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-2xl bg-turquoise/8 px-4 py-3 text-sm font-medium text-turquoise">
            {t("admin.costing.computedCost")}:{" "}
            {preview == null
              ? "—"
              : `${formatIls(preview, preview < 0.1 ? 4 : 2)} ${t(perUnitKey(baseUnitFor(form.purchaseUnit)))}`}
          </div>
          {impactNote && <p className="text-sm text-coffee/65">{impactNote}</p>}
        </div>
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || !form.name.trim() || preview == null}
          onClick={() => onSave(form)}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.save")}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}
