"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { filterIngredientsByQuery } from "@/lib/costing/names";
import type { CostingIngredient } from "@/lib/costing/types";
import { cn } from "@/lib/utils";

export function IngredientPicker({
  ingredients,
  value,
  onSelect,
  onCreate,
}: {
  ingredients: CostingIngredient[];
  value: string;
  onSelect: (id: string) => void;
  onCreate: (draftName?: string) => void;
}) {
  const t = useT();
  const selected = ingredients.find((item) => item.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => filterIngredientsByQuery(ingredients, query).slice(0, 12),
    [ingredients, query]
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const showCreate = query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between rounded-xl border border-beige-dark/30 bg-warm-white px-3 text-start text-sm"
        onClick={() => {
          setOpen(true);
          setQuery("");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <span className={cn("truncate", !selected && "text-coffee/45")}>
          {selected?.name ?? t("admin.costing.selectIngredient")}
        </span>
        <Search className="h-3.5 w-3.5 shrink-0 text-coffee/40" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-beige-dark/20 bg-white shadow-elevated">
          <div className="border-b border-beige-dark/10 p-2">
            <input
              ref={inputRef}
              className="h-9 w-full rounded-lg border border-beige-dark/25 bg-cream/40 px-3 text-sm outline-none focus:border-turquoise/50"
              placeholder={t("admin.costing.searchIngredient")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex w-full px-3 py-2 text-start text-sm hover:bg-beige/50",
                  item.id === value && "bg-turquoise/8 font-medium text-turquoise"
                )}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                {item.name}
              </button>
            ))}
            {results.length === 0 && (
              <p className="px-3 py-2 text-sm text-coffee/45">{t("admin.costing.noIngredientMatch")}</p>
            )}
          </div>
          <div className="border-t border-beige-dark/10 p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium text-turquoise hover:bg-turquoise/8"
              onClick={() => {
                setOpen(false);
                onCreate(query.trim() || undefined);
              }}
            >
              <Plus className="h-4 w-4" />
              {showCreate
                ? t("admin.costing.createNamed").replace("{name}", query.trim())
                : t("admin.costing.createNewIngredient")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
