"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, ClipboardList, Home, MoreHorizontal, Package } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { useAdminPath } from "@/hooks/useAdminPath";
import { cn } from "@/lib/utils";

export function AdminMobileNav({ onMore }: { onMore: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const adminPath = useAdminPath();
  const items = [
    { href: adminPath(""), label: t("admin.mobile.home"), icon: Home, exact: true },
    { href: adminPath("costing"), label: t("admin.mobile.inventory"), icon: Package },
    { href: `${adminPath("costing")}?capture=1`, label: t("admin.inventory.smart.camera"), icon: Camera, camera: true },
    { href: adminPath("orders"), label: t("admin.mobile.sales"), icon: ClipboardList },
  ];

  return (
    <nav aria-label={t("admin.mobile.nav")} className="mobile-bottom-nav lg:hidden print:hidden">
      <div className="mobile-bottom-nav__inner">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href.split("?")[0]) && !item.camera;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1"
            >
              <Icon className={cn("h-5 w-5", item.camera || active ? "text-turquoise" : "text-coffee/55")} />
              <span className={cn("max-w-full truncate text-xs font-semibold", item.camera || active ? "text-turquoise" : "text-coffee/70")}>
                {item.label}
              </span>
            </Link>
          );
        })}
        <button type="button" onClick={onMore} className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1">
          <MoreHorizontal className="h-5 w-5 text-coffee/55" />
          <span className="text-xs font-semibold text-coffee/70">{t("admin.mobile.more")}</span>
        </button>
      </div>
    </nav>
  );
}
