import type { CostingIngredient } from "@/lib/costing/types";

export function normalizeIngredientName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function findDuplicateIngredient(
  name: string,
  items: CostingIngredient[]
): CostingIngredient | undefined {
  const target = normalizeIngredientName(name);
  if (!target) return undefined;
  return items.find((item) => normalizeIngredientName(item.name) === target);
}

export function filterIngredientsByQuery(
  items: CostingIngredient[],
  query: string
): CostingIngredient[] {
  const q = normalizeIngredientName(query);
  if (!q) return items;
  return items.filter((item) => normalizeIngredientName(item.name).includes(q));
}
