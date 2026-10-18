"use client";

import { useMemo, useState } from "react";
import { Search, Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { normalizeCategoryName } from "@/lib/inventory/category-name";
import { createCategory } from "@/services/categoryService";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

interface CategorySearchSelectProps {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
}

export function CategorySearchSelect({
  categories,
  value,
  onChange,
  placeholder,
  emptyLabel,
}: CategorySearchSelectProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [extras, setExtras] = useState<Category[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => {
    const seen = new Set(categories.map((item) => item.id));
    return [...categories, ...extras.filter((item) => !seen.has(item.id))];
  }, [categories, extras]);

  const filtered = useMemo(() => {
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (c) =>
        c.name_he.includes(query) ||
        c.name_ar.includes(query) ||
        c.name_en.toLowerCase().includes(q)
    );
  }, [all, query]);

  const create = async () => {
    const name = draft.trim();
    if (!name || saving) return;
    const existing = all.find((item) => normalizeCategoryName(item.name_he || item.name_ar || item.name_en) === normalizeCategoryName(name));
    if (existing) {
      onChange(existing.id);
      setCreating(false);
      setDraft("");
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await createCategory({
      nameHe: name,
      nameAr: name,
      nameEn: name,
      icon: "star",
      color: "#8B6914",
      sortOrder: all.length,
      active: true,
      parentId: null,
    });
    setSaving(false);
    if (!result.success) {
      setError(t("admin.inventory.smart.categoryCreateFailed"));
      return;
    }
    setExtras((current) => [...current, result.data]);
    onChange(result.data.id);
    setCreating(false);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-coffee/40" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-10 rounded-xl ps-9"
        />
      </div>
      <div className="max-h-48 overflow-y-auto rounded-xl border border-beige-dark/20 dark:border-white/10">
        {filtered.length === 0 && !creating ? (
          <p className="px-4 py-6 text-center text-sm text-coffee/50">{emptyLabel}</p>
        ) : (
          filtered.map((cat) => {
            const selected = cat.id === value;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onChange(cat.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 border-b border-beige-dark/10 px-4 py-3 text-start text-sm transition-colors last:border-0 hover:bg-beige/30 dark:border-white/5 dark:hover:bg-white/5",
                  selected && "bg-turquoise/10"
                )}
              >
                <span dir="rtl" className="font-medium dark:text-warm-white">
                  {cat.name_he || cat.name_ar}
                </span>
                <span className="truncate text-xs text-coffee/50">{cat.name_en}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-turquoise" />}
              </button>
            );
          })
        )}
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-start text-sm text-turquoise hover:bg-turquoise/8"
          onClick={() => {
            setCreating(true);
            setDraft(query.trim());
            setError(null);
          }}
        >
          <Plus className="h-4 w-4" /> {t("admin.inventory.smart.newCategory")}
        </button>
      </div>
      {creating && (
        <div className="rounded-xl bg-beige/40 p-3">
          <Input
            className="h-10"
            value={draft}
            disabled={saving}
            placeholder={t("admin.inventory.smart.newCategoryName")}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="button" variant="turquoise" className="mt-2 h-9 text-sm" disabled={saving || !draft.trim()} onClick={() => void create()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.smart.createAndSelect")}
          </Button>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
