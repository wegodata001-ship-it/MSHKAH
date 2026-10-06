"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-beige/60",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.8s_infinite] before:bg-gradient-to-r before:from-transparent before:via-warm-white/40 before:to-transparent",
        className
      )}
      {...props}
    />
  );
}

function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[22px] bg-warm-white ring-1 ring-black/[0.05]">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-3 sm:p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <div className="flex items-center justify-between pt-3">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={CATALOG_GRID_CLASS}>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export { Skeleton, ProductCardSkeleton, ProductGridSkeleton };
