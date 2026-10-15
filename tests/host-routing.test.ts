import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminExternalHref,
  adminPath,
  isLocalAdminHost,
  isLocalDevHost,
  isMenuBlockedApiPath,
  isMenuHost,
  isOrderingPath,
  isPortalHost,
  isViewOnlyMenuSurface,
  safeAdminReturnPath,
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
    expect(shouldBlockAdminOnHost("127.0.0.1:4000")).toBe(false);
    expect(shouldBlockAdminOnHost("10.0.0.16:3000")).toBe(false);
  });

  it("keeps local and LAN hosts on same-origin /admin", () => {
    expect(isLocalDevHost("localhost:3000")).toBe(true);
    expect(isLocalDevHost("127.0.0.1")).toBe(true);
    expect(isLocalDevHost("10.0.0.16")).toBe(true);
    expect(isLocalDevHost("192.168.1.10")).toBe(true);
    expect(isLocalAdminHost("localhost")).toBe(true);
    expect(isLocalAdminHost("portal.mishkatcafe.dev")).toBe(false);
    expect(isLocalAdminHost("menu.mishkatcafe.dev")).toBe(false);
    expect(isLocalAdminHost("mishkatcafe.dev")).toBe(false);
    expect(adminExternalHref("products", "localhost")).toBe("/admin/products");
    expect(adminExternalHref("login", "127.0.0.1")).toBe("/admin/login");
    expect(adminExternalHref("", "localhost")).toBe("/admin");
    expect(adminExternalHref("products", "portal.mishkatcafe.dev")).toBe("/products");
    expect(adminExternalHref("login", "mishkatcafe.dev")).toContain("portal.mishkatcafe.dev");
    expect(adminExternalHref("login", "mishkatcafe.dev")).not.toContain("localhost");
    expect(safeAdminReturnPath("/admin/costing", "/admin")).toBe("/admin/costing");
    expect(safeAdminReturnPath("http://localhost:3000/admin/orders?tab=open", "/admin")).toBe(
      "/admin/orders?tab=open"
    );
    expect(safeAdminReturnPath("https://portal.mishkatcafe.dev/orders", "/admin")).toBe("/admin/orders");
    expect(safeAdminReturnPath("https://evil.example/admin", "/admin")).toBe("/admin");
    expect(safeAdminReturnPath("//evil.example/admin", "/admin")).toBe("/admin");
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

describe("portal manifest", () => {
  it("lets /manifest.webmanifest reach Next.js instead of rewriting to /admin", () => {
    const source = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");
    expect(source).toMatch(/isPortalHost[\s\S]*pathname === "\/manifest\.webmanifest"[\s\S]*NextResponse\.next\(\)/);
  });

  it("keeps local /admin on the current origin before portal rewrites", () => {
    const source = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");
    expect(source).toMatch(/isLocalAdminHost\(host\)[\s\S]*NextResponse\.next\(\)/);
    expect(source.indexOf("isLocalAdminHost")).toBeLessThan(source.indexOf("isPortalHost(host)"));
  });
});
