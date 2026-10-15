import type { BaseUnit, CostingIngredient, DishRecipe, PurchaseUnit, RecipeLine } from "@/lib/costing/types";
import { asPurchaseUnit, baseUnitFor, purchaseQuantityInBase, unitsCompatible } from "@/lib/costing/units";
import { confirmInvoiceMatchPatch } from "@/lib/inventory/invoice-line-review";
import { currentStockBase, movementSignedBase, offerNormalizedCost, offerNormalizedLastPurchase, offerPurchaseUnit } from "@/lib/inventory/stock";
import type {
  InventoryMovement,
  PurchaseInvoiceLine,
  SupplierItemMap,
  SupplierOffer,
} from "@/lib/inventory/types";

/** Invoice qty → base units. conversionFactor is base units per 1 invoice qty (e.g. 2 packs × 12 = 24). */
export function invoiceLineQuantityBase(line: Pick<PurchaseInvoiceLine, "quantity" | "unit" | "conversionFactor">): number | null {
  const qty = Number(line.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (line.conversionFactor != null && line.conversionFactor > 0) return qty * line.conversionFactor;
  if (!line.unit) return null;
  const base = purchaseQuantityInBase(qty, line.unit);
  return base > 0 ? base : null;
}

export function packNeedsCompletion(
  line: Pick<PurchaseInvoiceLine, "unit" | "conversionFactor">,
  productBase?: BaseUnit | null
): boolean {
  if (line.conversionFactor != null && line.conversionFactor > 0) return false;
  if (!line.unit) return true;
  if (productBase && productBase !== "unit" && line.unit === "unit") return true;
  return false;
}

export function assignLinesToIngredient(
  lines: PurchaseInvoiceLine[],
  keys: string[],
  product: Pick<CostingIngredient, "id" | "name" | "category">
): PurchaseInvoiceLine[] {
  const selected = new Set(keys);
  const patch = confirmInvoiceMatchPatch(product);
  return lines.map((line) => {
    if (!selected.has(line.key)) return line;
    return {
      ...line,
      ...patch,
      rawName: line.rawName,
      originalDescription: line.originalDescription ?? line.rawName,
      sku: line.sku,
    };
  });
}

export function ingredientMatchesSearch(
  item: Pick<CostingIngredient, "id" | "name" | "category">,
  query: string,
  maps: Pick<SupplierItemMap, "inventoryProductId" | "supplierProductName" | "supplierSku">[] = []
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q) || (item.category ?? "").toLowerCase().includes(q)) return true;
  return maps.some(
    (map) =>
      map.inventoryProductId === item.id &&
      (`${map.supplierProductName} ${map.supplierSku ?? ""}`.toLowerCase().includes(q))
  );
}

export function filterUnifiedIngredients(input: {
  ingredients: CostingIngredient[];
  maps?: SupplierItemMap[];
  offers?: SupplierOffer[];
  movements?: InventoryMovement[];
  query?: string;
  category?: string;
  supplierId?: string;
  lowStockOnly?: boolean;
}): CostingIngredient[] {
  const maps = input.maps ?? [];
  const offers = input.offers ?? [];
  const movements = input.movements ?? [];
  return input.ingredients.filter((item) => {
    if (item.active === false) return false;
    if (!ingredientMatchesSearch(item, input.query ?? "", maps)) return false;
    if (input.category && item.category !== input.category) return false;
    if (input.supplierId) {
      const linked =
        item.lastSupplierId === input.supplierId ||
        maps.some((map) => map.inventoryProductId === item.id && map.supplierId === input.supplierId) ||
        offers.some((offer) => offer.productId === item.id && offer.supplierId === input.supplierId && offer.active !== false);
      if (!linked) return false;
    }
    if (input.lowStockOnly) {
      const current = currentStockBase(movements, item.id);
      if (item.minStock == null || current >= item.minStock) return false;
    }
    return true;
  });
}

export type OfferCompareRow = {
  offerId: string;
  supplierId: string;
  supplierProductName?: string;
  packQuantity: number | null;
  packUnit: PurchaseUnit | undefined;
  packPrice: number | null;
  unitCost: number | null;
  purchaseDate?: string;
  changePercent: number | null;
  complete: boolean;
  compatible: boolean;
  canRank: boolean;
};

export function buildOfferCompareRow(
  offer: SupplierOffer,
  previousUnitCost?: number | null,
  productBase?: BaseUnit
): OfferCompareRow {
  const packQuantity = offer.packageQuantity ?? offer.lastPackageQuantity ?? null;
  const packUnit = offerPurchaseUnit(offer);
  const packPrice = offer.priceIncludingVat ?? offer.currentPrice ?? offer.lastPriceIncludingVat ?? offer.lastPurchasePrice ?? null;
  const unitCost = offerNormalizedCost(offer) ?? offerNormalizedLastPurchase(offer) ?? null;
  const complete = packQuantity != null && packQuantity > 0 && Boolean(packUnit) && unitCost != null && unitCost > 0;
  const compatible = !productBase || !packUnit || baseUnitFor(packUnit) === productBase;
  const changePercent =
    previousUnitCost != null && previousUnitCost > 0 && unitCost != null
      ? ((unitCost - previousUnitCost) / previousUnitCost) * 100
      : null;
  return {
    offerId: offer.id,
    supplierId: offer.supplierId,
    supplierProductName: offer.supplierSku || offer.notes,
    packQuantity,
    packUnit,
    packPrice,
    unitCost,
    purchaseDate: offer.lastPurchaseDate || offer.lastPurchasedAt,
    changePercent,
    complete,
    compatible,
    canRank: complete && compatible,
  };
}

export function cheapestComparableOffer(rows: OfferCompareRow[]): OfferCompareRow | undefined {
  const ranked = rows.filter((row) => row.canRank).slice().sort((a, b) => (a.unitCost ?? Infinity) - (b.unitCost ?? Infinity));
  return ranked[0];
}

export function ingredientHasCost(ingredient: Pick<CostingIngredient, "costPerBaseUnit">): boolean {
  return Number.isFinite(ingredient.costPerBaseUnit) && ingredient.costPerBaseUnit > 0;
}

export function recipeIngredientCostReport(
  lines: RecipeLine[],
  ingredients: Map<string, Pick<CostingIngredient, "costPerBaseUnit" | "active">>
): { total: number | null; missingIds: string[] } {
  let total = 0;
  const missingIds: string[] = [];
  for (const line of lines) {
    if (line.subRecipeId) continue;
    const ingredient = ingredients.get(line.ingredientId);
    if (!ingredient || !ingredientHasCost(ingredient)) {
      if (line.ingredientId) missingIds.push(line.ingredientId);
      continue;
    }
    const qty = purchaseQuantityInBase(line.quantity, asPurchaseUnit(line.unit));
    total += qty * ingredient.costPerBaseUnit;
  }
  return { total: missingIds.length ? null : total, missingIds };
}

export function recipeHasCycle(recipes: DishRecipe[], startId: string): boolean {
  const byId = new Map(recipes.map((item) => [item.id, item]));
  const byProduct = new Map(recipes.map((item) => [item.productId, item]));
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    if (seen.has(id)) return true;
    const recipe = byId.get(id) ?? byProduct.get(id);
    if (!recipe) return false;
    seen.add(recipe.id);
    for (const line of recipe.ingredients) {
      if (line.subRecipeId && walk(line.subRecipeId)) return true;
    }
    seen.delete(recipe.id);
    return false;
  };
  return walk(startId);
}

export function expandRecipeMaterials(
  recipe: DishRecipe,
  portions: number,
  recipes: DishRecipe[]
): { productId: string; quantity: number; unit: PurchaseUnit }[] {
  if (recipeHasCycle(recipes, recipe.id)) return [];
  const byId = new Map(recipes.map((item) => [item.id, item]));
  const byProduct = new Map(recipes.map((item) => [item.productId, item]));
  const out = new Map<string, { productId: string; quantity: number; unit: PurchaseUnit }>();
  const walk = (current: DishRecipe, scale: number) => {
    const yieldPortions = current.yieldPortions && current.yieldPortions > 0 ? current.yieldPortions : 1;
    const factor = scale / yieldPortions;
    for (const line of current.ingredients) {
      if (line.subRecipeId) {
        const child = byId.get(line.subRecipeId) ?? byProduct.get(line.subRecipeId);
        if (child) walk(child, line.quantity * factor);
        continue;
      }
      if (!line.ingredientId || line.quantity <= 0) continue;
      const unit = asPurchaseUnit(line.unit);
      const qty = line.quantity * factor;
      const prev = out.get(line.ingredientId);
      if (prev && unitsCompatible(prev.unit, unit)) {
        const add = purchaseQuantityInBase(qty, unit);
        const existing = purchaseQuantityInBase(prev.quantity, prev.unit);
        out.set(line.ingredientId, { productId: line.ingredientId, quantity: existing + add, unit: prev.unit === unit ? prev.unit : unit });
      } else {
        out.set(line.ingredientId, { productId: line.ingredientId, quantity: qty, unit });
      }
    }
  };
  walk(recipe, portions);
  return [...out.values()];
}

export function consumptionAlreadyRecorded(
  movements: InventoryMovement[],
  ref: { productId: string; orderId?: string; recipeId?: string; posImportId?: string }
): boolean {
  return movements.some((row) => {
    if (row.productId !== ref.productId) return false;
    if (row.type !== "SALE_OUT" && row.type !== "ISSUE_OUT") return false;
    if (ref.orderId && row.orderId === ref.orderId) return true;
    if (ref.posImportId && row.posImportId === ref.posImportId) return true;
    if (ref.recipeId && ref.orderId && row.recipeId === ref.recipeId && row.orderId === ref.orderId) return true;
    return false;
  });
}

export type IngredientMergePlan =
  | { ok: false; reason: "same-card" | "incompatible-units" }
  | {
      ok: true;
      survivorId: string;
      loserId: string;
      survivorBalance: number;
      loserBalance: number;
      mergedBalance: number;
      survivorDelta: number;
      loserDelta: number;
    };

export function planIngredientMerge(input: {
  survivor: Pick<CostingIngredient, "id" | "baseUnit" | "purchaseUnit">;
  loser: Pick<CostingIngredient, "id" | "baseUnit" | "purchaseUnit">;
  survivorBalance: number;
  loserBalance: number;
}): IngredientMergePlan {
  if (input.survivor.id === input.loser.id) return { ok: false, reason: "same-card" };
  if (input.survivor.baseUnit !== input.loser.baseUnit && !unitsCompatible(input.survivor.purchaseUnit, input.loser.purchaseUnit)) {
    return { ok: false, reason: "incompatible-units" };
  }
  if (input.survivor.baseUnit !== input.loser.baseUnit) return { ok: false, reason: "incompatible-units" };
  return {
    ok: true,
    survivorId: input.survivor.id,
    loserId: input.loser.id,
    survivorBalance: input.survivorBalance,
    loserBalance: input.loserBalance,
    mergedBalance: input.survivorBalance + input.loserBalance,
    survivorDelta: input.loserBalance,
    loserDelta: -input.loserBalance,
  };
}

export type StockCountLine = { productId: string; countedBase: number | null };

export function stockCountAdjustment(input: {
  countedBase: number | null;
  snapshotBase: number;
  movementsDuringBase: number;
}): { skip: true } | { skip: false; expected: number; counted: number; adjustment: number } {
  if (input.countedBase == null || !Number.isFinite(input.countedBase)) return { skip: true };
  const expected = input.snapshotBase + input.movementsDuringBase;
  return { skip: false, expected, counted: input.countedBase, adjustment: input.countedBase - expected };
}

export function movementsDuringCount(
  movements: InventoryMovement[],
  productId: string,
  startedAt: string
): number {
  return movements
    .filter((row) => row.productId === productId && (row.receivedAt || row.createdAt) >= startedAt)
    .reduce((sum, row) => sum + movementSignedBase(row), 0);
}

export function invoicePriceIncrease(line: Pick<PurchaseInvoiceLine, "priceChangePercent">, threshold = 0): boolean {
  return line.priceChangePercent != null && line.priceChangePercent > threshold;
}
