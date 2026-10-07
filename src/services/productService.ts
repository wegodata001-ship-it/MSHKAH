import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  type Unsubscribe,
  type DocumentData,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { ServiceError, type ServiceResult, success, failure } from "@/lib/errors";
import { mapProduct } from "@/lib/mappers";
import { productSchema, type ProductInput } from "@/lib/validation/schemas";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { nowTimestamp } from "@/types/firestore";
import type { Product, ProductFilters } from "@/types";
import { isPublicMenuProduct } from "@/lib/menu/category-tree";
import type { FirestoreProduct, FirestoreDoc } from "@/types/firestore";

function docToProduct(id: string, data: DocumentData): FirestoreDoc<FirestoreProduct> {
  return { id, ...(data as FirestoreProduct) };
}

function applyFilters(items: Product[], filters?: ProductFilters): Product[] {
  let result = [...items];

  if (filters?.categoryId && filters.categoryId !== "all") {
    if (filters.subcategoryId) {
      result = result.filter((p) => p.subcategoryId === filters.subcategoryId);
    } else {
      result = result.filter(
        (p) => p.categoryId === filters.categoryId && !p.subcategoryId
      );
    }
  }

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (p) =>
        p.name_he.includes(filters.search!) ||
        p.name_ar.includes(filters.search!) ||
        p.name_en.toLowerCase().includes(q) ||
        p.description_he.includes(filters.search!) ||
        p.description_ar.includes(filters.search!) ||
        p.description_en.toLowerCase().includes(q)
    );
  }

  if (filters?.minPrice !== undefined) {
    result = result.filter((p) => p.price >= filters.minPrice!);
  }

  if (filters?.maxPrice !== undefined) {
    result = result.filter((p) => p.price <= filters.maxPrice!);
  }

  if (filters?.isPopular) {
    result = result.filter((p) => p.isPopular);
  }

  if (filters?.isNew) {
    result = result.filter((p) => p.isNew);
  }

  if (filters?.available !== undefined) {
    result = result.filter((p) => p.available === filters.available);
  }

  if (filters?.active !== undefined) {
    result = result.filter((p) => p.active === filters.active);
  }
  if (filters?.active === true) {
    result = result.filter(isPublicMenuProduct);
  }

  switch (filters?.sortBy) {
    case "price-asc":
      result.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      result.sort((a, b) => b.price - a.price);
      break;
    case "name-asc":
      result.sort((a, b) => a.name_en.localeCompare(b.name_en));
      break;
    case "popular":
      result.sort((a, b) => Number(b.isPopular) - Number(a.isPopular));
      break;
    case "newest":
    default:
      result.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      break;
  }

  return result;
}

async function fetchAllProducts(): Promise<Product[]> {
  const db = getDb();
  const q = query(
    collection(db, COLLECTIONS.products),
    orderBy("sortOrder", "asc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => mapProduct(docToProduct(d.id, d.data())));
}

/** Every product in the collection, including hidden/inactive. No orderBy so docs without sortOrder are not dropped. */
export async function getAllProductsForExport(): Promise<Product[]> {
  try {
    const db = getDb();
    const snapshot = await getDocs(collection(db, COLLECTIONS.products));
    return snapshot.docs
      .map((d) => mapProduct(docToProduct(d.id, d.data())))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name_he.localeCompare(b.name_he, "he"));
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch products for export",
      "PRODUCTS_EXPORT_READ_FAILED"
    );
  }
}

export async function getProducts(filters?: ProductFilters): Promise<Product[]> {
  try {
    const products = await fetchAllProducts();
    return applyFilters(products, filters);
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch products",
      "PRODUCTS_READ_FAILED"
    );
  }
}

export async function getProductById(id: string): Promise<Product | undefined> {
  try {
    const db = getDb();
    const snap = await getDoc(doc(db, COLLECTIONS.products, id));
    if (!snap.exists()) return undefined;
    return mapProduct(docToProduct(snap.id, snap.data()));
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch product",
      "PRODUCT_READ_FAILED"
    );
  }
}

export async function getPopularProducts(limit = 6): Promise<Product[]> {
  const products = await getProducts({ isPopular: true, available: true });
  return products.slice(0, limit);
}

export function subscribeToProducts(
  filters: ProductFilters | undefined,
  onData: (products: Product[]) => void,
  onError: (error: string) => void
): Unsubscribe {
  try {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.products),
      orderBy("sortOrder", "asc")
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const products = snapshot.docs.map((d) =>
          mapProduct(docToProduct(d.id, d.data()))
        );
        onData(applyFilters(products, filters));
      },
      (error) => {
        const message = error instanceof Error ? error.message : "Failed to subscribe to products";
        console.error("[Products] subscribeToProducts failed:", message);
        onError(message);
      }
    );
  } catch (error) {
    onError(error instanceof Error ? error.message : "Failed to subscribe to products");
    return () => {};
  }
}

export async function createProduct(input: ProductInput): Promise<ServiceResult<Product>> {
  try {
    const parsed = productSchema.parse(input);
    const db = getDb();
    const now = nowTimestamp();
    const ref = await addDoc(collection(db, COLLECTIONS.products), sanitizeFirestoreData({
      ...parsed,
      subcategoryId: parsed.subcategoryId || null,
      createdAt: now,
      updatedAt: now,
    }));
    return success(
      mapProduct(
        docToProduct(ref.id, {
          ...parsed,
          subcategoryId: parsed.subcategoryId || null,
          createdAt: now,
          updatedAt: now,
        })
      )
    );
  } catch (error) {
    return failure(error, "Failed to create product");
  }
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>
): Promise<ServiceResult<Product>> {
  try {
    const db = getDb();
    const ref = doc(db, COLLECTIONS.products, id);
    await updateDoc(ref, sanitizeFirestoreData({
      ...input,
      ...(input.subcategoryId === "" ? { subcategoryId: null } : {}),
      updatedAt: nowTimestamp(),
    }));
    return success({ id } as Product);
  } catch (error) {
    return failure(error, "Failed to update product");
  }
}

export async function deleteProduct(id: string): Promise<ServiceResult<void>> {
  try {
    const db = getDb();
    await deleteDoc(doc(db, COLLECTIONS.products, id));
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to delete product");
  }
}

export async function reorderProducts(
  orderedIds: string[]
): Promise<ServiceResult<void>> {
  try {
    const db = getDb();
    await Promise.all(
      orderedIds.map((id, index) =>
        updateDoc(doc(db, COLLECTIONS.products, id), { sortOrder: index + 1 })
      )
    );
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to reorder products");
  }
}

export async function readOneProductForTest(): Promise<ServiceResult<Product | null>> {
  try {
    const products = await fetchAllProducts();
    return success(products[0] ?? null);
  } catch (error) {
    return failure(error, "Product read test failed");
  }
}

export { applyFilters };
