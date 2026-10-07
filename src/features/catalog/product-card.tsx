"use client";

import { motion } from "framer-motion";
import { Heart, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPrice, cn } from "@/lib/utils";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { useLocalizedProduct } from "@/hooks/useLocalizedContent";
import { useCart } from "@/features/cart/cart-context";
import { useFavorites } from "@/hooks/useFavorites";
import { ProductImage } from "@/components/catalog/product-image";
import { ProductModifiersTeaser } from "@/features/catalog/product-modifiers-teaser";
import { useProductModifierPreview } from "@/features/catalog/catalog-modifier-preview-context";
import type { Product } from "@/types";

interface ProductCardProps {
  product: Product;
  index?: number;
  onClick?: () => void;
}

export function ProductCard({ product, index = 0, onClick }: ProductCardProps) {
  const t = useT();
  const { dir } = useLocale();
  const localized = useLocalizedProduct(product);
  const { addItem, openCart } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const modifierPreview = useProductModifierPreview(product.id);

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!product.available) return;
    if (onClick) {
      onClick();
      return;
    }
    addItem(product);
    if (window.innerWidth < 1024) openCart();
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(product.id);
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-20px" }}
      transition={{ delay: (index % 8) * 0.03, duration: 0.28 }}
      onClick={onClick}
      dir={dir}
      className={cn(
        "group flex h-full cursor-pointer flex-col overflow-hidden rounded-[22px] bg-warm-white",
        "ring-1 ring-black/[0.05] shadow-[0_4px_18px_rgba(60,40,20,0.06)]",
        "transition-[transform,box-shadow] duration-300",
        "hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(60,40,20,0.11)]",
        !product.available && "opacity-55"
      )}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-beige/35">
        <ProductImage
          image={product.image}
          categoryId={product.categoryId}
          alt={localized.name}
          priority={index < 2}
          sizes="(max-width: 639px) 100vw, min(50vw, 640px)"
          className="object-center transition-transform duration-500 ease-out group-hover:scale-[1.02]"
        />
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={t("catalog.favorite")}
          className="absolute top-2 end-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-warm-white/90 text-coffee/35 shadow-soft backdrop-blur-[2px] transition-colors hover:text-gold"
        >
          <Heart
            className={cn("h-3.5 w-3.5", isFavorite(product.id) && "fill-gold text-gold")}
            strokeWidth={1.75}
          />
        </button>
        {(product.isNew || product.isPopular) && (
          <div className="absolute start-2 top-2 z-10 flex flex-wrap gap-1">
            {product.isNew && (
              <Badge variant="new" className="px-1.5 py-0 text-[10px]">
                {t("catalog.newBadge")}
              </Badge>
            )}
            {product.isPopular && (
              <Badge variant="popular" className="px-1.5 py-0 text-[10px]">
                {t("catalog.popularBadge")}
              </Badge>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
        <h3
          className="font-display text-[15px] font-bold leading-snug text-dark-brown sm:text-lg dark:text-warm-white"
          dir={localized.dir}
        >
          {localized.name}
        </h3>
        {localized.description && (
          <p
            className="text-description mt-1.5 line-clamp-2 text-[13px] leading-relaxed sm:line-clamp-3 sm:text-sm"
            dir={localized.dir}
          >
            {localized.description}
          </p>
        )}
        <ProductModifiersTeaser groups={modifierPreview} />
        {!product.available && (
          <p className="text-caption mt-1">{t("catalog.unavailable")}</p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span dir="ltr" className="text-price text-base tabular-nums sm:text-lg md:text-xl">
            {formatPrice(product.price)}
          </span>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!product.available}
            aria-label={t("catalog.addToCart")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-turquoise text-warm-white shadow-soft transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 sm:h-11 sm:w-11"
          >
            <Plus className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </motion.article>
  );
}
