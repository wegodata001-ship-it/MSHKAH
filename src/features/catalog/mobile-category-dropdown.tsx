"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Coffee,
  GlassWater,
  Citrus,
  Milk,
  Snowflake,
  EggFried,
  Sandwich,
  Salad,
  Utensils,
  Croissant,
  Cake,
  IceCream,
  type LucideIcon,
} from "lucide-react";
import { useLocalizedCategory } from "@/hooks/useLocalizedContent";
import { useCategories, useAllProducts } from "@/hooks/useProducts";
import { countProductsInCategory, getRootCategories } from "@/lib/menu/category-tree";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

const iconMap: Record<string, LucideIcon> = {
  coffee: Coffee,
  "cup-soda": GlassWater,
  "glass-water": GlassWater,
  citrus: Citrus,
  milk: Milk,
  snowflake: Snowflake,
  "egg-fried": EggFried,
  sandwich: Sandwich,
  salad: Salad,
  utensils: Utensils,
  croissant: Croissant,
  cake: Cake,
  "ice-cream": IceCream,
};

export function MobileCategoryDropdown({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}) {
  const { categories, loading } = useCategories();
  const { products } = useAllProducts();
  const roots = getRootCategories(categories);
  const selected = roots.find((item) => item.id === selectedId) ?? roots[0] ?? null;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const node = rootRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  if (loading || !selected) {
    return <div className="h-12 rounded-2xl bg-beige/40" />;
  }

  return (
    <div ref={rootRef} className="relative md:hidden" data-category-dropdown="">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-full items-center justify-between gap-3 rounded-2xl border border-beige-dark/25 bg-warm-white px-3.5 text-start shadow-soft"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CategoryLabel cat={selected} />
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-coffee/50 transition-transform", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-50 max-h-[55vh] overflow-y-auto rounded-2xl border border-beige-dark/20 bg-warm-white p-1.5 shadow-[0_12px_32px_rgba(60,40,20,0.16)]"
        >
          {roots.map((cat) => {
            const count = countProductsInCategory(products, cat.id, categories);
            const isSelected = cat.id === selected.id;
            return (
              <li key={cat.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setOpen(false);
                    onSelect(cat.id);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start",
                    isSelected ? "bg-turquoise/10 text-dark-brown" : "text-coffee/80 hover:bg-cream"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {isSelected ? (
                      <Check className="h-4 w-4 shrink-0 text-turquoise" strokeWidth={2} />
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <CategoryLabel cat={cat} />
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-coffee/45">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CategoryLabel({ cat }: { cat: Category }) {
  const localized = useLocalizedCategory(cat);
  const Icon = iconMap[cat.icon] ?? Coffee;
  return (
    <>
      <Icon className="h-4 w-4 shrink-0 text-coffee/45" strokeWidth={1.75} />
      <span dir={localized.dir} className="min-w-0 truncate font-medium">
        {localized.name}
      </span>
    </>
  );
}
