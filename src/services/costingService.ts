import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { ServiceError, failure, success, type ServiceResult } from "@/lib/errors";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { nowTimestamp, timestampToIso } from "@/types/firestore";
import { recipeIngredientCost } from "@/lib/costing/calc";
import { baseUnitFor, costPerBaseUnit, isPackUnit, purchaseQuantityInBase } from "@/lib/costing/units";
import { packFactor } from "@/lib/inventory/pack-cost";
import {
  DEFAULT_COSTING_SETTINGS,
  type CostingIngredient,
  type CostingSettings,
  type CostingSnapshot,
  type DishRecipe,
  type IngredientOriginKind,
  type IngredientPriceHistory,
  type OverheadSettings,
  type PriceRoundMode,
  type PurchaseUnit,
  type RecipeLine,
} from "@/lib/costing/types";
import type { ProductCostKind, ProductCostLink } from "@/lib/breakeven/types";

const SETTINGS_DOC = "default";

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapIngredient(id: string, data: Record<string, unknown>): CostingIngredient {
  const purchaseUnit = (data.purchaseUnit as PurchaseUnit) || "unit";
  const purchasePrice = asNumber(data.purchasePrice);
  const purchaseQuantity = asNumber(data.purchaseQuantity);
  return {
    id,
    name: String(data.name ?? ""),
    originKind:
      data.originKind === "manual" || data.originKind === "invoice" || data.originKind === "purchase-file" || data.originKind === "other"
        ? data.originKind
        : undefined,
    category: data.category ? String(data.category) : undefined,
    categoryId: data.categoryId ? String(data.categoryId) : undefined,
    packCount: data.packCount != null ? asNumber(data.packCount) : undefined,
    packContentUnit: data.packContentUnit ? (data.packContentUnit as PurchaseUnit) : undefined,
    purchasePrice,
    purchaseQuantity,
    purchaseUnit,
    baseUnit: (data.baseUnit as CostingIngredient["baseUnit"]) || baseUnitFor(purchaseUnit),
    costPerBaseUnit: asNumber(data.costPerBaseUnit, costPerBaseUnit(purchasePrice, purchaseQuantity, purchaseUnit)),
    supplier: data.supplier ? String(data.supplier) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    barcode: data.barcode ? String(data.barcode) : undefined,
    minStock: data.minStock != null ? asNumber(data.minStock) : undefined,
    recommendedStock: data.recommendedStock != null ? asNumber(data.recommendedStock) : undefined,
    lastSupplierId: data.lastSupplierId ? String(data.lastSupplierId) : undefined,
    adminPriceCorrection: data.adminPriceCorrection && typeof data.adminPriceCorrection === "object"
      ? data.adminPriceCorrection as CostingIngredient["adminPriceCorrection"]
      : undefined,
    lastReceivedAt: data.lastReceivedAt ? timestampToIso(data.lastReceivedAt as never) : undefined,
    compareGroupId: data.compareGroupId ? String(data.compareGroupId) : undefined,
    compareGroupName: data.compareGroupName ? String(data.compareGroupName) : undefined,
    active: data.active !== false,
    createdAt: timestampToIso(data.createdAt as never),
    updatedAt: timestampToIso(data.updatedAt as never),
  };
}

function mapRecipe(id: string, data: Record<string, unknown>): DishRecipe {
  const ingredients = Array.isArray(data.ingredients)
    ? (data.ingredients as RecipeLine[]).filter((line) => line.ingredientId && Number(line.quantity) > 0)
    : [];
  return {
    id,
    productId: String(data.productId ?? ""),
    variantId: data.variantId ? String(data.variantId) : undefined,
    ingredients,
    overheadSettings: (data.overheadSettings as OverheadSettings | undefined) ?? undefined,
    targetFoodCostPercent:
      data.targetFoodCostPercent != null ? asNumber(data.targetFoodCostPercent) : undefined,
    createdAt: timestampToIso(data.createdAt as never),
    updatedAt: timestampToIso(data.updatedAt as never),
  };
}

export function subscribeToIngredients(
  onData: (items: CostingIngredient[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.ingredients),
    (snap) => {
      onData(snap.docs.map((d) => mapIngredient(d.id, d.data() as Record<string, unknown>)));
    },
    (error) => onError?.(error.message)
  );
}

export function subscribeToDishRecipes(
  onData: (items: DishRecipe[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.dishRecipes),
    (snap) => {
      onData(snap.docs.map((d) => mapRecipe(d.id, d.data() as Record<string, unknown>)));
    },
    (error) => onError?.(error.message)
  );
}

export function subscribeToIngredientPriceHistory(
  onData: (items: IngredientPriceHistory[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.ingredientPriceHistory),
    (snap) => {
      onData(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ingredientId: String(data.ingredientId ?? ""),
            previousPrice: asNumber(data.previousPrice),
            newPrice: asNumber(data.newPrice),
            previousQuantity: asNumber(data.previousQuantity),
            newQuantity: asNumber(data.newQuantity),
            changedAt: timestampToIso(data.changedAt),
            changedBy: data.changedBy ? String(data.changedBy) : undefined,
          };
        })
      );
    },
    (error) => onError?.(error.message)
  );
}

export function subscribeToCostingSettings(
  onData: (settings: CostingSettings) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), COLLECTIONS.costingSettings, SETTINGS_DOC),
    (snap) => {
      if (!snap.exists()) {
        onData({ ...DEFAULT_COSTING_SETTINGS });
        return;
      }
      const data = snap.data();
      onData({
        targetFoodCostPercent: asNumber(data.targetFoodCostPercent, DEFAULT_COSTING_SETTINGS.targetFoodCostPercent),
        priceRoundMode: (data.priceRoundMode as PriceRoundMode) || "none",
        vatRate: data.vatRate != null ? asNumber(data.vatRate, 0.18) : 0.18,
        foodCostVatMode: data.foodCostVatMode === "including" ? "including" : "before",
        costBasis: data.costBasis === "weighted" ? "weighted" : "latest",
      });
    },
    (error) => onError?.(error.message)
  );
}

export function subscribeToCostingSnapshots(
  onData: (items: CostingSnapshot[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.costingSnapshots),
    (snap) => {
      onData(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            productId: String(data.productId ?? ""),
            variantId: data.variantId ? String(data.variantId) : undefined,
            ingredientCost: asNumber(data.ingredientCost),
            sellingPrice: asNumber(data.sellingPrice),
            foodCostPercent:
              data.foodCostPercent == null ? null : asNumber(data.foodCostPercent),
            createdAt: timestampToIso(data.createdAt),
          };
        })
      );
    },
    (error) => onError?.(error.message)
  );
}

export type IngredientWriteInput = {
  name: string;
  category?: string;
  categoryId?: string;
  packCount?: number;
  packContentUnit?: PurchaseUnit;
  purchasePrice: number;
  purchaseQuantity: number;
  purchaseUnit: PurchaseUnit;
  supplier?: string;
  notes?: string;
  barcode?: string;
  minStock?: number;
  recommendedStock?: number;
  active?: boolean;
  originKind?: IngredientOriginKind;
};

export function isCostingPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient permissions|permission-denied|PERMISSION_DENIED/i.test(message);
}

function ingredientPayload(input: IngredientWriteInput) {
  const purchaseUnit = input.purchaseUnit;
  const packed =
    isPackUnit(purchaseUnit) && input.packContentUnit && input.packCount
      ? packFactor({ contentCount: input.packCount, contentUnit: input.packContentUnit })
      : null;
  const baseUnit = packed?.ok ? packed.base : baseUnitFor(purchaseUnit);
  const perPack = packed?.ok
    ? input.purchaseQuantity * packed.factor
    : purchaseQuantityInBase(input.purchaseQuantity, purchaseUnit);
  const costPerBase = perPack > 0 ? input.purchasePrice / perPack : 0;
  return sanitizeFirestoreData({
    name: input.name.trim(),
    category: input.category?.trim() || null,
    categoryId: input.categoryId?.trim() || null,
    packCount: input.packCount ?? null,
    packContentUnit: input.packContentUnit ?? null,
    purchasePrice: input.purchasePrice,
    purchaseQuantity: input.purchaseQuantity,
    purchaseUnit,
    baseUnit,
    costPerBaseUnit: costPerBase,
    supplier: input.supplier?.trim() || null,
    notes: input.notes?.trim() || null,
    barcode: input.barcode?.trim() || null,
    minStock: input.minStock ?? null,
    recommendedStock: input.recommendedStock ?? null,
    active: input.active !== false,
    ...(input.originKind ? { originKind: input.originKind } : {}),
  });
}

function writeFailure(error: unknown, fallback: string): ServiceResult<never> {
  if (isCostingPermissionError(error)) {
    console.error("[costing] permission denied", error);
    return failure(new ServiceError("PERMISSION_DENIED", "PERMISSION_DENIED"));
  }
  console.error("[costing] write failed", error);
  return failure(error, fallback);
}

export async function createIngredient(input: IngredientWriteInput): Promise<ServiceResult<CostingIngredient>> {
  try {
    if (!input.name.trim()) return failure(new ServiceError("Name required", "VALIDATION"));
    if (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0) {
      input = { ...input, purchasePrice: 0 };
    }
    if (!Number.isFinite(input.purchaseQuantity) || input.purchaseQuantity <= 0) {
      input = { ...input, purchaseQuantity: 1 };
    }
    const now = nowTimestamp();
    const payload = { ...ingredientPayload(input), createdAt: now, updatedAt: now };
    const ref = await addDoc(collection(getDb(), COLLECTIONS.ingredients), payload);
    return success(mapIngredient(ref.id, payload as Record<string, unknown>));
  } catch (error) {
    return writeFailure(error, "Failed to save ingredient");
  }
}

export async function setIngredientCategory(
  id: string,
  category: string | null,
  categoryId?: string | null
): Promise<ServiceResult<void>> {
  try {
    await updateDoc(doc(getDb(), COLLECTIONS.ingredients, id), {
      category: category?.trim() || null,
      categoryId: categoryId?.trim() || null,
      updatedAt: nowTimestamp(),
    });
    return success(undefined);
  } catch (error) {
    return writeFailure(error, "Failed to update category");
  }
}

export async function updateIngredient(
  id: string,
  input: IngredientWriteInput,
  changedBy?: string
): Promise<ServiceResult<{ ingredient: CostingIngredient; affectedRecipeCount: number }>> {
  try {
    const ref = doc(getDb(), COLLECTIONS.ingredients, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return failure(new ServiceError("Not found", "NOT_FOUND"));
    const previous = mapIngredient(id, snap.data() as Record<string, unknown>);
    const payload = { ...ingredientPayload(input), updatedAt: nowTimestamp() };
    await updateDoc(ref, payload);

    const priceChanged =
      previous.purchasePrice !== input.purchasePrice ||
      previous.purchaseQuantity !== input.purchaseQuantity ||
      previous.purchaseUnit !== input.purchaseUnit;

    if (priceChanged) {
      await addDoc(collection(getDb(), COLLECTIONS.ingredientPriceHistory), {
        ingredientId: id,
        previousPrice: previous.purchasePrice,
        newPrice: input.purchasePrice,
        previousQuantity: previous.purchaseQuantity,
        newQuantity: input.purchaseQuantity,
        changedAt: nowTimestamp(),
        changedBy: changedBy || null,
      });
    }

    const recipes = await getDocs(collection(getDb(), COLLECTIONS.dishRecipes));
    const affected = recipes.docs.filter((d) =>
      ((d.data().ingredients as RecipeLine[]) ?? []).some((line) => line.ingredientId === id)
    );
    return success({
      ingredient: mapIngredient(id, { ...previous, ...payload } as Record<string, unknown>),
      affectedRecipeCount: affected.length,
    });
  } catch (error) {
    return writeFailure(error, "Failed to update ingredient");
  }
}

export async function countIngredientUsage(ingredientId: string): Promise<number> {
  const recipes = await getDocs(collection(getDb(), COLLECTIONS.dishRecipes));
  return recipes.docs.filter((d) =>
    ((d.data().ingredients as RecipeLine[]) ?? []).some((line) => line.ingredientId === ingredientId)
  ).length;
}

export async function deleteIngredient(id: string): Promise<ServiceResult<void>> {
  try {
    const used = await countIngredientUsage(id);
    if (used > 0) {
      return failure(new ServiceError(`IN_USE:${used}`, "IN_USE"));
    }
    await deleteDoc(doc(getDb(), COLLECTIONS.ingredients, id));
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to delete ingredient");
  }
}

export async function deactivateIngredient(id: string): Promise<ServiceResult<void>> {
  try {
    await updateDoc(doc(getDb(), COLLECTIONS.ingredients, id), {
      active: false,
      updatedAt: nowTimestamp(),
    });
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to deactivate ingredient");
  }
}

export type RecipeWriteInput = {
  productId: string;
  variantId?: string;
  ingredients: RecipeLine[];
  overheadSettings?: OverheadSettings;
  targetFoodCostPercent?: number;
};

export async function saveDishRecipe(
  input: RecipeWriteInput & { id?: string },
  meta?: { sellingPrice?: number; ingredients?: CostingIngredient[] }
): Promise<ServiceResult<DishRecipe>> {
  try {
    if (!input.productId.trim()) return failure(new ServiceError("productId required", "VALIDATION"));
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      productId: input.productId,
      variantId: input.variantId?.trim() || null,
      ingredients: input.ingredients,
      overheadSettings: input.overheadSettings ?? null,
      targetFoodCostPercent: input.targetFoodCostPercent ?? null,
      updatedAt: now,
    });

    let id = input.id;
    if (id) {
      await updateDoc(doc(getDb(), COLLECTIONS.dishRecipes, id), payload);
    } else {
      const ref = await addDoc(collection(getDb(), COLLECTIONS.dishRecipes), {
        ...payload,
        createdAt: now,
      });
      id = ref.id;
    }

    if (meta?.ingredients) {
      const cost = recipeIngredientCost(
        input.ingredients,
        new Map(meta.ingredients.map((item) => [item.id, item]))
      );
      const sellingPrice = meta.sellingPrice ?? 0;
      if (cost > 0 && sellingPrice > 0) {
        await addDoc(collection(getDb(), COLLECTIONS.costingSnapshots), {
          productId: input.productId,
          variantId: input.variantId?.trim() || null,
          ingredientCost: cost,
          sellingPrice,
          foodCostPercent: sellingPrice > 0 ? (cost / sellingPrice) * 100 : null,
          createdAt: now,
        });
      }
    }

    return success(
      mapRecipe(id, { ...payload, createdAt: now } as Record<string, unknown>)
    );
  } catch (error) {
    return failure(error, "Failed to save recipe");
  }
}

export async function deleteDishRecipe(id: string): Promise<ServiceResult<void>> {
  try {
    await deleteDoc(doc(getDb(), COLLECTIONS.dishRecipes, id));
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to delete recipe");
  }
}

export async function saveCostingSettings(settings: CostingSettings): Promise<ServiceResult<CostingSettings>> {
  try {
    await setDoc(
      doc(getDb(), COLLECTIONS.costingSettings, SETTINGS_DOC),
      sanitizeFirestoreData({
        targetFoodCostPercent: settings.targetFoodCostPercent,
        priceRoundMode: settings.priceRoundMode,
        vatRate: settings.vatRate ?? 0.18,
        foodCostVatMode: settings.foodCostVatMode ?? "before",
        costBasis: settings.costBasis ?? "latest",
        updatedAt: nowTimestamp(),
      }),
      { merge: true }
    );
    return success(settings);
  } catch (error) {
    return failure(error, "Failed to save settings");
  }
}

export async function recordCostingImportHistory(input: {
  fileName: string;
  importedBy?: string;
  rowsProcessed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}): Promise<void> {
  await addDoc(collection(getDb(), COLLECTIONS.costingImportHistory), sanitizeFirestoreData({
    ...input,
    importedAt: nowTimestamp(),
  }));
}

export async function writeIngredientImpactSnapshots(input: {
  ingredientId: string;
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  sellingPriceByProduct: Map<string, number>;
}): Promise<void> {
  const lookup = new Map(input.ingredients.map((item) => [item.id, item]));
  const now = nowTimestamp();
  const affected = input.recipes.filter((recipe) =>
    recipe.ingredients.some((line) => line.ingredientId === input.ingredientId)
  );
  await Promise.all(
    affected.map((recipe) => {
      const sellingPrice = input.sellingPriceByProduct.get(recipe.productId) ?? 0;
      const cost = recipeIngredientCost(recipe.ingredients, lookup);
      if (cost <= 0 || sellingPrice <= 0) return Promise.resolve();
      return addDoc(collection(getDb(), COLLECTIONS.costingSnapshots), {
        productId: recipe.productId,
        variantId: recipe.variantId || null,
        ingredientCost: cost,
        sellingPrice,
        foodCostPercent: (cost / sellingPrice) * 100,
        createdAt: now,
      });
    })
  );
}

function mapCostLink(id: string, data: Record<string, unknown>): ProductCostLink {
  const kind = data.kind;
  return {
    id,
    productId: String(data.productId ?? id),
    kind: kind === "resale" || kind === "combo" || kind === "estimate" ? kind : "recipe",
    recipeId: data.recipeId ? String(data.recipeId) : undefined,
    ingredientId: data.ingredientId ? String(data.ingredientId) : undefined,
    packQuantity: data.packQuantity == null ? null : asNumber(data.packQuantity),
    packUnit: data.packUnit ? (data.packUnit as PurchaseUnit) : undefined,
    estimateAmount: data.estimateAmount == null ? null : asNumber(data.estimateAmount),
    estimateNote: data.estimateNote ? String(data.estimateNote) : undefined,
    estimateAt: data.estimateAt ? String(data.estimateAt) : undefined,
    updatedAt: timestampToIso(data.updatedAt as never),
  };
}

export function subscribeToProductCostLinks(
  onData: (items: ProductCostLink[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.productCostLinks),
    (snap) => onData(snap.docs.map((item) => mapCostLink(item.id, item.data() as Record<string, unknown>))),
    (error) => onError?.(error.message)
  );
}

export async function saveProductCostLink(
  input: Omit<ProductCostLink, "id" | "updatedAt"> & { id?: string }
): Promise<ServiceResult<ProductCostLink>> {
  try {
    const id = input.id || input.productId;
    if (!id) return failure(new ServiceError("productId required", "VALIDATION"));
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      productId: input.productId,
      kind: input.kind,
      ...(input.recipeId !== undefined ? { recipeId: input.recipeId } : {}),
      ...(input.ingredientId !== undefined ? { ingredientId: input.ingredientId } : {}),
      ...(input.packQuantity !== undefined ? { packQuantity: input.packQuantity } : {}),
      ...(input.packUnit !== undefined ? { packUnit: input.packUnit } : {}),
      ...(input.estimateAmount !== undefined ? { estimateAmount: input.estimateAmount } : {}),
      ...(input.estimateNote !== undefined ? { estimateNote: input.estimateNote } : {}),
      ...(input.estimateAt !== undefined ? { estimateAt: input.estimateAt } : {}),
      updatedAt: now,
    });
    await setDoc(doc(getDb(), COLLECTIONS.productCostLinks, id), payload, { merge: true });
    return success(mapCostLink(id, { ...payload, updatedAt: now } as Record<string, unknown>));
  } catch (error) {
    return writeFailure(error, "Failed to save product cost link");
  }
}

export async function completeProductCost(input: {
  productId: string;
  kind: ProductCostKind;
  sellingPrice?: number;
  ingredients: CostingIngredient[];
  existingRecipeId?: string;
  lines?: RecipeLine[];
  ingredientId?: string;
  packPrice?: number;
  packQuantity?: number;
  packUnit?: PurchaseUnit;
  estimateAmount?: number;
  estimateNote?: string;
}): Promise<ServiceResult<{ recipeId?: string }>> {
  try {
    let recipeId = input.existingRecipeId;
    if (input.kind !== "estimate") {
      const lines = input.lines?.length
        ? input.lines
        : input.ingredientId
          ? [{ ingredientId: input.ingredientId, quantity: 1, unit: input.packUnit ?? "unit" }]
          : [];
      if (!lines.length) return failure(new ServiceError("lines required", "VALIDATION"));
      const saved = await saveDishRecipe(
        { id: recipeId, productId: input.productId, ingredients: lines },
        { sellingPrice: input.sellingPrice, ingredients: input.ingredients }
      );
      if (!saved.success) return saved;
      recipeId = saved.data.id;
    }
    if (input.ingredientId && input.packQuantity && input.packPrice != null) {
      const current = input.ingredients.find((item) => item.id === input.ingredientId);
      if (current) {
        await updateIngredient(input.ingredientId, {
          name: current.name,
          category: current.category,
          purchasePrice: input.packPrice,
          purchaseQuantity: input.packQuantity,
          purchaseUnit: input.packUnit ?? current.purchaseUnit,
          supplier: current.supplier,
          notes: current.notes,
          barcode: current.barcode,
          minStock: current.minStock,
          recommendedStock: current.recommendedStock,
          active: current.active,
        });
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const link = await saveProductCostLink({
      productId: input.productId,
      kind: input.kind,
      ...(input.kind === "estimate"
        ? {
            ...(input.existingRecipeId ? { recipeId: input.existingRecipeId } : {}),
            estimateAmount: input.estimateAmount,
            estimateNote: input.estimateNote,
            estimateAt: today,
          }
        : {
            recipeId,
            estimateAmount: null,
          }),
      ...(input.ingredientId
        ? {
            ingredientId: input.ingredientId,
            packQuantity: input.packQuantity,
            packUnit: input.packUnit,
          }
        : {}),
    });
    if (!link.success) return link;
    return success({ recipeId });
  } catch (error) {
    return writeFailure(error, "Failed to complete product cost");
  }
}
