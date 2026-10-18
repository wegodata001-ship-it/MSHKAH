import { collection, doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { categoryDocId, findCategoryByNormalizedName, normalizeCategoryName } from "@/lib/inventory/category-name";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { failure, success, type ServiceResult } from "@/lib/errors";
import { nowTimestamp } from "@/types/firestore";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";

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

export async function ensureIngredientCategory(
  name: string,
  existing: string[] = []
): Promise<ServiceResult<string>> {
  const trimmed = name.trim();
  if (!trimmed) return failure(new Error("VALIDATION"), "VALIDATION");
  const match = findCategoryByNormalizedName(trimmed, existing);
  if (match) return success(match);
  const viaApi = await clientAdminFetch<{ name: string }>("/api/admin/inventory/ingredient-category", { name: trimmed });
  if (viaApi.ok && viaApi.data?.name) return success(viaApi.data.name);
  try {
    const normalized = normalizeCategoryName(trimmed);
    const id = categoryDocId(normalized);
    await setDoc(
      doc(getDb(), COLLECTIONS.ingredientCategories, id),
      sanitizeFirestoreData({
        name: trimmed,
        nameNormalized: normalized,
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
