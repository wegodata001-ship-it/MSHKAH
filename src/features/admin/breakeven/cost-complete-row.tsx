"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { comboRecipeLines, findResaleCandidates } from "@/lib/breakeven/product-cost";
import type { ProductContribution, ProductCostKind } from "@/lib/breakeven/types";
import type { CostingIngredient, DishRecipe, PurchaseUnit, RecipeLine } from "@/lib/costing/types";
import type { Product } from "@/types";
import { completeProductCost } from "@/services/costingService";
import { recipeForProduct } from "@/lib/costing/model";

type Kind = ProductCostKind;

export function CostCompletePanel({
  row,
  products,
  recipes,
  ingredients,
  onSaved,
}: {
  row: ProductContribution;
  products: Product[];
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  onSaved: (message: string) => void;
}) {
  const t = useT();
  const existingRecipe = recipeForProduct(recipes, row.productId);
  const candidates = useMemo(
    () => findResaleCandidates(row.productId, row.name, ingredients, products.find((item) => item.id === row.productId)),
    [row.productId, row.name, ingredients, products]
  );
  const defaultKind: Kind =
    row.costKind ??
    (existingRecipe ? "recipe" : candidates.exact[0] ? "resale" : "recipe");
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [recipeId, setRecipeId] = useState(existingRecipe?.id ?? "");
  const [ingredientId, setIngredientId] = useState(candidates.exact[0]?.id ?? candidates.suggest[0]?.id ?? "");
  const [packPrice, setPackPrice] = useState(candidates.exact[0]?.purchasePrice ? String(candidates.exact[0].purchasePrice) : "");
  const [packQty, setPackQty] = useState(candidates.exact[0]?.purchaseQuantity ? String(candidates.exact[0].purchaseQuantity) : "");
  const [packUnit, setPackUnit] = useState<PurchaseUnit>(candidates.exact[0]?.purchaseUnit ?? "unit");
  const [lines, setLines] = useState<RecipeLine[]>(existingRecipe?.ingredients ?? [{ ingredientId: "", quantity: 0, unit: "unit" }]);
  const [combo, setCombo] = useState<{ productId: string; quantity: number }[]>([{ productId: "", quantity: 1 }]);
  const [estimateAmount, setEstimateAmount] = useState("");
  const [estimateNote, setEstimateNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unused = row.unusedExisting ?? [];

  async function save() {
    setSaving(true);
    setError(null);
    const builtCombo = kind === "combo" ? comboRecipeLines(combo.filter((item) => item.productId), recipes, ingredients) : null;
    if (builtCombo?.gaps.length) {
      setSaving(false);
      setError(t(`admin.breakeven.gap.${builtCombo.gaps[0]!.code}`));
      return;
    }
    const result = await completeProductCost({
      productId: row.productId,
      kind,
      sellingPrice: row.sellingPrice,
      ingredients,
      existingRecipeId: kind === "recipe" ? recipeId || existingRecipe?.id : undefined,
      lines:
        kind === "recipe"
          ? lines.filter((line) => line.ingredientId && Number(line.quantity) > 0)
          : kind === "combo"
            ? builtCombo?.lines
            : undefined,
      ingredientId: kind === "resale" ? ingredientId : undefined,
      packPrice: kind === "resale" ? Number(packPrice) || undefined : undefined,
      packQuantity: kind === "resale" ? Number(packQty) || undefined : undefined,
      packUnit: kind === "resale" ? packUnit : undefined,
      estimateAmount: kind === "estimate" ? Number(estimateAmount) : undefined,
      estimateNote: kind === "estimate" ? estimateNote : undefined,
    });
    setSaving(false);
    if (!result.success) {
      setError(t("admin.breakeven.saveFailed"));
      return;
    }
    onSaved(t("admin.breakeven.costSaved"));
  }

  return (
    <div className="space-y-3 rounded-xl bg-beige/30 p-3 text-sm">
      {(row.costGaps ?? []).map((gap, index) => (
        <p key={`${gap.code}-${index}`} className="text-amber-900">
          {t(`admin.breakeven.gap.${gap.code}`)}
          {gap.name ? ` — ${gap.name}` : ""}
        </p>
      ))}
      {unused.map((item) => (
        <div key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warm-white px-2 py-1.5">
          <p>
            {t(`admin.breakeven.existing${item.kind === "purchase" ? "Purchase" : item.kind === "recipe" ? "Recipe" : item.kind === "pos-cost" ? "Purchase" : "Ingredient"}`)}
            {item.kind !== "pos-cost" ? `: ${item.name}` : ""}
            {item.kind === "pos-cost" ? ` · ${t("admin.breakeven.posCostKept")}` : ""}
          </p>
          {item.kind !== "pos-cost" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (item.kind === "recipe") {
                  setKind("recipe");
                  setRecipeId(item.id);
                } else {
                  setKind("resale");
                  setIngredientId(item.id);
                  const found = ingredients.find((rowItem) => rowItem.id === item.id);
                  if (found) {
                    setPackPrice(String(found.purchasePrice || ""));
                    setPackQty(String(found.purchaseQuantity || ""));
                    setPackUnit(found.purchaseUnit);
                  }
                }
              }}
            >
              {t("admin.breakeven.useExisting")}
            </Button>
          )}
        </div>
      ))}
      {row.posCost != null && !unused.some((item) => item.kind === "pos-cost") && (
        <p className="text-xs text-coffee/60">{t("admin.breakeven.posCostKept")}: {formatIls(row.posCost)}</p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["recipe", "resale", "combo", "estimate"] as Kind[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-xl border px-3 py-2 text-start ${kind === item ? "border-turquoise bg-turquoise/10" : "border-beige-dark/20 bg-warm-white"}`}
            onClick={() => setKind(item)}
          >
            {t(`admin.breakeven.costKind.${item}`)}
          </button>
        ))}
      </div>

      {kind === "recipe" && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span>{t("admin.breakeven.pickRecipe")}</span>
            <select
              className="h-10 w-full rounded-xl border border-beige-dark/40 px-2"
              value={recipeId}
              onChange={(e) => {
                setRecipeId(e.target.value);
                const chosen = recipes.find((item) => item.id === e.target.value);
                if (chosen) setLines(chosen.ingredients);
              }}
            >
              <option value="">{t("admin.breakeven.pickRecipe")}</option>
              {recipes.map((item) => (
                <option key={item.id} value={item.id}>
                  {products.find((product) => product.id === item.productId)?.name_he || item.productId}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-coffee/60">{t("admin.breakeven.recipeLines")}</p>
          {lines.map((line, index) => (
            <div key={`${line.ingredientId}-${index}`} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                className="h-10 rounded-xl border border-beige-dark/40 px-2"
                value={line.ingredientId}
                onChange={(e) =>
                  setLines((current) => current.map((item, i) => (i === index ? { ...item, ingredientId: e.target.value } : item)))
                }
              >
                <option value="">{t("admin.breakeven.pickIngredient")}</option>
                {ingredients.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <Input
                type="number"
                placeholder={t("admin.breakeven.qty")}
                value={line.quantity || ""}
                onChange={(e) =>
                  setLines((current) => current.map((item, i) => (i === index ? { ...item, quantity: Number(e.target.value) || 0 } : item)))
                }
              />
              <select
                className="h-10 rounded-xl border border-beige-dark/40 px-2"
                value={line.unit}
                onChange={(e) =>
                  setLines((current) => current.map((item, i) => (i === index ? { ...item, unit: e.target.value as PurchaseUnit } : item)))
                }
              >
                <option value="unit">unit</option>
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="ml">ml</option>
                <option value="liter">liter</option>
              </select>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setLines((current) => [...current, { ingredientId: "", quantity: 0, unit: "unit" }])}>
            {t("admin.breakeven.addRecipeLine")}
          </Button>
        </div>
      )}

      {kind === "resale" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span>{t("admin.breakeven.pickIngredient")}</span>
            <select
              className="h-10 w-full rounded-xl border border-beige-dark/40 px-2"
              value={ingredientId}
              onChange={(e) => {
                setIngredientId(e.target.value);
                const found = ingredients.find((item) => item.id === e.target.value);
                if (found) {
                  setPackPrice(String(found.purchasePrice || ""));
                  setPackQty(found.purchaseQuantity > 1 ? String(found.purchaseQuantity) : "");
                  setPackUnit(found.purchaseUnit);
                }
              }}
            >
              <option value="">{t("admin.breakeven.pickIngredient")}</option>
              {ingredients.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span>{t("admin.breakeven.packPrice")}</span>
            <Input type="number" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span>{t("admin.breakeven.packQty")}</span>
            <Input type="number" value={packQty} onChange={(e) => setPackQty(e.target.value)} />
            <span className="text-[11px] text-coffee/55">{t("admin.breakeven.noGuessPack")}</span>
          </label>
        </div>
      )}

      {kind === "combo" && (
        <div className="space-y-2">
          <p className="text-xs text-coffee/60">{t("admin.breakeven.comboLines")}</p>
          {combo.map((line, index) => (
            <div key={`${line.productId}-${index}`} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                className="h-10 rounded-xl border border-beige-dark/40 px-2"
                value={line.productId}
                onChange={(e) => setCombo((current) => current.map((item, i) => (i === index ? { ...item, productId: e.target.value } : item)))}
              >
                <option value="">{t("admin.breakeven.dish")}</option>
                {products.map((item) => (
                  <option key={item.id} value={item.id}>{item.name_he || item.name_en}</option>
                ))}
              </select>
              <Input
                type="number"
                placeholder={t("admin.breakeven.qty")}
                value={line.quantity || ""}
                onChange={(e) =>
                  setCombo((current) => current.map((item, i) => (i === index ? { ...item, quantity: Number(e.target.value) || 0 } : item)))
                }
              />
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setCombo((current) => [...current, { productId: "", quantity: 1 }])}>
            {t("admin.breakeven.addComboLine")}
          </Button>
        </div>
      )}

      {kind === "estimate" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span>{t("admin.breakeven.estimateAmount")}</span>
            <Input type="number" value={estimateAmount} onChange={(e) => setEstimateAmount(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span>{t("admin.breakeven.estimateNote")}</span>
            <Input value={estimateNote} onChange={(e) => setEstimateNote(e.target.value)} />
          </label>
          <p className="text-xs text-coffee/55 sm:col-span-2">
            {t("admin.breakeven.estimateAt")}: {new Date().toISOString().slice(0, 10)} · {t("admin.breakeven.basis.estimate")}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      <Button variant="turquoise" disabled={saving} onClick={save}>
        {t("admin.breakeven.saveUpdate")}
      </Button>
    </div>
  );
}
