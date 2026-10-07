"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminCard } from "@/features/admin/components/admin-card";
import { QuickCreateIngredientPanel } from "@/features/admin/costing/quick-create-ingredient";
import { useT } from "@/components/providers/locale-provider";
import type { CostingIngredient } from "@/lib/costing/types";
import type { PurchaseInvoice, PurchaseInvoiceLine, Supplier } from "@/lib/inventory/types";
import { invoiceStockStatus } from "@/lib/inventory/invoice-finance";
import { transferInvoiceLinesToStock } from "@/services/inventoryService";

export function InvoiceStockTransfer({
  invoice,
  ingredients,
  onClose,
  onToast,
}: {
  invoice: PurchaseInvoice;
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [lines, setLines] = useState<PurchaseInvoiceLine[]>(
    invoice.lines.map((line) => ({
      ...line,
      transferToInventory: line.postedToStock ? false : line.skipInventory ? false : Boolean(line.productId),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const alreadyPosted = invoiceStockStatus(invoice) === "posted";

  const selectedKeys = useMemo(
    () => lines.filter((line) => line.transferToInventory && !line.postedToStock && line.productId).map((line) => line.key),
    [lines]
  );

  const update = (key: string, patch: Partial<PurchaseInvoiceLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  if (alreadyPosted) {
    return (
      <AdminCard title={t("admin.finance.stockPosted")}>
        <p className="text-sm text-coffee/70">{t("admin.finance.alreadyPosted")}</p>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </AdminCard>
    );
  }

  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.finance.transferTitle")}>
        <p className="mb-3 text-sm text-coffee/65">{t("admin.finance.transferHint")}</p>
        <div className="space-y-3">
          {lines.map((line) => (
            <div key={line.key} className="rounded-2xl border border-beige-dark/15 p-3">
              <p className="font-medium">{line.rawName}</p>
              {line.productId ? (
                <p className="text-sm text-coffee/60">
                  {t("admin.inventory.smart.suggestedMatch")}: {ingredients.find((item) => item.id === line.productId)?.name}
                  {line.matchConfidence != null ? ` · ${Math.round(line.matchConfidence * 100)}%` : ""}
                </p>
              ) : (
                <p className="text-sm text-amber-700">{t("admin.inventory.smart.missingInventory")}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(line.transferToInventory) && !line.postedToStock}
                    disabled={line.postedToStock || !line.productId}
                    onChange={(e) => update(line.key, { transferToInventory: e.target.checked, skipInventory: !e.target.checked })}
                  />
                  {line.postedToStock ? t("admin.finance.stockPosted") : t("admin.finance.includeInStock")}
                </label>
                <select
                  className="h-9 rounded-xl border px-2 text-sm"
                  value={line.productId ?? ""}
                  onChange={(e) => update(line.key, { productId: e.target.value || undefined, matchKind: "exact", transferToInventory: Boolean(e.target.value) })}
                >
                  <option value="">{t("admin.inventory.smart.chooseOther")}</option>
                  {ingredients.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                <button type="button" className="text-xs text-turquoise" onClick={() => setCreateKey(line.key)}>
                  {t("admin.inventory.createProduct")}
                </button>
                <button type="button" className="text-xs text-coffee/60" onClick={() => update(line.key, { transferToInventory: false, skipInventory: true })}>
                  {t("admin.finance.skipLine")}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="button"
            variant="turquoise"
            disabled={saving || selectedKeys.length === 0}
            onClick={async () => {
              setSaving(true);
              const result = await transferInvoiceLinesToStock({ ...invoice, lines }, selectedKeys);
              setSaving(false);
              if (!result.success) {
                onToast(result.error === "NO_STOCK_LINES" ? t("admin.finance.noStockLines") : result.error, "error");
                return;
              }
              onToast(t("admin.finance.stockTransferred"));
              onClose();
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.finance.confirmTransfer")}
          </Button>
        </div>
      </AdminCard>
      <QuickCreateIngredientPanel
        open={createKey != null}
        existing={ingredients}
        initialName={lines.find((line) => line.key === createKey)?.rawName}
        onClose={() => setCreateKey(null)}
        onCreated={(item) => {
          if (createKey) update(createKey, { productId: item.id, matchKind: "exact", transferToInventory: true, skipInventory: false });
          setCreateKey(null);
        }}
        onUseExisting={(item) => {
          if (createKey) update(createKey, { productId: item.id, matchKind: "exact", transferToInventory: true });
          setCreateKey(null);
        }}
      />
    </div>
  );
}
