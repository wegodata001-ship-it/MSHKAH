import { normalizeIngredientName } from "@/lib/costing/names";
import type { CostingIngredient } from "@/lib/costing/types";
import type { Product } from "@/types";
import type { MatchKind } from "@/lib/costing/import/types";

export type NameMatch<T> = {
  item?: T;
  kind: MatchKind;
  alternatives: T[];
};

export function matchIngredient(
  name: string,
  items: CostingIngredient[]
): NameMatch<CostingIngredient> {
  const target = normalizeIngredientName(name);
  if (!target) return { kind: "none", alternatives: [] };
  const exact = items.filter((item) => normalizeIngredientName(item.name) === target);
  if (exact.length === 1) return { item: exact[0], kind: "exact", alternatives: [] };
  if (exact.length > 1) return { kind: "suggest", alternatives: exact };

  const fuzzy = items.filter((item) => {
    const n = normalizeIngredientName(item.name);
    if (n.length < 3 || target.length < 3) return false;
    return n.includes(target) || target.includes(n);
  });
  if (fuzzy.length === 1) return { item: fuzzy[0], kind: "suggest", alternatives: [] };
  if (fuzzy.length > 1) return { kind: "suggest", alternatives: fuzzy };
  return { kind: "new", alternatives: [] };
}

export function matchProduct(
  productId: string,
  productName: string,
  products: Product[]
): NameMatch<Product> {
  const id = productId.trim();
  if (id) {
    const byId = products.find((item) => item.id === id);
    if (byId) return { item: byId, kind: "exact", alternatives: [] };
  }
  const target = normalizeIngredientName(productName);
  if (!target) return { kind: "none", alternatives: [] };
  const names = (item: Product) =>
    [item.name_ar, item.name_he, item.name_en].map((value) => normalizeIngredientName(value));
  const exact = products.filter((item) => names(item).includes(target));
  if (exact.length === 1) return { item: exact[0], kind: "exact", alternatives: [] };
  if (exact.length > 1) return { kind: "none", alternatives: exact };
  const fuzzy = products.filter((item) =>
    names(item).some((n) => n.length >= 3 && target.length >= 3 && (n.includes(target) || target.includes(n)))
  );
  if (fuzzy.length === 1) return { item: fuzzy[0], kind: "suggest", alternatives: [] };
  if (fuzzy.length > 1) return { kind: "none", alternatives: fuzzy };
  return { kind: "none", alternatives: [] };
}
