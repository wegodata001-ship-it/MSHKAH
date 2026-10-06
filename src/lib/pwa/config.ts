/** PWA constants — installable app shell only; no business logic. */

export const PWA_APP_NAME = "Mishkat Cafe";

export const PWA_SHORT_NAME = "Mishkat";

export const PWA_DESCRIPTION =
  "Mishkat Cafe | مشكاة كافيه — menu, orders, and pickup.";

/** Customer menu home — same as storefront catalog */
export const PWA_START_URL = "/";

export const PWA_SCOPE = "/";

export const PWA_THEME_COLOR = "#F8F3ED";

export const PWA_BACKGROUND_COLOR = "#F8F3ED";

/** Bump when service worker caching strategy changes */
export const PWA_SW_VERSION = "mshkah-pwa-3";

export const PWA_ICONS = {
  favicon: "/favicon.ico",
  icon192: "/icon-192.png",
  icon512: "/icon-512.png",
  maskable512: "/icons/icon-maskable-512.png",
  appleTouch: "/apple-touch-icon.png",
} as const;
