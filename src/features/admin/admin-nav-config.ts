import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Tags,
  Layers,
  Link2,
  GitBranch,
  ClipboardList,
  Users,
  ImageIcon,
  MessageSquare,
  UserCog,
  Settings,
  FileText,
  Printer,
  QrCode,
  Calculator,
} from "lucide-react";
import { adminPath, toInternalAdminPath } from "@/lib/domains/host-routing";
import type { AdminSurface } from "@/lib/domains/host-routing";

export type AdminNavSegment = Parameters<typeof adminPath>[0];

export type AdminNavItem = {
  segment: AdminNavSegment;
  labelKey: string;
  icon: LucideIcon;
  exact?: boolean;
  adminOnly?: boolean;
};

export type AdminNavGroup = {
  labelKey: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    labelKey: "admin.nav.group.overview",
    items: [{ segment: "", labelKey: "admin.dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    labelKey: "admin.nav.group.catalog",
    items: [
      { segment: "products", labelKey: "admin.products", icon: Package },
      { segment: "categories", labelKey: "admin.categories", icon: Tags },
      { segment: "modifier-groups", labelKey: "admin.modifierManagement", icon: Layers },
      { segment: "product-builder", labelKey: "admin.productAssignments", icon: Link2 },
      { segment: "business-rules", labelKey: "admin.selectionRules", icon: GitBranch },
    ],
  },
  {
    labelKey: "admin.nav.group.sales",
    items: [
      { segment: "orders", labelKey: "admin.orders", icon: ClipboardList },
      { segment: "customers", labelKey: "admin.customers", icon: Users },
      { segment: "costing", labelKey: "admin.costing", icon: Calculator, adminOnly: true },
    ],
  },
  {
    labelKey: "admin.nav.group.content",
    items: [
      { segment: "banners", labelKey: "admin.banners", icon: ImageIcon },
      { segment: "menu-builder", labelKey: "admin.menuBuilder", icon: FileText },
      { segment: "qr", labelKey: "admin.qr", icon: QrCode },
    ],
  },
  {
    labelKey: "admin.nav.group.system",
    items: [
      { segment: "assistant", labelKey: "admin.assistantManager", icon: MessageSquare },
      { segment: "printer", labelKey: "admin.printer", icon: Printer },
      { segment: "users", labelKey: "admin.users", icon: UserCog, adminOnly: true },
      { segment: "settings", labelKey: "admin.settings", icon: Settings },
    ],
  },
];

export function getAdminNavHref(segment: AdminNavSegment, surface: AdminSurface): string {
  return adminPath(segment, surface);
}

export function getAdminNavInternalPath(segment: AdminNavSegment): string {
  return adminPath(segment, "dev");
}

/** Map pathname → page title translation key */
export const ADMIN_PAGE_TITLES: Record<string, string> = {
  "/admin": "admin.dashboard",
  "/admin/products": "admin.products",
  "/admin/categories": "admin.categories",
  "/admin/modifier-groups": "admin.modifiers.title",
  "/admin/product-builder": "admin.productAssignments",
  "/admin/business-rules": "admin.selectionRules",
  "/admin/orders": "admin.orders.title",
  "/admin/customers": "admin.customers.title",
  "/admin/banners": "admin.banners.title",
  "/admin/menu-builder": "admin.menuBuilder",
  "/admin/qr": "admin.qr.title",
  "/admin/costing": "admin.costing.title",
  "/admin/media": "admin.media.title",
  "/admin/assistant": "admin.assistant.title",
  "/admin/printer": "admin.printer.title",
  "/admin/printer-test": "admin.printerTest.title",
  "/admin/users": "admin.users.title",
  "/admin/settings": "admin.settings.title",
};

export function getAdminPageTitleKey(pathname: string): string {
  const internal = toInternalAdminPath(pathname);
  if (ADMIN_PAGE_TITLES[internal]) return ADMIN_PAGE_TITLES[internal];
  const match = Object.keys(ADMIN_PAGE_TITLES)
    .filter((k) => k !== "/admin")
    .find((k) => internal.startsWith(k));
  return match ? ADMIN_PAGE_TITLES[match] : "admin.dashboard";
}
