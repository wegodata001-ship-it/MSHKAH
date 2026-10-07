import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("catalog shows all category products", () => {
  it("does not truncate or offer show-more in the product grid", () => {
    const grid = readFileSync(
      resolve(process.cwd(), "src/features/catalog/product-grid.tsx"),
      "utf8"
    );
    const section = readFileSync(
      resolve(process.cwd(), "src/features/catalog/category-product-section.tsx"),
      "utf8"
    );
    const view = readFileSync(
      resolve(process.cwd(), "src/features/catalog/catalog-view.tsx"),
      "utf8"
    );

    for (const src of [grid, section, view]) {
      expect(src).not.toMatch(/slice\(\s*0\s*,\s*3\s*\)/);
      expect(src).not.toMatch(/ShowMoreProductsButton/);
      expect(src).not.toMatch(/showMoreCount|CATALOG_PREVIEW|getCatalogVisibleProducts/);
      expect(src).not.toMatch(/incremental|expandedByCategory/);
    }

    expect(grid).toMatch(/products\.map/);
  });

  it("uses a large-image card grid instead of the old thumbnail list", () => {
    const card = readFileSync(
      resolve(process.cwd(), "src/features/catalog/product-card.tsx"),
      "utf8"
    );
    const layout = readFileSync(
      resolve(process.cwd(), "src/features/catalog/catalog-grid.ts"),
      "utf8"
    );

    expect(card).toMatch(/aspect-square/);
    expect(card).toMatch(/aspect-\[4\/3\]/);
    expect(card).toMatch(/flex-col/);
    expect(card).toMatch(/line-clamp-2/);
    expect(card).toMatch(/mt-auto/);
    expect(card).not.toMatch(/grid-cols-\[112px/);
    expect(card).not.toMatch(/showProductThumbnails/);
    expect(layout).toMatch(/grid-cols-2/);
    expect(layout).toMatch(/md:grid-cols-3/);
    expect(layout).not.toMatch(/grid-cols-1/);
  });
});
