"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminCard } from "@/features/admin/components/admin-card";
import { useAuth } from "@/components/providers/auth-provider";
import { useT } from "@/components/providers/locale-provider";
import type { CostingIngredient } from "@/lib/costing/types";
import { currentStockBase } from "@/lib/inventory/stock";
import { stockCountAdjustment } from "@/lib/inventory/ingredient-core";
import type { InventoryMovement } from "@/lib/inventory/types";
import { approveStockCountSession, saveStockCountSession, type StockCountSession } from "@/services/inventoryService";
import { isAdminRole } from "@/lib/auth/roles";

export function StockCountPanel({
  ingredients,
  movements,
  onToast,
}: {
  ingredients: CostingIngredient[];
  movements: InventoryMovement[];
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const startedAt = useMemo(() => new Date().toISOString(), []);
  const snapshot = useMemo(
    () => Object.fromEntries(ingredients.filter((item) => item.active !== false).map((item) => [item.id, currentStockBase(movements, item.id)])),
    [ingredients, movements]
  );

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t("admin.inventory.countStart")}
      </Button>
    );
  }

  const lines = ingredients.filter((item) => item.active !== false).map((item) => {
    const raw = counts[item.id];
    const countedBase = raw === "" || raw == null ? null : Number(raw);
    return {
      productId: item.id,
      countedBase: countedBase != null && Number.isFinite(countedBase) ? countedBase : null,
      name: item.name,
      system: snapshot[item.id] ?? 0,
    };
  });

  const submit = async (asPending: boolean) => {
    setBusy(true);
    const sessionLines = lines.map((line) => ({ productId: line.productId, countedBase: line.countedBase }));
    const saved = await saveStockCountSession({
      status: asPending ? "pending" : "open",
      startedAt,
      startedBy: user?.email,
      lines: sessionLines,
      snapshot,
    });
    if (!saved.success) {
      setBusy(false);
      onToast(saved.error, "error");
      return;
    }
    if (!asPending) {
      setBusy(false);
      onToast(t("admin.inventory.countSaved"));
      return;
    }
    if (!isAdminRole(user?.role ?? "")) {
      setBusy(false);
      onToast(t("admin.inventory.countNeedsManager"), "error");
      return;
    }
    const session: StockCountSession = {
      id: saved.data,
      status: "pending",
      startedAt,
      startedBy: user?.email,
      lines: sessionLines,
      snapshot,
    };
    const approved = await approveStockCountSession({ session, movements, actor: user?.email });
    setBusy(false);
    if (!approved.success) {
      onToast(approved.error, "error");
      return;
    }
    onToast(t("admin.inventory.countApproved"));
    setOpen(false);
  };

  return (
    <AdminCard title={t("admin.inventory.countTitle")}>
      <p className="mb-2 text-xs text-coffee/55">{t("admin.inventory.countHint")}</p>
      <div className="space-y-2">
        {lines.map((line) => {
          const preview = stockCountAdjustment({
            countedBase: line.countedBase,
            snapshotBase: line.system,
            movementsDuringBase: 0,
          });
          return (
            <div key={line.productId} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 text-sm">
              <span>{line.name}</span>
              <span className="text-coffee/55">{line.system}</span>
              <Input
                className="h-8"
                inputMode="decimal"
                value={counts[line.productId] ?? ""}
                placeholder=""
                onChange={(e) => setCounts((current) => ({ ...current, [line.productId]: e.target.value }))}
              />
              {!preview.skip && <p className="col-span-3 text-[11px] text-coffee/55">{t("admin.inventory.countAdj")}: {preview.adjustment}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(false)}>{t("admin.inventory.smart.saveDraft")}</Button>
        <Button type="button" variant="turquoise" disabled={busy} onClick={() => void submit(true)}>{t("admin.inventory.countApprove")}</Button>
      </div>
    </AdminCard>
  );
}
