import { describe, expect, it } from "vitest";
import {
  adminPath,
  isMenuBlockedApiPath,
  isMenuHost,
  isOrderingPath,
  isPortalHost,
  isViewOnlyMenuSurface,
  shouldBlockAdminOnHost,
  shouldHideCustomerChrome,
  toInternalAdminPath,
  toPortalPath,
} from "@/lib/domains/host-routing";
import { filterMenuDisplayProducts } from "@/lib/menu/category-tree";
import type { Category, Product } from "@/types";

describe("host-routing", () => {
  it("detects portal host", () => {
    expect(isPortalHost("portal.mishkatcafe.dev")).toBe(true);
    expect(isPortalHost("mishkatcafe.dev")).toBe(false);
    expect(isPortalHost("localhost:3000")).toBe(false);
  });

  it("detects menu host", () => {
    expect(isMenuHost("menu.mishkatcafe.dev")).toBe(true);
    expect(isMenuHost("mishkatcafe.dev")).toBe(false);
    expect(isMenuHost("portal.mishkatcafe.dev")).toBe(false);
  });

  it("blocks /admin on public and menu hosts", () => {
    expect(shouldBlockAdminOnHost("mishkatcafe.dev")).toBe(true);
    expect(shouldBlockAdminOnHost("menu.mishkatcafe.dev")).toBe(true);
    expect(shouldBlockAdminOnHost("portal.mishkatcafe.dev")).toBe(false);
    expect(shouldBlockAdminOnHost("localhost:3000")).toBe(false);
  });

  it("maps portal paths to internal admin routes", () => {
    expect(toInternalAdminPath("/")).toBe("/admin");
    expect(toInternalAdminPath("/login")).toBe("/admin/login");
    expect(toInternalAdminPath("/products")).toBe("/admin/products");
    expect(toInternalAdminPath("/admin/orders")).toBe("/admin/orders");
  });

  it("maps internal admin routes to clean portal paths", () => {
    expect(toPortalPath("/admin")).toBe("/");
    expect(toPortalPath("/admin/login")).toBe("/login");
    expect(toPortalPath("/admin/products")).toBe("/products");
  });

  it("builds surface-aware admin hrefs", () => {
    expect(adminPath("products", "portal")).toBe("/products");
    expect(adminPath("products", "dev")).toBe("/admin/products");
    expect(adminPath("costing", "dev")).toBe("/admin/costing");
    expect(adminPath("costing", "portal")).toBe("/costing");
    expect(adminPath("login", "portal")).toBe("/login");
    expect(adminPath("", "portal")).toBe("/");
  });

  it("hides customer chrome on portal, menu, and /admin", () => {
    expect(shouldHideCustomerChrome("/products", "portal.mishkatcafe.dev")).toBe(true);
    expect(shouldHideCustomerChrome("/", "menu.mishkatcafe.dev")).toBe(true);
    expect(shouldHideCustomerChrome("/menu-display", "localhost")).toBe(true);
    expect(shouldHideCustomerChrome("/catalog", "mishkatcafe.dev")).toBe(false);
    expect(shouldHideCustomerChrome("/admin/products", "localhost")).toBe(true);
  });

  it("flags ordering paths and view-only surface", () => {
    expect(isOrderingPath("/checkout")).toBe(true);
    expect(isOrderingPath("/cart")).toBe(true);
    expect(isOrderingPath("/orders")).toBe(true);
    expect(isViewOnlyMenuSurface("menu.mishkatcafe.dev")).toBe(true);
    expect(isViewOnlyMenuSurface("localhost", "/menu-display")).toBe(true);
    expect(isViewOnlyMenuSurface("mishkatcafe.dev", "/")).toBe(false);
    expect(isMenuBlockedApiPath("/api/payments/hyp/create")).toBe(true);
    expect(isMenuBlockedApiPath("/api/orders/notify-new")).toBe(true);
  });
});

describe("menu display product filter", () => {
  it("includes subcategory products under a root category", () => {
    const categories = [
      { id: "coffee", parentId: null, active: true, sortOrder: 1 },
      { id: "hot", parentId: "coffee", active: true, sortOrder: 1 },
    ] as Category[];
    const products = [
      {
        id: "1",
        categoryId: "coffee",
        subcategoryId: "hot",
        active: true,
        sortOrder: 1,
        isPopular: false,
      },
      {
        id: "2",
        categoryId: "desserts",
        active: true,
        sortOrder: 1,
        isPopular: false,
      },
    ] as Product[];

    const all = filterMenuDisplayProducts(products, null, categories);
    expect(all.map((p) => p.id)).toEqual(["1", "2"]);

    const coffee = filterMenuDisplayProducts(products, "coffee", categories);
    expect(coffee.map((p) => p.id)).toEqual(["1"]);
  });
});
