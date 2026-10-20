import { collection, doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { categoryDocId, findCategoryByNormalizedName, normalizeCategoryName } from "@/lib/inventory/category-name";
import { mapCategoryRecord, type IngredientCategoryRecord } from "@/lib/inventory/category-record";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { failure, success, type ServiceResult } from "@/lib/errors";
import { nowTimestamp } from "@/types/firestore";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";

export type { IngredientCategoryRecord };

export type CategoryWrite = {
  name: string;
  nameAr?: string;
  nameEn?: string;
  description?: string;
  id?: string;
};

export function subscribeToIngredientCategories(
  onData: (names: string[]) => void,
  onError?: (error: string) => void
): Unsubscribe {
  try {
    return onSnapshot(
      collection(getDb(), COLLECTIONS.ingredientCategories),
      (snap) => {
        onData(
          snap.docs
            .map((item) => String(item.data().name ?? "").trim())
            .filter(Boolean)
        );
      },
      (error) => onError?.(error.message)
    );
  } catch (error) {
    onError?.(error instanceof Error ? error.message : "Failed to subscribe");
    return () => {};
  }
}

export function subscribeToIngredientCategoryDocs(
  onData: (rows: IngredientCategoryRecord[]) => void,
  onError?: (error: string) => void
): Unsubscribe {
  try {
    return onSnapshot(
      collection(getDb(), COLLECTIONS.ingredientCategories),
      (snap) => {
        onData(snap.docs.map((item) => mapCategoryRecord(item.id, item.data() as Record<string, unknown>)));
      },
      (error) => onError?.(error.message)
    );
  } catch (error) {
    onError?.(error instanceof Error ? error.message : "Failed to subscribe");
    return () => {};
  }
}

export async function saveIngredientCategory(input: CategoryWrite): Promise<ServiceResult<IngredientCategoryRecord>> {
  const trimmed = input.name.trim();
  if (!trimmed) return failure(new Error("VALIDATION"), "VALIDATION");
  const viaApi = await clientAdminFetch<{ category: IngredientCategoryRecord; name?: string }>(
    "/api/admin/inventory/ingredient-category",
    {
      id: input.id,
      name: trimmed,
      nameHe: trimmed,
      nameAr: input.nameAr ?? "",
      nameEn: input.nameEn ?? "",
      description: input.description ?? "",
    }
  );
  if (viaApi.ok && viaApi.data?.category) return success(viaApi.data.category);
  if (viaApi.code === "DUPLICATE") return failure(new Error("DUPLICATE"), "DUPLICATE");
  return failure(new Error(viaApi.error || "VALIDATION"), viaApi.code || "VALIDATION");
}

export async function archiveIngredientCategory(id: string): Promise<ServiceResult<void>> {
  const viaApi = await clientAdminFetch("/api/admin/inventory/ingredient-category", { id, archived: true });
  if (viaApi.ok) return success(undefined);
  return failure(new Error(viaApi.error || "FAILED"), viaApi.code || "FAILED");
}

export async function ensureIngredientCategory(
  name: string,
  existing: string[] = [],
  details?: Omit<CategoryWrite, "name" | "id">
): Promise<ServiceResult<string>> {
  const trimmed = name.trim();
  if (!trimmed) return failure(new Error("VALIDATION"), "VALIDATION");
  const match = findCategoryByNormalizedName(trimmed, existing);
  if (match) return success(match);
  const viaApi = await clientAdminFetch<{ name: string }>("/api/admin/inventory/ingredient-category", {
    name: trimmed,
    nameHe: trimmed,
    nameAr: details?.nameAr ?? "",
    nameEn: details?.nameEn ?? "",
    description: details?.description ?? "",
  });
  if (viaApi.ok && viaApi.data?.name) return success(viaApi.data.name);
  try {
    const normalized = normalizeCategoryName(trimmed);
    const id = categoryDocId(normalized);
    await setDoc(
      doc(getDb(), COLLECTIONS.ingredientCategories, id),
      sanitizeFirestoreData({
        name: trimmed,
        nameHe: trimmed,
        nameAr: details?.nameAr?.trim() || null,
        nameEn: details?.nameEn?.trim() || null,
        description: details?.description?.trim() || null,
        nameNormalized: normalized,
        archived: false,
        updatedAt: nowTimestamp(),
        createdAt: nowTimestamp(),
      }),
      { merge: true }
    );
    return success(trimmed);
  } catch (error) {
    return failure(error, viaApi.error || "Failed to save category");
  }
}
