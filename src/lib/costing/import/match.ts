import { normalizeIngredientName } from "@/lib/costing/names";
import type { CostingIngredient } from "@/lib/costing/types";
import type { Product } from "@/types";
import type { MatchKind } from "@/lib/costing/import/types";

export type NameMatch<T> = {
  item?: T;
  kind: MatchKind;
  alternatives: T[];
};

export function catalogNames(item: Product | Record<string, unknown>): string[] {
  const row = item as Record<string, unknown>;
  const aliases = Array.isArray(row.aliases) ? row.aliases : [];
  return [row.name_ar, row.name_he, row.name_en, row.nameAr, row.nameHe, row.nameEn, row.name, ...aliases]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeIngredientName(value))
    .filter(Boolean);
}

export function matchIngredient(
  name: unknown,
  items: CostingIngredient[]
): NameMatch<CostingIngredient> {
  const target = normalizeIngredientName(name);
  if (!target) return { kind: "none", alternatives: [] };
  const usable = items.filter((item) => typeof item?.name === "string" && item.name.trim());
  const exact = usable.filter((item) => normalizeIngredientName(item.name) === target);
  if (exact.length === 1) return { item: exact[0], kind: "exact", alternatives: [] };
  if (exact.length > 1) return { kind: "suggest", alternatives: exact };

  const fuzzy = usable.filter((item) => {
    const n = normalizeIngredientName(item.name);
    if (n.length < 3 || target.length < 3) return false;
    return n.includes(target) || target.includes(n);
  });
  if (fuzzy.length === 1) return { item: fuzzy[0], kind: "suggest", alternatives: [] };
  if (fuzzy.length > 1) return { kind: "suggest", alternatives: fuzzy };
  return { kind: "new", alternatives: [] };
}

export function matchProduct(
  productId: unknown,
  productName: unknown,
  products: Product[]
): NameMatch<Product> {
  const id = typeof productId === "string" ? productId.trim() : "";
  if (id) {
    const byId = products.find((item) => item.id === id);
    if (byId) return { item: byId, kind: "exact", alternatives: [] };
  }
  const target = normalizeIngredientName(productName);
  if (!target) return { kind: "none", alternatives: [] };
  const exact = products.filter((item) => catalogNames(item).includes(target));
  if (exact.length === 1) return { item: exact[0], kind: "exact", alternatives: [] };
  if (exact.length > 1) return { kind: "none", alternatives: exact };
  const fuzzy = products.filter((item) =>
    catalogNames(item).some((n) => n.length >= 3 && target.length >= 3 && (n.includes(target) || target.includes(n)))
  );
  if (fuzzy.length === 1) return { item: fuzzy[0], kind: "suggest", alternatives: [] };
  if (fuzzy.length > 1) return { kind: "none", alternatives: fuzzy };
  return { kind: "none", alternatives: [] };
}
