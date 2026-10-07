"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  asPurchaseUnit,
  compatibleRecipeUnits,
  convertRecipeQuantity,
  defaultRecipeUnit,
  lineRecipeCost,
} from "@/lib/costing/units";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { IngredientPicker } from "@/features/admin/costing/ingredient-picker";
import { QuickCreateIngredientPanel } from "@/features/admin/costing/quick-create-ingredient";
import { useSmartInvoiceEnabled } from "@/features/admin/inventory/smart-invoice-flow";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import type { RecipeIngredientSuggestion } from "@/lib/ai/gemini-recipe";
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

function emptyLine(ingredient?: CostingIngredient): DraftLine {
  return {
    key: newKey(),
    ingredientId: ingredient?.id ?? "",
    quantity: 0,
    unit: ingredient ? defaultRecipeUnit(ingredient.purchaseUnit) : "g",
  };
}

export function RecipeEditorModal({
  open,
  productName,
  productDescription,
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
  productDescription?: string;
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
  const ai = useSmartInvoiceEnabled();
  const authFetch = useAuthFetch();
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<RecipeIngredientSuggestion[]>([]);
  const [extraIngredients, setExtraIngredients] = useState<CostingIngredient[]>([]);
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
  const [createRowKey, setCreateRowKey] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const allIngredients = useMemo(() => {
    const map = new Map(ingredients.map((item) => [item.id, item]));
    for (const item of extraIngredients) map.set(item.id, item);
    return [...map.values()];
  }, [ingredients, extraIngredients]);

  const activeIngredients = allIngredients.filter((item) => item.active);
  const lookup = useMemo(
    () => new Map(allIngredients.map((item) => [item.id, item])),
    [allIngredients]
  );

  const total = lines.reduce((sum, line) => {
    const ingredient = lookup.get(line.ingredientId);
    return sum + (ingredient ? lineRecipeCost(line.quantity, line.unit, ingredient.costPerBaseUnit) : 0);
  }, 0);

  useEffect(() => {
    if (!focusKey) return;
    const node = qtyRefs.current[focusKey];
    if (!node) return;
    node.focus();
    node.select();
    setFocusKey(null);
  }, [focusKey, lines]);

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const applyIngredient = (index: number, ingredient: CostingIngredient) => {
    updateLine(index, {
      ingredientId: ingredient.id,
      unit: defaultRecipeUnit(ingredient.purchaseUnit),
      quantity: 0,
    });
    setFocusKey(lines[index]?.key ?? null);
  };

  const openCreate = (rowKey: string, draftName?: string) => {
    setCreateRowKey(rowKey);
    setCreateName(draftName ?? "");
  };

  const addLine = () => {
    const line = emptyLine();
    setLines((current) => [...current, line]);
  };

  const handleCreated = (item: CostingIngredient) => {
    setExtraIngredients((current) => [...current.filter((row) => row.id !== item.id), item]);
    const rowKey = createRowKey;
    setCreateRowKey(null);
    setCreateName("");
    if (!rowKey) {
      const line = emptyLine(item);
      setLines((current) => [...current, line]);
      setFocusKey(line.key);
      return;
    }
    setLines((current) =>
      current.map((line) =>
        line.key === rowKey
          ? { ...line, ingredientId: item.id, unit: defaultRecipeUnit(item.purchaseUnit), quantity: 0 }
          : line
      )
    );
    setFocusKey(rowKey);
  };

  const handleUseExisting = (item: CostingIngredient) => {
    const rowKey = createRowKey;
    setCreateRowKey(null);
    setCreateName("");
    if (!rowKey) return;
    setLines((current) =>
      current.map((line) =>
        line.key === rowKey
          ? { ...line, ingredientId: item.id, unit: defaultRecipeUnit(item.purchaseUnit), quantity: 0 }
          : line
      )
    );
    setFocusKey(rowKey);
  };

  const renderRow = (line: DraftLine, index: number) => {
    const ingredient = lookup.get(line.ingredientId);
    const cost = ingredient ? lineRecipeCost(line.quantity, line.unit, ingredient.costPerBaseUnit) : 0;
    const units = compatibleRecipeUnits(ingredient?.purchaseUnit ?? asPurchaseUnit(line.unit));
    return (
      <div key={line.key} className="rounded-2xl border border-beige-dark/15 bg-warm-white p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_6.5rem_7rem_5.5rem_auto] md:items-start">
          <div>
            <Label className="mb-1 text-xs text-coffee/55 md:hidden">{t("admin.costing.selectIngredient")}</Label>
            <IngredientPicker
              ingredients={activeIngredients}
              value={line.ingredientId}
              onSelect={(id) => {
                const next = activeIngredients.find((item) => item.id === id);
                if (next) applyIngredient(index, next);
              }}
              onCreate={(draftName) => openCreate(line.key, draftName)}
            />
            <button
              type="button"
              className="mt-1 text-xs font-medium text-turquoise"
              onClick={() => openCreate(line.key)}
            >
              {t("admin.costing.createNewIngredient")}
            </button>
          </div>
          <div>
            <Label className="mb-1 text-xs text-coffee/55">{t("admin.costing.quantity")}</Label>
            <Input
              ref={(node) => {
                qtyRefs.current[line.key] = node;
              }}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="h-10"
              value={line.quantity || ""}
              onChange={(e) => updateLine(index, { quantity: Number(e.target.value) || 0 })}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <div>
            <Label className="mb-1 text-xs text-coffee/55">{t("admin.costing.recipeUnit")}</Label>
            <select
              className="h-10 w-full rounded-xl border border-beige-dark/30 bg-warm-white px-2 text-sm"
              value={asPurchaseUnit(line.unit)}
              onChange={(e) => {
                const next = asPurchaseUnit(e.target.value);
                const from = asPurchaseUnit(line.unit);
                updateLine(index, {
                  unit: next,
                  quantity: convertRecipeQuantity(line.quantity, from, next),
                });
              }}
            >
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {t(unitLabelKey(unit))}
                </option>
              ))}
            </select>
          </div>
          <p className="pt-6 text-end text-sm font-semibold md:pt-8">{formatIls(cost)}</p>
          <div className="flex justify-end gap-1 md:pt-6">
            <button
              type="button"
              className="rounded-lg p-2 hover:bg-beige/50"
              onClick={() => setLines((current) => [...current, { ...line, key: newKey() }])}
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
        </div>
      </div>
    );
  };

  return (
    <AdminModal
      open={open}
      onOpenChange={(next) => {
        if (!next && createRowKey) {
          setCreateRowKey(null);
          return;
        }
        if (!next) onClose();
      }}
      size="xl"
      preventOverlayClose={Boolean(createRowKey) || saving}
    >
      <AdminModalHeader onClose={createRowKey ? undefined : onClose}>
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

          <div className="hidden rounded-2xl bg-beige/40 px-4 py-2 text-xs text-coffee/65 md:grid md:grid-cols-[minmax(0,1.4fr)_6.5rem_7rem_5.5rem_auto]">
            <span>{t("admin.costing.selectIngredient")}</span>
            <span>{t("admin.costing.quantity")}</span>
            <span>{t("admin.costing.recipeUnit")}</span>
            <span className="text-end">{t("admin.costing.ingredientCost")}</span>
            <span />
          </div>
          <div className="space-y-3">
            {lines.map((line, index) => renderRow(line, index))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4" /> {t("admin.costing.addLine")}
            </Button>
            {ai?.configured && (
              <Button
                type="button"
                variant="ghost"
                disabled={suggesting || ai.reachable === false}
                onClick={async () => {
                  setSuggesting(true);
                  setSuggestError(null);
                  try {
                    const response = await authFetch("/api/admin/costing/recipe-suggest", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: productName, description: productDescription }),
                    });
                    const data = (await response.json()) as { suggestions?: RecipeIngredientSuggestion[]; error?: string };
                    if (!response.ok) {
                      setSuggestError(data.error === "ai-not-configured" ? t("admin.inventory.smart.notConfigured") : t("admin.inventory.smart.unavailable"));
                      return;
                    }
                    setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
                  } catch {
                    setSuggestError(t("admin.inventory.smart.unavailable"));
                  } finally {
                    setSuggesting(false);
                  }
                }}
              >
                {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.smart.recipeSuggest")}
              </Button>
            )}
            {ai && !ai.configured && (
              <p className="self-center text-xs text-coffee/50">{t("admin.inventory.smart.notConfigured")}</p>
            )}
            <Button
              type="button"
              variant="ghost"
              className="text-turquoise"
              onClick={() => {
                const line = emptyLine();
                setLines((current) => [...current, line]);
                openCreate(line.key);
              }}
            >
              {t("admin.costing.createNewIngredient")}
            </Button>
          </div>
          {suggestError && <p className="text-sm text-red-600">{suggestError}</p>}
          {suggestions.length > 0 && (
            <div className="rounded-2xl bg-beige/40 p-3 text-sm">
              <p className="mb-2 text-xs font-semibold">{t("admin.inventory.smart.recipeReview")}</p>
              <p className="mb-3 text-xs text-coffee/55">{t("admin.inventory.smart.recipeHint")}</p>
              <div className="space-y-2">
                {suggestions.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="rounded-xl bg-warm-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">✓ {item.name}</p>
                      <span className={item.needsReview || item.matchKind === "missing" ? "text-xs text-amber-700" : "text-xs text-emerald-700"}>
                        {item.matchKind === "missing"
                          ? t("admin.inventory.smart.missingInventory")
                          : `${t("admin.inventory.smart.suggestedMatch")}: ${item.productName ?? "—"}`}
                        {item.matchConfidence != null ? ` · ${Math.round(item.matchConfidence * 100)}%` : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-coffee/55">
                      {t("admin.costing.quantity")}: — · {t("admin.costing.recipeUnit")}: {item.purchaseUnit ?? "—"}
                      {item.costPerBaseUnit != null ? ` · ${t("admin.costing.ingredientCost")}: ${formatIls(item.costPerBaseUnit, 4)}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.productId && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const ingredient = activeIngredients.find((row) => row.id === item.productId);
                            const line = emptyLine(ingredient);
                            setLines((current) => [...current, line]);
                            setFocusKey(line.key);
                            setSuggestions((current) => current.filter((_, i) => i !== index));
                          }}
                        >
                          {t("admin.inventory.smart.confirmMatch")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const line = emptyLine();
                          setLines((current) => [...current, line]);
                          openCreate(line.key, item.name);
                          setSuggestions((current) => current.filter((_, i) => i !== index));
                        }}
                      >
                        {item.matchKind === "missing" ? t("admin.inventory.createProduct") : t("admin.inventory.smart.chooseOther")}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setSuggestions((current) => current.filter((_, i) => i !== index))}>
                        {t("admin.costing.deleteLine")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
              ingredients: lines
                .filter((line) => line.ingredientId && line.quantity > 0)
                .map(({ ingredientId, quantity, unit }) => ({
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
      <QuickCreateIngredientPanel
        open={createRowKey != null}
        initialName={createName}
        existing={activeIngredients}
        onClose={() => {
          setCreateRowKey(null);
          setCreateName("");
        }}
        onCreated={handleCreated}
        onUseExisting={handleUseExisting}
      />
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
