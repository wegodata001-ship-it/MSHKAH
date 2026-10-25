"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { AdminSidebar, AdminMobileDrawer } from "./admin-sidebar";
import { AdminMobileNav } from "./components/admin-mobile-nav";
import { AdminHeader } from "./admin-header";
import { AuthGuard } from "./auth-guard";
import { MeasureUnitsProvider } from "@/features/admin/measure-units-provider";
import { isAdminLoginPath } from "@/lib/domains/host-routing";

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
        <div className="lg:grid lg:min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Column 1: Sidebar — in-flow, sticky, 100vh */}
          <AdminSidebar />

          {/* Column 2: Header + Main — never under sidebar */}
          <div className="flex min-h-screen min-w-0 flex-col">
            <AdminHeader onMenuClick={() => setMobileOpen(true)} />
            <motion.main
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="min-w-0 flex-1 px-4 py-6 pb-28 print:p-0 md:px-6 md:py-8 lg:pb-8"
            >
              <div className="mx-auto w-full max-w-7xl print:max-w-none">{children}</div>
            </motion.main>
            <AdminMobileNav onMore={() => setMobileOpen(true)} />
          </div>
        </div>
      </div>
      </MeasureUnitsProvider>
    </AuthGuard>
  );
}
