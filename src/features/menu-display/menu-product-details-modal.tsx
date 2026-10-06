"use client";

import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductImage } from "@/components/catalog/product-image";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { useLocalizedProduct } from "@/hooks/useLocalizedContent";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useProductModifierPreview } from "@/features/catalog/catalog-modifier-preview-context";
import {
  formatSelectionHint,
  type ModifierPreviewGroup,
} from "@/lib/menu/modifier-preview";
import { formatPrice, cn } from "@/lib/utils";
import type { Product } from "@/types";

function ModifierGroupSection({ group }: { group: ModifierPreviewGroup }) {
  const t = useT();
  const hint = formatSelectionHint(group, {
    chooseOne: t("catalog.chooseOne", "בחירה אחת"),
    chooseExact: (n) =>
      t("catalog.chooseExact", "בחירת {n}").replace("{n}", String(n)),
    chooseUpTo: (n) =>
      t("catalog.chooseUpTo", "בחירה עד {n}").replace("{n}", String(n)),
  });

  return (
    <section className="space-y-2.5">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-dark-brown dark:text-warm-white">
          {group.groupName}
        </h3>
        {hint ? (
          <p className="mt-0.5 text-xs text-coffee/50 dark:text-warm-white/45">{hint}</p>
        ) : null}
      </div>
      <ul className="space-y-2" aria-label={group.groupName}>
        {group.options.map((option) => (
          <li
            key={option.id}
            className="flex items-center justify-between gap-3 rounded-xl bg-beige/45 px-3.5 py-3 text-[14px] leading-snug text-dark-brown ring-1 ring-beige-dark/10 dark:bg-white/[0.04] dark:text-warm-white dark:ring-white/8"
          >
            <span className="min-w-0 flex-1 font-medium">{option.name}</span>
            {option.priceDelta > 0 ? (
              <span className="shrink-0 font-semibold tabular-nums text-turquoise">
                +{formatPrice(option.priceDelta)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MenuProductDetailsBody({ product }: { product: Product }) {
  const localized = useLocalizedProduct(product);
  const groups = useProductModifierPreview(product.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-beige/40 dark:bg-white/5 sm:aspect-[2/1]">
        <ProductImage
          image={product.image}
          categoryId={product.categoryId}
          alt={localized.name}
          className="object-cover"
          sizes="(max-width:768px) 100vw, 640px"
          priority
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        <div className="space-y-2" dir={localized.dir}>
          <h2 className="font-display text-2xl font-bold leading-snug text-dark-brown dark:text-warm-white">
            {localized.name}
          </h2>
          {localized.description?.trim() ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-coffee/75 dark:text-warm-white/70">
              {localized.description}
            </p>
          ) : null}
          <p className="pt-1 text-2xl font-bold tabular-nums text-turquoise">
            {formatPrice(product.price)}
          </p>
        </div>

        {groups.length > 0 ? (
          <div className="mt-6 divide-y divide-beige-dark/15 dark:divide-white/10">
            {groups.map((group) => (
              <div key={group.groupId} className="py-5 first:pt-0 last:pb-1">
                <ModifierGroupSection group={group} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface MenuProductDetailsModalProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * MENU DISPLAY only — read-only product details (no cart / selection).
 * Ordering continues to use ProductDetailDrawer.
 */
export function MenuProductDetailsModal({
  product,
  open,
  onOpenChange,
}: MenuProductDetailsModalProps) {
  const t = useT();
  const { dir } = useLocale();
  const isMobile = useIsMobile(768);

  const closeButton = (
    <button
      type="button"
      onClick={() => onOpenChange(false)}
      aria-label={t("common.close", "סגור")}
      className="absolute end-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-warm-white/95 text-dark-brown shadow-soft ring-1 ring-beige-dark/15 dark:bg-[#1a1412]/95 dark:text-warm-white dark:ring-white/10"
    >
      <X className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );

  const body = product ? (
    <>
      <DialogHeader className="sr-only">
        <DialogTitle>{product.name_he || product.name_en || product.name_ar}</DialogTitle>
        <DialogDescription>
          {product.description_he || product.description_en || product.description_ar || ""}
        </DialogDescription>
      </DialogHeader>
      <MenuProductDetailsBody key={product.id} product={product} />
    </>
  ) : null;

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          layout="custom"
          dir={dir}
          className={cn(
            "inset-x-0 bottom-0 top-auto flex max-h-[90dvh] w-full max-w-none flex-col overflow-hidden rounded-t-3xl border-0 p-0 shadow-elevated",
            "pb-[env(safe-area-inset-bottom,0px)]",
          )}
          hideCloseButton
          style={{ backgroundColor: "#FFFFFF" }}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-beige-dark/45" aria-hidden />
          {closeButton}
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={dir}
        hideCloseButton
        className={cn(
          "flex gap-0 overflow-hidden p-0",
          "h-auto max-h-[min(860px,calc(100dvh-48px))] w-[min(640px,calc(100vw-40px))] max-w-[640px]"
        )}
      >
        {closeButton}
        {body}
      </DialogContent>
    </Dialog>
  );
}
