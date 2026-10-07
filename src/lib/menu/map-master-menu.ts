import {
  masterMenuCategories,
  masterMenuProducts,
  MASTER_MENU_STATS,
} from "@/data/master-menu";
import type { Product, Category, ProductFilters } from "@/types";
import { isPublicMenuProduct } from "@/lib/menu/category-tree";

const SEED_ISO = "2026-01-01T00:00:00.000Z";

export function mapMasterMenuCategories(): Category[] {
  return masterMenuCategories.map((c) => ({
    id: c.id,
    name_he: c.nameHe,
    name_ar: c.nameAr,
    name_en: c.nameEn,
    icon: c.icon,
    image: c.image,
    color: "#8B6914",
    sortOrder: c.sortOrder,
    active: c.active,
  }));
}

export function mapMasterMenuProducts(): Product[] {
  return masterMenuProducts.map((p) => ({
    id: p.id,
    name_he: p.nameHe,
    name_ar: p.nameAr,
    name_en: p.nameEn,
    description_he: p.descriptionHe,
    description_ar: p.descriptionAr,
    description_en: p.descriptionEn,
    categoryId: p.categoryId,
    price: p.price,
    cost: p.cost,
    profit: p.profit,
    businessType: p.businessType,
    image: p.image,
    isPopular: p.popular,
    isNew: p.sortOrder <= 3,
    available: p.available,
    active: p.active,
    sortOrder: p.sortOrder,
    createdAt: SEED_ISO,
    updatedAt: SEED_ISO,
  }));
}

export function applyProductFilters(
  products: Product[],
  filters?: ProductFilters
): Product[] {
  let result = products.filter((p) =>
    filters?.active === true ? isPublicMenuProduct(p) : p.active !== false
  );

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
        p.name_he.includes(q) ||
        p.name_ar.includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.description_he.includes(q) ||
        p.description_ar.includes(q) ||
        p.description_en.toLowerCase().includes(q)
    );
  }
  if (filters?.available !== undefined) {
    result = result.filter((p) => p.available === filters.available);
  }
  if (filters?.isPopular) {
    result = result.filter((p) => p.isPopular);
  }
  if (filters?.isNew) {
    result = result.filter((p) => p.isNew);
  }
  if (filters?.minPrice !== undefined) {
    result = result.filter((p) => p.price >= filters.minPrice!);
  }
  if (filters?.maxPrice !== undefined) {
    result = result.filter((p) => p.price <= filters.maxPrice!);
  }

  switch (filters?.sortBy) {
    case "price-asc":
      result.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      result.sort((a, b) => b.price - a.price);
      break;
    case "name-asc":
      result.sort((a, b) => a.name_he.localeCompare(b.name_he));
      break;
    case "newest":
      result.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      break;
    case "popular":
    default:
      result.sort((a, b) => {
        if (a.isPopular !== b.isPopular) return a.isPopular ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      });
  }

  return result;
}

export function getProductCountByCategory(
  products: Product[],
  categoryId: string
): number {
  return products.filter((p) => p.categoryId === categoryId).length;
}

export { MASTER_MENU_STATS };
