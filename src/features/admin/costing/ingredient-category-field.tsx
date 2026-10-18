"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { findCategoryByNormalizedName, mergeCategoryNames } from "@/lib/inventory/category-name";
import { ensureIngredientCategory, subscribeToIngredientCategories } from "@/services/ingredientCategoryService";
import { cn } from "@/lib/utils";

export function IngredientCategoryField({
  value,
  extras = [],
  disabled,
  highlight,
  onChange,
}: {
  value: string;
  extras?: string[];
  disabled?: boolean;
  highlight?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [catalog, setCatalog] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return subscribeToIngredientCategories(setCatalog);
  }, []);

  const options = useMemo(() => mergeCategoryNames(catalog, extras, [value]), [catalog, extras, value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((item) => item.toLowerCase().includes(q));
  }, [options, query]);

  const create = async () => {
    const name = draft.trim();
    if (!name || saving) return;
    const existing = findCategoryByNormalizedName(name, options);
    if (existing) {
      onChange(existing);
      setCreating(false);
      setDraft("");
      setError(null);
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await ensureIngredientCategory(name, options);
    setSaving(false);
    if (!result.success) {
      setError(result.code === "PERMISSION_DENIED" || result.error === "PERMISSION_DENIED"
        ? t("admin.inventory.smart.permissionSystem")
        : t("admin.inventory.smart.categoryCreateFailed"));
      return;
    }
    onChange(result.data);
    setCatalog((current) => mergeCategoryNames(current, [result.data]));
    setCreating(false);
    setDraft("");
    setOpen(false);
  };

  return (
    <div className={cn("space-y-1", highlight && "rounded-xl ring-2 ring-turquoise")}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 start-2.5 h-3.5 w-3.5 -translate-y-1/2 text-coffee/40" />
        <Input
          className="h-9 ps-8 text-sm"
          value={open ? query : value}
          disabled={disabled}
          placeholder={value || t("admin.costing.category")}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
        />
      </div>
      {open && !disabled && (
        <div className="max-h-44 overflow-y-auto rounded-xl border border-beige-dark/20 bg-white p-1 text-sm shadow-sm">
          {filtered.map((item) => (
            <button
              key={item}
              type="button"
              className={cn("block w-full rounded-lg px-2.5 py-1.5 text-start hover:bg-beige/50", item === value && "bg-turquoise/10")}
              onClick={() => {
                onChange(item);
                setOpen(false);
                setCreating(false);
                setError(null);
              }}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-start text-turquoise hover:bg-turquoise/8"
            onClick={() => {
              setCreating(true);
              setDraft(query.trim());
              setError(null);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> {t("admin.inventory.smart.newCategory")}
          </button>
        </div>
      )}
      {creating && (
        <div className="rounded-xl bg-beige/40 p-2">
          <Input
            className="h-9 text-sm"
            value={draft}
            disabled={saving}
            placeholder={t("admin.inventory.smart.newCategoryName")}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="button" variant="turquoise" className="mt-2 h-8 text-xs" disabled={saving || !draft.trim()} onClick={() => void create()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("admin.inventory.smart.createAndSelect")}
          </Button>
          {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
