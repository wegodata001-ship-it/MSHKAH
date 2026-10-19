"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import { filterUnifiedIngredients } from "@/lib/inventory/ingredient-core";
import { ComparePane } from "@/features/admin/inventory/compare-pane";
import { cheapestOffer, currentStockBase, labeledPurchaseUnitPrice, latestPurchase, movementSignedBase, offerNormalizedNet, reorderQty, stockInBase, stockOutBase } from "@/lib/inventory/stock";
import { purchaseQuantityInBase } from "@/lib/costing/units";
import { stockInDisplayUnit } from "@/lib/inventory/issue";
import type { PurchaseUnit } from "@/lib/costing/types";
import { IssueIngredientForm } from "@/features/admin/inventory/issue-ingredient-form";
import { InvoiceStockTransfer } from "@/features/admin/inventory/invoice-stock-transfer";
import type {
  InventoryMovement,
  PosFinanceEntry,
  PosImport,
  PosProductMap,
  PosZReport,
  PurchaseInvoice,
  PurchasePriceRecord,
  Supplier,
  SupplierOffer,
} from "@/lib/inventory/types";
import type { Product } from "@/types";
import type { Locale } from "@/lib/i18n/types";
import { saveSupplier } from "@/services/inventoryService";
import { cn } from "@/lib/utils";
import { PosExcelPanel } from "@/features/admin/inventory/pos-excel-panel";
import { PosHistoryPanel } from "@/features/admin/inventory/pos-history-panel";
import { PosZPanel } from "@/features/admin/inventory/pos-z-panel";
import { SupplierInvoiceForm } from "@/features/admin/inventory/supplier-invoice-form";
import { InventoryProductDetails } from "@/features/admin/inventory/inventory-product-details";
import { InvoiceArchivePanel } from "@/features/admin/inventory/invoice-archive-panel";
import { SmartInvoiceFlow, useSmartInvoiceEnabled } from "@/features/admin/inventory/smart-invoice-flow";
import { StockCountPanel } from "@/features/admin/inventory/stock-count-panel";
import { PurchaseListPanel } from "@/features/admin/inventory/purchase-list-panel";

function priceUnitKey(unit: PurchaseUnit): string {
  if (unit === "kg") return "admin.compare.eachKg";
  if (unit === "g") return "admin.costing.perGram";
  if (unit === "liter") return "admin.compare.eachLiter";
  if (unit === "ml") return "admin.costing.perMl";
  return "admin.compare.eachUnit";
}

function moneyWithUnit(amount: number, unit: PurchaseUnit, t: (key: string) => string): string {
  return `${formatIls(amount)} ${t(priceUnitKey(unit))}`;
}

type InventoryPane = "products" | "ledger" | "alerts";
type PurchasePane = "invoices" | "suppliers" | "compare";
type PosPane = "excel" | "z" | "history";

export function InventorySection(props: InventoryHubProps & { pane: InventoryPane }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null | "all">(null);
  const [purchaseImport, setPurchaseImport] = useState(false);
  const categories = Array.from(new Set(props.ingredients.map((item) => item.category).filter(Boolean))) as string[];

  const rows = filterUnifiedIngredients({
    ingredients: props.ingredients,
    maps: props.itemMaps,
    offers: props.offers,
    movements: props.movements,
    query: search,
    category: category || undefined,
    supplierId: supplierId || undefined,
    lowStockOnly,
  })
    .filter((item) => {
      if (!missingOnly) return true;
      return !props.offers.some((offer) => offer.productId === item.id && offer.active !== false);
    })
    .map((item) => {
      const current = currentStockBase(props.movements, item.id);
      const incoming = stockInBase(props.movements, item.id);
      const outgoing = stockOutBase(props.movements, item.id);
      const last = latestPurchase(props.records, item.id);
      const itemOffers = props.offers.filter((offer) => offer.productId === item.id && offer.active !== false);
      const lastOffer = itemOffers
        .slice()
        .sort((a, b) => (b.lastPurchasedAt ?? b.lastPurchaseDate ?? "").localeCompare(a.lastPurchasedAt ?? a.lastPurchaseDate ?? ""))[0];
      const cheap = cheapestOffer(itemOffers, item.baseUnit);
      const supplierName =
        props.suppliers.find((s) => s.id === (item.lastSupplierId || last?.supplierId || lastOffer?.supplierId))?.name ||
        item.supplier?.trim() ||
        "";
      const cheapName = props.suppliers.find((s) => s.id === cheap?.supplierId)?.name;
      const belowMin = item.minStock != null && current < item.minStock;
      const opening = props.movements
        .filter((row) => row.productId === item.id && row.type === "OPENING")
        .reduce((sum, row) => sum + row.quantityBase, 0);
      const toOrder = reorderQty(current, item.recommendedStock ?? item.minStock ?? 0);
      return { item, current, incoming, outgoing, last, cheap, cheapName, supplierName, belowMin, missingSupplier: !itemOffers.length, opening, toOrder };
    });

  const alerts = rows.filter((row) => row.belowMin || row.missingSupplier);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.inventory.searchAlsoAlias")} className="max-w-sm" />
        <select className="h-10 rounded-xl border px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("admin.costing.category")}</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="h-10 rounded-xl border px-2 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">{t("admin.costing.supplier")}</option>
          {props.suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Button type="button" variant={lowStockOnly ? "turquoise" : "outline"} onClick={() => setLowStockOnly((v) => !v)}>
          {t("admin.inventory.belowMin")}
        </Button>
        <Button type="button" variant={missingOnly ? "turquoise" : "outline"} onClick={() => setMissingOnly((v) => !v)}>
          {t("admin.inventory.filterMissingSupplier")}
        </Button>
        <Button type="button" variant="outline" onClick={() => setIssueId("all")}>
          {t("admin.inventory.issue")}
        </Button>
        <StockCountPanel ingredients={props.ingredients} movements={props.movements} onToast={props.onToast} />
        {props.pane === "products" && (
          <Button type="button" variant="outline" onClick={() => setPurchaseImport((value) => !value)}>
            {t("admin.purchaseList.open")}
          </Button>
        )}
        <Button type="button" variant="turquoise" onClick={props.onAddProduct}>
          <Plus className="h-4 w-4" /> {t("admin.inventory.newProduct")}
        </Button>
      </div>
      {purchaseImport && props.pane === "products" && <PurchaseListPanel {...props} />}

      {props.pane === "alerts" && (
        <AdminCard title={t("admin.inventory.alerts")}>
          {alerts.length === 0 ? (
            <p className="text-sm text-coffee/55">{t("admin.inventory.noAlerts")}</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((row) => (
                <div key={row.item.id} className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm">
                  <span>{row.item.name}</span>
                  <span className="text-amber-800">
                    {row.missingSupplier ? t("admin.inventory.missingSupplier") : t("admin.inventory.belowMin")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {props.pane === "ledger" && (
        <LedgerPane
          ingredients={props.ingredients}
          movements={props.movements}
          suppliers={props.suppliers}
          selectedId={ledgerId}
          onSelect={setLedgerId}
        />
      )}

      {props.pane !== "ledger" && (
        <>
        <div className="space-y-2 lg:hidden">
          {rows.map((row) => (
            <div key={row.item.id} className="rounded-2xl border border-beige-dark/15 p-3">
              <button type="button" className="font-semibold" onClick={() => setDetailsId(row.item.id)}>{row.item.name}</button>
              <p className="mt-1 text-sm text-coffee/65">
                {t("admin.inventory.current")}: {stockInDisplayUnit(row.current, row.item).toFixed(2)} {t(unitLabelKey(row.item.purchaseUnit))}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="text-sm text-turquoise" onClick={() => setIssueId(row.item.id)}>{t("admin.inventory.issue")}</button>
                <button type="button" className="text-sm text-turquoise" onClick={() => props.onEditProduct(row.item)}>{t("common.edit")}</button>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-2xl border border-beige-dark/20 lg:block">
          <table className="min-w-[920px] w-full text-sm">
            <thead className="bg-beige/40 text-coffee/70">
              <tr>
                <th className="px-3 py-2 text-start">{t("admin.inventory.product")}</th>
                <th className="px-3 py-2 text-start">{t("admin.costing.category")}</th>
                <th className="px-3 py-2 text-end">{t("admin.inventory.opening")}</th>
                <th className="px-3 py-2 text-end">{t("admin.inventory.stockIn")}</th>
                <th className="px-3 py-2 text-end">{t("admin.inventory.consumption")}</th>
                <th className="px-3 py-2 text-end">{t("admin.inventory.current")}</th>
                <th className="px-3 py-2 text-start">{t("admin.inventory.lastSupplier")}</th>
                <th className="px-3 py-2 text-end">{t("admin.inventory.lastPrice")}</th>
                <th className="px-3 py-2 text-end">{t("admin.inventory.bestPrice")}</th>
                <th className="px-3 py-2 text-start">{t("admin.inventory.status")}</th>
                <th className="px-3 py-2 text-start">{t("admin.inventory.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.item.id} className="border-t border-beige-dark/10">
                  <td className="px-3 py-2">
                    <button type="button" className="font-medium text-start" onClick={() => setDetailsId(row.item.id)}>
                      {row.item.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-coffee/60">{row.item.category || "—"}</td>
                  <td className="px-3 py-2 text-end">{stockInDisplayUnit(row.opening, row.item).toFixed(2)} {t(unitLabelKey(row.item.purchaseUnit))}</td>
                  <td className="px-3 py-2 text-end">{stockInDisplayUnit(row.incoming, row.item).toFixed(2)} {t(unitLabelKey(row.item.purchaseUnit))}</td>
                  <td className="px-3 py-2 text-end">{stockInDisplayUnit(row.outgoing, row.item).toFixed(2)} {t(unitLabelKey(row.item.purchaseUnit))}</td>
                  <td className="px-3 py-2 text-end font-semibold">{stockInDisplayUnit(row.current, row.item).toFixed(2)} {t(unitLabelKey(row.item.purchaseUnit))}</td>
                  <td className="px-3 py-2">{row.supplierName || "—"}</td>
                  <td className="px-3 py-2 text-end">
                    {row.last && labeledPurchaseUnitPrice(row.last)
                      ? moneyWithUnit(labeledPurchaseUnitPrice(row.last)!.amount, labeledPurchaseUnitPrice(row.last)!.unit, t)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-end">
                    {row.cheap
                      ? `${moneyWithUnit((offerNormalizedNet(row.cheap) ?? 0) * purchaseQuantityInBase(1, row.item.purchaseUnit), row.item.purchaseUnit, t)} — ${row.cheapName ?? ""}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.missingSupplier ? (
                      <span className="text-amber-700">{t("admin.inventory.missingSupplier")}</span>
                    ) : row.belowMin ? (
                      <span className="text-red-600">{t("admin.inventory.belowMin")}</span>
                    ) : (
                      <span className="text-emerald-700">{t("admin.inventory.ok")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="text-turquoise" onClick={() => setIssueId(row.item.id)}>
                        {t("admin.inventory.issue")}
                      </button>
                      <button type="button" className="text-turquoise" onClick={() => props.onEditProduct(row.item)}>
                        {t("common.edit")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      {detailsId && (() => {
        const product = props.ingredients.find((item) => item.id === detailsId);
        if (!product) return null;
        return (
          <InventoryProductDetails
            product={product}
            suppliers={props.suppliers}
            offers={props.offers}
            records={props.records}
            movements={props.movements}
            recipes={props.recipes}
            products={props.products}
            itemMaps={props.itemMaps ?? []}
            allIngredients={props.ingredients}
            locale={props.locale}
            onIssue={() => setIssueId(product.id)}
            onEdit={() => {
              setDetailsId(null);
              props.onEditProduct(product);
            }}
            onClose={() => setDetailsId(null)}
            onToast={props.onToast}
          />
        );
      })()}
      {issueId != null && (
        <IssueIngredientForm
          open
          ingredients={props.ingredients}
          movements={props.movements}
          recipes={props.recipes}
          products={props.products}
          initialProductId={issueId === "all" ? undefined : issueId}
          onClose={() => setIssueId(null)}
          onToast={props.onToast}
        />
      )}
    </div>
  );
}

function LedgerPane({
  ingredients,
  movements,
  suppliers,
  selectedId,
  onSelect,
}: {
  ingredients: CostingIngredient[];
  movements: InventoryMovement[];
  suppliers: Supplier[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const productId = selectedId ?? ingredients[0]?.id;
  const product = ingredients.find((item) => item.id === productId);
  const rows = movements
    .filter((row) => row.productId === productId)
    .slice()
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.createdAt.localeCompare(b.createdAt));
  let running = 0;
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="space-y-1">
        {ingredients.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn("w-full rounded-xl px-3 py-2 text-start text-sm", productId === item.id ? "bg-coffee text-warm-white" : "hover:bg-beige/50")}
          >
            {item.name}
          </button>
        ))}
      </div>
      <AdminCard title={t("admin.inventory.ledger")}>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => {
              running += movementSignedBase(row);
              const supplier = suppliers.find((item) => item.id === row.supplierId)?.name;
              return (
                <tr key={row.id} className="border-b border-beige-dark/10">
                  <td className="py-2">{row.receivedAt.slice(0, 10)}</td>
                  <td className="py-2">{movementSignedBase(row) < 0 ? `-${row.quantity}` : `+${row.quantity}`} {row.unit ? t(unitLabelKey(row.unit)) : ""}</td>
                  <td className="py-2 text-coffee/60">
                    {t(`admin.inventory.movement.${row.type}`, row.type)} {row.reason ? `· ${t(`admin.inventory.reason.${row.reason}`)}` : ""} {supplier ? `· ${supplier}` : ""}
                  </td>
                  <td className="py-2 text-end">{product ? `${stockInDisplayUnit(running, product).toFixed(2)} ${t(unitLabelKey(product.purchaseUnit))}` : running.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm font-semibold">
          {t("admin.inventory.balance")}: {product ? `${stockInDisplayUnit(currentStockBase(movements, productId ?? ""), product).toFixed(2)} ${t(unitLabelKey(product.purchaseUnit))}` : currentStockBase(movements, productId ?? "").toFixed(2)}
        </p>
      </AdminCard>
    </div>
  );
}

export function PurchaseSection(props: InventoryHubProps & { pane: PurchasePane; onViewInventory?: () => void }) {
  if (props.pane === "suppliers") return <SuppliersPane {...props} />;
  if (props.pane === "compare") return <ComparePane {...props} />;
  return <InvoicesPane {...props} />;
}

function SuppliersPane({ suppliers, onToast }: InventoryHubProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.inventory.addSupplier")}>
        <div className="flex flex-wrap gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.inventory.supplierName")} className="max-w-xs" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("admin.settings.phone")} className="max-w-xs" />
          <Button
            type="button"
            variant="turquoise"
            onClick={async () => {
              if (!name.trim()) return;
              const result = await saveSupplier({ name, phone });
              if (result.success) {
                setName("");
                setPhone("");
                onToast(t("admin.inventory.supplierSaved"));
              } else onToast(result.error, "error");
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </AdminCard>
      <div className="grid gap-2 sm:grid-cols-2">
        {suppliers.map((item) => (
          <div key={item.id} className="rounded-2xl border border-beige-dark/20 p-4">
            <p className="font-semibold">{item.name}</p>
            {item.phone && <p className="text-sm text-coffee/55">{item.phone}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoicesPane(props: InventoryHubProps & { onViewInventory?: () => void }) {
  const t = useT();
  const ai = useSmartInvoiceEnabled();
  const [draft, setDraft] = useState<PurchaseInvoice | "new" | null>(null);
  const [smart, setSmart] = useState(false);
  const [smartInvoice, setSmartInvoice] = useState<PurchaseInvoice | null>(null);
  const [transferInvoice, setTransferInvoice] = useState<PurchaseInvoice | null>(null);

  if (transferInvoice) {
    return (
      <InvoiceStockTransfer
        invoice={transferInvoice}
        ingredients={props.ingredients}
        suppliers={props.suppliers}
        onToast={props.onToast}
        onClose={() => setTransferInvoice(null)}
      />
    );
  }

  if (smart) {
    return (
      <SmartInvoiceFlow
        ingredients={props.ingredients}
        suppliers={props.suppliers}
        maps={props.itemMaps}
        offers={props.offers}
        invoices={props.invoices}
        vatRate={props.settingsVatRate}
        initialInvoice={smartInvoice}
        onToast={props.onToast}
        onViewInventory={props.onViewInventory}
        onOpenExisting={(invoice) => setSmartInvoice(invoice)}
        onClose={() => {
          setSmart(false);
          setSmartInvoice(null);
        }}
        onManual={() => {
          setSmart(false);
          setDraft(smartInvoice ?? "new");
          setSmartInvoice(null);
        }}
      />
    );
  }

  if (draft) {
    return (
      <SupplierInvoiceForm
        invoice={draft}
        ingredients={props.ingredients}
        suppliers={props.suppliers}
        vatRate={props.settingsVatRate}
        onToast={props.onToast}
        onClose={() => setDraft(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PurchaseListPanel {...props} />
      <AdminCard title={t("admin.finance.purchases")}>
        <p className="mb-3 text-sm text-coffee/60">{t("admin.finance.purchasesHint")}</p>
        <div className="flex flex-wrap gap-2">
          {ai?.configured && ai.reachable ? (
            <Button type="button" variant="turquoise" onClick={() => setSmart(true)}>{t("admin.finance.scanInvoice")}</Button>
          ) : ai?.configured ? (
            <>
              <p className="self-center text-xs text-coffee/50">{t("admin.inventory.smart.unavailable")}</p>
              <Button type="button" variant="outline" onClick={() => setSmart(true)}>{t("admin.inventory.smart.retry")}</Button>
            </>
          ) : (
            <p className="self-center text-xs text-coffee/50">{t("admin.inventory.smart.notConfigured")}</p>
          )}
          <Button type="button" variant="outline" onClick={() => setSmart(true)}>{t("admin.finance.uploadPdf")}</Button>
          <Button type="button" variant="outline" onClick={() => setSmart(true)}>{t("admin.finance.uploadImage")}</Button>
          <Button type="button" variant="outline" onClick={() => setSmart(true)}>{t("admin.inventory.smart.camera")}</Button>
          <Button type="button" variant="outline" onClick={() => setDraft("new")}>
            <Plus className="h-4 w-4" /> {t("admin.inventory.smart.manual")}
          </Button>
        </div>
      </AdminCard>
      <AdminCard title={t("admin.inventory.archive.title")}>
        <InvoiceArchivePanel
          invoices={props.invoices}
          onOpen={(invoice) => {
            if (invoice.sourceFile || invoice.scanStatus || invoice.aiProvider) {
              setSmartInvoice(invoice);
              setSmart(true);
              return;
            }
            setDraft(invoice);
          }}
          onRescan={(invoice) => {
            setSmartInvoice(invoice);
            setSmart(true);
          }}
          onTransfer={setTransferInvoice}
        />
      </AdminCard>
    </div>
  );
}

export function PosSection(props: InventoryHubProps & { pane: PosPane }) {
  const [opened, setOpened] = useState<PosImport | null>(null);
  if (props.pane === "z") return <PosZPanel {...props} />;
  if (props.pane === "history") {
    return (
      <div className="space-y-4">
        <PosHistoryPanel {...props} onOpenExcel={setOpened} />
        {opened && <PosExcelPanel {...props} opened={opened} onCloseOpened={() => setOpened(null)} />}
      </div>
    );
  }
  return <PosExcelPanel {...props} opened={opened} onCloseOpened={() => setOpened(null)} />;
}

export type InventoryHubProps = {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  offers: SupplierOffer[];
  movements: InventoryMovement[];
  records: PurchasePriceRecord[];
  invoices: PurchaseInvoice[];
  posImports: PosImport[];
  zReports: PosZReport[];
  financeEntries: PosFinanceEntry[];
  maps: PosProductMap[];
  recipes: DishRecipe[];
  products: Product[];
  itemMaps?: import("@/lib/inventory/types").SupplierItemMap[];
  locale: Locale;
  settingsVatRate: number;
  onToast: (message: string, variant?: "success" | "error") => void;
  onAddProduct: () => void;
  onEditProduct: (item: CostingIngredient) => void;
};

export { SupplierOffersPanel as SupplierOffersEditor } from "@/features/admin/inventory/supplier-offers-panel";
