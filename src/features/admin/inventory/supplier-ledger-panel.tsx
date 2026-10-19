"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/providers/auth-provider";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { formatIls } from "@/lib/costing/money";
import { headerNet, headerVat } from "@/lib/inventory/invoice-finance";
import { downloadLedgerPdf, downloadLedgerWorkbook } from "@/lib/inventory/supplier-ledger-export";
import {
  balanceTone,
  buildSupplierLedger,
  coveredDeliveryIds,
  debtEffect,
  documentGross,
  isApprovedDocument,
  lastPurchaseDate,
  periodRows,
  previewPayment,
  supplierIdentityMatch,
  supplierProductRows,
  supplierScopeIds,
  supplierSearchMatch,
  supplierStockRows,
  type SupplierOpening,
  type SupplierPayment,
  type SupplierPaymentMethod,
} from "@/lib/inventory/supplier-ledger";
import type { CostingIngredient } from "@/lib/costing/types";
import type { InventoryMovement, PurchaseInvoice, PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { saveSupplier } from "@/services/inventoryService";
import {
  appendSupplierAudit,
  cancelSupplierPayment,
  linkDeliveryToInvoice,
  mergeSuppliers,
  saveSupplierOpening,
  saveSupplierPayment,
  subscribeSupplierOpenings,
  subscribeSupplierPayments,
} from "@/services/supplierLedgerService";

type LedgerProps = {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  offers: SupplierOffer[];
  movements: InventoryMovement[];
  records: PurchasePriceRecord[];
  invoices: PurchaseInvoice[];
  itemMaps?: SupplierItemMap[];
  onToast: (message: string, variant?: "success" | "error") => void;
  onOpenInvoice?: (invoiceId: string, lineId?: string) => void;
};

type Tab = "movements" | "documents" | "products" | "stock" | "aging" | "history";
type PayStatus = "executed" | "planned";

function showDate(value?: string): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function moneyBalance(balance: number, t: (key: string) => string): string {
  const tone = balanceTone(balance);
  if (tone === "credit") return `${t("admin.supplier.credit")}: ${formatIls(Math.abs(balance))}`;
  if (tone === "zero") return t("admin.supplier.settled");
  return formatIls(balance);
}

function statusText(invoice: PurchaseInvoice, t: (key: string, fallback?: string) => string): string {
  if (!isApprovedDocument(invoice)) {
    const scan = invoice.scanStatus;
    if (scan && ["uploaded", "scanning", "needs_review", "failed", "cancelled"].includes(scan)) {
      return t(`admin.supplier.status.${scan}`, scan);
    }
    return t(`admin.supplier.status.${invoice.status}`, invoice.status);
  }
  return t("admin.supplier.status.approved");
}

export function SupplierLedgerPanel(props: LedgerProps) {
  const t = useT();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payments, setPayments] = useState<SupplierPayment[] | null>(null);
  const [openings, setOpenings] = useState<SupplierOpening[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const actor = user?.email || undefined;

  useEffect(() => subscribeSupplierPayments((items) => { setPayments(items); setLoadError(null); }, setLoadError), []);
  useEffect(() => subscribeSupplierOpenings((items) => { setOpenings(items); setLoadError(null); }, setLoadError), []);

  const visibleSuppliers = useMemo(
    () => props.suppliers.filter((supplier) => supplier.active !== false && !supplier.mergedInto && supplierSearchMatch(supplier, query)),
    [props.suppliers, query]
  );
  const selected = props.suppliers.find((supplier) => supplier.id === selectedId) ?? null;

  if (!selected) {
    return (
      <div className="space-y-4">
        <AddSupplier onToast={props.onToast} />
        <AdminCard title={t("admin.supplier.ledger")}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("admin.supplier.search")} className="mb-3 max-w-md" />
          {loadError ? <p className="mb-2 text-sm text-red-700">{loadError}</p> : null}
          {payments === null || openings === null ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : null}
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-beige/40 text-coffee/70">
                <tr>
                  <th className="px-2 py-2 text-start">{t("admin.inventory.supplierName")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.settings.phone")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.supplier.balance")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.supplier.overdue")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.supplier.lastPurchase")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleSuppliers.map((supplier) => {
                  const scope = supplierScopeIds(supplier.id, props.suppliers);
                  const invoices = props.invoices.filter((invoice) => invoice.supplierId && scope.has(invoice.supplierId));
                  const ledger = buildSupplierLedger({
                    invoices,
                    payments: (payments ?? []).filter((payment) => scope.has(payment.supplierId)),
                    openings: (openings ?? []).filter((opening) => scope.has(opening.supplierId)),
                    today: todayIso(),
                  });
                  const last = lastPurchaseDate(invoices, props.movements.filter((movement) => movement.supplierId && scope.has(movement.supplierId)));
                  const ready = payments !== null && openings !== null;
                  return (
                    <tr key={supplier.id} className="cursor-pointer border-t border-beige-dark/10 hover:bg-beige/30" onClick={() => setSelectedId(supplier.id)}>
                      <td className="px-2 py-2 font-medium">{supplier.name}</td>
                      <td className="px-2 py-2">{supplier.phone || "—"}</td>
                      <td className="px-2 py-2">{ready ? moneyBalance(ledger.balance, t) : "—"}</td>
                      <td className="px-2 py-2">{ready ? formatIls(ledger.overdue) : "—"}</td>
                      <td className="px-2 py-2">{showDate(last)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminCard>
      </div>
    );
  }

  return (
    <SupplierCard
      supplier={selected}
      payments={payments}
      openings={openings}
      loadError={loadError}
      actor={actor}
      onBack={() => setSelectedId(null)}
      {...props}
    />
  );
}

function AddSupplier({ onToast }: { onToast: LedgerProps["onToast"] }) {
  const t = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <AdminCard title={t("admin.inventory.addSupplier")}>
      <div className="flex flex-wrap gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("admin.inventory.supplierName")} className="max-w-xs" />
        <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t("admin.settings.phone")} className="max-w-xs" />
        <Button
          type="button"
          variant="turquoise"
          onClick={async () => {
            if (!name.trim()) return;
            setError(null);
            const result = await saveSupplier({ name, phone });
            if (result.success) {
              setName("");
              setPhone("");
              onToast(t("admin.inventory.supplierSaved"));
            } else setError(result.error);
          }}
        >
          {t("common.save")}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </AdminCard>
  );
}

function SupplierCard(props: LedgerProps & {
  supplier: Supplier;
  payments: SupplierPayment[] | null;
  openings: SupplierOpening[] | null;
  loadError: string | null;
  actor?: string;
  onBack: () => void;
}) {
  const t = useT();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState<Tab>("movements");
  const [paying, setPaying] = useState(false);
  const [docStatus, setDocStatus] = useState("all");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<string | null>(null);
  const supplier = props.supplier;
  const scope = useMemo(() => supplierScopeIds(supplier.id, props.suppliers), [supplier.id, props.suppliers]);
  const invoices = useMemo(() => props.invoices.filter((invoice) => invoice.supplierId && scope.has(invoice.supplierId)), [props.invoices, scope]);
  const payments = useMemo(() => (props.payments ?? []).filter((payment) => scope.has(payment.supplierId)), [props.payments, scope]);
  const openings = useMemo(() => (props.openings ?? []).filter((opening) => scope.has(opening.supplierId)), [props.openings, scope]);
  const today = todayIso();
  const ready = props.payments !== null && props.openings !== null;
  const ledger = useMemo(
    () => buildSupplierLedger({ invoices, payments, openings, from, to, today }),
    [invoices, payments, openings, from, to, today]
  );
  const rows = periodRows(ledger, from, to);
  const covered = useMemo(() => coveredDeliveryIds(invoices), [invoices]);
  const matches = props.suppliers.filter((item) => item.id !== supplier.id && item.active !== false && !item.mergedInto && supplierIdentityMatch(supplier, item, props.invoices).match);

  const profileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setProfileError(null);
    const result = await saveSupplier({
      id: supplier.id,
      name: String(data.get("name") || supplier.name),
      taxId: String(data.get("taxId") || ""),
      contactName: String(data.get("contactName") || ""),
      phone: String(data.get("phone") || ""),
      email: String(data.get("email") || ""),
      paymentTerms: String(data.get("paymentTerms") || ""),
      aliases: supplier.aliases,
      companyName: supplier.companyName,
      address: supplier.address,
      notes: supplier.notes,
    });
    if (!result.success) {
      setProfileError(result.error);
      setBusy(false);
      return;
    }
    await appendSupplierAudit(supplier.id, props.actor, "EDIT", "profile", supplier.audit);
    setBusy(false);
    props.onToast(t("admin.supplier.saved"));
  };

  const exportRows = () => [
    [t("admin.supplier.col.date"), t("admin.supplier.col.action"), t("admin.supplier.col.reference"), t("admin.supplier.col.description"), t("admin.supplier.col.increase"), t("admin.supplier.col.decrease"), t("admin.supplier.col.balance")],
    ...rows.map((row) => [
      showDate(row.at),
      row.id === "period-opening" ? t("admin.supplier.periodOpening") : row.id === "period-closing" ? t("admin.supplier.periodClosing") : t(`admin.supplier.kind.${row.kind}`),
      row.reference || "",
      row.description,
      row.increase ? row.increase : "",
      row.decrease ? row.decrease : "",
      row.balanceAfter,
    ]),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-sm text-turquoise" onClick={props.onBack}>{t("admin.supplier.back")}</button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void downloadLedgerWorkbook(`${supplier.name}-ledger.xlsx`, [{ name: "ledger", rows: exportRows() }]).catch(() => setActionError(t("admin.supplier.saveFailed")))}>{t("admin.supplier.export.excel")}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void downloadLedgerPdf(`${supplier.name}-ledger.pdf`, supplier.name, exportRows()).catch(() => setActionError(t("admin.supplier.saveFailed")))}>{t("admin.supplier.export.pdf")}</Button>
          <Button type="button" variant="turquoise" onClick={() => setPaying(true)}>{t("admin.supplier.pay.add")}</Button>
        </div>
      </div>
      {props.loadError ? <p className="text-sm text-red-700">{props.loadError}</p> : null}
      {!ready ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : null}
      <AdminCard title={t("admin.supplier.ledger")}>
        <form key={supplier.updatedAt} className="grid gap-2 sm:grid-cols-3" onSubmit={(event) => void profileSave(event)}>
          <Field name="name" label={t("admin.inventory.supplierName")} defaultValue={supplier.name} />
          <Field name="taxId" label={t("admin.supplier.businessNumber")} defaultValue={supplier.taxId || ""} />
          <Field name="contactName" label={t("admin.supplier.contact")} defaultValue={supplier.contactName || ""} />
          <Field name="phone" label={t("admin.settings.phone")} defaultValue={supplier.phone || ""} />
          <Field name="email" label={t("admin.inventory.supplierEmail")} defaultValue={supplier.email || ""} />
          <Field name="paymentTerms" label={t("admin.supplier.paymentTerms")} defaultValue={supplier.paymentTerms || ""} />
          <div className="sm:col-span-3">
            <Button type="submit" variant="outline" disabled={busy}>{t("common.save")}</Button>
            {profileError ? <p className="mt-2 text-sm text-red-700">{profileError}</p> : null}
          </div>
        </form>
        {matches.map((match) => {
          const identity = supplierIdentityMatch(supplier, match, props.invoices);
          const reason = identity.reasons
            .map((item) => (item === "tax" ? t("admin.supplier.businessNumber") : item === "phone" ? t("admin.settings.phone") : t("admin.supplier.tab.documents")))
            .join(" · ");
          return (
            <div key={match.id} className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm">
              <p>{t("admin.supplier.merge.title")}: {match.name}</p>
              <p className="text-coffee/60">{reason}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setActionError(null);
                  const result = await mergeSuppliers({ survivor: supplier, loser: match, invoices: props.invoices, actor: props.actor });
                  setBusy(false);
                  if (!result.success) {
                    setActionError(result.error.includes("MERGE_NEEDS_IDENTITY") ? t("admin.supplier.merge.blocked") : result.error);
                    return;
                  }
                  props.onToast(t("admin.supplier.merge.done"));
                }}
              >
                {t("admin.supplier.merge.action")}
              </Button>
            </div>
          );
        })}
        {actionError ? <p className="mt-2 text-sm text-red-700">{actionError}</p> : null}
      </AdminCard>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-coffee/70">{t("admin.supplier.filter.from")}<input className="mt-1 block h-9 rounded-xl border border-beige-dark/40 px-2 text-sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="text-xs text-coffee/70">{t("admin.supplier.filter.to")}<input className="mt-1 block h-9 rounded-xl border border-beige-dark/40 px-2 text-sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label={t("admin.supplier.periodPurchases")} value={ready ? formatIls(ledger.periodPurchases) : "—"} hint={t("admin.supplier.periodNote")} />
        <Kpi label={t("admin.supplier.periodPayments")} value={ready ? formatIls(ledger.periodPayments) : "—"} hint={t("admin.supplier.periodNote")} />
        <Kpi label={t("admin.supplier.currentBalance")} value={ready ? moneyBalance(ledger.balance, t) : "—"} hint={t("admin.supplier.totalNote")} />
        <Kpi label={t("admin.supplier.overdue")} value={ready ? formatIls(ledger.overdue) : "—"} hint={t("admin.supplier.totalNote")} />
        <Kpi label={t("admin.supplier.nextPayment")} value={ready && ledger.nextPayment ? `${formatIls(ledger.nextPayment.amount)} · ${showDate(ledger.nextPayment.date)}` : "—"} hint={ledger.nextPayment?.planned ? t("admin.supplier.pay.planned") : t("admin.supplier.pay.due")} />
      </div>
      <p className="text-xs text-coffee/55">{t("admin.supplier.formula")}</p>
      <div className="flex flex-wrap gap-2">
        {(["movements", "documents", "products", "stock", "aging", "history"] as Tab[]).map((item) => (
          <button key={item} type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === item ? "bg-turquoise text-white" : "bg-beige/50 text-coffee/70"}`} onClick={() => setTab(item)}>
            {t(`admin.supplier.tab.${item}`)}
          </button>
        ))}
      </div>
      {tab === "movements" && (
        <AdminCard title={t("admin.supplier.tab.movements")}>
          <OpeningForm supplierId={supplier.id} current={openings.find((item) => item.supplierId === supplier.id)} actor={props.actor} onToast={props.onToast} />
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-beige/40 text-coffee/70">
                <tr>
                  {[t("admin.supplier.col.date"), t("admin.supplier.col.action"), t("admin.supplier.col.reference"), t("admin.supplier.col.description"), t("admin.supplier.col.increase"), t("admin.supplier.col.decrease"), t("admin.supplier.col.balance"), t("admin.supplier.col.source")].map((label) => (
                    <th key={label} className="px-2 py-2 text-start font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={8} className="px-2 py-3 text-coffee/60">{t("admin.supplier.empty")}</td></tr> : rows.map((row) => (
                  <tr key={row.id} className="border-t border-beige-dark/10">
                    <td className="px-2 py-2">{showDate(row.at)}</td>
                    <td className="px-2 py-2">{row.id === "period-opening" ? t("admin.supplier.periodOpening") : row.id === "period-closing" ? t("admin.supplier.periodClosing") : t(`admin.supplier.kind.${row.kind}`)}</td>
                    <td className="px-2 py-2">{row.reference || "—"}</td>
                    <td className="px-2 py-2">{row.description || "—"}</td>
                    <td className="px-2 py-2">{row.increase ? formatIls(row.increase) : "—"}</td>
                    <td className="px-2 py-2">{row.decrease ? formatIls(row.decrease) : "—"}</td>
                    <td className="px-2 py-2">{moneyBalance(row.balanceAfter, t)}</td>
                    <td className="px-2 py-2">
                      {row.sourceId && row.kind !== "payment" && row.kind !== "opening" ? (
                        <button type="button" className="text-turquoise" onClick={() => props.onOpenInvoice?.(row.sourceId!)}>{t("admin.supplier.doc.view")}</button>
                      ) : row.kind === "payment" ? (
                        <button
                          type="button"
                          className="text-turquoise"
                          onClick={async () => {
                            const payment = payments.find((item) => item.id === row.sourceId);
                            if (!payment) return;
                            setActionError(null);
                            if (!window.confirm(t("admin.supplier.pay.cancel"))) return;
                            const result = await cancelSupplierPayment(payment, props.actor);
                            if (!result.success) setActionError(result.error);
                            else props.onToast(t("admin.supplier.pay.cancelled"));
                          }}
                        >
                          {t("admin.supplier.pay.cancel")}
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {payments.some((payment) => payment.status === "planned") ? (
            <div className="mt-3 space-y-1 text-sm">
              <p className="font-medium">{t("admin.supplier.pay.planned")}</p>
              {payments.filter((payment) => payment.status === "planned").map((payment) => (
                <p key={payment.id}>{showDate(payment.dueAt || payment.paidAt)} · {formatIls(payment.amount)} · {payment.reference || "—"}</p>
              ))}
            </div>
          ) : null}
        </AdminCard>
      )}
      {tab === "documents" && (
        <DocumentsTab
          invoices={invoices}
          payments={payments}
          covered={covered}
          status={docStatus}
          onStatus={setDocStatus}
          actor={props.actor}
          onOpenInvoice={props.onOpenInvoice}
          onToast={props.onToast}
        />
      )}
      {tab === "products" && (
        <AdminCard title={t("admin.supplier.tab.products")}>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-beige/40 text-coffee/70">
                <tr>
                  {[t("admin.supplier.product.name"), t("admin.supplier.product.sku"), t("admin.supplier.product.ingredient"), t("admin.supplier.product.group"), t("admin.supplier.product.pack"), t("admin.supplier.product.price"), t("admin.supplier.col.date"), t("admin.supplier.product.history")].map((label) => (
                    <th key={label} className="px-2 py-2 text-start font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supplierProductRows({ supplierId: supplier.id, scope, ingredients: props.ingredients, maps: props.itemMaps ?? [], offers: props.offers, records: props.records }).map((row) => (
                  <tr key={row.name} className="border-t border-beige-dark/10">
                    <td className="px-2 py-2">{row.name}</td>
                    <td className="px-2 py-2">{row.sku || "—"}</td>
                    <td className="px-2 py-2">{row.ingredientName || "—"}</td>
                    <td className="px-2 py-2">{row.compareGroup || "—"}</td>
                    <td className="px-2 py-2">{row.pack || "—"}</td>
                    <td className="px-2 py-2">{row.price != null ? `${formatIls(row.price)}${row.unit ? ` / ${t(unitLabelKey(row.unit))}` : ""}` : "—"}</td>
                    <td className="px-2 py-2">{showDate(row.date)}</td>
                    <td className="px-2 py-2">
                      <button type="button" className="text-turquoise" onClick={() => setHistoryProduct(historyProduct === row.name ? null : row.name)}>{t("admin.supplier.product.history")}</button>
                      {historyProduct === row.name ? row.history.map((item) => <p key={`${item.date}-${item.price}`} className="text-xs text-coffee/60">{showDate(item.date)} · {formatIls(item.price)}</p>) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
      {tab === "stock" && (
        <AdminCard title={t("admin.supplier.tab.stock")}>
          <p className="mb-2 text-sm text-coffee/60">{t("admin.supplier.stock.note")}</p>
          <div className="space-y-1 text-sm">
            {supplierStockRows({ scope, movements: props.movements, invoices }).map((movement) => (
              <div key={movement.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-beige-dark/10 py-1">
                <span>{showDate(movement.receivedAt)} · {t(`admin.inventory.movement.${movement.type}`, movement.type)} · {movement.quantity} {movement.unit ? t(unitLabelKey(movement.unit)) : ""}</span>
                {movement.invoiceId ? <button type="button" className="text-turquoise" onClick={() => props.onOpenInvoice?.(movement.invoiceId!, movement.invoiceLineId || movement.invoiceLineKey)}>{t("admin.supplier.doc.view")}</button> : <span>—</span>}
              </div>
            ))}
          </div>
        </AdminCard>
      )}
      {tab === "aging" && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <Kpi label={t("admin.supplier.aging.current")} value={formatIls(ledger.aging.current)} />
          <Kpi label={t("admin.supplier.aging.d1")} value={formatIls(ledger.aging.d1_30)} />
          <Kpi label={t("admin.supplier.aging.d31")} value={formatIls(ledger.aging.d31_60)} />
          <Kpi label={t("admin.supplier.aging.d61")} value={formatIls(ledger.aging.d61_90)} />
          <Kpi label={t("admin.supplier.aging.d90")} value={formatIls(ledger.aging.d90)} />
          <Kpi label={t("admin.supplier.aging.missing")} value={formatIls(ledger.aging.missing)} />
        </div>
      )}
      {tab === "history" && (
        <AdminCard title={t("admin.supplier.tab.history")}>
          <div className="space-y-1 text-sm">
            {(supplier.audit ?? []).map((event, index) => (
              <p key={`${event.at}-${index}`}>{showDate(event.at)} · {event.actor || "—"} · {event.action}{event.detail ? ` · ${event.detail}` : ""}</p>
            ))}
            {payments.flatMap((payment) =>
              (payment.history ?? []).map((event, index) => (
                <p key={`${payment.id}-${index}`}>{showDate(event.at)} · {event.actor || "—"} · {event.change} · {payment.reference || payment.id}</p>
              ))
            )}
            {openings.flatMap((opening) =>
              (opening.history ?? []).map((event, index) => (
                <p key={`${opening.id}-${index}`}>{showDate(event.at)} · {event.actor || "—"} · {event.change}</p>
              ))
            )}
          </div>
        </AdminCard>
      )}
      {paying ? (
        <PaymentDialog
          supplier={supplier}
          invoices={invoices}
          payments={payments}
          balance={ledger.balance}
          actor={props.actor}
          onClose={() => setPaying(false)}
          onToast={props.onToast}
        />
      ) : null}
    </div>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="text-xs text-coffee/70">
      {label}
      <Input name={name} defaultValue={defaultValue} className="mt-1" />
    </label>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-beige-dark/20 p-3">
      <p className="text-xs text-coffee/55">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-coffee/45">{hint}</p> : null}
    </div>
  );
}

function OpeningForm({ supplierId, current, actor, onToast }: { supplierId: string; current?: SupplierOpening; actor?: string; onToast: LedgerProps["onToast"] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button type="button" variant="outline" onClick={() => setOpen(true)}>{t("admin.supplier.opening.add")}</Button>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const amount = Number(data.get("amount"));
        const date = String(data.get("date") || "");
        if (!Number.isFinite(amount) || !date) {
          setError(t("admin.supplier.err.amount"));
          return;
        }
        setError(null);
        const result = await saveSupplierOpening({ supplierId, amount, date, note: String(data.get("note") || ""), actor, previous: current });
        if (!result.success) setError(result.error);
        else {
          setOpen(false);
          onToast(t("admin.supplier.opening.saved"));
        }
      }}
    >
      <Input name="amount" type="number" step="0.01" placeholder={t("admin.supplier.pay.amount")} className="max-w-[8rem]" defaultValue={current?.amount ?? ""} />
      <Input name="date" type="date" defaultValue={current?.date || todayIso()} className="max-w-[11rem]" />
      <Input name="note" placeholder={t("admin.supplier.pay.note")} className="max-w-xs" defaultValue={current?.note || ""} />
      <Button type="submit" variant="turquoise">{t("common.save")}</Button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

function DocumentsTab(props: {
  invoices: PurchaseInvoice[];
  payments: SupplierPayment[];
  covered: Set<string>;
  status: string;
  onStatus: (value: string) => void;
  actor?: string;
  onOpenInvoice?: (invoiceId: string, lineId?: string) => void;
  onToast: LedgerProps["onToast"];
}) {
  const t = useT();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [linkError, setLinkError] = useState<string | null>(null);
  const paid = new Map<string, number>();
  for (const payment of props.payments) {
    if (payment.status !== "executed") continue;
    for (const allocation of payment.allocations) paid.set(allocation.invoiceId, (paid.get(allocation.invoiceId) ?? 0) + allocation.amount);
  }
  const rows = props.invoices.filter((invoice) => {
    if (props.status === "approved") return isApprovedDocument(invoice);
    if (props.status === "pending") return !isApprovedDocument(invoice);
    return true;
  });
  const covers = props.invoices.filter((invoice) => isApprovedDocument(invoice) && invoice.documentType !== "delivery" && invoice.documentType !== "credit");
  return (
    <AdminCard title={t("admin.supplier.tab.documents")}>
      <label className="mb-3 block max-w-xs text-xs text-coffee/70">
        {t("admin.supplier.filter.status")}
        <select className="mt-1 h-9 w-full rounded-xl border border-beige-dark/40 px-2 text-sm" value={props.status} onChange={(event) => props.onStatus(event.target.value)}>
          <option value="all">{t("admin.supplier.filter.all")}</option>
          <option value="approved">{t("admin.supplier.status.approved")}</option>
          <option value="pending">{t("admin.supplier.status.needs_review")}</option>
        </select>
      </label>
      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-beige/40 text-coffee/70">
            <tr>
              {[t("admin.supplier.doc.number"), t("admin.supplier.col.date"), t("admin.supplier.doc.due"), t("admin.supplier.doc.net"), t("admin.supplier.doc.vat"), t("admin.supplier.doc.gross"), t("admin.supplier.doc.paid"), t("admin.supplier.doc.balance"), t("admin.supplier.doc.status"), t("admin.supplier.doc.view")].map((label) => (
                <th key={label} className="px-2 py-2 text-start font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => {
              const effect = debtEffect(invoice, props.covered);
              const settled = paid.get(invoice.id) ?? 0;
              const open = effect > 0 ? Math.max(0, effect - settled) : 0;
              return (
                <tr key={invoice.id} className="border-t border-beige-dark/10">
                  <td className="px-2 py-2">{invoice.invoiceNumber || "—"}</td>
                  <td className="px-2 py-2">{showDate(invoice.invoiceDate)}</td>
                  <td className="px-2 py-2">{invoice.dueDate ? showDate(invoice.dueDate) : t("admin.supplier.aging.missing")}</td>
                  <td className="px-2 py-2">{headerNet(invoice) == null ? "—" : formatIls(headerNet(invoice) ?? 0)}</td>
                  <td className="px-2 py-2">{headerVat(invoice) == null ? "—" : formatIls(headerVat(invoice) ?? 0)}</td>
                  <td className="px-2 py-2">{formatIls(documentGross(invoice))}</td>
                  <td className="px-2 py-2">{settled ? formatIls(settled) : "—"}</td>
                  <td className="px-2 py-2">{effect > 0 ? formatIls(open) : effect < 0 ? moneyBalance(effect, t) : t("admin.supplier.doc.noDebt")}</td>
                  <td className="px-2 py-2">{t(`admin.supplier.kind.${invoice.documentType === "credit" ? "credit" : invoice.documentType === "delivery" ? "delivery" : "invoice"}`)} · {statusText(invoice, t)}{invoice.documentType === "delivery" && props.covered.has(invoice.id) ? ` · ${t("admin.supplier.doc.noDebt")}` : ""}</td>
                  <td className="px-2 py-2">
                    <button type="button" className="text-turquoise" onClick={() => props.onOpenInvoice?.(invoice.id, invoice.lines[0]?.key)}>{t("admin.supplier.doc.view")}</button>
                    {invoice.documentType === "delivery" && !props.covered.has(invoice.id) ? (
                      <div className="mt-1">
                        <select className="h-8 rounded-lg border px-1 text-xs" value={links[invoice.id] ?? ""} onChange={(event) => setLinks({ ...links, [invoice.id]: event.target.value })}>
                          <option value="">{t("admin.supplier.doc.link")}</option>
                          {covers.map((cover) => <option key={cover.id} value={cover.id}>{cover.invoiceNumber}</option>)}
                        </select>
                        {links[invoice.id] ? (
                          <button
                            type="button"
                            className="ms-2 text-turquoise"
                            onClick={async () => {
                              setLinkError(null);
                              const result = await linkDeliveryToInvoice(invoice.id, links[invoice.id]!, props.actor);
                              if (!result.success) setLinkError(result.error);
                              else {
                                setLinks({ ...links, [invoice.id]: "" });
                                props.onToast(t("admin.supplier.doc.linked"));
                              }
                            }}
                          >
                            {t("common.save")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {linkError ? <p className="mt-2 text-sm text-red-700">{linkError}</p> : null}
    </AdminCard>
  );
}

function PaymentDialog(props: {
  supplier: Supplier;
  invoices: PurchaseInvoice[];
  payments: SupplierPayment[];
  balance: number;
  actor?: string;
  onClose: () => void;
  onToast: LedgerProps["onToast"];
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayIso());
  const [dueAt, setDueAt] = useState("");
  const [method, setMethod] = useState<SupplierPaymentMethod>("bank");
  const [reference, setReference] = useState("");
  const [account, setAccount] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<PayStatus>("executed");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const covered = coveredDeliveryIds(props.invoices);
  const paid = new Map<string, number>();
  for (const payment of props.payments) {
    if (payment.status !== "executed") continue;
    for (const allocation of payment.allocations) paid.set(allocation.invoiceId, (paid.get(allocation.invoiceId) ?? 0) + allocation.amount);
  }
  const openInvoices = props.invoices.flatMap((invoice) => {
    const effect = debtEffect(invoice, covered);
    if (effect <= 0) return [];
    const open = Math.max(0, effect - (paid.get(invoice.id) ?? 0));
    return open > 0.009 ? [{ invoice, open }] : [];
  });
  const parsedAllocations = openInvoices
    .map((row) => ({ invoiceId: row.invoice.id, amount: Number(allocations[row.invoice.id] || 0) }))
    .filter((row) => row.amount > 0);
  const preview = previewPayment({
    amount: Number(amount),
    allocations: parsedAllocations,
    openByInvoice: openInvoices.map((row) => ({ invoiceId: row.invoice.id, open: row.open })),
    balanceBefore: props.balance,
  });
  const balanceAfter = status === "planned" || !preview.ok ? null : preview.balanceAfter;

  return (
    <AdminModal open onOpenChange={(next) => !next && props.onClose()} size="md">
      <AdminModalHeader onClose={props.onClose}>
        <AdminModalTitle>{t("admin.supplier.pay.add")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-3">
        <p className="text-xs text-coffee/60">{t("admin.supplier.pay.notice")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">{t("admin.supplier.pay.amount")}<Input className="mt-1" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="text-xs">{t("admin.supplier.pay.date")}<Input className="mt-1" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
          <label className="text-xs">{t("admin.supplier.pay.method")}
            <select className="mt-1 h-10 w-full rounded-xl border px-2 text-sm" value={method} onChange={(event) => setMethod(event.target.value as SupplierPaymentMethod)}>
              {(["cash", "bank", "check", "card", "other"] as SupplierPaymentMethod[]).map((item) => <option key={item} value={item}>{t(`admin.supplier.method.${item}`)}</option>)}
            </select>
          </label>
          <label className="text-xs">{t("admin.supplier.pay.reference")}<Input className="mt-1" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <label className="text-xs">{t("admin.supplier.pay.account")}<Input className="mt-1" value={account} onChange={(event) => setAccount(event.target.value)} /></label>
          <label className="text-xs">{t("admin.supplier.pay.note")}<Input className="mt-1" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="flex gap-3 text-sm">
          <label><input type="radio" checked={status === "executed"} onChange={() => setStatus("executed")} /> {t("admin.supplier.pay.executed")}</label>
          <label><input type="radio" checked={status === "planned"} onChange={() => setStatus("planned")} /> {t("admin.supplier.pay.planned")}</label>
        </div>
        {status === "planned" || method === "check" ? (
          <label className="block text-xs">{t("admin.supplier.pay.due")}<Input className="mt-1 max-w-[12rem]" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        ) : null}
        <div>
          <p className="mb-1 text-sm font-medium">{t("admin.supplier.pay.allocate")}</p>
          {openInvoices.map((row) => (
            <label key={row.invoice.id} className="mb-1 grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
              <span>{row.invoice.invoiceNumber} · {t("admin.supplier.pay.open")} {formatIls(row.open)}</span>
              <Input type="number" min="0" step="0.01" value={allocations[row.invoice.id] ?? ""} onChange={(event) => setAllocations({ ...allocations, [row.invoice.id]: event.target.value })} />
            </label>
          ))}
        </div>
        {preview.ok ? (
          <div className="rounded-xl bg-beige/40 p-3 text-sm">
            <p>{t("admin.supplier.pay.before")}: {moneyBalance(preview.balanceBefore, t)}</p>
            <p>{t("admin.supplier.pay.after")}: {balanceAfter == null ? t("admin.supplier.pay.planned") : moneyBalance(balanceAfter, t)}</p>
            {preview.rows.map((row) => {
              const number = openInvoices.find((item) => item.invoice.id === row.invoiceId)?.invoice.invoiceNumber || row.invoiceId;
              return <p key={row.invoiceId}>{number}: {formatIls(row.before)} → {formatIls(row.after)}</p>;
            })}
            {preview.excess > 0 ? <p>{t("admin.supplier.pay.excess")}: {formatIls(preview.excess)}</p> : null}
          </div>
        ) : amount ? <p className="text-sm text-red-700">{t(`admin.supplier.err.${preview.error}`)}</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button
          type="button"
          variant="turquoise"
          disabled={busy || !preview.ok}
          onClick={async () => {
            if (!preview.ok) return;
            setBusy(true);
            setError(null);
            const result = await saveSupplierPayment({
              supplierId: props.supplier.id,
              supplierName: props.supplier.name,
              amount: Number(amount),
              paidAt,
              dueAt: dueAt || undefined,
              method,
              reference,
              account,
              note,
              status,
              allocations: parsedAllocations,
              idempotencyKey: key,
              actor: props.actor,
            });
            setBusy(false);
            if (!result.success) {
              setError(result.error || t("admin.supplier.saveFailed"));
              return;
            }
            props.onToast(result.data.reused ? t("admin.supplier.pay.reused") : t("admin.supplier.pay.saved"));
            props.onClose();
          }}
        >
          {t("common.save")}
        </Button>
      </AdminModalBody>
    </AdminModal>
  );
}
