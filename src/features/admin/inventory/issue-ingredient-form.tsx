"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminModal, AdminModalBody, AdminModalFooter, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { MeasureUnitSelect } from "@/features/admin/measure-unit-select";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale, useT } from "@/components/providers/locale-provider";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import { ISSUE_REASONS, recipeIssueDraft, stockInDisplayUnit, validateIssueLines, type IssueDraftLine } from "@/lib/inventory/issue";
import { currentStockBase } from "@/lib/inventory/stock";
import type { InventoryIssueReason, InventoryMovement } from "@/lib/inventory/types";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Product } from "@/types";
import { issueInventory, recordManualStockIn } from "@/services/inventoryService";

function newLine(productId = ""): IssueDraftLine {
  return { key: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, productId, quantity: null, unit: "unit" };
}

export function IssueIngredientForm({
  open,
  ingredients,
  movements,
  recipes,
  products,
  initialProductId,
  onClose,
  onToast,
}: {
  open: boolean;
  ingredients: CostingIngredient[];
  movements: InventoryMovement[];
  recipes: DishRecipe[];
  products: Product[];
  initialProductId?: string;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { user } = useAuth();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [mode, setMode] = useState<"manual" | "recipe" | "in">(initialProductId ? "manual" : "manual");
  const [lines, setLines] = useState<IssueDraftLine[]>([newLine(initialProductId ?? "")]);
  const [reason, setReason] = useState<InventoryIssueReason>(initialProductId ? "kitchen" : "kitchen");
  const [note, setNote] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [recipeId, setRecipeId] = useState("");
  const [portions, setPortions] = useState(1);
  const [busy, setBusy] = useState(false);

  const recipe = recipes.find((item) => item.id === recipeId || item.productId === recipeId);
  const preview = useMemo(() => validateIssueLines(lines, ingredients, movements), [lines, ingredients, movements]);

  const applyRecipe = () => {
    if (!recipe) return;
    setLines(recipeIssueDraft(recipe, portions, ingredients, recipes));
    setReason("recipe");
  };

  const submit = async () => {
    if (busy) return;
    if (mode !== "in" && !preview.ok) {
      onToast(t(`admin.inventory.err.${preview.error}`), "error");
      return;
    }
    setBusy(true);
    if (mode === "in") {
      const first = lines.find((line) => line.productId && line.quantity);
      if (!first?.productId || !first.quantity) {
        setBusy(false);
        onToast(t("admin.inventory.err.zeroQty"), "error");
        return;
      }
      const result = await recordManualStockIn({
        productId: first.productId,
        quantity: first.quantity,
        unit: first.unit,
        note: note.trim() || undefined,
        actor: user?.email || undefined,
        receivedAt,
        idempotencyKey: idempotencyKey.current,
      });
      setBusy(false);
      if (!result.success) {
        onToast(result.error, "error");
        return;
      }
      onToast(t("admin.inventory.stockInDone"));
      onClose();
      return;
    }
    const result = await issueInventory({
      lines,
      ingredients,
      reason,
      note: note.trim() || undefined,
      receivedAt,
      actor: user?.email || undefined,
      recipeId: recipe?.id,
      menuProductId: recipe?.productId,
      dishCount: reason === "recipe" ? portions : undefined,
      idempotencyKey: idempotencyKey.current,
    });
    setBusy(false);
    if (!result.success) {
      onToast(t(`admin.inventory.err.${result.error}`, t("admin.inventory.err.issueFailed")), "error");
      return;
    }
    onToast(t("admin.inventory.issued"));
    onClose();
  };

  return (
    <AdminModal open={open} onOpenChange={(next) => !next && onClose()} size="lg">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.inventory.issueTitle")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="min-w-0 space-y-4 overflow-x-hidden">
        <p className="text-sm text-coffee/65">{t("admin.inventory.issueHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={mode === "manual" ? "turquoise" : "outline"} className="h-8 text-xs" onClick={() => setMode("manual")}>
            {t("admin.inventory.issueManual")}
          </Button>
          <Button type="button" variant={mode === "recipe" ? "turquoise" : "outline"} className="h-8 text-xs" onClick={() => setMode("recipe")}>
            {t("admin.inventory.issueByRecipe")}
          </Button>
          <Button type="button" variant={mode === "in" ? "turquoise" : "outline"} className="h-8 text-xs" onClick={() => setMode("in")}>
            {t("admin.inventory.manualIn")}
          </Button>
        </div>

        {mode === "recipe" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("admin.inventory.dish")}</Label>
              <select className="mt-1 h-10 w-full min-w-0 rounded-xl border px-2 text-sm" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
                <option value="">{t("admin.inventory.smart.notDetected")}</option>
                {recipes.map((item) => {
                  const product = products.find((row) => row.id === item.productId);
                  return (
                    <option key={item.id} value={item.id}>
                      {product ? getProductDisplayName(product, locale) : item.productId}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <Label>{t("admin.inventory.portions")}</Label>
              <Input className="mt-1 min-w-0" type="number" min="1" value={portions} onChange={(e) => setPortions(Number(e.target.value) || 0)} />
            </div>
            <div className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={applyRecipe} disabled={!recipe || portions <= 0}>
                {t("admin.inventory.recipePreview")}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {lines.map((line) => {
            const item = ingredients.find((row) => row.id === line.productId);
            const available = item ? currentStockBase(movements, item.id) : 0;
            const availableDisplay = item ? stockInDisplayUnit(available, item) : 0;
            return (
              <div key={line.key} className="grid gap-2 rounded-2xl border border-beige-dark/15 p-3 sm:grid-cols-[1fr_7rem_7rem_auto]">
                <div>
                  <Label>{t("admin.inventory.product")}</Label>
                  <select
                    className="mt-1 h-10 w-full min-w-0 rounded-xl border px-2 text-sm"
                    value={line.productId}
                    onChange={(e) => {
                      const next = ingredients.find((row) => row.id === e.target.value);
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key
                            ? { ...row, productId: e.target.value, unit: next?.purchaseUnit ?? row.unit }
                            : row
                        )
                      );
                    }}
                  >
                    <option value="">{t("admin.inventory.search")}</option>
                    {ingredients.filter((row) => row.active !== false).map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </select>
                  {item && (
                    <p className="mt-1 text-xs text-coffee/55">
                      {t("admin.inventory.available")}: {availableDisplay.toFixed(2)} {t(unitLabelKey(item.purchaseUnit))}
                    </p>
                  )}
                </div>
                <div>
                  <Label>{t("admin.inventory.issueQty")}</Label>
                  <Input
                    className="mt-1 min-w-0"
                    type="number"
                    min="0"
                    value={line.quantity ?? ""}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((row) => (row.key === line.key ? { ...row, quantity: e.target.value === "" ? null : Number(e.target.value) } : row))
                      )
                    }
                  />
                </div>
                <div>
                  <Label>{t("admin.costing.unit")}</Label>
                  <MeasureUnitSelect
                    value={line.unit}
                    compatibleWith={item?.baseUnit ?? line.unit}
                    onChange={(unit) =>
                      setLines((current) =>
                        current.map((row) => (row.key === line.key ? { ...row, unit: unit as IssueDraftLine["unit"] } : row))
                      )
                    }
                  />
                </div>
                <button type="button" className="self-end text-coffee/40" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key || current.length === 1))} aria-label={t("common.delete")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setLines((current) => [...current, newLine()])}>
            <Plus className="h-3.5 w-3.5" /> {t("admin.inventory.addIssueLine")}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t("admin.inventory.issueReason")}</Label>
            <select className="mt-1 h-10 w-full rounded-xl border px-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value as InventoryIssueReason)}>
              {ISSUE_REASONS.map((item) => (
                <option key={item} value={item}>{t(`admin.inventory.reason.${item}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t("admin.inventory.issueDate")}</Label>
            <Input className="mt-1 min-w-0" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>{t("admin.inventory.issueNote")}</Label>
            <Input className="mt-1 min-w-0" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        {preview.ok && (
          <div className="rounded-2xl bg-beige/40 p-3 text-sm">
            <p className="font-medium">{t("admin.inventory.expectedBalance")}</p>
            {preview.lines.map((line) => {
              const item = ingredients.find((row) => row.id === line.productId);
              if (!item) return null;
              return (
                <p key={line.productId}>
                  {item.name}: {stockInDisplayUnit(line.quantityBefore, item).toFixed(2)} → {stockInDisplayUnit(line.quantityAfter, item).toFixed(2)} {t(unitLabelKey(item.purchaseUnit))}
                </p>
              );
            })}
          </div>
        )}
        {!preview.ok && (
          <p className="text-sm text-amber-800">{t(`admin.inventory.err.${preview.error}`)}</p>
        )}
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="button" variant="turquoise" disabled={busy || !preview.ok} onClick={() => void submit()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.confirmIssue")}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}
