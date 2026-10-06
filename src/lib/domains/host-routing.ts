/**
 * Hostname-based routing for customer site vs admin portal vs menu display.
 * Internal Next.js routes stay under /admin/* — portal URLs are rewritten in middleware.
 */

export const PUBLIC_HOST =
  process.env.NEXT_PUBLIC_PUBLIC_HOST?.trim().toLowerCase() || "mishkatcafe.dev";

export const PORTAL_HOST =
  process.env.NEXT_PUBLIC_PORTAL_HOST?.trim().toLowerCase() || "portal.mishkatcafe.dev";

export const MENU_HOST =
  process.env.NEXT_PUBLIC_MENU_HOST?.trim().toLowerCase() || "menu.mishkatcafe.dev";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Customer storefront paths — not served on admin portal */
export const CUSTOMER_ONLY_PATH_PREFIXES = [
  "/catalog",
  "/cart",
  "/checkout",
  "/payment",
  "/account",
  "/offline",
  "/pdf-smoke",
] as const;

/** Ordering paths blocked on menu.mishkatcafe.dev */
export const ORDERING_PATH_PREFIXES = [
  "/cart",
  "/checkout",
  "/orders",
  "/account",
  "/catalog",
  "/admin",
] as const;

/** Order-related API prefixes blocked on menu host */
export const MENU_BLOCKED_API_PREFIXES = ["/api/orders", "/api/seed", "/api/payments"] as const;

export function normalizeHostname(host: string | null | undefined): string {
  return (host ?? "").toLowerCase().split(":")[0] ?? "";
}

export function isLocalDevHost(host: string | null | undefined): boolean {
  return LOCAL_HOSTS.has(normalizeHostname(host));
}

export function isPortalHost(host: string | null | undefined): boolean {
  const h = normalizeHostname(host);
  if (!h) return false;
  if (h === PORTAL_HOST) return true;
  return h.startsWith("portal.");
}

export function isMenuHost(host: string | null | undefined): boolean {
  const h = normalizeHostname(host);
  if (!h) return false;
  if (h === MENU_HOST) return true;
  return h.startsWith("menu.");
}

export function isPublicProductionHost(host: string | null | undefined): boolean {
  const h = normalizeHostname(host);
  if (!h || isLocalDevHost(h)) return false;
  if (isPortalHost(h) || isMenuHost(h)) return false;
  return true;
}

export function shouldBlockAdminOnHost(host: string | null | undefined): boolean {
  if (isMenuHost(host)) return true;
  return isPublicProductionHost(host);
}

export function isCustomerOnlyPath(pathname: string): boolean {
  return CUSTOMER_ONLY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isOrderingPath(pathname: string): boolean {
  return ORDERING_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isMenuBlockedApiPath(pathname: string): boolean {
  return MENU_BLOCKED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** Map visible portal path → internal /admin path */
export function toInternalAdminPath(pathname: string): string {
  if (pathname.startsWith("/admin")) return pathname;
  if (pathname === "/login") return "/admin/login";
  if (pathname === "/" || pathname === "") return "/admin";
  return `/admin${pathname}`;
}

/** Map internal /admin path → visible portal path */
export function toPortalPath(internalPath: string): string {
  if (!internalPath.startsWith("/admin")) return internalPath;
  if (internalPath === "/admin/login") return "/login";
  const rest = internalPath.slice("/admin".length);
  return rest === "" ? "/" : rest;
}

export function isAdminLoginPath(pathname: string): boolean {
  return pathname === "/admin/login" || pathname === "/login";
}

export type AdminSurface = "portal" | "dev";

export function getAdminSurface(host: string | null | undefined): AdminSurface {
  return isPortalHost(host) ? "portal" : "dev";
}

/**
 * Build admin href for links/redirects.
 * - portal: /products
 * - dev (localhost): /admin/products
 */
export function adminPath(
  segment: "" | "login" | "products" | "categories" | "modifier-groups" | "product-builder" | "business-rules" | "orders" | "customers" | "banners" | "menu-builder" | "qr" | "assistant" | "printer" | "printer-test" | "users" | "settings" | "media" | "ai-assistant" | "costing",
  surface: AdminSurface = "dev"
): string {
  if (segment === "login") {
    return surface === "portal" ? "/login" : "/admin/login";
  }
  if (surface === "portal") {
    return segment ? `/${segment}` : "/";
  }
  return segment ? `/admin/${segment}` : "/admin";
}

export function adminPathFromHost(
  segment: Parameters<typeof adminPath>[0],
  host: string | null | undefined
): string {
  return adminPath(segment, getAdminSurface(host));
}

export function getPublicStoreOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured && !configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured;
  }
  return `https://${PUBLIC_HOST}`;
}

export function getPortalOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_PORTAL_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return `https://${PORTAL_HOST}`;
}

export function getMenuOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_MENU_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return `https://${MENU_HOST}`;
}

export function portalUrl(path = ""): string {
  const normalized = path.startsWith("/") ? path : path ? `/${path}` : "";
  return `${getPortalOrigin()}${normalized}`;
}

export function publicStoreHref(host: string | null | undefined): string {
  if (isPortalHost(host) || isMenuHost(host)) return getPublicStoreOrigin();
  return "/";
}

export function shouldHideCustomerChrome(
  pathname: string,
  host: string | null | undefined
): boolean {
  if (isPortalHost(host) || isMenuHost(host)) return true;
  if (pathname.startsWith("/menu-display")) return true;
  return pathname.startsWith("/admin");
}

export function isViewOnlyMenuSurface(
  host: string | null | undefined,
  pathname?: string
): boolean {
  if (isMenuHost(host)) return true;
  if (pathname?.startsWith("/menu-display")) return true;
  return false;
}

export function safeAdminReturnPath(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}
