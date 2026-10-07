"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SiteHeader } from "@/components/layout/header";
import { HeroBanner } from "@/features/catalog/hero-banner";
import { MenuCategoryStrip } from "@/features/catalog/menu-category-strip";
import { MobileCategoryDropdown } from "@/features/catalog/mobile-category-dropdown";
import { SubcategoryChips } from "@/features/catalog/subcategory-chips";
import { ProductFiltersBar } from "@/features/catalog/product-filters-bar";
import { ProductGrid } from "@/features/catalog/product-grid";
import { ProductDetailDrawer } from "@/features/catalog/product-detail-drawer";
import { CatalogModifierPreviewProvider } from "@/features/catalog/catalog-modifier-preview-context";
import { CatalogSeeder } from "@/components/catalog/catalog-seeder";
import { Input } from "@/components/ui/input";
import { useProducts, useAllProducts, useCategories } from "@/hooks/useProducts";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { useLocalizedCategory } from "@/hooks/useLocalizedContent";
import {
  filterMenuDisplayProducts,
  filterMenuProducts,
  getRootCategories,
  hasSubcategories,
  sortProducts,
} from "@/lib/menu/category-tree";
import type { Product, ProductFilters } from "@/types";

export function CatalogView() {
  const t = useT();
  const { dir } = useLocale();
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<ProductFilters>({
    sortBy: "popular",
    active: true,
  });
  const bannerTargetApplied = useRef(false);

  const { categories } = useCategories();
  const { products: allProducts, loading: allLoading } = useAllProducts();
  const rootCategories = useMemo(() => getRootCategories(categories), [categories]);

  useEffect(() => {
    if (bannerTargetApplied.current || (categories.length === 0 && allProducts.length === 0)) return;
    const params = new URLSearchParams(window.location.search);
    const categoryId = params.get("category");
    const productId = params.get("product");
    if (categoryId && categories.some((category) => category.id === categoryId)) {
      setSelectedCategoryId(categoryId);
      setSelectedSubcategoryId(null);
      bannerTargetApplied.current = true;
    } else if (productId) {
      const product = allProducts.find((item) => item.id === productId);
      if (product) {
        setSelectedProduct(product);
        bannerTargetApplied.current = true;
      }
    }
  }, [allProducts, categories]);

  useEffect(() => {
    if (bannerTargetApplied.current || selectedCategoryId || rootCategories.length === 0) return;
    setSelectedCategoryId(rootCategories[0]!.id);
  }, [rootCategories, selectedCategoryId]);

  const isSearchMode = searchQuery.trim().length > 0;

  const combinedFilters = useMemo<ProductFilters>(
    () => ({
      ...filters,
      search: searchQuery || undefined,
      categoryId: isSearchMode ? undefined : selectedCategoryId ?? undefined,
      subcategoryId: isSearchMode ? undefined : selectedSubcategoryId ?? undefined,
      active: true,
    }),
    [filters, searchQuery, isSearchMode, selectedCategoryId, selectedSubcategoryId]
  );

  const { products: searchProducts, loading: searchLoading } = useProducts(
    isSearchMode ? combinedFilters : undefined
  );

  const menuProducts = useMemo(() => {
    if (isSearchMode) return sortProducts(searchProducts);
    if (selectedSubcategoryId) {
      return sortProducts(
        filterMenuProducts(allProducts, selectedCategoryId, selectedSubcategoryId, categories)
      );
    }
    return filterMenuDisplayProducts(allProducts, selectedCategoryId, categories);
  }, [
    isSearchMode,
    searchProducts,
    allProducts,
    selectedCategoryId,
    selectedSubcategoryId,
    categories,
  ]);

  const desktopMenuProducts = useMemo(() => {
    if (isSearchMode) return menuProducts;
    return sortProducts(
      filterMenuProducts(allProducts, selectedCategoryId, selectedSubcategoryId, categories)
    );
  }, [
    isSearchMode,
    menuProducts,
    allProducts,
    selectedCategoryId,
    selectedSubcategoryId,
    categories,
  ]);

  const loading = isSearchMode ? searchLoading : allLoading;

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;
  const selectedSub = selectedSubcategoryId
    ? categories.find((c) => c.id === selectedSubcategoryId) ?? null
    : null;

  const heroCategory = selectedSub ?? selectedCategory;
  const localizedHero = useLocalizedCategory(heroCategory);

  const sectionTitle = useMemo(() => {
    if (isSearchMode) return t("catalog.fullMenu");
    return localizedHero.name || t("catalog.menuSection");
  }, [isSearchMode, localizedHero.name, t]);

  const showProducts =
    isSearchMode ||
    (selectedCategoryId &&
      (!hasSubcategories(categories, selectedCategoryId) || selectedSubcategoryId));

  const handleCategorySelect = useCallback((categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId(null);
    // Wait for category strip collapse/layout, then scroll to products.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById("menu")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }, []);

  const handleSubcategorySelect = useCallback((subcategoryId: string) => {
    setSelectedSubcategoryId(subcategoryId);
  }, []);

  const needsSubcategoryPick =
    !isSearchMode &&
    selectedCategoryId &&
    hasSubcategories(categories, selectedCategoryId) &&
    !selectedSubcategoryId;

  return (
    <CatalogModifierPreviewProvider>
    <>
      <CatalogSeeder />
      <SiteHeader />

      {isHome && <HeroBanner />}

      <div className="mx-auto max-w-[1280px] px-4 md:px-8 lg:px-10">
        <div className="mt-6">
          <div className="min-w-0 pb-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom,0px)+5.5rem)] md:pb-12">
            {!isSearchMode && (
              <div className="sticky top-12 z-30 -mx-4 bg-cream/95 px-4 py-2 backdrop-blur-md md:static md:top-auto md:mx-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
                <section className="space-y-2">
                  <MobileCategoryDropdown
                    selectedId={selectedCategoryId}
                    onSelect={handleCategorySelect}
                  />
                  <div className="hidden md:block">
                    <MenuCategoryStrip
                      selectedId={selectedCategoryId}
                      onSelect={handleCategorySelect}
                    />
                  </div>
                  <div className="hidden md:block">
                    <SubcategoryChips
                      parentId={selectedCategoryId}
                      selectedSubId={selectedSubcategoryId}
                      onSelect={handleSubcategorySelect}
                    />
                  </div>
                </section>
              </div>
            )}

            <div className="relative mt-3 hidden max-w-md md:block">
              <Search
                className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40"
                strokeWidth={1.75}
              />
              <Input
                placeholder={t("header.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t("header.search")}
                dir={dir}
                className="h-10 border-beige-dark/25 bg-warm-white ps-10 shadow-none"
              />
            </div>

            <div className="hidden md:block">
              <ProductFiltersBar
                filters={combinedFilters}
                onFiltersChange={setFilters}
                showFilters={showFilters}
                onToggleFilters={() => setShowFilters(!showFilters)}
              />
            </div>

            <div id="menu" className="mt-4 scroll-mt-28 md:mt-6 md:scroll-mt-8">
              <div className="mb-4 flex items-end justify-between gap-3">
                <h2 className="heading-section" dir={localizedHero.dir}>
                  {sectionTitle}
                </h2>
                {(isSearchMode || selectedCategoryId) && (
                  <span className="text-caption shrink-0 md:hidden">
                    {loading ? "..." : `${menuProducts.length} ${t("catalog.productsCount")}`}
                  </span>
                )}
                {showProducts && (
                  <span className="text-caption hidden shrink-0 md:inline">
                    {loading ? "..." : `${desktopMenuProducts.length} ${t("catalog.productsCount")}`}
                  </span>
                )}
              </div>

              <div className="md:hidden">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`mobile-${selectedCategoryId}-${searchQuery}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {selectedCategoryId || isSearchMode ? (
                      <ProductGrid
                        products={menuProducts}
                        loading={loading}
                        onProductClick={setSelectedProduct}
                      />
                    ) : (
                      <p className="text-body py-12 text-center">{t("catalog.pickCategory")}</p>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="hidden md:block">
                <AnimatePresence mode="wait">
                  {needsSubcategoryPick ? (
                    <motion.p
                      key="pick-sub"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-body py-12 text-center"
                    >
                      {t("catalog.pickSubcategory")}
                    </motion.p>
                  ) : showProducts ? (
                    <motion.div
                      key={`${selectedCategoryId}-${selectedSubcategoryId}-${searchQuery}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ProductGrid
                        products={desktopMenuProducts}
                        loading={loading}
                        onProductClick={setSelectedProduct}
                      />
                    </motion.div>
                  ) : (
                    <motion.p
                      key="pick-cat"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-body py-12 text-center"
                    >
                      {t("catalog.pickCategory")}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

        </div>
      </div>

      <ProductDetailDrawer
        product={selectedProduct}
        open={!!selectedProduct}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        onSelectProduct={setSelectedProduct}
      />

    </>
    </CatalogModifierPreviewProvider>
  );
}
