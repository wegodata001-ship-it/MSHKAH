"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import type { CostingIngredient } from "@/lib/costing/types";
import type { IngredientCategoryRecord } from "@/lib/inventory/category-record";
import type { InventoryMovement } from "@/lib/inventory/types";
import {
  archiveIngredientCategory,
  saveIngredientCategory,
  subscribeToIngredientCategoryDocs,
} from "@/services/ingredientCategoryService";
import { setIngredientCategory } from "@/services/costingService";

export function IngredientCategoriesPanel({
  ingredients,
  movements,
  onToast,
}: {
  ingredients: CostingIngredient[];
  movements: InventoryMovement[];
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<IngredientCategoryRecord[]>([]);
  const [editing, setEditing] = useState<IngredientCategoryRecord | null>(null);
  const [nameHe, setNameHe] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [moveTo, setMoveTo] = useState("");

  useEffect(() => subscribeToIngredientCategoryDocs(setRows), []);
  const visible = rows.filter((row) => !row.archived);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of ingredients) {
      const key = item.categoryId || item.category || "";
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
      if (item.category) map.set(item.category, (map.get(item.category) || 0) + 1);
    }
    return map;
  }, [ingredients]);

  const startNew = () => {
    setEditing(null);
    setNameHe("");
    setNameAr("");
    setNameEn("");
    setDescription("");
    setMoveTo("");
  };

  const startEdit = (row: IngredientCategoryRecord) => {
    setEditing(row);
    setNameHe(row.nameHe || row.name);
    setNameAr(row.nameAr);
    setNameEn(row.nameEn);
    setDescription(row.description);
    setMoveTo("");
  };

  const save = async () => {
    if (!nameHe.trim() || saving) return;
    setSaving(true);
    const result = await saveIngredientCategory({
      id: editing?.id,
      name: nameHe,
      nameAr,
      nameEn,
      description,
    });
    setSaving(false);
    if (!result.success) {
      onToast(result.code === "DUPLICATE" ? t("admin.invoice.manual.duplicateCategory") : t("admin.costing.saveFailed"), "error");
      return;
    }
    onToast(t("admin.inventory.categories.saved"));
    startNew();
  };

  const productsFor = (row: IngredientCategoryRecord) =>
    ingredients.filter((item) => item.categoryId === row.id || item.category === row.name);

  const archive = async (row: IngredientCategoryRecord) => {
    const products = productsFor(row);
    const activeMoves = movements.some((move) => products.some((item) => item.id === move.productId));
    if ((products.length > 0 || activeMoves) && !moveTo) {
      onToast(t("admin.inventory.categories.moveFirst"), "error");
      return;
    }
    if (moveTo) {
      const target = visible.find((item) => item.id === moveTo);
      if (!target) return;
      for (const product of products) {
        const moved = await setIngredientCategory(product.id, target.name, target.id);
        if (!moved.success) {
          onToast(t("admin.costing.saveFailed"), "error");
          return;
        }
      }
    }
    const result = await archiveIngredientCategory(row.id);
    if (!result.success) {
      onToast(t("admin.costing.saveFailed"), "error");
      return;
    }
    onToast(t("admin.inventory.categories.archived"));
    startNew();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-2xl border border-beige-dark/15 p-3 sm:grid-cols-2">
        <Input className="h-11" value={nameHe} placeholder={t("admin.invoice.manual.categoryHe")} onChange={(event) => setNameHe(event.target.value)} />
        <Input className="h-11" value={nameAr} placeholder={t("admin.invoice.manual.categoryAr")} onChange={(event) => setNameAr(event.target.value)} />
        <Input className="h-11" value={nameEn} placeholder={t("admin.invoice.manual.categoryEn")} onChange={(event) => setNameEn(event.target.value)} />
        <Input className="h-11" value={description} placeholder={t("admin.invoice.manual.categoryDescription")} onChange={(event) => setDescription(event.target.value)} />
        <Button type="button" variant="turquoise" className="min-h-11 sm:col-span-2" disabled={saving || !nameHe.trim()} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.invoice.manual.saveCategory")}
        </Button>
      </div>
      {visible.length === 0 && <p className="text-coffee/70">{t("admin.inventory.categories.empty")}</p>}
      <div className="space-y-2">
        {visible.map((row) => {
          const count = productsFor(row).length || counts.get(row.id) || counts.get(row.name) || 0;
          return (
            <div key={row.id} className="rounded-2xl border border-beige-dark/15 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{row.name}</p>
                  {row.nameAr ? <p className="text-sm text-coffee/70">{row.nameAr}</p> : null}
                  {row.nameEn ? <p className="text-sm text-coffee/70">{row.nameEn}</p> : null}
                  {row.description ? <p className="text-sm text-coffee/60">{row.description}</p> : null}
                  <p className="text-sm">{t("admin.inventory.categories.count")}: {count}</p>
                </div>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => startEdit(row)}>{t("admin.costing.editLine")}</Button>
              </div>
              {editing?.id === row.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select className="h-11 rounded-xl border px-2" value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
                    <option value="">{t("admin.inventory.categories.move")}</option>
                    {visible.filter((item) => item.id !== row.id).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => void archive(row)}>
                    {t("admin.inventory.categories.archive")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
