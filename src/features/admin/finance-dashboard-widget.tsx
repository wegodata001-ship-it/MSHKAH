"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { AdminCard } from "@/features/admin/components/admin-card";
import { useT } from "@/components/providers/locale-provider";
import { useAdminPath } from "@/hooks/useAdminPath";
import { formatIls } from "@/lib/costing/money";
import { financeMonthStats } from "@/lib/inventory/invoice-finance";
import type { PurchaseInvoice } from "@/lib/inventory/types";
import { subscribeToPurchaseInvoices } from "@/services/inventoryService";

export function FinanceDashboardWidget() {
  const t = useT();
  const adminPath = useAdminPath();
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);

  useEffect(() => subscribeToPurchaseInvoices(setInvoices), []);

  const stats = useMemo(() => financeMonthStats(invoices), [invoices]);
  const href = `${adminPath("costing")}?hub=finance`;

  return (
    <AdminCard
      title={t("admin.finance.dashTitle")}
      icon={<Wallet className="h-4 w-4 text-turquoise" />}
      action={
        <Link href={href} className="text-xs font-medium text-turquoise hover:underline">
          {t("admin.dashboard.viewAll")}
        </Link>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href={href} className="rounded-xl bg-beige/40 px-3 py-2">
          <p className="text-xs text-coffee/55">{t("admin.finance.dashTitle")}</p>
          <p className="text-lg font-semibold">{formatIls(stats.net)}</p>
        </Link>
        <Link href={href} className="rounded-xl bg-beige/40 px-3 py-2">
          <p className="text-xs text-coffee/55">{t("admin.finance.dashVat")}</p>
          <p className="text-lg font-semibold">{formatIls(stats.vat)}</p>
        </Link>
        <Link href={href} className="rounded-xl bg-beige/40 px-3 py-2">
          <p className="text-xs text-coffee/55">{t("admin.finance.dashGross")}</p>
          <p className="text-lg font-semibold">{formatIls(stats.gross)}</p>
        </Link>
        <Link href={href} className="rounded-xl bg-beige/40 px-3 py-2">
          <p className="text-xs text-coffee/55">{t("admin.finance.dashCount")}</p>
          <p className="text-lg font-semibold">{stats.count}</p>
        </Link>
        <Link href={`${href}&view=review`} className="rounded-xl bg-beige/40 px-3 py-2">
          <p className="text-xs text-coffee/55">{t("admin.finance.dashReview")}</p>
          <p className="text-lg font-semibold">{stats.pendingReview}</p>
        </Link>
        <Link href={`${href}&view=pending-stock`} className="rounded-xl bg-beige/40 px-3 py-2">
          <p className="text-xs text-coffee/55">{t("admin.finance.dashPendingStock")}</p>
          <p className="text-lg font-semibold">{stats.pendingStock}</p>
        </Link>
      </div>
    </AdminCard>
  );
}
