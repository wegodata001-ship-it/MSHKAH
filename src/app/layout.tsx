import type { Metadata, Viewport } from "next";
import {
  Inter,
  Playfair_Display,
  Atkinson_Hyperlegible,
  Heebo,
  Assistant,
  Cairo,
  Tajawal,
} from "next/font/google";
import { FirebaseProvider } from "@/components/providers/firebase-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AccessibilityProvider } from "@/components/providers/accessibility-provider";
import { AccessibilityCenter } from "@/components/accessibility/accessibility-center";
import { AssistantWidget } from "@/features/assistant/assistant-widget";
import { ClientSiteFooter } from "@/components/layout/client-site-footer";
import { LocaleHtmlScript } from "@/components/providers/locale-html-sync";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { CartProvider } from "@/features/cart/cart-context";
import { CartDrawer } from "@/features/cart/cart-drawer";
import { FloatingCartButton } from "@/features/cart/floating-cart-button";
import { MobileCartBar } from "@/features/cart/mobile-cart-bar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { PwaManager } from "@/components/pwa/pwa-manager";
import { BrandSplash } from "@/components/brand/brand-splash";
import { BRAND } from "@/lib/brand";
import { PWA_APP_NAME, PWA_ICONS } from "@/lib/pwa/config";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  variable: "--font-assistant",
  weight: ["500", "600", "700"],
  display: "swap",
});

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  variable: "--font-tajawal",
  weight: ["400", "500"],
  display: "swap",
});

const atkinson = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-atkinson",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F8F3ED",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Mishkat Cafe | مشكاة كافيه",
  description: `${BRAND.taglineAlt} — ${BRAND.tagline}`,
  applicationName: PWA_APP_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: PWA_APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: PWA_ICONS.favicon, sizes: "48x48" },
      { url: PWA_ICONS.icon192, sizes: "192x192", type: "image/png" },
      { url: PWA_ICONS.icon512, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: PWA_ICONS.appleTouch, sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Mishkat Cafe | مشكاة كافيه",
    description: BRAND.taglineAlt,
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "Mishkat Cafe" }],
    type: "website",
    siteName: "Mishkat Cafe",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mishkat Cafe | مشكاة كافيه",
    description: BRAND.taglineAlt,
    images: ["/og-image.jpg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${inter.variable} ${playfair.variable} ${heebo.variable} ${assistant.variable} ${cairo.variable} ${tajawal.variable} ${atkinson.variable}`}
    >
      <head>
        <LocaleHtmlScript />
      </head>
      <body className="flex min-h-dvh flex-col overflow-x-hidden bg-cream pb-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom,0px)+12px)] has-[[data-admin]]:pb-0 has-[[data-menu-display]]:pb-0 md:pb-0">
        <BrandSplash />
        <ThemeProvider>
          <AccessibilityProvider>
            <LocaleProvider>
              <FirebaseProvider>
                <AuthProvider>
                  <CartProvider>
                    <main id="main-content" className="min-w-0 flex-1" tabIndex={-1}>
                      {children}
                    </main>
                    <ClientSiteFooter />
                    <FloatingCartButton />
                    <MobileCartBar />
                    <CartDrawer />
                    <BottomNav />
                    <PwaManager />
                    <AccessibilityCenter />
                    <AssistantWidget />
                  </CartProvider>
                </AuthProvider>
              </FirebaseProvider>
            </LocaleProvider>
          </AccessibilityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
