"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Store, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { useAuth } from "@/components/providers/auth-provider";
import {
  ADMIN_NAV_GROUPS,
  getAdminNavHref,
  getAdminNavInternalPath,
  type AdminNavItem,
} from "./admin-nav-config";
import { ADMIN_LAYOUT, ADMIN_SIDEBAR_WIDTH_PX } from "./admin-layout-config";
import { toInternalAdminPath, publicStoreHref } from "@/lib/domains/host-routing";
import { useAdminPath, useAdminSurface } from "@/hooks/useAdminPath";

function NavItemLink({
  item,
  isActive,
  onNavigate,
}: {
  item: AdminNavItem & { href: string };
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const t = useT();
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
        isActive
          ? "bg-coffee text-warm-white shadow-soft dark:bg-turquoise dark:text-warm-white"
          : "text-coffee/70 hover:bg-beige/60 hover:text-dark-brown dark:text-warm-white/70 dark:hover:bg-white/10 dark:hover:text-warm-white"
      )}
    >
      {isActive && (
        <motion.span
          layoutId="admin-nav-active"
          className="absolute inset-0 rounded-xl bg-coffee dark:bg-turquoise"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          style={{ zIndex: -1 }}
        />
      )}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-transform duration-200",
          isActive ? "scale-110" : "group-hover:scale-105"
        )}
      />
      <span className="relative">{t(item.labelKey)}</span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const { user } = useAuth();
  const surface = useAdminSurface();
  const internalPathname = toInternalAdminPath(pathname);

  return (
    <div className="space-y-6">
      {ADMIN_NAV_GROUPS.map((group) => {
        const items = group.items.filter(
          (item) => !item.adminOnly || user?.role === "Admin"
        );
        if (!items.length) return null;

        return (
          <div key={group.labelKey}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-coffee/40 dark:text-warm-white/40">
              {t(group.labelKey)}
            </p>
            <nav className="space-y-0.5">
              {items.map((item) => {
                const href = getAdminNavHref(item.segment, surface);
                const itemPath = getAdminNavInternalPath(item.segment);
                const isActive = item.exact
                  ? internalPathname === itemPath
                  : internalPathname === itemPath ||
                    internalPathname.startsWith(`${itemPath}/`);
                return (
                  <NavItemLink
                    key={itemPath}
                    item={{ ...item, href }}
                    isActive={isActive}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </nav>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Desktop sidebar — part of CSS Grid column, NOT fixed overlay.
 * Sticky within column, 100vh, internal scroll when nav is long.
 */
export function AdminSidebar() {
  const t = useT();
  const adminPath = useAdminPath();
  const storeHref =
    typeof window !== "undefined"
      ? publicStoreHref(window.location.hostname)
      : "/";

  return (
    <aside
      className={cn(
        ADMIN_LAYOUT.sidebarVisible,
        "sticky top-0 h-screen shrink-0 flex-col print:hidden",
        "border-e border-beige-dark/20 bg-warm-white dark:border-white/10 dark:bg-[#1a1412]"
      )}
      style={{ width: ADMIN_SIDEBAR_WIDTH_PX }}
      aria-label={t("admin.subtitle")}
    >
      <div className="flex h-full flex-col p-5">
        <Logo size="md" href={adminPath("")} className="h-12 w-auto max-w-[180px]" />
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <NavLinks />
        </div>
        <div className="shrink-0 border-t border-beige-dark/20 pt-4 dark:border-white/10">
          <Link
            href={storeHref}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-coffee/60 transition-colors hover:bg-beige/40 dark:text-warm-white/60 dark:hover:bg-white/10"
          >
            <Store className="h-4 w-4" />
            {t("admin.backToStore")}
          </Link>
          <p className="mt-2 px-3 text-[10px] text-coffee/40 dark:text-warm-white/40">{BRAND.name}</p>
        </div>
      </div>
    </aside>
  );
}

/** Mobile + tablet drawer — overlay allowed only below lg */
export function AdminMobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { dir } = useLocale();
  const adminPath = useAdminPath();
  const offScreen = dir === "rtl" ? "100%" : "-100%";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn("fixed inset-0 z-40 bg-dark-brown/50", ADMIN_LAYOUT.drawerOnly)}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            initial={{ x: offScreen }}
            animate={{ x: 0 }}
            exit={{ x: offScreen }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className={cn(
              "fixed inset-y-0 start-0 z-50 flex flex-col bg-warm-white p-5 shadow-elevated dark:bg-[#1a1412]",
              ADMIN_LAYOUT.drawerOnly
            )}
            style={{ width: ADMIN_SIDEBAR_WIDTH_PX }}
          >
            <div className="flex items-center justify-between">
              <Logo size="sm" href={adminPath("")} className="h-10 w-auto max-w-[160px]" />
              <button
                onClick={onClose}
                className="rounded-xl p-2 transition-colors hover:bg-beige/40 dark:hover:bg-white/10"
                aria-label="close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <NavLinks onNavigate={onClose} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
