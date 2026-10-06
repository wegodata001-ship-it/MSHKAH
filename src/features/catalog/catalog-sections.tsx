"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
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
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/components/providers/locale-provider";
import { useLocalizedCategory } from "@/hooks/useLocalizedContent";
import { useCategories, useAllProducts } from "@/hooks/useProducts";
import { getProductCountByCategory } from "@/lib/menu/map-master-menu";
import { SECTION_ICONS, type SectionIconKey } from "@/lib/icons/section-icons";
import { ProductCard } from "./product-card";
import type { Category, Product } from "@/types";
import { cn } from "@/lib/utils";

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

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-5 px-4 md:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-turquoise/10 text-turquoise">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="heading-section">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-coffee/55">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

interface ProductCarouselProps {
  iconKey: SectionIconKey;
  title?: string;
  titleKey?: string;
  subtitle?: string;
  subtitleKey?: string;
  products: Product[];
  onProductClick: (product: Product) => void;
}

export function ProductCarousel({
  iconKey,
  title,
  titleKey,
  subtitle,
  subtitleKey,
  products,
  onProductClick,
}: ProductCarouselProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const Icon = SECTION_ICONS[iconKey];
  const displayTitle = titleKey ? t(titleKey) : (title ?? "");
  const displaySubtitle = subtitleKey ? t(subtitleKey) : subtitle;

  if (products.length === 0) return null;

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -300 : 300, behavior: "smooth" });
  };

  return (
    <section className="py-8">
      <div className="mb-5 flex items-end justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-turquoise/10 text-turquoise">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="heading-section">{displayTitle}</h2>
            {displaySubtitle && <p className="mt-1 text-sm text-coffee/55">{displaySubtitle}</p>}
          </div>
        </div>
        <div className="hidden shrink-0 gap-2 md:flex">
          <button
            type="button"
            onClick={() => scroll("left")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-beige-dark/25 bg-warm-white shadow-soft transition-all hover:scale-105 hover:shadow-elevated"
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-beige-dark/25 bg-warm-white shadow-soft transition-all hover:scale-105 hover:shadow-elevated"
            aria-label="Scroll right"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="hide-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 md:gap-5 md:px-6"
      >
        {products.map((product, index) => (
          <motion.div
            key={product.id}
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.03 }}
            className="w-[240px] shrink-0 snap-start md:w-[280px]"
          >
            <ProductCard product={product} index={index} onClick={() => onProductClick(product)} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function CategoryCard({
  cat,
  count,
  selected,
  index,
  onSelect,
}: {
  cat: Category;
  count: number;
  selected: string;
  index: number;
  onSelect: (categoryId: string) => void;
}) {
  const t = useT();
  const localized = useLocalizedCategory(cat);
  const Icon = iconMap[cat.icon] ?? Coffee;
  const isActive = selected === cat.id;

  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.04 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(cat.id)}
      className={cn(
        "group relative flex h-40 w-44 shrink-0 flex-col justify-end overflow-hidden rounded-2xl shadow-soft ring-1 ring-beige-dark/15 transition-shadow duration-300 hover:shadow-elevated md:h-44 md:w-48",
        isActive && "ring-2 ring-turquoise ring-offset-2 ring-offset-cream"
      )}
    >
      {cat.image ? (
        <Image
          src={cat.image}
          alt={localized.name}
          fill
          className="object-cover transition-transform duration-700 group-hover:scale-110"
          sizes="200px"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-coffee to-dark-brown" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-dark-brown/95 via-dark-brown/40 to-transparent" />
      <Icon className="absolute top-4 end-4 h-6 w-6 text-warm-white/90 drop-shadow" strokeWidth={1.75} />
      <div className="relative p-4 text-start">
        <p className="text-sm font-bold text-warm-white md:text-base" dir={localized.dir}>
          {localized.name}
        </p>
        <p className="mt-0.5 text-xs text-warm-white/75">
          {count} {t("catalog.productsCount")}
        </p>
      </div>
    </motion.button>
  );
}

interface CategoryGridProps {
  selected: string;
  onSelect: (categoryId: string) => void;
}

export function CategoryGrid({ selected, onSelect }: CategoryGridProps) {
  const t = useT();
  const { categories, loading } = useCategories();
  const { products } = useAllProducts();

  if (loading) {
    return (
      <div className="hide-scrollbar flex gap-4 overflow-x-auto px-4 py-6 md:px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-44 shrink-0 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <section className="py-6">
      <SectionHeader icon={SECTION_ICONS.categories} title={t("catalog.categories")} />
      <div className="hide-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:px-6">
        <motion.button
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect("all")}
          className={cn(
            "relative flex h-40 w-44 shrink-0 snap-start flex-col justify-end overflow-hidden rounded-2xl p-4 shadow-soft ring-1 ring-beige-dark/15 transition-shadow hover:shadow-elevated md:h-44 md:w-48",
            selected === "all" && "ring-2 ring-turquoise ring-offset-2 ring-offset-cream"
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-coffee to-dark-brown" />
          <LayoutGrid className="absolute top-4 end-4 h-6 w-6 text-warm-white/80" strokeWidth={1.75} />
          <div className="relative text-start">
            <p className="text-sm font-bold text-warm-white">{t("catalog.all")}</p>
            <p className="text-xs text-warm-white/70">
              {products.length} {t("catalog.productsCount")}
            </p>
          </div>
        </motion.button>

        {categories.map((cat, index) => (
          <CategoryCard
            key={cat.id}
            cat={cat}
            count={getProductCountByCategory(products, cat.id)}
            selected={selected}
            index={index}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

export function filterProductsByCategories(products: Product[], categoryIds: string[]): Product[] {
  return products.filter((p) => categoryIds.includes(p.categoryId));
}
