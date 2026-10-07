import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPublicMenuCategory, isPublicMenuProduct } from "@/lib/menu/category-tree";
import type { Category, Product } from "@/types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name_he: "קפה",
    name_ar: "قهوة",
    name_en: "Coffee",
    description_he: "",
    description_ar: "",
    description_en: "",
    categoryId: "drinks",
    price: 12,
    cost: 4,
    profit: 8,
    businessType: "beverage",
    image: "",
    isPopular: false,
    isNew: false,
    available: true,
    active: true,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isPublicMenuProduct", () => {
  it("keeps a normal active product", () => {
    expect(isPublicMenuProduct(product())).toBe(true);
  });

  it("hides inactive, hidden, flagged, or TEST-named products", () => {
    expect(isPublicMenuProduct(product({ active: false }))).toBe(false);
    expect(isPublicMenuProduct(product({ hidden: true }))).toBe(false);
    expect(isPublicMenuProduct(product({ isTestProduct: true }))).toBe(false);
    expect(isPublicMenuProduct(product({ name_en: "TEST", name_he: "TEST", name_ar: "TEST" }))).toBe(
      false
    );
  });
});

describe("isPublicMenuCategory", () => {
  const category = (overrides: Partial<Category> = {}): Category => ({
    id: "drinks",
    name_he: "שתייה",
    name_ar: "مشروبات",
    name_en: "Drinks",
    icon: "coffee",
    image: "",
    color: "#8B6914",
    sortOrder: 1,
    active: true,
    ...overrides,
  });

  it("hides the TEST category from the public menu", () => {
    expect(isPublicMenuCategory(category())).toBe(true);
    expect(isPublicMenuCategory(category({ id: "test", name_en: "TEST", name_he: "TEST", name_ar: "TEST" }))).toBe(
      false
    );
  });
});

describe("mobile catalog UX", () => {
  const dropdown = readFileSync(
    resolve(process.cwd(), "src/features/catalog/mobile-category-dropdown.tsx"),
    "utf8"
  );
  const view = readFileSync(resolve(process.cwd(), "src/features/catalog/catalog-view.tsx"), "utf8");
  const header = readFileSync(resolve(process.cwd(), "src/components/layout/header.tsx"), "utf8");

  it("uses an overlay dropdown instead of in-flow expansion", () => {
    expect(dropdown).toMatch(/absolute/);
    expect(dropdown).toMatch(/max-h-\[55vh\]/);
    expect(dropdown).toMatch(/overflow-y-auto/);
    expect(dropdown).toMatch(/Escape/);
    expect(dropdown).toMatch(/data-category-dropdown/);
    expect(dropdown).toMatch(/aria-expanded/);
    expect(dropdown).toMatch(/rotate-180/);
  });

  it("wires the dropdown on mobile only and keeps the desktop strip", () => {
    expect(view).toMatch(/MobileCategoryDropdown/);
    expect(view).toMatch(/hidden md:block/);
    expect(view).toMatch(/MenuCategoryStrip/);
    expect(view).toMatch(/sticky top-12/);
    expect(view).toMatch(/mobile-bottom-nav-height/);
    expect(view).toMatch(/safe-area-inset-bottom/);
    expect(view).not.toMatch(/window\.location\.reload/);
  });

  it("keeps the mobile header compact and slightly smaller on scroll", () => {
    expect(header).toMatch(/h-14 md:h-20/);
    expect(header).toMatch(/scrolled && "h-12 shadow-soft md:h-20"/);
  });
});
