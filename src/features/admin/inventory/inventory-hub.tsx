"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, ScanLine, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, DishRecipe, PurchaseUnit } from "@/lib/costing/types";
import { cheapestOffer, currentStockBase, latestPurchase, reorderQty, stockInBase, stockOutBase } from "@/lib/inventory/stock";
import { theoreticalConsumption } from "@/lib/inventory/pos";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/inventory/vat";
import type {
  InventoryMovement,
  PosImport,
  PosProductMap,
  PosSaleLine,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchasePriceRecord,
  Supplier,
  SupplierOffer,
  VatType,
} from "@/lib/inventory/types";
import type { Product } from "@/types";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Locale } from "@/lib/i18n/types";
import {
  approvePosImport,
  approvePurchaseInvoice,
  linkSupplierOffer,
  savePosDraft,
  savePosProductMap,
  savePurchaseInvoiceDraft,
  saveSupplier,
} from "@/services/inventoryService";
import { createIngredient } from "@/services/costingService";
import { cn } from "@/lib/utils";
import { useAuthFetch } from "@/lib/auth/auth-fetch";

type InventoryPane = "products" | "ledger" | "alerts";
type PurchasePane = "invoices" | "suppliers" | "compare";
type PosPane = "upload" | "maps" | "history";

export function InventorySection(props: InventoryHubProps & { pane: InventoryPane }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const q = search.trim().toLowerCase();

  const rows = props.ingredients
    .filter((item) => item.active !== false)
    .filter((item) => !q || item.name.toLowerCase().includes(q))
    .filter((item) => {
      if (!missingOnly) return true;
      return !props.offers.some((offer) => offer.productId === item.id);
    })
    .map((item) => {
      const current = currentStockBase(props.movements, item.id);
      const incoming = stockInBase(props.movements, item.id);
      const outgoing = stockOutBase(props.movements, item.id);
      const last = latestPurchase(props.records, item.id);
      const lastOffer = props.offers
        .filter((offer) => offer.productId === item.id)
        .slice()
        .sort((a, b) => (b.lastPurchaseDate ?? "").localeCompare(a.lastPurchaseDate ?? ""))[0];
      const supplierName = props.suppliers.find((s) => s.id === (item.lastSupplierId || lastOffer?.supplierId))?.name;
      const belowMin = item.minStock != null && current < item.minStock;
      const opening = props.movements
        .filter((row) => row.productId === item.id && row.type === "OPENING")
        .reduce((sum, row) => sum + row.quantityBase, 0);
      const toOrder = reorderQty(current, item.recommendedStock ?? item.minStock ?? 0);
      return { item, current, incoming, outgoing, last, supplierName, belowMin, missingSupplier: !lastOffer, opening, toOrder };
    });

  const alerts = rows.filter((row) => row.belowMin || row.missingSupplier);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.inventory.search")} className="max-w-sm" />
        <Button type="button" variant={missingOnly ? "turquoise" : "outline"} onClick={() => setMissingOnly((v) => !v)}>
          {t("admin.inventory.filterMissingSupplier")}
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
        <div className="overflow-x-auto rounded-2xl border border-beige-dark/20">
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
                <th className="px-3 py-2 text-start">{t("admin.inventory.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.item.id} className="border-t border-beige-dark/10">
                  <td className="px-3 py-2">
                    <button type="button" className="font-medium text-start" onClick={() => props.onEditProduct(row.item)}>
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
                  <td className="px-3 py-2">
                    {row.missingSupplier ? (
                      <span className="text-amber-700">{t("admin.inventory.missingSupplier")}</span>
                    ) : row.belowMin ? (
                      <span className="text-red-600">{t("admin.inventory.belowMin")}</span>
                    ) : (
                      <span className="text-emerald-700">{t("admin.inventory.ok")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
              running += row.type === "SALE_OUT" ? -Math.abs(row.quantityBase) : row.quantityBase;
              const supplier = suppliers.find((item) => item.id === row.supplierId)?.name;
              return (
                <tr key={row.id} className="border-b border-beige-dark/10">
                  <td className="py-2">{row.receivedAt.slice(0, 10)}</td>
                  <td className="py-2">{row.type === "SALE_OUT" ? `-${row.quantity}` : `+${row.quantity}`}</td>
                  <td className="py-2 text-coffee/60">
                    {row.type} {supplier ? `· ${supplier}` : ""}
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

function ComparePane({ ingredients, offers, records, suppliers }: InventoryHubProps) {
  const t = useT();
  return (
    <div className="space-y-4">
      {ingredients.map((item) => {
        const itemOffers = offers.filter((offer) => offer.productId === item.id && offer.lastUnitCost != null);
        if (!itemOffers.length) return null;
        const cheap = cheapestOffer(itemOffers);
        const last = latestPurchase(records, item.id);
        return (
          <AdminCard key={item.id} title={item.name}>
            <div className="space-y-2 text-sm">
              {itemOffers.map((offer) => {
                const supplier = suppliers.find((s) => s.id === offer.supplierId);
                return (
                  <div key={offer.id} className="flex items-center justify-between">
                    <span>
                      {supplier?.name ?? offer.supplierId}{" "}
                      {cheap?.id === offer.id && <span className="text-emerald-700">← {t("admin.inventory.cheapest")}</span>}
                    </span>
                    <span>{formatIls(offer.lastUnitCost ?? 0, 4)}</span>
                  </div>
                );
              })}
              {last && (
                <p className="text-coffee/55">
                  {t("admin.inventory.lastPaid")}: {formatIls(last.unitCost, 4)} · {last.purchaseDate}
                </p>
              )}
            </div>
          </AdminCard>
        );
      })}
    </div>
  );
}

function InvoicesPane(props: InventoryHubProps) {
  const t = useT();
  const authFetch = useAuthFetch();
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState<PurchaseInvoice | null>(null);

  const scan = async (file: File) => {
    setScanning(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await authFetch("/api/admin/inventory/invoice/parse", { method: "POST", body: form });
      const json = (await response.json()) as { draft?: Omit<PurchaseInvoice, "id" | "createdAt" | "status">; error?: string };
      if (!response.ok || !json.draft) {
        props.onToast(t("admin.inventory.scanFailed"), "error");
        return;
      }
      const saved = await savePurchaseInvoiceDraft(json.draft);
      if (!saved.success) {
        props.onToast(saved.error, "error");
        return;
      }
      setDraft({
        id: saved.data,
        status: "draft",
        createdAt: new Date().toISOString(),
        ...json.draft,
      });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-turquoise/40 bg-turquoise/5 px-6 py-10">
        <ScanLine className="h-8 w-8 text-turquoise" />
        <p className="mt-3 text-lg font-semibold">{t("admin.inventory.scanInvoice")}</p>
        <p className="text-sm text-coffee/55">{t("admin.inventory.scanHint")}</p>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void scan(file);
            e.target.value = "";
          }}
        />
      </label>
      {scanning && <p className="text-sm text-coffee/55">{t("admin.inventory.scanning")}</p>}
      {draft && <InvoiceReview draft={draft} {...props} onClose={() => setDraft(null)} />}
      <div className="space-y-2">
        {props.invoices.map((invoice) => (
          <button
            key={invoice.id}
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-beige-dark/20 px-4 py-3 text-start"
            onClick={() => setDraft(invoice)}
          >
            <span>
              #{invoice.invoiceNumber || invoice.id.slice(0, 6)} · {invoice.supplierName}
            </span>
            <span className="text-sm text-coffee/55">{invoice.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InvoiceReview({
  draft,
  ingredients,
  suppliers,
  settingsVatRate,
  onToast,
  onClose,
}: InventoryHubProps & { draft: PurchaseInvoice; onClose: () => void }) {
  const t = useT();
  const [invoice, setInvoice] = useState(draft);
  const [saving, setSaving] = useState(false);

  const updateLine = (key: string, patch: Partial<PurchaseInvoiceLine>) => {
    setInvoice((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  };

  return (
    <AdminCard title={`${t("admin.inventory.invoice")} #${invoice.invoiceNumber || ""}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input value={invoice.supplierName} onChange={(e) => setInvoice({ ...invoice, supplierName: e.target.value })} />
        <select
          className="h-10 rounded-xl border border-beige-dark/40 px-3 text-sm"
          value={invoice.supplierId ?? ""}
          onChange={(e) => setInvoice({ ...invoice, supplierId: e.target.value || undefined })}
        >
          <option value="">{t("admin.inventory.noSupplier")}</option>
          {suppliers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="text-sm">
          {t("admin.inventory.invoiceDate")}
          <Input type="date" value={invoice.invoiceDate} onChange={(e) => setInvoice({ ...invoice, invoiceDate: e.target.value })} />
        </label>
        <label className="text-sm">
          {t("admin.inventory.receivedAt")}
          <Input type="date" value={invoice.receivedAt} onChange={(e) => setInvoice({ ...invoice, receivedAt: e.target.value })} />
        </label>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="text-coffee/60">
              <th className="py-2 text-start">{t("admin.inventory.product")}</th>
              <th className="py-2 text-end">{t("admin.costing.purchaseQty")}</th>
              <th className="py-2 text-end">{t("admin.costing.purchasePrice")}</th>
              <th className="py-2 text-start">{t("admin.inventory.vat")}</th>
              <th className="py-2 text-start">{t("admin.inventory.match")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.key} className="border-t border-beige-dark/10">
                <td className="py-2">{line.rawName}</td>
                <td className="py-2 text-end">{line.quantity ?? "—"}</td>
                <td className="py-2 text-end">{line.lineTotal != null ? formatIls(line.lineTotal) : "—"}</td>
                <td className="py-2">
                  <select
                    className="h-9 rounded-lg border px-2"
                    value={line.vatType}
                    onChange={(e) => updateLine(line.key, { vatType: e.target.value as VatType })}
                  >
                    <option value="inclusive">{t("admin.inventory.vatInclusive")}</option>
                    <option value="exclusive">{t("admin.inventory.vatExclusive")}</option>
                    <option value="exempt">{t("admin.inventory.vatExempt")}</option>
                  </select>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    <select
                      className="h-9 max-w-[160px] rounded-lg border px-2"
                      value={line.productId ?? ""}
                      onChange={(e) => updateLine(line.key, { productId: e.target.value || undefined, matchKind: e.target.value ? "exact" : "none", ignored: false })}
                    >
                      <option value="">{t("admin.inventory.matchExisting")}</option>
                      {ingredients.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const created = await createIngredient({
                          name: line.rawName,
                          purchasePrice: line.lineTotal ?? 0,
                          purchaseQuantity: line.quantity ?? 1,
                          purchaseUnit: (line.unit as PurchaseUnit) || "kg",
                        });
                        if (created.success) updateLine(line.key, { productId: created.data.id, matchKind: "exact", createNew: true });
                      }}
                    >
                      {t("admin.inventory.createProduct")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => updateLine(line.key, { ignored: true, productId: undefined })}>
                      {t("admin.inventory.ignoreLine")}
                    </Button>
                    <span className={line.productId ? "text-emerald-700" : "text-amber-700"}>
                      {line.ignored ? t("admin.inventory.ignored") : line.productId ? "✓" : t("admin.inventory.notFound")}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || invoice.status === "approved"}
          onClick={async () => {
            setSaving(true);
            const result = await approvePurchaseInvoice({
              ...invoice,
              lines: invoice.lines.map((line) => {
                const vat = splitVat({
                  amount: line.lineTotal ?? 0,
                  vatType: line.vatType,
                  vatRate: line.vatRate || settingsVatRate || DEFAULT_VAT_RATE,
                });
                return { ...line, ...vat };
              }),
            });
            setSaving(false);
            if (!result.success) {
              onToast(result.error, "error");
              return;
            }
            onToast(t("admin.inventory.invoiceApproved"));
            onClose();
          }}
        >
          {t("admin.inventory.approveReceipt")}
        </Button>
      </div>
    </AdminCard>
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
  locale: Locale;
  settingsVatRate: number;
  onToast: (message: string, variant?: "success" | "error") => void;
  onAddProduct: () => void;
  onEditProduct: (item: CostingIngredient) => void;
};

export function SupplierOffersEditor({
  product,
  suppliers,
  offers,
  records,
  onToast,
}: {
  product: CostingIngredient;
  suppliers: Supplier[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [supplierId, setSupplierId] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState<PurchaseUnit>(product.purchaseUnit);
  const productOffers = offers.filter((offer) => offer.productId === product.id);
  const cheap = cheapestOffer(productOffers);
  const last = latestPurchase(records, product.id);

  return (
    <div className="space-y-3 rounded-2xl border border-beige-dark/20 p-3">
      <p className="text-sm font-semibold">{t("admin.inventory.supplierPrices")}</p>
      {!productOffers.length && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" /> {t("admin.inventory.missingSupplierWarning")}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-coffee/55">
              <th className="py-1 text-start">{t("admin.costing.supplier")}</th>
              <th className="py-1 text-end">{t("admin.inventory.lastPrice")}</th>
              <th className="py-1 text-end">{t("admin.inventory.unitCost")}</th>
              <th className="py-1 text-start">{t("admin.inventory.date")}</th>
            </tr>
          </thead>
          <tbody>
            {productOffers.map((offer) => {
              const supplier = suppliers.find((item) => item.id === offer.supplierId);
              return (
                <tr key={offer.id}>
                  <td className="py-1">
                    {supplier?.name ?? offer.supplierId}
                    {cheap?.id === offer.id ? ` · ${t("admin.inventory.cheapest")}` : ""}
                    {last?.supplierId === offer.supplierId ? ` · ${t("admin.inventory.lastPaid")}` : ""}
                  </td>
                  <td className="py-1 text-end">{offer.lastPriceIncludingVat != null ? formatIls(offer.lastPriceIncludingVat) : "—"}</td>
                  <td className="py-1 text-end">{offer.lastUnitCost != null ? formatIls(offer.lastUnitCost, 4) : "—"}</td>
                  <td className="py-1">{offer.lastPurchaseDate ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className="h-10 rounded-xl border px-2 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">{t("admin.inventory.linkSupplier")}</option>
          {suppliers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="₪" />
        <Input value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="h-10 rounded-xl border px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value as PurchaseUnit)}>
          {(["kg", "g", "liter", "ml", "unit"] as const).map((item) => (
            <option key={item} value={item}>
              {t(unitLabelKey(item))}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          if (!supplierId) return;
          const result = await linkSupplierOffer({
            productId: product.id,
            supplierId,
            lastPriceIncludingVat: price ? Number(price) : undefined,
            lastPackageQuantity: qty ? Number(qty) : undefined,
            lastUnit: unit,
          });
          if (result.success) onToast(t("admin.inventory.supplierLinked"));
          else onToast(result.error, "error");
        }}
      >
        + {t("admin.inventory.linkSupplier")}
      </Button>
    </div>
  );
}
