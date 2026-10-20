"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { normalizeCategoryName } from "@/lib/inventory/category-name";
import { pendingCategorySuggestions } from "@/lib/inventory/pack-cost";
import type { IngredientCategoryRecord } from "@/lib/inventory/category-record";
import { saveIngredientCategory, subscribeToIngredientCategoryDocs } from "@/services/ingredientCategoryService";
import { cn } from "@/lib/utils";

export function InvoiceCategorySelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: { name: string; id: string }) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<IngredientCategoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [nameHe, setNameHe] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToIngredientCategoryDocs(setRows), []);

  const active = rows.filter((row) => !row.archived && row.name);
  const filtered = useMemo(() => {
    const q = normalizeCategoryName(query);
    if (!q) return active;
    return active.filter((row) => normalizeCategoryName(`${row.name} ${row.nameAr} ${row.nameEn}`).includes(q));
  }, [active, query]);
  const suggestions = useMemo(
    () => pendingCategorySuggestions(active.map((row) => row.name), normalizeCategoryName).filter((name) => {
      const q = normalizeCategoryName(query);
      return !q || normalizeCategoryName(name).includes(q);
    }),
    [active, query]
  );

  const choose = (row: IngredientCategoryRecord) => {
    onChange({ name: row.name, id: row.id });
    setOpen(false);
    setQuery("");
  };

  const addSuggestion = async (name: string) => {
    setSaving(true);
    setError(null);
    const result = await saveIngredientCategory({ name });
    setSaving(false);
    if (!result.success) {
      setError(result.code === "DUPLICATE" ? t("admin.invoice.manual.duplicateCategory") : t("admin.costing.saveFailed"));
      return;
    }
    choose(result.data);
  };

  const saveDialog = async () => {
    if (!nameHe.trim() || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveIngredientCategory({ name: nameHe, nameAr, nameEn, description });
    setSaving(false);
    if (!result.success) {
      setError(result.code === "DUPLICATE" ? t("admin.invoice.manual.duplicateCategory") : t("admin.costing.saveFailed"));
      return;
    }
    choose(result.data);
    setDialog(false);
    setNameHe("");
    setNameAr("");
    setNameEn("");
    setDescription("");
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-coffee/40" />
        <Input
          className="h-11 ps-8 text-base"
          disabled={disabled}
          value={open ? query : value}
          placeholder={value || t("admin.costing.category")}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
          }}
        />
      </div>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-beige-dark/20 bg-white p-1 text-sm shadow-lg">
          {filtered.map((row) => (
            <button key={row.id} type="button" className={cn("block min-h-11 w-full rounded-lg px-2 text-start hover:bg-beige/60", row.name === value && "bg-turquoise/10")} onClick={() => choose(row)}>
              {row.name}
              {row.nameAr ? <span className="ms-2 text-coffee/50">{row.nameAr}</span> : null}
            </button>
          ))}
          {suggestions.length > 0 && <p className="px-2 pt-2 text-[11px] text-coffee/45">{t("admin.invoice.manual.suggestions")}</p>}
          {suggestions.map((name) => (
            <button key={name} type="button" className="block min-h-11 w-full rounded-lg px-2 text-start text-coffee/80 hover:bg-beige/60" disabled={saving} onClick={() => void addSuggestion(name)}>
              {name}
            </button>
          ))}
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-1 rounded-lg px-2 text-start text-turquoise hover:bg-turquoise/10"
            onClick={() => {
              setNameHe(query.trim());
              setDialog(true);
              setOpen(false);
              setError(null);
            }}
          >
            <Plus className="h-4 w-4" /> {t("admin.invoice.manual.newCategory")}
          </button>
          {error && <p className="px-2 py-1 text-xs text-red-700">{error}</p>}
        </div>
      )}
      <AdminModal open={dialog} onOpenChange={setDialog} size="sm">
        <AdminModalHeader onClose={() => setDialog(false)}>
          <AdminModalTitle>{t("admin.invoice.manual.newCategory")}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody className="space-y-2">
          <Input className="h-11" value={nameHe} placeholder={t("admin.invoice.manual.categoryHe")} onChange={(event) => setNameHe(event.target.value)} />
          <Input className="h-11" value={nameAr} placeholder={`${t("admin.invoice.manual.categoryAr")} (${t("admin.invoice.manual.optional")})`} onChange={(event) => setNameAr(event.target.value)} />
          <Input className="h-11" value={nameEn} placeholder={`${t("admin.invoice.manual.categoryEn")} (${t("admin.invoice.manual.optional")})`} onChange={(event) => setNameEn(event.target.value)} />
          <Input className="h-11" value={description} placeholder={`${t("admin.invoice.manual.categoryDescription")} (${t("admin.invoice.manual.optional")})`} onChange={(event) => setDescription(event.target.value)} />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="button" variant="turquoise" className="min-h-11" disabled={saving || !nameHe.trim()} onClick={() => void saveDialog()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.invoice.manual.saveCategory")}
          </Button>
        </AdminModalBody>
      </AdminModal>
    </div>
  );
}
