"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { MeasureUnitSelect } from "@/features/admin/measure-unit-select";
import {
  componentRecipeLines,
  parseUnitCost,
  previewCostParts,
  type CostPartDraft,
  type CostPartSource,
} from "@/lib/breakeven/product-cost";
import type { BreakEvenVatBasis, ProductContribution } from "@/lib/breakeven/types";
import { formatIls } from "@/lib/costing/money";
import { recipeForProduct } from "@/lib/costing/model";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import { completeProductCost } from "@/services/costingService";
import type { Product } from "@/types";

function fill(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}


function blankPart(): CostPartDraft {
  return { source: "ingredient", refId: "", quantity: "", unit: "unit" };
}

export function CostCompleteDialog({
  row,
  products,
  recipes,
  ingredients,
  vatBasis,
  onClose,
  onSaved,
}: {
  row: ProductContribution;
  products: Product[];
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  vatBasis: BreakEvenVatBasis;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [partsOpen, setPartsOpen] = useState(false);
  const [parts, setParts] = useState<CostPartDraft[]>([blankPart()]);
  const [saving, setSaving] = useState<"unit" | "parts" | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [partError, setPartError] = useState<string | null>(null);
  const catalog = useMemo(() => products.map((item) => ({ id: item.id, name: item.name_he || item.name_ar || item.name_en || item.id })), [products]);
  const preview = useMemo(
    () => previewCostParts(parts, ingredients, recipes, catalog, row.productId),
    [parts, ingredients, recipes, catalog, row.productId]
  );
  const basis = t(`admin.breakeven.vatNote.${vatBasis}`);
  const current = !row.costMissing && row.foodCost != null;

  async function saveUnit() {
    const cost = parseUnitCost(amount);
    if (cost == null) {
      setUnitError(t("admin.breakeven.cost.empty"));
      return;
    }
    setSaving("unit");
    setUnitError(null);
    const ownRecipe = recipeForProduct(recipes, row.productId);
    const result = await completeProductCost({
      productId: row.productId,
      kind: "estimate",
      sellingPrice: row.sellingPrice,
      ingredients,
      existingRecipeId: ownRecipe?.id,
      estimateAmount: cost,
      estimateNote: "manual",
    });
    setSaving(null);
    if (!result.success) {
      setUnitError(result.error || t("admin.breakeven.saveFailed"));
      return;
    }
    onSaved(t("admin.breakeven.costSaved"));
  }

  async function saveParts() {
    if (preview.total == null) {
      setPartError(t("admin.breakeven.cost.noPartial"));
      return;
    }
    const lines = componentRecipeLines(parts, {
      recipes,
      ingredients,
      products,
      currentProductId: row.productId,
    });
    if (lines.length !== preview.rows.length) {
      setPartError(t("admin.breakeven.cost.noPartial"));
      return;
    }
    if (!lines.length) {
      setPartError(t("admin.breakeven.cost.noPartial"));
      return;
    }
    setSaving("parts");
    setPartError(null);
    const ownRecipe = recipeForProduct(recipes, row.productId);
    const result = await completeProductCost({
      productId: row.productId,
      kind: lines.some((line) => line.subRecipeId) ? "combo" : "recipe",
      sellingPrice: row.sellingPrice,
      ingredients,
      existingRecipeId: ownRecipe?.id,
      lines,
    });
    setSaving(null);
    if (!result.success) {
      setPartError(result.error || t("admin.breakeven.saveFailed"));
      return;
    }
    onSaved(t("admin.breakeven.costSaved"));
  }

  return (
    <AdminModal open onOpenChange={(next) => !next && onClose()} size={partsOpen ? "md" : "sm"}>
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{fill(t("admin.breakeven.cost.title"), { name: row.name })}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-4">
        <p className="text-sm text-dark-brown">
          {t("admin.costing.sellingPrice")}: {formatIls(row.sellingPrice)}
        </p>
        <p className="text-xs text-coffee/60">{basis}</p>
        {current ? (
          <p className="rounded-xl bg-beige/40 px-3 py-2 text-sm">
            {t("admin.breakeven.cost.current")}: {formatIls(row.foodCost ?? 0)}
            {row.costBasis ? ` · ${t(`admin.breakeven.basis.${row.costBasis}`)}` : ""}
          </p>
        ) : null}
        <div className="space-y-1 text-sm">
          <p className="font-medium text-dark-brown">{t("admin.breakeven.cost.ask")}</p>
          <label className="block space-y-1">
            <span>{t("admin.breakeven.cost.unit")}</span>
            <Input
              className="text-base"
              inputMode="decimal"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setUnitError(null);
              }}
            />
          </label>
          <p className="text-xs text-coffee/55">{t("admin.breakeven.basis.estimate")}</p>
        </div>
        {unitError ? <p className="text-sm text-red-700">{unitError}</p> : null}
        <Button type="button" variant="turquoise" className="w-full sm:w-auto" disabled={saving != null} onClick={() => void saveUnit()}>
          {t("admin.breakeven.cost.save")}
        </Button>

        <details
          className="rounded-xl border border-beige-dark/20 px-3 py-2"
          onToggle={(event) => setPartsOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-sm font-medium text-turquoise">{t("admin.breakeven.cost.byParts")}</summary>
          {partsOpen ? (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-coffee/55">{basis}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-start text-xs text-coffee/60">
                      <th className="p-1 font-medium">{t("admin.breakeven.cost.part")}</th>
                      <th className="p-1 font-medium">{t("admin.breakeven.cost.qtyPer")}</th>
                      <th className="p-1 font-medium">{t("admin.breakeven.cost.unitCol")}</th>
                      <th className="p-1 font-medium">{t("admin.breakeven.cost.calculated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((part, index) => (
                      <PartRow
                        key={index}
                        part={part}
                        ingredients={ingredients}
                        recipes={recipes}
                        products={products}
                        currentProductId={row.productId}
                        onChange={(next) => setParts((current) => current.map((item, i) => (i === index ? next : item)))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setParts((current) => [...current, blankPart()])}>
                {t("admin.breakeven.cost.addPart")}
              </Button>
              {preview.rows.some((item) => item.problem) ? (
                <div className="space-y-1">
                  {preview.rows.filter((item) => item.problem).map((item, index) => (
                    <p key={`${item.name}-${index}`} className="text-sm text-red-700">
                      {item.problem === "qty"
                        ? fill(t("admin.breakeven.cost.missingQty"), { name: item.name || t("admin.breakeven.cost.part") })
                        : fill(t("admin.breakeven.cost.missingPart"), { name: item.name || t("admin.breakeven.cost.part") })}
                    </p>
                  ))}
                  <p className="text-xs text-coffee/60">{t("admin.breakeven.cost.noPartial")}</p>
                </div>
              ) : preview.total != null ? (
                <p className="text-sm font-semibold">{t("admin.breakeven.cost.summary")}: {formatIls(preview.total)}</p>
              ) : null}
              {partError ? <p className="text-sm text-red-700">{partError}</p> : null}
              <Button type="button" variant="turquoise" className="w-full sm:w-auto" disabled={saving != null || preview.total == null} onClick={() => void saveParts()}>
                {t("admin.breakeven.cost.saveParts")}
              </Button>
            </div>
          ) : null}
        </details>
      </AdminModalBody>
    </AdminModal>
  );
}

function PartRow({
  part,
  ingredients,
  recipes,
  products,
  currentProductId,
  onChange,
}: {
  part: CostPartDraft;
  ingredients: CostingIngredient[];
  recipes: DishRecipe[];
  products: Product[];
  currentProductId: string;
  onChange: (next: CostPartDraft) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const catalog = products.map((item) => ({ id: item.id, name: getProductDisplayName(item, locale) || item.id }));
  const rowPreview = previewCostParts([part], ingredients, recipes, catalog, currentProductId).rows[0];
  const portion = part.source === "recipe" || part.source === "product";
  return (
    <tr className="align-top">
      <td className="p-1">
        <select
          className="mb-1 h-10 w-full rounded-xl border border-beige-dark/40 bg-white px-2 text-base"
          value={part.source}
          aria-label={t("admin.breakeven.cost.part")}
          onChange={(event) => onChange({ ...part, source: event.target.value as CostPartSource, refId: "", unit: event.target.value === "ingredient" ? part.unit : "unit" })}
        >
          <option value="ingredient">{t("admin.breakeven.cost.source.ingredient")}</option>
          <option value="product">{t("admin.breakeven.cost.source.product")}</option>
          <option value="recipe">{t("admin.breakeven.cost.source.recipe")}</option>
        </select>
        <select
          className="h-10 w-full rounded-xl border border-beige-dark/40 bg-white px-2 text-base"
          value={part.refId}
          aria-label={part.source === "recipe" ? t("admin.breakeven.cost.source.recipe") : part.source === "product" ? t("admin.breakeven.cost.source.product") : t("admin.breakeven.cost.source.ingredient")}
          onChange={(event) => {
            const refId = event.target.value;
            const ingredient = ingredients.find((item) => item.id === refId);
            onChange({ ...part, refId, unit: portion ? "unit" : ingredient?.purchaseUnit || part.unit });
          }}
        >
          <option value="">{t("admin.breakeven.cost.part")}</option>
          {part.source === "recipe"
            ? recipes.filter((item) => item.productId !== currentProductId).map((item) => (
                <option key={item.id} value={item.id}>
                  {catalog.find((product) => product.id === item.productId)?.name || item.productId}
                </option>
              ))
            : part.source === "product"
              ? products.filter((item) => item.id !== currentProductId).map((item) => (
                  <option key={item.id} value={item.id}>{getProductDisplayName(item, locale) || item.id}</option>
                ))
              : ingredients.filter((item) => item.active !== false).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
        </select>
      </td>
      <td className="p-1">
        <Input className="text-base" inputMode="decimal" type="number" min="0" step="any" aria-label={t("admin.breakeven.cost.qtyPer")} value={part.quantity} onChange={(event) => onChange({ ...part, quantity: event.target.value })} />
      </td>
      <td className="p-1">
        {portion ? (
          <p className="flex h-10 items-center text-sm text-coffee/70">{t("admin.breakeven.cost.portion")}</p>
        ) : (
          <MeasureUnitSelect
            value={part.unit}
            className="h-10 w-full rounded-xl border border-beige-dark/40 bg-white px-2 text-base"
            onChange={(unit) => onChange({ ...part, unit })}
          />
        )}
      </td>
      <td className="p-1">
        <p className="flex h-10 items-center whitespace-nowrap text-sm">
          {rowPreview?.cost == null ? "—" : formatIls(rowPreview.cost)}
        </p>
      </td>
    </tr>
  );
}
