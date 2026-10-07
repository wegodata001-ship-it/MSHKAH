import type { DishRecipe } from "@/lib/costing/types";
import { purchaseQuantityInBase } from "@/lib/costing/units";
import type { PosSaleLine } from "@/lib/inventory/types";

export function posPeriod(lines: PosSaleLine[], fallback = ""): string {
  const dates = lines.map((line) => line.saleDate).filter(Boolean) as string[];
  if (!dates.length) return fallback;
  const sorted = dates.slice().sort();
  return sorted[0] === sorted[sorted.length - 1] ? sorted[0] : `${sorted[0]}:${sorted[sorted.length - 1]}`;
}

export function theoreticalConsumption(
  lines: PosSaleLine[],
  recipes: DishRecipe[]
): { productId: string; quantityBase: number; unit: "g" | "ml" | "unit" }[] {
  const byProduct = new Map<string, number>();
  const unitByProduct = new Map<string, "g" | "ml" | "unit">();
  for (const line of lines) {
    if (!line.menuProductId || !line.quantity) continue;
    const recipe = recipes.find((item) => item.productId === line.menuProductId && !item.variantId);
    if (!recipe) continue;
    for (const ingredient of recipe.ingredients) {
      const base = purchaseQuantityInBase(ingredient.quantity, ingredient.unit === "kg" || ingredient.unit === "g" || ingredient.unit === "liter" || ingredient.unit === "ml" || ingredient.unit === "unit" ? ingredient.unit : "g");
      const next = (byProduct.get(ingredient.ingredientId) ?? 0) + base * line.quantity;
      byProduct.set(ingredient.ingredientId, next);
      unitByProduct.set(ingredient.ingredientId, ingredient.unit === "ml" || ingredient.unit === "liter" ? "ml" : ingredient.unit === "unit" ? "unit" : "g");
    }
  }
  return [...byProduct.entries()].map(([productId, quantityBase]) => ({
    productId,
    quantityBase,
    unit: unitByProduct.get(productId) ?? "g",
  }));
}

export function posDelta(previous: PosSaleLine[], next: PosSaleLine[]) {
  const keyOf = (line: PosSaleLine) => `${line.posCode}|${line.posName}|${line.saleDate ?? ""}`;
  const prevMap = new Map(previous.map((line) => [keyOf(line), line]));
  const nextMap = new Map(next.map((line) => [keyOf(line), line]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  let unchanged = 0;
  for (const [key, line] of nextMap) {
    const old = prevMap.get(key);
    if (!old) added += 1;
    else if (old.quantity !== line.quantity || old.netTotal !== line.netTotal) changed += 1;
    else unchanged += 1;
  }
  for (const key of prevMap.keys()) {
    if (!nextMap.has(key)) removed += 1;
  }
  return { added, changed, removed, unchanged };
}
