"use client";

import { useMemo, useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
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
import { lineIngredientCost } from "@/lib/costing/units";
import { perUnitKey, unitLabelKey } from "@/features/admin/costing/costing-shared";
import type {
  CostingIngredient,
  CustomCost,
  DishRecipe,
  OverheadSettings,
  RecipeLine,
} from "@/lib/costing/types";
import type { ModifierOption } from "@/types/modifiers";
import { getLocalizedName } from "@/lib/i18n/localized-content";
import type { Locale } from "@/lib/i18n/types";

type DraftLine = RecipeLine & { key: string };

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function RecipeEditorModal({
  open,
  productName,
  recipe,
  ingredients,
  variants,
  locale,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  productName: string;
  recipe?: DishRecipe;
  ingredients: CostingIngredient[];
  variants: ModifierOption[];
  locale: Locale;
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    variantId?: string;
    ingredients: RecipeLine[];
    overheadSettings: OverheadSettings;
    targetFoodCostPercent?: number;
  }) => void;
}) {
  const t = useT();
  const activeIngredients = ingredients.filter((item) => item.active);
  const [variantId, setVariantId] = useState(recipe?.variantId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    (recipe?.ingredients ?? []).map((line) => ({ ...line, key: newKey() }))
  );
  const [packaging, setPackaging] = useState(String(recipe?.overheadSettings?.packaging ?? ""));
  const [labor, setLabor] = useState(String(recipe?.overheadSettings?.labor ?? ""));
  const [card, setCard] = useState(String(recipe?.overheadSettings?.creditCardPercent ?? ""));
  const [platform, setPlatform] = useState(String(recipe?.overheadSettings?.platformPercent ?? ""));
  const [overhead, setOverhead] = useState(String(recipe?.overheadSettings?.overheadPercent ?? ""));
  const [custom, setCustom] = useState<CustomCost[]>(recipe?.overheadSettings?.customCosts ?? []);
  const [target, setTarget] = useState(String(recipe?.targetFoodCostPercent ?? ""));

  const lookup = useMemo(
    () => new Map(ingredients.map((item) => [item.id, item])),
    [ingredients]
  );

  const total = lines.reduce((sum, line) => {
    const ingredient = lookup.get(line.ingredientId);
    return sum + (ingredient ? lineIngredientCost(line.quantity, ingredient.costPerBaseUnit) : 0);
  }, 0);

  const addLine = () => {
    const first = activeIngredients[0];
    if (!first) return;
    setLines((current) => [
      ...current,
      { key: newKey(), ingredientId: first.id, quantity: 1, unit: first.baseUnit },
    ]);
  };

  return (
    <AdminModal open={open} onOpenChange={(next) => !next && onClose()} size="xl">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>
          {t("admin.costing.recipeLines")} — {productName}
        </AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <div className="space-y-5">
          {variants.length > 0 && (
            <div>
              <Label>{t("admin.costing.variant")}</Label>
              <select
                className="mt-1 h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
              >
                <option value="">{t("admin.costing.baseRecipe")}</option>
                {variants.map((option) => (
                  <option key={option.id} value={option.id}>
                    {getLocalizedName(option, locale)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="hidden overflow-hidden rounded-2xl border border-beige-dark/15 md:block">
            <table className="w-full text-sm">
              <thead className="bg-beige/40 text-xs text-coffee/65">
                <tr>
                  <th className="px-3 py-2 text-start">{t("admin.costing.selectIngredient")}</th>
                  <th className="px-3 py-2 text-start">{t("admin.costing.quantity")}</th>
                  <th className="px-3 py-2 text-start">{t("admin.costing.purchaseUnit")}</th>
                  <th className="px-3 py-2 text-end">{t("admin.costing.ingredientCost")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const ingredient = lookup.get(line.ingredientId);
                  const cost = ingredient
                    ? lineIngredientCost(line.quantity, ingredient.costPerBaseUnit)
                    : 0;
                  return (
                    <tr key={line.key} className="border-t border-beige-dark/10">
                      <td className="px-3 py-2">
                        <select
                          className="h-10 w-full rounded-xl border border-beige-dark/30 px-2"
                          value={line.ingredientId}
                          onChange={(e) => {
                            const next = activeIngredients.find((item) => item.id === e.target.value);
                            setLines((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      ingredientId: e.target.value,
                                      unit: next?.baseUnit ?? item.unit,
                                    }
                                  : item
                              )
                            );
                          }}
                        >
                          {activeIngredients.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, quantity: Number(e.target.value) || 0 } : item
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-coffee/60">
                        {t(unitLabelKey(ingredient?.baseUnit ?? line.unit))}
                      </td>
                      <td className="px-3 py-2 text-end font-medium">{formatIls(cost)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-lg p-2 hover:bg-beige/50"
                            onClick={() =>
                              setLines((current) => [
                                ...current,
                                { ...line, key: newKey() },
                              ])
                            }
                            aria-label={t("admin.costing.duplicateLine")}
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-2 hover:bg-red-50"
                            onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                            aria-label={t("admin.costing.deleteLine")}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {lines.map((line, index) => {
              const ingredient = lookup.get(line.ingredientId);
              const cost = ingredient
                ? lineIngredientCost(line.quantity, ingredient.costPerBaseUnit)
                : 0;
              return (
                <div key={line.key} className="rounded-2xl border border-beige-dark/15 bg-warm-white p-4">
                  <p className="font-medium">{ingredient?.name ?? t("admin.costing.selectIngredient")}</p>
                  <select
                    className="mt-2 h-10 w-full rounded-xl border border-beige-dark/30 px-2 text-sm"
                    value={line.ingredientId}
                    onChange={(e) => {
                      const next = activeIngredients.find((item) => item.id === e.target.value);
                      setLines((current) =>
                        current.map((item, i) =>
                          i === index
                            ? { ...item, ingredientId: e.target.value, unit: next?.baseUnit ?? item.unit }
                            : item
                        )
                      );
                    }}
                  >
                    {activeIngredients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <Input
                      type="number"
                      min="0"
                      className="w-28"
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, quantity: Number(e.target.value) || 0 } : item
                          )
                        )
                      }
                    />
                    <span className="text-coffee/55">
                      {line.quantity} {t(unitLabelKey(ingredient?.baseUnit ?? "g"))}
                    </span>
                  </div>
                  {ingredient && (
                    <p className="mt-1 text-xs text-coffee/45">
                      {formatIls(ingredient.costPerBaseUnit, 4)} {t(perUnitKey(ingredient.baseUnit))}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-semibold">{formatIls(cost)}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded-lg p-2 hover:bg-beige/50"
                        onClick={() => setLines((current) => [...current, { ...line, key: newKey() }])}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 hover:bg-red-50"
                        onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="button" variant="outline" onClick={addLine} disabled={activeIngredients.length === 0}>
            <Plus className="h-4 w-4" /> {t("admin.costing.addLine")}
          </Button>

          <div className="rounded-2xl bg-beige/30 px-4 py-3 text-sm font-semibold">
            {t("admin.costing.rawTotal")}: {formatIls(total)}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.costing.packaging")} value={packaging} onChange={setPackaging} />
            <Field label={t("admin.costing.labor")} value={labor} onChange={setLabor} />
            <Field label={`${t("admin.costing.cardFee")} %`} value={card} onChange={setCard} />
            <Field label={`${t("admin.costing.platformFee")} %`} value={platform} onChange={setPlatform} />
            <Field label={`${t("admin.costing.overhead")} %`} value={overhead} onChange={setOverhead} />
            <Field label={`${t("admin.costing.targetFoodCost")} %`} value={target} onChange={setTarget} />
          </div>

          <div className="space-y-2">
            {custom.map((item, index) => (
              <div key={`${item.name}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_8rem_7rem_auto]">
                <Input
                  placeholder={t("admin.costing.customName")}
                  value={item.name}
                  onChange={(e) =>
                    setCustom((current) => current.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
                  }
                />
                <select
                  className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm"
                  value={item.type}
                  onChange={(e) =>
                    setCustom((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, type: e.target.value as CustomCost["type"] } : row
                      )
                    )
                  }
                >
                  <option value="fixed">{t("admin.costing.fixed")}</option>
                  <option value="percent">{t("admin.costing.percent")}</option>
                </select>
                <Input
                  type="number"
                  value={item.value}
                  onChange={(e) =>
                    setCustom((current) =>
                      current.map((row, i) => (i === index ? { ...row, value: Number(e.target.value) || 0 } : row))
                    )
                  }
                />
                <button type="button" onClick={() => setCustom((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setCustom((current) => [...current, { name: "", type: "fixed", value: 0 }])}
            >
              <Plus className="h-4 w-4" /> {t("admin.costing.addCustomCost")}
            </Button>
          </div>
        </div>
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving}
          onClick={() =>
            onSave({
              variantId: variantId || undefined,
              ingredients: lines.map(({ ingredientId, quantity, unit }) => ({
                ingredientId,
                quantity,
                unit,
              })),
              overheadSettings: {
                packaging: Number(packaging) || undefined,
                labor: Number(labor) || undefined,
                creditCardPercent: Number(card) || undefined,
                platformPercent: Number(platform) || undefined,
                overheadPercent: Number(overhead) || undefined,
                customCosts: custom.filter((item) => item.name.trim()),
              },
              targetFoodCostPercent: Number(target) || undefined,
            })
          }
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.save")}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" type="number" min="0" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
