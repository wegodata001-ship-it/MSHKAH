"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { MeasureUnitSelect } from "@/features/admin/measure-unit-select";
import { stockInDisplayUnit } from "@/lib/inventory/issue";
import { planInventoryAdjustment, type ShownUnitPrice } from "@/lib/inventory/last-price";
import type { Supplier } from "@/lib/inventory/types";

export function InventoryRowCorrection({
  mode,
  product,
  suppliers,
  currentBase,
  stockNames,
  price,
  invoiceId,
  invoiceNumber,
  onOpenInvoice,
  onToast,
}: {
  mode: "quantity" | "price";
  product: CostingIngredient;
  suppliers: Supplier[];
  currentBase: number;
  stockNames: Array<{ name: string; quantity: number }>;
  price?: ShownUnitPrice | null;
  invoiceId?: string;
  invoiceNumber?: string;
  onOpenInvoice?: (invoiceId: string) => void;
  onToast: (message: string) => void;
}) {
  const t = useT();
  const current = stockInDisplayUnit(currentBase, product);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextQty, setNextQty] = useState(current.toFixed(2));
  const [basis, setBasis] = useState<"including" | "excluding" | "exempt">(price?.includingVat != null ? "excluding" : "excluding");
  const [nextPrice, setNextPrice] = useState(price?.excludingVat != null ? String(price.excludingVat) : "");
  const [unit, setUnit] = useState<PurchaseUnit>(product.purchaseUnit);
  const [supplierId, setSupplierId] = useState(product.lastSupplierId ?? "");
  const [reason, setReason] = useState("");
  const parsedQty = Number(nextQty);
  let preview = "";
  if (mode === "quantity" && Number.isFinite(parsedQty)) {
    try {
      const plan = planInventoryAdjustment({ currentBase, nextQuantity: parsedQty, unit: product.purchaseUnit, baseUnit: product.baseUnit });
      preview = `${current.toFixed(2)} → ${parsedQty.toFixed(2)} (${plan.deltaBase > 0 ? "+" : ""}${plan.deltaBase})`;
    } catch {
      preview = t("admin.inventory.adjustRejected");
    }
  }
  const otherNames = stockNames.filter((item) => item.name !== product.name);

  async function confirm() {
    if (!reason.trim()) return;
    setBusy(true);
    const result = mode === "quantity"
      ? await clientAdminFetch("/api/admin/inventory/stock-adjust", {
          productId: product.id,
          nextQuantity: parsedQty,
          unit: product.purchaseUnit,
          reason: reason.trim(),
        })
      : await clientAdminFetch("/api/admin/inventory/price-correction", {
          productId: product.id,
          unitPrice: Number(nextPrice),
          basis,
          supplierId: supplierId || undefined,
          purchaseUnit: unit,
          reason: reason.trim(),
          invoiceId,
        });
    setBusy(false);
    if (!result.ok) {
      onToast(t("admin.inventory.adjustRejected"));
      return;
    }
    setOpen(false);
    onToast(t("admin.inventory.adjustSaved"));
  }

  return (
    <div className="mt-1 text-start">
      <button type="button" className="text-[11px] text-turquoise" onClick={() => setOpen((value) => !value)}>
        {mode === "quantity" ? `${current.toFixed(2)} ${t(unitLabelKey(product.purchaseUnit))}` : t("admin.inventory.editLastPrice")}
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded-lg border border-beige-dark/20 bg-white p-2 text-[11px]">
          {mode === "quantity" ? (
            <>
              <Input value={nextQty} className="h-8" onChange={(event) => setNextQty(event.target.value)} />
              <p>{t("admin.inventory.adjustPreview")}: {preview}</p>
              {otherNames.length > 0 && (
                <p className="text-amber-800">{t("admin.inventory.mergedQtyNote")}: {otherNames.map((item) => `${item.name} ${item.quantity}`).join(", ")}</p>
              )}
            </>
          ) : (
            <>
              <p>{t("admin.inventory.priceExVat")}: {price?.excludingVat != null ? formatIls(price.excludingVat) : "—"} · {t("admin.inventory.priceIncVat")}: {price?.includingVat != null ? formatIls(price.includingVat) : "—"}</p>
              <select className="h-8 w-full rounded-lg border px-2" value={basis} onChange={(event) => setBasis(event.target.value as typeof basis)}>
                <option value="excluding">{t("admin.inventory.priceBasis.excluding")}</option>
                <option value="including">{t("admin.inventory.priceBasis.including")}</option>
                <option value="exempt">{t("admin.inventory.priceBasis.exempt")}</option>
              </select>
              <Input value={nextPrice} className="h-8" onChange={(event) => setNextPrice(event.target.value)} />
              <MeasureUnitSelect className="h-8 w-full rounded-lg border px-2" value={unit} onChange={(next) => setUnit(next as PurchaseUnit)} />
              <select className="h-8 w-full rounded-lg border px-2" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">—</option>
                {suppliers.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {invoiceId && (
                <button type="button" className="text-turquoise" onClick={() => onOpenInvoice?.(invoiceId)}>
                  {t("admin.inventory.sourceInvoice")} {invoiceNumber || invoiceId}
                </button>
              )}
            </>
          )}
          <Input value={reason} placeholder={t("admin.inventory.adjustReason")} className="h-8" onChange={(event) => setReason(event.target.value)} />
          <Button type="button" variant="turquoise" className="h-8 text-xs" disabled={busy || !reason.trim()} onClick={() => void confirm()}>
            {t("admin.inventory.confirmChange")}
          </Button>
        </div>
      )}
    </div>
  );
}
