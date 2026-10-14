"use client";

import { useMemo, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import { cheapestLastPurchase, cheapestOffer, currentStockBase, latestPurchase, movementSignedBase, offerNormalizedLastPurchase, offerNormalizedNet, reorderQty, stockInBase, stockOutBase } from "@/lib/inventory/stock";
import { stockInDisplayUnit } from "@/lib/inventory/issue";
import { IssueIngredientForm } from "@/features/admin/inventory/issue-ingredient-form";
import { InvoiceStockTransfer } from "@/features/admin/inventory/invoice-stock-transfer";
import { theoreticalConsumption } from "@/lib/inventory/pos";
import type {
  InventoryMovement,
  PosImport,
  PosProductMap,
  PosSaleLine,
  PurchaseInvoice,
  PurchasePriceRecord,
  Supplier,
  SupplierOffer,
} from "@/lib/inventory/types";
import type { Product } from "@/types";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Locale } from "@/lib/i18n/types";
import {
  approvePosImport,
  savePosDraft,
  savePosProductMap,
  saveSupplier,
} from "@/services/inventoryService";
import { cn } from "@/lib/utils";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { SupplierInvoiceForm } from "@/features/admin/inventory/supplier-invoice-form";
import { InventoryProductDetails } from "@/features/admin/inventory/inventory-product-details";
import { InvoiceArchivePanel } from "@/features/admin/inventory/invoice-archive-panel";
import { SmartInvoiceFlow, useSmartInvoiceEnabled } from "@/features/admin/inventory/smart-invoice-flow";

type InventoryPane = "products" | "ledger" | "alerts";
type PurchasePane = "invoices" | "suppliers" | "compare";
type PosPane = "upload" | "maps" | "history";

export function InventorySection(props: InventoryHubProps & { pane: InventoryPane }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null | "all">(null);
  const q = search.trim().toLowerCase();

  const rows = props.ingredients
    .filter((item) => item.active !== false)
    .filter((item) => !q || item.name.toLowerCase().includes(q))
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
      const supplierName = props.suppliers.find((s) => s.id === (item.lastSupplierId || last?.supplierId || lastOffer?.supplierId))?.name;
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
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.inventory.search")} className="max-w-sm" />
        <Button type="button" variant={missingOnly ? "turquoise" : "outline"} onClick={() => setMissingOnly((v) => !v)}>
          {t("admin.inventory.filterMissingSupplier")}
        </Button>
        <Button type="button" variant="outline" onClick={() => setIssueId("all")}>
          {t("admin.inventory.issue")}
        </Button>
        <Button type="button" variant="turquoise" onClick={props.onAddProduct}>
          <Plus className="h-4 w-4" /> {t("admin.inventory.newProduct")}
        </Button>
      </div>

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
                  <td className="px-3 py-2 text-end">{row.opening.toFixed(1)}</td>
                  <td className="px-3 py-2 text-end">{row.incoming.toFixed(1)}</td>
                  <td className="px-3 py-2 text-end">{row.outgoing.toFixed(1)}</td>
                  <td className="px-3 py-2 text-end font-semibold">{row.current.toFixed(1)}</td>
                  <td className="px-3 py-2">{row.supplierName || "—"}</td>
                  <td className="px-3 py-2 text-end">{row.last ? formatIls(row.last.unitCost, 4) : "—"}</td>
                  <td className="px-3 py-2 text-end">
                    {row.cheap
                      ? `${formatIls(offerNormalizedNet(row.cheap) ?? 0, 4)} — ${row.cheapName ?? ""}`
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
                  <td className="py-2">{movementSignedBase(row) < 0 ? `-${row.quantity}` : `+${row.quantity}`}</td>
                  <td className="py-2 text-coffee/60">
                    {t(`admin.inventory.movement.${row.type}`, row.type)} {row.reason ? `· ${t(`admin.inventory.reason.${row.reason}`)}` : ""} {supplier ? `· ${supplier}` : ""}
                  </td>
                  <td className="py-2 text-end">{running.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm font-semibold">
          {t("admin.inventory.balance")}: {currentStockBase(movements, productId ?? "").toFixed(2)}
        </p>
      </AdminCard>
    </div>
  );
}

export function PurchaseSection(props: InventoryHubProps & { pane: PurchasePane }) {
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

function ComparePane({ ingredients, offers, records, movements, suppliers }: InventoryHubProps) {
  const t = useT();
  const [productId, setProductId] = useState(ingredients[0]?.id ?? "");
  const [mode, setMode] = useState<"net" | "vat" | "gross">("net");
  const item = ingredients.find((row) => row.id === productId);
  const itemOffers = offers.filter((offer) => offer.productId === productId && offer.active !== false);
  const cheap = item ? cheapestLastPurchase(itemOffers, mode === "gross" ? "gross" : "net", item.baseUnit) : cheapestLastPurchase(itemOffers, mode === "gross" ? "gross" : "net");
  const last = latestPurchase(records, productId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select className="h-10 rounded-xl border px-3 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {ingredients.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
        <Button type="button" variant={mode === "net" ? "turquoise" : "outline"} onClick={() => setMode("net")}>{t("admin.finance.compareNet")}</Button>
        <Button type="button" variant={mode === "vat" ? "turquoise" : "outline"} onClick={() => setMode("vat")}>{t("admin.inventory.vat")}</Button>
        <Button type="button" variant={mode === "gross" ? "turquoise" : "outline"} onClick={() => setMode("gross")}>{t("admin.finance.compareGross")}</Button>
      </div>
      {item && (
        <AdminCard title={item.name}>
          <p className="mb-3 text-xs text-coffee/55">{t("admin.inventory.cheapestHint")}</p>
          <div className="space-y-2 text-sm">
            {itemOffers.map((offer) => {
              const supplier = suppliers.find((s) => s.id === offer.supplierId);
              const net = offerNormalizedNet(offer);
              const gross = offerNormalizedLastPurchase(offer);
              const vat = net != null && gross != null ? gross - net : null;
              const cost = mode === "net" ? net : mode === "vat" ? vat : gross;
              const cheapNet = cheap ? offerNormalizedNet(cheap) : undefined;
              const cheapGross = cheap ? offerNormalizedLastPurchase(cheap) : undefined;
              const cheapVat = cheapNet != null && cheapGross != null ? cheapGross - cheapNet : undefined;
              const cheapCost = mode === "net" ? cheapNet : mode === "vat" ? cheapVat : cheapGross;
              const gap = cost != null && cheapCost != null ? cost - cheapCost : 0;
              return (
                <div key={offer.id} className="rounded-xl bg-beige/30 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span>
                      {supplier?.name ?? offer.supplierId}{" "}
                      {cheap?.id === offer.id && <span className="text-emerald-700">🏆 {t("admin.inventory.cheapest")}</span>}
                    </span>
                    <span>{cost != null ? formatIls(cost, 4) : "—"}{cheap?.id !== offer.id && gap > 0 ? ` · +${formatIls(gap, 4)}` : ""}</span>
                  </div>
                  <p className="mt-1 text-xs text-coffee/55">
                    {t("admin.finance.netTotal")}: {net != null ? formatIls(net, 4) : "—"}
                    {" · "}
                    {t("admin.inventory.vat")}: {vat != null ? formatIls(vat, 4) : "—"}
                    {" · "}
                    {t("admin.finance.grossTotal")}: {gross != null ? formatIls(gross, 4) : "—"}
                    {" · "}
                    {t("admin.inventory.lastPaid")}: {offer.lastPurchaseDate || last?.purchaseDate || "—"}
                  </p>
                </div>
              );
            })}
          </div>
        </AdminCard>
      )}
    </div>
  );
}

function InvoicesPane(props: InventoryHubProps) {
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
        invoices={props.invoices}
        vatRate={props.settingsVatRate}
        initialInvoice={smartInvoice}
        onToast={props.onToast}
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
  if (props.pane === "maps") return <PosMapsPane {...props} />;
  if (props.pane === "history") {
    return (
      <div className="space-y-2">
        {props.posImports.map((item) => (
          <div key={item.id} className="rounded-2xl border border-beige-dark/20 px-4 py-3 text-sm">
            {item.fileName} · {item.period} · {item.status} · {item.lines.length}
          </div>
        ))}
      </div>
    );
  }
  return <PosUploadPane {...props} />;
}

function PosMapsPane({ products, maps, locale, onToast }: InventoryHubProps) {
  const t = useT();
  const [posName, setPosName] = useState("");
  const [posCode, setPosCode] = useState("");
  const [menuProductId, setMenuProductId] = useState("");
  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.inventory.posMatch")}>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input value={posCode} onChange={(e) => setPosCode(e.target.value)} placeholder="POS code" />
          <Input value={posName} onChange={(e) => setPosName(e.target.value)} placeholder="POS name" />
          <select className="h-10 rounded-xl border px-3 text-sm" value={menuProductId} onChange={(e) => setMenuProductId(e.target.value)}>
            <option value="">{t("admin.inventory.matchExisting")}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {getProductDisplayName(product, locale)}
              </option>
            ))}
          </select>
        </div>
        <Button
          className="mt-3"
          type="button"
          variant="turquoise"
          onClick={async () => {
            if (!posName || !menuProductId) return;
            const result = await savePosProductMap({ posCode, posName, menuProductId });
            if (result.success) onToast(t("admin.inventory.mapSaved"));
            else onToast(result.error, "error");
          }}
        >
          {t("common.save")}
        </Button>
      </AdminCard>
      {maps.map((item) => (
        <p key={item.id} className="text-sm">
          {item.posName} → {getProductDisplayName(products.find((p) => p.id === item.menuProductId) ?? products[0], locale)}
        </p>
      ))}
    </div>
  );
}

function PosUploadPane(props: InventoryHubProps) {
  const t = useT();
  const authFetch = useAuthFetch();
  const [review, setReview] = useState<{
    fileName: string;
    fileHash: string;
    period: string;
    lines: PosSaleLine[];
    previousImportId?: string;
    delta?: { added: number; changed: number; removed: number; unchanged: number } | null;
    draftId?: string;
  } | null>(null);

  const consumption = useMemo(
    () => (review ? theoreticalConsumption(review.lines, props.recipes) : []),
    [review, props.recipes]
  );

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center rounded-3xl border border-dashed border-coffee/25 px-6 py-10">
        <Upload className="h-8 w-8" />
        <p className="mt-3 font-semibold">{t("admin.inventory.uploadPos")}</p>
        <p className="text-sm text-coffee/55">XLSX / CSV</p>
        <input
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const form = new FormData();
            form.set("file", file);
            const response = await authFetch("/api/admin/inventory/pos/parse", { method: "POST", body: form });
            const json = await response.json();
            if (json.duplicate) {
              props.onToast(t("admin.inventory.duplicateFile"), "error");
              return;
            }
            const saved = await savePosDraft({
              fileName: json.fileName,
              fileHash: json.fileHash,
              source: "pos-file",
              period: json.period,
              status: "draft",
              lines: json.lines,
              previousImportId: json.previousImportId,
            });
            if (!saved.success) {
              props.onToast(saved.error, "error");
              return;
            }
            setReview({ ...json, draftId: saved.data });
          }}
        />
      </label>

      {review && (
        <AdminCard title={t("admin.inventory.posReview")}>
          <p>{t("admin.inventory.period")}: {review.period}</p>
          <p>{t("admin.inventory.salesCount")}: {review.lines.length}</p>
          <p>
            {t("admin.inventory.matched")}: {review.lines.filter((line) => line.menuProductId).length} ·{" "}
            {t("admin.inventory.unmatched")}: {review.lines.filter((line) => !line.menuProductId).length}
          </p>
          {review.delta && (
            <p className="text-sm text-coffee/65">
              +{review.delta.added} / ~{review.delta.changed} / -{review.delta.removed} / ={review.delta.unchanged}
            </p>
          )}
          <div className="mt-3 space-y-1 text-sm">
            {consumption.map((row) => {
              const name = props.ingredients.find((item) => item.id === row.productId)?.name ?? row.productId;
              return (
                <p key={row.productId}>
                  {name}: -{row.quantityBase.toFixed(1)} {row.unit}
                </p>
              );
            })}
          </div>
          {review.lines
            .filter((line) => !line.menuProductId)
            .map((line) => (
              <div key={line.key} className="mt-2 flex gap-2">
                <span className="flex-1 text-sm">{line.posName}</span>
                <select
                  className="h-9 rounded-lg border px-2 text-sm"
                  onChange={(e) => {
                    const menuProductId = e.target.value;
                    if (!menuProductId) return;
                    void savePosProductMap({ posCode: line.posCode, posName: line.posName, menuProductId });
                    setReview((current) =>
                      current
                        ? {
                            ...current,
                            lines: current.lines.map((item) =>
                              item.key === line.key ? { ...item, menuProductId, matchKind: "exact" } : item
                            ),
                          }
                        : current
                    );
                  }}
                >
                  <option value="">{t("admin.inventory.matchExisting")}</option>
                  {props.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {getProductDisplayName(product, props.locale)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          <Button
            className="mt-4"
            type="button"
            variant="turquoise"
            onClick={async () => {
              if (!review.draftId) return;
              const previous = props.posImports.find((item) => item.id === review.previousImportId);
              const result = await approvePosImport({
                draft: {
                  id: review.draftId,
                  fileName: review.fileName,
                  fileHash: review.fileHash,
                  source: "pos-file",
                  period: review.period,
                  status: "draft",
                  lines: review.lines,
                  createdAt: new Date().toISOString(),
                },
                recipes: props.recipes,
                previous,
              });
              if (!result.success) {
                props.onToast(result.error, "error");
                return;
              }
              props.onToast(t("admin.inventory.posApproved"));
              setReview(null);
            }}
          >
            {t("admin.inventory.approvePos")}
          </Button>
        </AdminCard>
      )}
    </div>
  );
}

export type InventoryHubProps = {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  offers: SupplierOffer[];
  movements: InventoryMovement[];
  records: PurchasePriceRecord[];
  invoices: PurchaseInvoice[];
  posImports: PosImport[];
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
