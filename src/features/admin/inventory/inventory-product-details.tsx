"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AdminModal,
  AdminModalBody,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient } from "@/lib/costing/types";
import {
  cheapestOffer,
  currentStockBase,
  latestPurchase,
  offerLastPurchaseCost,
  offerNormalizedCost,
  offerPurchaseUnit,
} from "@/lib/inventory/stock";
import type { InventoryMovement, PurchasePriceRecord, Supplier, SupplierOffer } from "@/lib/inventory/types";
import { SupplierOffersPanel } from "@/features/admin/inventory/supplier-offers-panel";
import { cn } from "@/lib/utils";

type DetailTab = "info" | "suppliers" | "ledger" | "history";

export function InventoryProductDetails({
  product,
  suppliers,
  offers,
  records,
  movements,
  onEdit,
  onClose,
  onToast,
}: {
  product: CostingIngredient;
  suppliers: Supplier[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  movements: InventoryMovement[];
  onEdit: () => void;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<DetailTab>("suppliers");
  const stock = currentStockBase(movements, product.id);
  const productOffers = offers.filter((offer) => offer.productId === product.id && offer.active !== false);
  const cheap = cheapestOffer(productOffers, product.baseUnit);
  const last = latestPurchase(records, product.id);
  const tabs: { id: DetailTab; label: string }[] = [
    { id: "info", label: t("admin.inventory.tab.productInfo") },
    { id: "suppliers", label: t("admin.inventory.supplierPrices") },
    { id: "ledger", label: t("admin.inventory.tab.ledger") },
    { id: "history", label: t("admin.inventory.priceHistory") },
  ];

  return (
    <AdminModal open onOpenChange={(next) => !next && onClose()} size="lg">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{product.name}</AdminModalTitle>
        <p className="mt-1 text-sm text-coffee/60">
          {t("admin.inventory.current")}: {stock.toFixed(2)}
          {t(unitLabelKey(product.purchaseUnit))}
        </p>
      </AdminModalHeader>
      <AdminModalBody>
        <div className="mb-4 flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm",
                tab === item.id ? "bg-turquoise text-white" : "bg-beige/50 text-coffee/70"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "info" && (
          <div className="space-y-2 text-sm">
            <p>{t("admin.costing.category")}: {product.category || "—"}</p>
            <p>{t("admin.costing.unit")}: {t(unitLabelKey(product.purchaseUnit))}</p>
            <p>{t("admin.inventory.minStock")}: {product.minStock ?? "—"}</p>
            <p>{t("admin.inventory.barcode")}: {product.barcode || "—"}</p>
            <p>{t("admin.costing.notes")}: {product.notes || "—"}</p>
            <p>{t("admin.inventory.lastPaid")}: {last ? formatIls(last.unitCost, 4) : "—"}</p>
            <Button type="button" variant="outline" onClick={onEdit}>{t("common.edit")}</Button>
          </div>
        )}

        {tab === "suppliers" && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {productOffers.map((offer) => {
                const supplier = suppliers.find((item) => item.id === offer.supplierId);
                const unit = offerPurchaseUnit(offer);
                const quote = offerNormalizedCost(offer);
                const paid = offerLastPurchaseCost(offer);
                return (
                  <div key={offer.id} className="rounded-2xl border border-beige-dark/20 p-3 text-sm">
                    <p className="font-semibold">
                      {supplier?.name ?? offer.supplierId}
                      {cheap?.id === offer.id && (
                        <span className="ms-2 text-emerald-700"><Trophy className="inline h-3 w-3" /> {t("admin.inventory.bestPrice")}</span>
                      )}
                    </p>
                    <p>{t("admin.inventory.listPrice")}: {quote != null && unit ? `${formatIls(quote, 4)}/${t(unitLabelKey(unit))}` : "—"}</p>
                    <p>{t("admin.inventory.lastPaid")}: {paid != null ? formatIls(paid, 4) : "—"}</p>
                    <p className="text-coffee/55">{t("admin.inventory.date")}: {offer.lastQuotedAt || offer.lastPurchaseDate || "—"}</p>
                  </div>
                );
              })}
            </div>
            <SupplierOffersPanel
              product={product}
              suppliers={suppliers}
              offers={offers}
              records={records}
              onToast={onToast}
            />
          </div>
        )}

        {tab === "ledger" && (
          <div className="space-y-2 text-sm">
            {movements
              .filter((row) => row.productId === product.id)
              .slice()
              .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
              .map((row) => (
                <div key={row.id} className="flex justify-between border-b border-beige-dark/10 py-1">
                  <span>{row.receivedAt.slice(0, 10)} · {row.type}</span>
                  <span>{row.type === "SALE_OUT" ? `-${row.quantity}` : `+${row.quantity}`}</span>
                </div>
              ))}
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-2 text-sm">
            {records
              .filter((row) => row.productId === product.id)
              .slice()
              .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))
              .map((row) => (
                <div key={row.id} className="flex justify-between border-b border-beige-dark/10 py-1">
                  <span>
                    {row.purchaseDate} · {suppliers.find((item) => item.id === row.supplierId)?.name || "—"}
                  </span>
                  <span>{formatIls(row.unitCost, 4)}</span>
                </div>
              ))}
          </div>
        )}
      </AdminModalBody>
    </AdminModal>
  );
}
