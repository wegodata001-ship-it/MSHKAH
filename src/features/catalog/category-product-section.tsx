"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Coffee,
  GlassWater,
  Citrus,
  Milk,
  Snowflake,
  EggFried,
  Sandwich,
  Salad,
  Utensils,
  Croissant,
  Cake,
  IceCream,
  type LucideIcon,
} from "lucide-react";
import { ProductCard } from "@/features/catalog/product-card";
import { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
import { useT } from "@/components/providers/locale-provider";
import { useLocalizedCategory } from "@/hooks/useLocalizedContent";
import type { Category, Product } from "@/types";

const iconMap: Record<string, LucideIcon> = {
  coffee: Coffee,
  "glass-water": GlassWater,
  citrus: Citrus,
  milk: Milk,
  snowflake: Snowflake,
  "egg-fried": EggFried,
  sandwich: Sandwich,
  salad: Salad,
  utensils: Utensils,
  croissant: Croissant,
  cake: Cake,
  "ice-cream": IceCream,
};

interface CategoryProductSectionProps {
  category: Category;
  products: Product[];
  onProductClick: (product: Product) => void;
}

export function CategoryProductSection({
  category,
  products,
  onProductClick,
}: CategoryProductSectionProps) {
  const t = useT();
  const localized = useLocalizedCategory(category);

  if (products.length === 0) return null;

  const Icon = iconMap[category.icon] ?? Coffee;

  return (
    <section id={`category-${category.id}`} className="scroll-mt-36 py-4 md:py-5">
      <div className="mb-3 px-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-turquoise/10 text-turquoise">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="heading-section" dir={localized.dir}>
              {localized.name}
            </h2>
            <p className="mt-0.5 text-sm text-coffee/55">
              {products.length} {t("catalog.productsCount")}
            </p>
          </div>
        </div>
      </div>

      <div className={CATALOG_GRID_CLASS}>
        <AnimatePresence mode="popLayout">
          {products.map((product, index) => (
            <motion.div
              key={product.id}
              layout
              className="h-full min-w-0"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                delay: Math.min(index, 8) * 0.04,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <ProductCard
                product={product}
                index={index}
                onClick={() => onProductClick(product)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

export { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
