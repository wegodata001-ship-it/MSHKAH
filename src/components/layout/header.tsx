"use client";

import Link from "next/link";
import { ShoppingBag, Sparkles, User } from "lucide-react";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useHideCustomerChrome } from "@/hooks/useAdminPath";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useCart } from "@/features/cart/cart-context";
import { useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", labelKey: "nav.home", exact: true },
  { href: "/catalog", labelKey: "nav.catalog" },
  { href: "/#offers", labelKey: "nav.offers" },
  { href: "/#about", labelKey: "nav.about" },
  { href: "/account", labelKey: "nav.contact" },
] as const;

export function SiteHeader() {
  const { itemCount, openCart } = useCart();
  const t = useT();
  const pathname = usePathname();
  const hideChrome = useHideCustomerChrome();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 4));

  if (hideChrome) return null;

  return (
    <motion.header
      role="banner"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        "sticky top-0 z-40 border-b bg-warm-white transition-[height,box-shadow] duration-300",
        "h-14 md:h-20",
        scrolled && "h-12 shadow-soft md:h-20",
        scrolled ? "border-beige-dark/20" : "border-beige-dark/10 shadow-none"
      )}
    >
      <div className="mx-auto flex h-full max-w-[1400px] items-center gap-3 px-4 md:gap-4 md:px-6 lg:px-8">
        {/* Logo block — start (right in RTL) */}
        <div className="shrink-0">
          <Logo
            size="sm"
            href="/"
            priority
            className={cn("w-auto md:h-12", scrolled ? "h-8 md:h-12" : "h-9 md:h-12")}
          />
        </div>

        {/* Center navigation */}
        <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Main">
          {NAV_LINKS.map((link) => {
            const isActive =
              "exact" in link && link.exact
                ? pathname === link.href
                : pathname === link.href || pathname.startsWith(link.href.replace("/#", "/"));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "text-turquoise"
                    : "text-coffee/65 hover:bg-cream hover:text-dark-brown"
                )}
              >
                {t(link.labelKey)}
              </Link>
            );
          })}
        </nav>

        {/* Actions — end (left in RTL) */}
        <div className="ms-auto flex items-center gap-2 md:gap-3">
          <Link
            href="/club"
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-full bg-turquoise px-3 text-xs font-semibold text-warm-white transition-colors hover:bg-turquoise/90 md:px-4 md:text-sm",
              pathname.startsWith("/club") && "ring-2 ring-turquoise/30"
            )}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="sm:hidden">{t("nav.joinClubShort")}</span>
            <span className="hidden sm:inline">{t("nav.joinClub")}</span>
          </Link>
          <LanguageSwitcher variant="dropdown" className="sm:hidden" />
          <LanguageSwitcher compact className="hidden sm:inline-flex" />

          <Link
            href="/account"
            aria-label={t("nav.account")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-beige-dark/25 bg-cream/50 text-coffee transition-colors hover:border-turquoise/40 hover:text-turquoise"
          >
            <User className="h-4 w-4" strokeWidth={1.75} />
          </Link>

          <button
            type="button"
            onClick={openCart}
            aria-label={t("cart.openCart")}
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-beige-dark/25 bg-cream/50 text-coffee transition-colors hover:border-turquoise/40 hover:text-turquoise"
          >
            <ShoppingBag className="h-4 w-4" strokeWidth={1.75} />
            {itemCount > 0 && (
              <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-turquoise px-1 text-[10px] font-bold text-warm-white">
                {itemCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </motion.header>
  );
}

/** @deprecated Use SiteHeader — kept for catalog search integration */
export function Header({
  searchQuery,
  onSearchChange,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  void searchQuery;
  void onSearchChange;
  return <SiteHeader />;
}
