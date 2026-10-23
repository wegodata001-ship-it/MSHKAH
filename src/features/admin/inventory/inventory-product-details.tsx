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
import { useAuth } from "@/components/providers/auth-provider";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import { canReverseMovement, stockInDisplayUnit } from "@/lib/inventory/issue";
import { displayedLastPrice, shownRecordUnitPrices } from "@/lib/inventory/last-price";
import {
  cheapestOffer,
  currentStockBase,
  labeledPurchaseUnitPrice,
  latestPurchase,
  offerLastPurchaseCost,
  offerNormalizedCost,
  offerPurchaseUnit,
} from "@/lib/inventory/stock";
import type { InventoryMovement, PurchaseInvoice, PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { InventoryLedgerTable } from "@/features/admin/inventory/inventory-ledger-table";
import { SupplierOffersPanel } from "@/features/admin/inventory/supplier-offers-panel";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Locale } from "@/lib/i18n/types";
import type { Product } from "@/types";
import { mergeIngredients, reverseInventoryMovement } from "@/services/inventoryService";
import { SplitMergedProducts } from "@/features/admin/inventory/split-merged-products";
import { planIngredientMerge } from "@/lib/inventory/ingredient-core";
import { cn } from "@/lib/utils";

type DetailTab = "info" | "suppliers" | "ledger" | "history";

export function InventoryProductDetails({
  product,
  suppliers,
  offers,
  records,
  movements,
  invoices = [],
  recipes,
  products,
  itemMaps,
  allIngredients,
  locale,
  onOpenInvoice,
  onIssue,
  onEdit,
  onClose,
  onToast,
}: {
  product: CostingIngredient;
  suppliers: Supplier[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  movements: InventoryMovement[];
  invoices?: PurchaseInvoice[];
  recipes: DishRecipe[];
  products: Product[];
  itemMaps: SupplierItemMap[];
  allIngredients?: CostingIngredient[];
  locale: Locale;
  onOpenInvoice?: (invoiceId: string, lineId?: string) => void;
  onIssue: () => void;
  onEdit: () => void;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const [tab, setTab] = useState<DetailTab>("suppliers");
  const [reversing, setReversing] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState("");
  const [merging, setMerging] = useState(false);
  const stock = currentStockBase(movements, product.id);
  const displayStock = stockInDisplayUnit(stock, product);
  const productOffers = offers.filter((offer) => offer.productId === product.id && offer.active !== false);
  const cheap = cheapestOffer(productOffers, product.baseUnit);
  const last = latestPurchase(records, product.id);
  const shownPrice = displayedLastPrice(product, records);
  const aliases = itemMaps.filter((item) => item.inventoryProductId === product.id);
  const dishes = recipes.filter((recipe) => recipe.ingredients.some((line) => line.ingredientId === product.id));
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
          {t("admin.inventory.current")}: {displayStock.toFixed(2)} {t(unitLabelKey(product.purchaseUnit))}
        </p>
      </AdminModalHeader>
      <AdminModalBody className="min-w-0 overflow-x-hidden">
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
          <Button type="button" variant="turquoise" className="h-8 text-xs" onClick={onIssue}>
            {t("admin.inventory.issue")}
          </Button>
        </div>

        {tab === "info" && (
          <div className="space-y-2 text-sm">
            <p>{t("admin.costing.category")}: {product.category || "—"}</p>
            <p>{t("admin.costing.unit")}: {t(unitLabelKey(product.baseUnit))}</p>
            <p>{t("admin.inventory.minStock")}: {product.minStock ?? "—"}</p>
            <p>{t("admin.inventory.barcode")}: {product.barcode || "—"}</p>
            <p>{t("admin.costing.notes")}: {product.notes || "—"}</p>
            <div>
              <p>{t("admin.inventory.lastPaid")}:</p>
              {shownPrice?.excludingVat != null ? (
                <>
                  <p>{t("admin.inventory.priceExVat")}: {formatIls(shownPrice.excludingVat)}</p>
                  {shownPrice.includingVat != null ? (
                    <p>{t("admin.inventory.priceIncVat")}: {formatIls(shownPrice.includingVat)}</p>
                  ) : null}
                  <p className="text-coffee/60">
                    {suppliers.find((item) => item.id === (shownPrice.invoiceId ? records.find((row) => row.invoiceId === shownPrice.invoiceId)?.supplierId : last?.supplierId))?.name || "—"}
                    {` · ${shownPrice.quantity} ${t(unitLabelKey(shownPrice.unit))}`}
                    {shownPrice.purchaseDate ? ` · ${shownPrice.purchaseDate.slice(0, 10)}` : ""}
                    {invoices.find((invoice) => invoice.id === shownPrice.invoiceId)?.invoiceNumber
                      ? ` · ${invoices.find((invoice) => invoice.id === shownPrice.invoiceId)?.invoiceNumber}`
                      : ""}
                  </p>
                </>
              ) : "—"}
            </div>
            <div>
              <p className="font-medium">{t("admin.inventory.linkedDishes")}</p>
              {dishes.length === 0 ? (
                <p className="text-coffee/55">—</p>
              ) : (
                dishes.map((recipe) => {
                  const dish = products.find((item) => item.id === recipe.productId);
                  return <p key={recipe.id}>{dish ? getProductDisplayName(dish, locale) : recipe.productId}</p>;
                })
              )}
            </div>
            <Button type="button" variant="outline" onClick={onEdit}>{t("common.edit")}</Button>
            <SplitMergedProducts
              product={product}
              products={allIngredients ?? []}
              invoices={invoices}
              movements={movements}
              onDone={(message) => onToast(message)}
            />
            {allIngredients && allIngredients.length > 1 && (
              <div className="rounded-xl bg-beige/40 p-3">
                <p className="mb-2 font-medium">{t("admin.inventory.mergeTitle")}</p>
                <select className="h-9 w-full rounded-lg border px-2 text-sm" value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
                  <option value="">{t("admin.inventory.mergePick")}</option>
                  {allIngredients.filter((item) => item.id !== product.id && item.active !== false).map((item) => (
                    <option key={item.id} value={item.id}>{item.name} · {t(unitLabelKey(item.baseUnit))}</option>
                  ))}
                </select>
                {mergeId && (() => {
                  const loser = allIngredients.find((item) => item.id === mergeId);
                  if (!loser) return null;
                  const plan = planIngredientMerge({
                    survivor: product,
                    loser,
                    survivorBalance: stock,
                    loserBalance: currentStockBase(movements, loser.id),
                  });
                  if (!plan.ok) return <p className="mt-2 text-xs text-red-600">{t(`admin.inventory.merge.${plan.reason}`)}</p>;
                  return (
                    <div className="mt-2 space-y-1 text-xs">
                      <p>{t("admin.inventory.mergeSurvivor")}: {product.name} · {plan.survivorBalance}</p>
                      <p>{t("admin.inventory.mergeLoser")}: {loser.name} · {plan.loserBalance}</p>
                      <p>{t("admin.inventory.mergeResult")}: {plan.mergedBalance}</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-2 h-8 text-xs"
                        disabled={merging}
                        onClick={async () => {
                          setMerging(true);
                          const result = await mergeIngredients({ survivor: product, loser, actor: user?.email });
                          setMerging(false);
                          if (!result.success) {
                            onToast(result.error, "error");
                            return;
                          }
                          onToast(t("admin.inventory.mergeDone"));
                          onClose();
                        }}
                      >
                        {t("admin.inventory.mergeConfirm")}
                      </Button>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {tab === "suppliers" && (
          <div className="space-y-3">
            {aliases.length > 0 && (
              <div className="rounded-2xl bg-beige/40 p-3 text-sm">
                {aliases.map((alias) => (
                  <p key={alias.id}>
                    {suppliers.find((item) => item.id === alias.supplierId)?.name || alias.supplierId}: {t("admin.inventory.supplierAlias")} «{alias.supplierProductName}»
                    {alias.supplierSku ? ` · ${alias.supplierSku}` : ""}
                    {alias.packageQuantity && alias.purchaseUnit ? ` · ${alias.packageQuantity} ${t(unitLabelKey(alias.purchaseUnit))}` : ""}
                  </p>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {productOffers.map((offer) => {
                const supplier = suppliers.find((item) => item.id === offer.supplierId);
                const unit = offerPurchaseUnit(offer);
                const quote = offerNormalizedCost(offer);
                const paid = offerLastPurchaseCost(offer);
                const alias = aliases.find((item) => item.supplierId === offer.supplierId);
                return (
                  <div key={offer.id} className="rounded-2xl border border-beige-dark/20 p-3 text-sm">
                    <p className="font-semibold">
                      {supplier?.name ?? offer.supplierId}
                      {cheap?.id === offer.id && (
                        <span className="ms-2 text-emerald-700"><Trophy className="inline h-3 w-3" /> {t("admin.inventory.bestPrice")}</span>
                      )}
                    </p>
                    {alias && <p className="text-coffee/60">{t("admin.inventory.supplierAlias")}: {alias.supplierProductName}</p>}
                    <p>{t("admin.inventory.listPrice")}: {quote != null && unit ? `${formatIls(quote, 4)}/${t(unitLabelKey(product.baseUnit))}` : "—"}</p>
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
          <InventoryLedgerTable
            product={product}
            movements={movements}
            invoices={invoices}
            suppliers={suppliers}
            onOpenInvoice={onOpenInvoice}
            movementAction={(row) =>
              canReverseMovement(row, movements) ? (
                <button
                  type="button"
                  className="text-xs text-turquoise"
                  disabled={reversing === row.id}
                  onClick={async () => {
                    setReversing(row.id);
                    const result = await reverseInventoryMovement(row.id, user?.email);
                    setReversing(null);
                    onToast(result.success ? t("admin.inventory.reversed") : result.error, result.success ? "success" : "error");
                  }}
                >
                  {t("admin.inventory.reverse")}
                </button>
              ) : null
            }
          />
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
                  <span>
                    {(() => {
                      const prices = shownRecordUnitPrices(row, records.filter((item) => item.productId === product.id));
                      return prices.excludingVat != null
                        ? `${t("admin.inventory.priceExVat")} ${formatIls(prices.excludingVat)}${prices.includingVat != null ? ` · ${t("admin.inventory.priceIncVat")} ${formatIls(prices.includingVat)}` : ""}`
                        : formatIls(row.unitCost, 4);
                    })()}
                  </span>
                </div>
              ))}
          </div>
        )}
      </AdminModalBody>
    </AdminModal>
  );
}
