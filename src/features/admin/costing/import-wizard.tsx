"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { formatIls } from "@/lib/costing/money";
import { normalizeIngredientName } from "@/lib/costing/names";
import {
  buildFileDraft,
  isRecipeBulkReady,
  knownRecipeCost,
  missingQuantityCount,
  recipeDraftStatus,
  refreshSummary,
} from "@/lib/costing/import/build-draft";
import { costingWorkbookFilename } from "@/lib/costing/import/workbook";
import type { ImportDraft, RecipeDraft, RecipeLineDraft, ReviewFilter } from "@/lib/costing/import/types";
import type { ParsedWorkbook } from "@/lib/costing/import/types";
import type { CostingIngredient, DishRecipe, PurchaseUnit } from "@/lib/costing/types";
import type { Product } from "@/types";
import {
  createIngredient,
  recordCostingImportHistory,
  saveDishRecipe,
  updateIngredient,
  writeIngredientImpactSnapshots,
} from "@/services/costingService";
import { QuickCreateIngredientPanel } from "./quick-create-ingredient";
import { cn } from "@/lib/utils";

export async function downloadCostingWorkbook(
  request: (input: RequestInfo, init?: RequestInit) => Promise<Response>,
  kind: "blank" | "menu",
  locale: string
) {
  const response = await request(`/api/admin/costing/import/template?kind=${kind}&locale=${locale}`);
  if (!response.ok) throw new Error("download-failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = costingWorkbookFilename(kind);
  link.click();
  URL.revokeObjectURL(url);
}

const FILTERS: ReviewFilter[] = [
  "all",
  "ready",
  "review",
  "unknown-ingredient",
  "missing-qty",
  "conflict",
  "saved",
];

type Step = 1 | 2 | 3 | 4 | 5;

export function CostingImportWizard({
  open,
  products,
  ingredients,
  recipes,
  onClose,
  onToast,
}: {
  open: boolean;
  products: Product[];
  ingredients: CostingIngredient[];
  recipes: DishRecipe[];
  extrasByProduct?: Map<string, { name: string; priceDelta: number }[]>;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [query, setQuery] = useState("");
  const [createLine, setCreateLine] = useState<{ recipeKey: string; lineKey: string; name: string } | null>(null);
  const [compareKey, setCompareKey] = useState<string | null>(null);

  const filteredRecipes = useMemo(() => {
    if (!draft) return [];
    const q = query.trim().toLowerCase();
    return draft.recipes.filter((recipe) => {
      const status = recipeDraftStatus(recipe);
      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;
      return (
        recipe.productName.toLowerCase().includes(q) ||
        recipe.lines.some((line) => line.ingredientName.toLowerCase().includes(q))
      );
    });
  }, [draft, filter, query]);

  const reset = () => {
    setStep(1);
    setDraft(null);
    setFilter("all");
    setQuery("");
    setCreateLine(null);
    setCompareKey(null);
  };

  const downloadTemplate = async (kind: "blank" | "menu") => {
    setBusy(true);
    try {
      await downloadCostingWorkbook(authFetch, kind, locale);
    } catch {
      onToast(t("admin.costing.import.error.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const loadParsed = (parsed: ParsedWorkbook) => {
    setDraft(
      refreshSummary(
        buildFileDraft({
          parsed,
          products,
          ingredients,
          recipes,
          locale,
        })
      )
    );
    setStep(2);
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await authFetch("/api/admin/costing/import/parse", { method: "POST", body });
      const parsed = (await response.json()) as ParsedWorkbook & { error?: string };
      if (!response.ok) {
        onToast(t(`admin.costing.import.error.${parsed.error ?? "saveFailed"}`), "error");
        return;
      }
      loadParsed(parsed);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const patchDraft = (next: ImportDraft) => setDraft(refreshSummary(next));

  const applyIngredientToLine = (recipeKey: string, lineKey: string, item: CostingIngredient) => {
    if (!draft) return;
    patchDraft({
      ...draft,
      recipes: draft.recipes.map((recipe) =>
        recipe.key !== recipeKey
          ? recipe
          : {
              ...recipe,
              lines: recipe.lines.map((line) =>
                line.key !== lineKey
                  ? line
                  : {
                      ...line,
                      ingredientId: item.id,
                      matchName: item.name,
                      matchKind: "exact",
                      unit: line.unit ?? (item.baseUnit === "unit" ? "unit" : item.baseUnit),
                      errors: line.errors.filter((error) => error !== "missing-ingredient"),
                    }
              ),
            }
      ),
    });
  };

  const saveRecipe = async (recipe: RecipeDraft, liveIngredients: CostingIngredient[]) => {
    if (!recipe.productId || !isRecipeBulkReady(recipe)) return false;
    const lines = recipe.lines
      .filter((line) => line.included && line.ingredientId && line.quantity && line.unit)
      .map((line) => ({
        ingredientId: line.ingredientId!,
        quantity: line.quantity!,
        unit: line.unit as PurchaseUnit,
      }));
    const existing = recipes.find((item) => item.id === recipe.existingRecipeId);
    const result = await saveDishRecipe(
      {
        id: existing?.id,
        productId: recipe.productId,
        ingredients: lines,
      },
      {
        sellingPrice: recipe.sellingPrice,
        ingredients: liveIngredients,
      }
    );
    return result.success;
  };

  const commit = async (onlyReady: boolean, onlyKey?: string) => {
    if (!draft || busy) return;
    setBusy(true);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const nameToId = new Map(ingredients.map((item) => [normalizeIngredientName(item.name), item.id]));
    let liveIngredients = [...ingredients];
    try {
      for (const item of draft.ingredients) {
        if (item.matchKind === "new" && item.createApproved && item.purchasePrice && item.packageQuantity && item.purchaseUnit) {
          const result = await createIngredient({
            name: item.name,
            category: item.category,
            supplier: item.supplier,
            purchasePrice: item.purchasePrice,
            purchaseQuantity: item.packageQuantity,
            purchaseUnit: item.purchaseUnit,
            originKind: "other",
          });
          if (!result.success) {
            failed += 1;
            continue;
          }
          created += 1;
          nameToId.set(normalizeIngredientName(item.name), result.data.id);
          liveIngredients = [...liveIngredients, result.data];
        } else if (item.priceChanged && item.priceApproved && item.matchId) {
          const current = ingredients.find((row) => row.id === item.matchId);
          if (!current || item.purchasePrice == null || item.packageQuantity == null || !item.purchaseUnit) {
            skipped += 1;
            continue;
          }
          const result = await updateIngredient(
            item.matchId,
            {
              name: current.name,
              category: item.category || current.category,
              supplier: item.supplier || current.supplier,
              purchasePrice: item.purchasePrice,
              purchaseQuantity: item.packageQuantity,
              purchaseUnit: item.purchaseUnit,
              notes: current.notes,
            },
            user?.email
          );
          if (!result.success) {
            failed += 1;
            continue;
          }
          updated += 1;
          liveIngredients = liveIngredients.map((row) => (row.id === item.matchId ? result.data.ingredient : row));
          await writeIngredientImpactSnapshots({
            ingredientId: item.matchId,
            recipes,
            ingredients: liveIngredients,
            sellingPriceByProduct: new Map(products.map((product) => [product.id, product.price])),
          });
        }
      }

      const nextRecipes = draft.recipes.map((recipe) => ({
        ...recipe,
        lines: recipe.lines.map((line) => {
          const createdId = nameToId.get(normalizeIngredientName(line.ingredientName));
          return createdId && !line.ingredientId ? { ...line, ingredientId: createdId, matchKind: "exact" as const } : line;
        }),
      }));

      for (const recipe of nextRecipes) {
        if (onlyKey && recipe.key !== onlyKey) continue;
        if (recipe.resolve === "keep") {
          skipped += 1;
          continue;
        }
        if (onlyReady && !isRecipeBulkReady(recipe)) {
          skipped += 1;
          continue;
        }
        if (!onlyReady && !onlyKey && !isRecipeBulkReady(recipe)) {
          skipped += 1;
          continue;
        }
        const ok = await saveRecipe(recipe, liveIngredients);
        if (ok) {
          updated += 1;
          recipe.saved = true;
        } else if (isRecipeBulkReady(recipe)) {
          failed += 1;
        } else {
          skipped += 1;
        }
      }

      patchDraft({ ...draft, recipes: nextRecipes });
      await recordCostingImportHistory({
        fileName: draft.fileName,
        importedBy: user?.email,
        rowsProcessed: draft.ingredients.length + draft.recipes.reduce((sum, item) => sum + item.lines.length, 0),
        created,
        updated,
        skipped,
        failed,
      });
      onToast(t("admin.costing.import.saved"));
      setStep(5);
    } catch {
      onToast(t("admin.costing.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <AdminModal open={open} onOpenChange={(next) => !next && !busy && onClose()} size="xl" preventOverlayClose={busy}>
      <AdminModalHeader onClose={busy ? undefined : onClose}>
        <AdminModalTitle>{t("admin.costing.import.title")}</AdminModalTitle>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {[1, 2, 3, 4, 5].map((value) => (
            <span
              key={value}
              className={cn(
                "rounded-full px-3 py-1",
                step === value ? "bg-turquoise text-white" : "bg-beige/60 text-coffee/60"
              )}
            >
              {t(`admin.costing.import.step.${value}`)}
            </span>
          ))}
        </div>
      </AdminModalHeader>
      <AdminModalBody>
        {step === 1 && (
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed border-turquoise/40 bg-turquoise/5 px-6 py-10 text-center">
              <Upload className="h-8 w-8 text-turquoise" />
              <span className="font-medium">{t("admin.costing.import.uploadHint")}</span>
              <input
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => void downloadTemplate("blank")} disabled={busy}>
                <Download className="h-4 w-4" /> {t("admin.costing.import.downloadTemplate")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void downloadTemplate("menu")} disabled={busy}>
                <Download className="h-4 w-4" /> {t("admin.costing.import.downloadMenu")}
              </Button>
            </div>
          </div>
        )}

        {step >= 2 && draft && (
          <div className="grid gap-3 rounded-2xl bg-beige/30 p-4 text-sm sm:grid-cols-4">
            <Stat label={t("admin.costing.import.ingredients")} value={draft.summary.ingredientCount} />
            <Stat label={t("admin.costing.import.newIngredients")} value={draft.summary.newIngredients} />
            <Stat label={t("admin.costing.import.existingIngredients")} value={draft.summary.existingIngredients} />
            <Stat label={t("admin.costing.import.priceUpdates")} value={draft.summary.priceUpdates} />
            <Stat label={t("admin.costing.import.dishes")} value={draft.summary.dishCount} />
            <Stat label={t("admin.costing.import.ready")} value={draft.summary.readyRecipes} />
            <Stat label={t("admin.costing.import.needsReview")} value={draft.summary.reviewRecipes} />
            <Stat label={t("admin.costing.import.errors")} value={draft.summary.errorRows} />
          </div>
        )}

        {step === 3 && draft && (
          <div className="mt-4 space-y-3">
            {draft.ingredients.length === 0 && <p className="text-sm text-coffee/55">{t("admin.costing.import.noIngredientRows")}</p>}
            {draft.ingredients.map((item) => (
              <div key={item.key} className="rounded-2xl border border-beige-dark/15 p-4">
                <p className="font-semibold">{item.name}</p>
                {item.matchKind === "exact" && <p className="text-sm text-emerald-700">{t("admin.costing.import.matched")}</p>}
                {item.matchKind === "suggest" && (
                  <p className="text-sm text-amber-700">
                    {t("admin.costing.import.suggestMatch")}: {item.matchName}
                  </p>
                )}
                {item.matchKind === "new" && <p className="text-sm text-coffee/65">{t("admin.costing.import.newIngredient")}</p>}
                {item.matchKind === "suggest" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="turquoise"
                      onClick={() =>
                        patchDraft({
                          ...draft,
                          ingredients: draft.ingredients.map((row) =>
                            row.key === item.key ? { ...row, matchKind: "exact" } : row
                          ),
                        })
                      }
                    >
                      {t("admin.costing.import.accept")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        patchDraft({
                          ...draft,
                          ingredients: draft.ingredients.map((row) =>
                            row.key === item.key ? { ...row, matchKind: "new", matchId: undefined, matchName: undefined } : row
                          ),
                        })
                      }
                    >
                      {t("admin.costing.import.change")}
                    </Button>
                  </div>
                )}
                {(item.matchKind === "new" || item.matchKind === "none") && (
                  <div className="mt-2 flex flex-col gap-2">
                    <select
                      className="h-10 rounded-xl border border-beige-dark/20 bg-warm-white px-3 text-sm"
                      defaultValue=""
                      onChange={(event) => {
                        const chosen = ingredients.find((row) => row.id === event.target.value);
                        if (!chosen) return;
                        patchDraft({
                          ...draft,
                          ingredients: draft.ingredients.map((row) =>
                            row.key === item.key
                              ? {
                                  ...row,
                                  matchId: chosen.id,
                                  matchName: chosen.name,
                                  matchKind: "exact",
                                  createApproved: false,
                                }
                              : row
                          ),
                        });
                      }}
                    >
                      <option value="">{t("admin.costing.import.pickExisting")}</option>
                      {ingredients.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={item.createApproved ? "turquoise" : "outline"}
                        onClick={() =>
                          patchDraft({
                            ...draft,
                            ingredients: draft.ingredients.map((row) =>
                              row.key === item.key ? { ...row, matchKind: "new", createApproved: !row.createApproved } : row
                            ),
                          })
                        }
                      >
                        {t("admin.costing.import.createInStock")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          patchDraft({
                            ...draft,
                            ingredients: draft.ingredients.map((row) =>
                              row.key === item.key ? { ...row, matchKind: "none", createApproved: false } : row
                            ),
                          })
                        }
                      >
                        {t("admin.costing.import.ignore")}
                      </Button>
                    </div>
                  </div>
                )}
                {item.priceChanged && (
                  <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm">
                    <p>
                      {t("admin.costing.import.currentPrice")}: {formatIls(item.currentPrice ?? 0)} → {formatIls(item.newPrice ?? 0)}
                    </p>
                    <p className="text-coffee/65">
                      {t("admin.costing.affectsDishes").replace("{count}", String(item.affectedDishCount))}
                    </p>
                    <Button
                      type="button"
                      variant={item.priceApproved ? "turquoise" : "outline"}
                      className="mt-2"
                      onClick={() =>
                        patchDraft({
                          ...draft,
                          ingredients: draft.ingredients.map((row) =>
                            row.key === item.key ? { ...row, priceApproved: !row.priceApproved } : row
                          ),
                        })
                      }
                    >
                      {t("admin.costing.import.approvePrice")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {step === 4 && draft && (
          <div className="mt-4 space-y-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.costing.import.search")} />
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs",
                    filter === value ? "bg-turquoise text-white" : "bg-beige/60 text-coffee/70"
                  )}
                >
                  {t(`admin.costing.import.filter.${value}`)}
                </button>
              ))}
            </div>
            {filteredRecipes.map((recipe) => (
              <RecipeReviewCard
                key={recipe.key}
                recipe={recipe}
                ingredients={ingredients}
                compare={compareKey === recipe.key}
                onCompare={() => setCompareKey(compareKey === recipe.key ? null : recipe.key)}
                onResolve={(resolve) =>
                  patchDraft({
                    ...draft,
                    recipes: draft.recipes.map((item) => (item.key === recipe.key ? { ...item, resolve } : item)),
                  })
                }
                onLine={(lineKey, patch) =>
                  patchDraft({
                    ...draft,
                    recipes: draft.recipes.map((item) =>
                      item.key !== recipe.key
                        ? item
                        : {
                            ...item,
                            lines: item.lines.map((line) => (line.key === lineKey ? { ...line, ...patch } : line)),
                          }
                    ),
                  })
                }
                onCreate={(line) => setCreateLine({ recipeKey: recipe.key, lineKey: line.key, name: line.ingredientName })}
                onApprove={() => void commit(false, recipe.key)}
              />
            ))}
          </div>
        )}

        {step === 5 && draft && (
          <p className="mt-4 text-sm text-coffee/70">{t("admin.costing.import.doneHint")}</p>
        )}
        {busy && <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-turquoise" />}
      </AdminModalBody>
      <AdminModalFooter className="flex-wrap">
        {step > 1 && step < 5 && (
          <Button type="button" variant="outline" onClick={() => setStep((value) => (value - 1) as Step)} disabled={busy}>
            {t("common.back")}
          </Button>
        )}
        {step === 2 && (
          <Button type="button" variant="turquoise" onClick={() => setStep(3)} disabled={!draft}>
            {t("admin.costing.import.next")}
          </Button>
        )}
        {step === 3 && (
          <Button type="button" variant="turquoise" onClick={() => setStep(4)}>
            {t("admin.costing.import.next")}
          </Button>
        )}
        {step === 4 && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => onToast(t("admin.costing.import.draftKept"))}
              disabled={busy}
            >
              {t("admin.costing.import.saveDraft")}
            </Button>
            <Button type="button" variant="turquoise" onClick={() => void commit(true)} disabled={busy || !draft?.summary.readyRecipes}>
              {t("admin.costing.import.bulkReady")}
            </Button>
          </>
        )}
        {step === 5 && (
          <Button
            type="button"
            variant="turquoise"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t("admin.costing.done")}
          </Button>
        )}
      </AdminModalFooter>
      <QuickCreateIngredientPanel
        open={Boolean(createLine)}
        initialName={createLine?.name}
        existing={ingredients}
        onClose={() => setCreateLine(null)}
        onCreated={(item) => {
          if (createLine) applyIngredientToLine(createLine.recipeKey, createLine.lineKey, item);
          setCreateLine(null);
        }}
        onUseExisting={(item) => {
          if (createLine) applyIngredientToLine(createLine.recipeKey, createLine.lineKey, item);
          setCreateLine(null);
        }}
      />
    </AdminModal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-coffee/55">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function RecipeReviewCard({
  recipe,
  ingredients,
  compare,
  onCompare,
  onResolve,
  onLine,
  onCreate,
  onApprove,
}: {
  recipe: RecipeDraft;
  ingredients: CostingIngredient[];
  compare: boolean;
  onCompare: () => void;
  onResolve: (resolve: NonNullable<RecipeDraft["resolve"]>) => void;
  onLine: (lineKey: string, patch: Partial<RecipeLineDraft>) => void;
  onCreate: (line: RecipeLineDraft) => void;
  onApprove: () => void;
}) {
  const t = useT();
  const status = recipeDraftStatus(recipe);
  const ready = isRecipeBulkReady(recipe);
  return (
    <div className="rounded-2xl border border-beige-dark/15 bg-warm-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{recipe.productName}</p>
          {recipe.menuDescription && <p className="text-xs text-coffee/50">{recipe.menuDescription}</p>}
        </div>
        <span className="rounded-full bg-beige/70 px-2 py-1 text-xs">{t(`admin.costing.import.filter.${status}`)}</span>
      </div>
      {recipe.existingRecipeId && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
          <p>{t("admin.costing.import.hasExisting")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => onResolve("keep")}>
              {t("admin.costing.import.keepCurrent")}
            </Button>
            <Button type="button" variant="outline" onClick={onCompare}>
              {t("admin.costing.import.compare")}
            </Button>
            <Button type="button" variant="turquoise" onClick={() => onResolve("update")}>
              {t("admin.costing.import.update")}
            </Button>
          </div>
        </div>
      )}
      {compare && (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium">{t("admin.costing.import.current")}</p>
            {recipe.existingSummary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div>
            <p className="font-medium">{t("admin.costing.import.imported")}</p>
            {recipe.lines.map((line) => (
              <p key={line.key} className={cn(line.change === "CHANGED" && "text-amber-700")}>
                {line.ingredientName} {line.quantity ?? "—"} {line.unit ?? ""}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2 text-sm">
        {recipe.lines.map((line) => (
          <div key={line.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-beige/20 px-3 py-2">
            <div>
              <p>
                {line.matchKind === "exact" ? "✓ " : "⚠ "}
                {line.matchName ?? line.ingredientName}
                {line.change === "REMOVED" ? ` (${t("admin.costing.import.removed")})` : ""}
              </p>
              {line.suggested && <p className="text-xs text-coffee/45">{t("admin.costing.import.suggestion")}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="h-9 w-20"
                type="number"
                min="0"
                value={line.quantity ?? ""}
                onChange={(e) =>
                  onLine(line.key, {
                    quantity: e.target.value === "" ? null : Number(e.target.value),
                    errors: e.target.value ? line.errors.filter((error) => error !== "missing-qty") : line.errors,
                  })
                }
              />
              <span className="text-coffee/55">{line.unit ?? "—"}</span>
              {line.matchKind === "suggest" && (
                <Button type="button" variant="outline" onClick={() => onLine(line.key, { matchKind: "exact" })}>
                  {t("admin.costing.import.accept")}
                </Button>
              )}
              {!line.ingredientId && (
                <Button type="button" variant="outline" onClick={() => onCreate(line)}>
                  {t("admin.costing.import.createInStock")}
                </Button>
              )}
              {line.change === "REMOVED" && (
                <Button type="button" variant="ghost" onClick={() => onLine(line.key, { included: !line.included })}>
                  {line.included ? t("admin.costing.import.keepLine") : t("admin.costing.import.dropLine")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {recipe.extras.length > 0 && (
        <p className="mt-2 text-xs text-coffee/50">
          {t("admin.costing.import.extrasNote")}: {recipe.extras.map((item) => item.name).join(" · ")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          {t("admin.costing.import.knownCost")}: {formatIls(knownRecipeCost(recipe, ingredients))}
          {missingQuantityCount(recipe) > 0 &&
            ` · ${t("admin.costing.import.missingQty").replace("{count}", String(missingQuantityCount(recipe)))}`}
        </p>
        <Button type="button" variant="turquoise" disabled={!ready} onClick={onApprove}>
          {t("admin.costing.import.approve")}
        </Button>
      </div>
    </div>
  );
}
