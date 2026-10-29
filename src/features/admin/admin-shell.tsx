"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { AdminSidebar, AdminMobileDrawer } from "./admin-sidebar";
import { AdminMobileNav } from "./components/admin-mobile-nav";
import { AdminHeader } from "./admin-header";
import { AuthGuard } from "./auth-guard";
import { MeasureUnitsProvider } from "@/features/admin/measure-units-provider";
import { InventoryViewProvider, useInventoryView } from "@/features/admin/inventory-view-context";
import { isAdminLoginPath } from "@/lib/domains/host-routing";
import { cn } from "@/lib/utils";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLogin = isAdminLoginPath(pathname);

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <AuthGuard>
      <MeasureUnitsProvider>
      <InventoryViewProvider>
      <AdminFrame mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} pathname={pathname}>
        {children}
      </AdminFrame>
      </InventoryViewProvider>
      </MeasureUnitsProvider>
    </AuthGuard>
  );
}

function AdminFrame({
  children,
  mobileOpen,
  setMobileOpen,
  pathname,
}: {
  children: React.ReactNode;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  pathname: string;
}) {
  const { prefs, active } = useInventoryView();
  const wide = active && prefs.mode === "wide";
  const full = active && prefs.mode === "full";
  return (
      <div
        className="min-h-screen overflow-x-hidden bg-cream dark:bg-[#120e0c]"
        data-admin
      >
        {/* Drawer overlay — mobile & tablet only (< lg) */}
        <div className="print:hidden">
          <AdminMobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
        </div>

        {/*
          Desktop layout (lg+): CSS Grid — Sidebar | Main (Header + Content)
          No fixed overlay; sidebar is a real grid column.
        */}
        <div className={cn("lg:grid lg:min-h-screen", full ? "lg:grid-cols-1" : wide ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]")}>
          {!full ? <AdminSidebar collapsed={wide} /> : null}

          <div className={cn("flex min-w-0 flex-col", full ? "h-dvh" : "min-h-screen")}>
            {!full ? <AdminHeader onMenuClick={() => setMobileOpen(true)} /> : null}
            <motion.main
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={cn("min-w-0 flex-1 print:p-0", full ? "overflow-hidden p-2" : "px-4 py-6 pb-28 md:px-6 md:py-8 lg:pb-8")}
            >
              <div className={cn("mx-auto h-full w-full print:max-w-none", full || wide ? "max-w-none" : "max-w-7xl")}>{children}</div>
            </motion.main>
            {!full ? <AdminMobileNav onMore={() => setMobileOpen(true)} /> : null}
          </div>
        </div>
      </div>
  );
}
