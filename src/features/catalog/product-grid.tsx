"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ProductCard } from "./product-card";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/components/providers/locale-provider";
import { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
import { Search } from "lucide-react";
import type { Product } from "@/types";

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  onProductClick?: (product: Product) => void;
}

export function ProductGrid({
  products,
  loading,
  onProductClick,
}: ProductGridProps) {
  const t = useT();

  if (loading) {
    return <ProductGridSkeleton count={4} />;
  }

  if (products.length === 0) {
    return (
      <div className="mx-4 md:mx-6">
        <EmptyState
          icon={Search}
          title={t("catalog.noProducts")}
          description={t("catalog.noProductsHint")}
          actionLabel={t("cart.continueShopping")}
          actionHref="/"
        />
      </div>
    );
  }

  return (
    <div className={CATALOG_GRID_CLASS}>
      <AnimatePresence mode="popLayout">
        {products.map((product, index) => (
          <motion.div
            key={product.id}
            layout
            className="h-full min-w-0"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              duration: 0.3,
              delay: Math.min(index, 8) * 0.03,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <ProductCard
              product={product}
              index={index}
              onClick={onProductClick ? () => onProductClick(product) : undefined}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
