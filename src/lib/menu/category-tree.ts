import type { Category, Product } from "@/types";

export function isPublicMenuCategory(category: Category): boolean {
  if (!category.active) return false;
  const names = [category.name_en, category.name_he, category.name_ar].map((name) =>
    (name ?? "").trim().toUpperCase()
  );
  return !names.includes("TEST") && category.id.trim().toUpperCase() !== "TEST";
}

export function getRootCategories(categories: Category[]): Category[] {
  return categories
    .filter((c) => !c.parentId && isPublicMenuCategory(c))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Compact category preview: first N roots, always including the active
 * category (swapped into the last slot when it would otherwise be hidden).
 */
export function getCollapsedVisibleCategories<T extends { id: string }>(
  roots: T[],
  selectedId: string | null,
  limit: number
): T[] {
  if (limit <= 0) return [];
  if (roots.length <= limit) return roots;

  const head = roots.slice(0, limit);
  if (!selectedId || head.some((c) => c.id === selectedId)) return head;

  const selected = roots.find((c) => c.id === selectedId);
  if (!selected) return head;

  return [...head.slice(0, Math.max(0, limit - 1)), selected];
}

export function getSubcategories(categories: Category[], parentId: string): Category[] {
  return categories
    .filter((c) => c.parentId === parentId && c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function hasSubcategories(categories: Category[], parentId: string): boolean {
  return categories.some((c) => c.parentId === parentId && c.active);
}

export function getRootCategoriesForAdmin(categories: Category[]): Category[] {
  return categories
    .filter((c) => !c.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isPublicMenuProduct(product: Product): boolean {
  if (!product.active || product.hidden || product.isTestProduct) return false;
  const names = [product.name_en, product.name_he, product.name_ar].map((name) =>
    (name ?? "").trim().toUpperCase()
  );
  return !names.includes("TEST");
}

/** Total active products under a root category (direct + via subcategories) */
export function countProductsInCategory(
  products: Product[],
  categoryId: string,
  categories: Category[]
): number {
  const subIds = new Set(
    categories.filter((c) => c.parentId === categoryId).map((c) => c.id)
  );
  return products.filter((p) => {
    if (!isPublicMenuProduct(p)) return false;
    if (p.categoryId !== categoryId) return false;
    if (p.subcategoryId) return subIds.has(p.subcategoryId);
    return true;
  }).length;
}

export function countProductsInSubcategory(products: Product[], subcategoryId: string): number {
  return products.filter((p) => isPublicMenuProduct(p) && p.subcategoryId === subcategoryId).length;
}

export function filterMenuProducts(
  products: Product[],
  categoryId: string | null,
  subcategoryId: string | null,
  categories: Category[]
): Product[] {
  const active = products.filter(isPublicMenuProduct);

  if (!categoryId) return active;

  if (subcategoryId) {
    return active.filter((p) => p.subcategoryId === subcategoryId);
  }

  if (hasSubcategories(categories, categoryId)) {
    return [];
  }

  return active.filter((p) => p.categoryId === categoryId && !p.subcategoryId);
}

/** Digital menu display: show ALL products for a root category (including subcategories). */
export function filterMenuDisplayProducts(
  products: Product[],
  categoryId: string | null,
  categories: Category[]
): Product[] {
  const active = products.filter(isPublicMenuProduct);
  if (!categoryId) return sortProducts(active);

  const childIds = new Set(
    categories.filter((c) => c.parentId === categoryId && c.active).map((c) => c.id)
  );

  return sortProducts(
    active.filter(
      (p) =>
        p.categoryId === categoryId ||
        childIds.has(p.categoryId) ||
        (p.subcategoryId != null && childIds.has(p.subcategoryId))
    )
  );
}

export function sortProducts(products: Product[]): Product[] {
  return [...products].sort(
    (a, b) =>
      Number(b.isPopular) - Number(a.isPopular) ||
      a.sortOrder - b.sortOrder
  );
}
