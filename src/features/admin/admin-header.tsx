"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Moon,
  Sun,
  ChevronDown,
  LogOut,
  User,
  Plus,
  Search,
  Menu,
  ClipboardPlus,
} from "lucide-react";
import { useAppTheme } from "@/hooks/useAppTheme";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useT } from "@/components/providers/locale-provider";
import { getAdminPageTitleKey } from "./admin-nav-config";
import { adminInput } from "./components/admin-styles";
import { useAdminPath } from "@/hooks/useAdminPath";

interface AdminHeaderProps {
  onMenuClick?: () => void;
}

export function AdminHeader({ onMenuClick }: AdminHeaderProps) {
  const t = useT();
  const { user, logout } = useAuth();
  const { mounted, isDark, toggleTheme } = useAppTheme();
  const pathname = usePathname();
  const adminPath = useAdminPath();
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const pageTitle = t(getAdminPageTitleKey(pathname));
  const roleLabel =
    user?.role === "Admin"
      ? t("admin.role.admin")
      : user?.role === "Manager"
        ? t("admin.role.manager")
        : t("admin.role.employee");

  return (
    <header className="sticky top-0 z-30 border-b border-beige-dark/20 bg-warm-white/90 backdrop-blur-xl print:hidden dark:border-white/10 dark:bg-[#1a1412]/90">
      <div className="flex h-16 items-center gap-3 px-4 md:gap-4 md:px-6">
        <button
          onClick={onMenuClick}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-beige-dark/30 transition-colors hover:bg-beige/40 lg:hidden dark:border-white/10 dark:hover:bg-white/10"
          aria-label="menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="hidden min-w-0 items-center gap-3 sm:flex">
          <Logo size="sm" href={adminPath("")} className="h-10 w-auto" />
          <div className="min-w-0 border-s border-beige-dark/20 ps-3 dark:border-white/10">
            <p className="truncate text-[10px] text-coffee/50 dark:text-warm-white/50">{t("admin.subtitle")}</p>
          </div>
        </div>

        <div className="min-w-0 flex-1 lg:hidden">
          <h1 className="truncate font-display text-base font-bold text-dark-brown dark:text-warm-white">
            {pageTitle}
          </h1>
        </div>

        <div className="hidden max-w-sm flex-1 lg:block">
          <div className="relative">
            <Search className="absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-coffee/40" />
            <Input placeholder={t("admin.search")} className={`${adminInput} ps-9`} />
          </div>
        </div>

        <div className="hidden items-center gap-2 xl:flex">
          <Link href={`${adminPath("products")}?new=1`}>
            <Button variant="outline" size="sm" className="h-10 rounded-xl gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {t("admin.newProduct")}
            </Button>
          </Link>
          <Link href={adminPath("orders")}>
            <Button size="sm" className="h-10 rounded-xl gap-1.5 bg-coffee hover:bg-coffee/90 dark:bg-turquoise dark:hover:bg-turquoise/90">
              <ClipboardPlus className="h-3.5 w-3.5" />
              {t("admin.newOrder")}
            </Button>
          </Link>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          disabled={!mounted}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-beige-dark/30 transition-colors duration-250 hover:bg-beige/40 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
          aria-label={isDark ? t("admin.lightMode") : t("admin.darkMode")}
          aria-pressed={isDark}
        >
          {mounted ? (
            isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4 opacity-40" />
          )}
        </button>

        <LanguageSwitcher variant="dropdown" className="sm:hidden" />
        <LanguageSwitcher compact className="hidden sm:inline-flex" />

        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen(!notifOpen);
              setProfileOpen(false);
            }}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-beige-dark/30 transition-colors hover:bg-beige/40 dark:border-white/10 dark:hover:bg-white/10"
            aria-label={t("admin.notifications")}
          >
            <Bell className="h-4 w-4" />
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute end-0 mt-2 w-72 rounded-2xl border border-beige-dark/20 bg-warm-white p-4 shadow-elevated dark:border-white/10 dark:bg-[#1a1412]"
              >
                <p className="text-sm font-semibold text-dark-brown dark:text-warm-white">
                  {t("admin.notifications")}
                </p>
                <p className="mt-2 text-xs text-coffee/50 dark:text-warm-white/50">
                  {t("admin.noNotifications")}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative">
          <button
            onClick={() => {
              setProfileOpen(!profileOpen);
              setNotifOpen(false);
            }}
            className="flex h-10 items-center gap-2 rounded-xl border border-beige-dark/30 px-2 transition-colors hover:bg-beige/40 dark:border-white/10 dark:hover:bg-white/10"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-coffee text-xs font-bold text-warm-white dark:bg-turquoise">
              {user?.displayName?.charAt(0) ?? "א"}
            </div>
            <span className="hidden max-w-[120px] truncate text-sm font-medium md:block dark:text-warm-white">
              {user?.displayName}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-coffee/50 md:block" />
          </button>
          <AnimatePresence>
            {profileOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute end-0 mt-2 w-56 rounded-2xl border border-beige-dark/20 bg-warm-white py-2 shadow-elevated dark:border-white/10 dark:bg-[#1a1412]"
              >
                <div className="border-b border-beige-dark/20 px-4 py-3 dark:border-white/10">
                  <p className="text-sm font-semibold dark:text-warm-white">{user?.displayName}</p>
                  <p className="truncate text-xs text-coffee/50">{user?.email}</p>
                  <span className="mt-1 inline-block rounded-full bg-turquoise/10 px-2 py-0.5 text-[10px] font-medium text-turquoise">
                    {roleLabel}
                  </span>
                </div>
                <Link
                  href={adminPath("settings")}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-beige/40 dark:hover:bg-white/5"
                  onClick={() => setProfileOpen(false)}
                >
                  <User className="h-4 w-4" />
                  {t("admin.profile")}
                </Link>
                <button
                  onClick={() => logout()}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <LogOut className="h-4 w-4" />
                  {t("admin.signOut")}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
