import { describe, expect, it } from "vitest";
import {
  clampColumnWidth,
  clampRowHeight,
  defaultInventoryView,
  densityHeight,
  parseInventoryView,
  resizeInventoryColumn,
  visibleInventoryColumns,
} from "../src/lib/inventory/inventory-view";

describe("inventory view", () => {
  it("rejects invalid saved preferences", () => {
    expect(parseInventoryView("not-json")).toEqual(defaultInventoryView());
    expect(parseInventoryView(null).mode).toBe("normal");
  });

  it("keeps the product and actions columns visible", () => {
    const prefs = parseInventoryView(JSON.stringify({
      hidden: ["product", "actions", "category", "nope"],
    }));
    const visible = visibleInventoryColumns(prefs);
    expect(visible[0]).toBe("product");
    expect(visible.at(-1)).toBe("actions");
    expect(visible).not.toContain("category");
    expect(prefs.hidden).not.toContain("product");
  });

  it("clamps column width and row height", () => {
    expect(clampColumnWidth(10)).toBe(64);
    expect(clampColumnWidth(900)).toBe(480);
    expect(clampColumnWidth(Number.NaN)).toBe(96);
    expect(clampRowHeight(1)).toBe(28);
    expect(clampRowHeight(200)).toBe(72);
  });

  it("resizes a column without changing the view mode", () => {
    const next = resizeInventoryColumn({ ...defaultInventoryView(), mode: "full" }, "product", 300);
    expect(next.mode).toBe("full");
    expect(next.widths.product).toBe(300);
  });

  it("maps density to a row height", () => {
    expect(densityHeight("compact")).toBe(32);
    expect(densityHeight("regular")).toBe(40);
    expect(densityHeight("comfortable")).toBe(56);
    const parsed = parseInventoryView(JSON.stringify({ density: "compact" }));
    expect(parsed.rowHeight).toBe(32);
  });
});
