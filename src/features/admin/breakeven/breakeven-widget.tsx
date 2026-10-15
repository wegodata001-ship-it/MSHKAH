"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Target } from "lucide-react";
import { AdminCard } from "@/features/admin/components/admin-card";
import { useT } from "@/components/providers/locale-provider";
import { useAdminPath } from "@/hooks/useAdminPath";
import { formatIls } from "@/lib/costing/money";
import { computeBreakEven, monthBounds } from "@/lib/breakeven/compute";
import { DEFAULT_BREAK_EVEN_SETTINGS, type BreakEvenFixedCost, type BreakEvenSettings, type BreakEvenVariableCost } from "@/lib/breakeven/types";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { Order } from "@/types";
import { subscribeToOrders } from "@/services/orderService";
import { subscribeToDishRecipes, subscribeToIngredients } from "@/services/costingService";
import {
  subscribeToBreakEvenFixedCosts,
  subscribeToBreakEvenSettings,
  subscribeToBreakEvenVariableCosts,
} from "@/services/breakevenService";
import { subscribeToPosFinanceEntries, subscribeToPosZReports } from "@/services/inventoryService";
import type { PosFinanceEntry, PosZReport } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

export function BreakEvenDashboardWidget() {
  const t = useT();
  const adminPath = useAdminPath();
  const [fixed, setFixed] = useState<BreakEvenFixedCost[]>([]);
  const [variable, setVariable] = useState<BreakEvenVariableCost[]>([]);
  const [settings, setSettings] = useState<BreakEvenSettings>(DEFAULT_BREAK_EVEN_SETTINGS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [recipes, setRecipes] = useState<DishRecipe[]>([]);
  const [ingredients, setIngredients] = useState<CostingIngredient[]>([]);
  const [zReports, setZReports] = useState<PosZReport[]>([]);
  const [financeEntries, setFinanceEntries] = useState<PosFinanceEntry[]>([]);

  useEffect(() => {
    const unsubs = [
      subscribeToBreakEvenFixedCosts(setFixed),
      subscribeToBreakEvenVariableCosts(setVariable),
      subscribeToBreakEvenSettings(setSettings),
      subscribeToOrders({ status: "all" }, setOrders, () => undefined),
      subscribeToDishRecipes(setRecipes),
      subscribeToIngredients(setIngredients),
      subscribeToPosZReports(setZReports),
      subscribeToPosFinanceEntries(setFinanceEntries),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const month = useMemo(() => monthBounds(), []);
  const result = useMemo(
    () =>
      computeBreakEven({
        settings,
        fixed,
        variable,
        orders,
        recipes,
        ingredients,
        financeEntries,
        zReports,
        from: month.from,
        to: month.to,
      }),
    [settings, fixed, variable, orders, recipes, ingredients, financeEntries, zReports, month]
  );

  const href = `${adminPath("costing")}?hub=finance&tab=breakeven`;
  const progress = result.progress == null ? null : Math.round(result.progress * 100);
  const bar = Math.min(100, Math.max(0, progress ?? 0));

  return (
    <AdminCard
      title={t("admin.breakeven.title")}
      icon={<Target className="h-4 w-4 text-turquoise" />}
      action={
        <Link href={href} className="text-xs font-medium text-turquoise hover:underline">
          {t("admin.dashboard.viewAll")}
        </Link>
      }
    >
      {!result.canCompute ? (
        <div>
          <p className="text-sm font-medium">{t("admin.breakeven.cannot")}</p>
          <p className="mt-1 text-xs text-coffee/55">
            {result.missing.map((item) => t(`admin.breakeven.missing.${item}`)).join(" · ")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-2xl font-semibold">{result.breakEvenMonthly == null ? "—" : formatIls(result.breakEvenMonthly)}</p>
            <p className="text-xs text-coffee/55">{t("admin.breakeven.perMonth")}</p>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-beige">
            <div
              className={cn("h-full rounded-full", result.achieved ? "bg-emerald-600" : "bg-turquoise")}
              style={{ width: `${bar}%` }}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Link href={href} className="rounded-xl bg-beige/40 px-3 py-2">
              <p className="text-xs text-coffee/55">{t("admin.breakeven.sold")}</p>
              <p className="font-semibold">{result.revenue == null ? "—" : formatIls(result.revenue)}</p>
            </Link>
            <Link href={href} className="rounded-xl bg-beige/40 px-3 py-2">
              <p className="text-xs text-coffee/55">{result.achieved ? t("admin.breakeven.above") : t("admin.breakeven.short")}</p>
              <p className="font-semibold">
                {result.achieved
                  ? result.aboveBreakEven == null
                    ? "—"
                    : formatIls(result.aboveBreakEven)
                  : result.gap == null
                    ? "—"
                    : formatIls(result.gap)}
              </p>
            </Link>
            <Link href={href} className="rounded-xl bg-beige/40 px-3 py-2">
              <p className="text-xs text-coffee/55">{t("admin.breakeven.dailyTarget")}</p>
              <p className="font-semibold">{result.breakEvenDaily == null ? "—" : formatIls(result.breakEvenDaily)}</p>
            </Link>
          </div>
        </div>
      )}
    </AdminCard>
  );
}
