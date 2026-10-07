import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCollapsedVisibleCategories } from "@/lib/menu/category-tree";

describe("menu category strip mobile UX", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/features/catalog/menu-category-strip.tsx"),
    "utf8"
  );

  it("does not use horizontal overflow scroll on compact layout", () => {
    expect(source).not.toMatch(/overflow-x-auto/);
    expect(source).not.toMatch(/snap-x/);
    expect(source).toMatch(/grid-cols-2/);
    expect(source).toMatch(/catalog\.showAll/);
    expect(source).toMatch(/catalog\.showLess/);
  });

  it("keeps desktop wrap path and avoids LTR direction hacks", () => {
    expect(source).toMatch(/HorizontalScroller/);
    expect(source).not.toMatch(/direction:\s*ltr/);
    expect(source).not.toMatch(/dir=["']ltr["']/);
  });

  it("collapses expanded categories after selection on compact layout", () => {
    expect(source).toMatch(/setExpanded\(false\)/);
    expect(source).toMatch(/getCollapsedVisibleCategories/);
    expect(source).not.toMatch(/setExpanded\(true\)/);
  });
});

describe("getCollapsedVisibleCategories", () => {
  const roots = Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}` }));

  it("returns the first N categories when selected is already visible", () => {
    expect(getCollapsedVisibleCategories(roots, "c2", 4).map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  it("swaps the last slot for an active category beyond the limit", () => {
    expect(getCollapsedVisibleCategories(roots, "c10", 4).map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c10",
    ]);
  });

  it("returns all roots when under the limit", () => {
    expect(getCollapsedVisibleCategories(roots.slice(0, 3), "c2", 4).map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });
});
