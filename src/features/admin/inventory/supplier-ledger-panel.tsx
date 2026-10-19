"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/providers/auth-provider";
import { useT } from "@/components/providers/locale-provider";
import {
  MovementCards,
  ProductTable,
  SidePanel,
  SummarySkeleton,
  MoneyFigure,
  StatusTag,
  amountOrMissing,
  formatPack,
  initials,
  monthRange,
  payTagForInvoice,
  priceText,
  type LedgerPeriod,
} from "@/features/admin/inventory/supplier-ledger-screen";
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
  onAddDocument?: () => void;
};

type Tab = "overview" | "movements" | "documents" | "products";
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

function invoiceSettlement(invoice: PurchaseInvoice, payments: SupplierPayment[], covered: Set<string>) {
  const effect = debtEffect(invoice, covered);
  const settled = payments.reduce((sum, payment) => {
    if (payment.status !== "executed") return sum;
    return sum + payment.allocations.filter((item) => item.invoiceId === invoice.id).reduce((inner, item) => inner + item.amount, 0);
  }, 0);
  const open = effect > 0 ? Math.max(0, effect - settled) : 0;
  return { effect, settled, open, countsAsDebt: effect !== 0 };
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
      <div className="min-w-0 space-y-4 overflow-x-hidden">
        <AddSupplier onToast={props.onToast} />
        <AdminCard title={t("admin.supplier.ledger")}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("admin.supplier.search")} className="mb-3 max-w-md" />
          {loadError ? <p className="mb-2 text-sm text-red-700">{loadError}</p> : null}
          {payments === null || openings === null ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : null}
          <div className="min-w-0 overflow-hidden">
            <table className="w-full table-fixed text-sm">
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
                      <td className="break-words px-2 py-2 font-medium">{supplier.name}</td>
                      <td className="px-2 py-2">{supplier.phone || t("admin.supplier.phoneMissing")}</td>
                      <td className="px-2 py-2">{ready ? moneyBalance(ledger.balance, t) : t("admin.supplier.loading")}</td>
                      <td className="px-2 py-2">{ready ? formatIls(ledger.overdue) : t("admin.supplier.loading")}</td>
                      <td className="px-2 py-2">{last ? showDate(last) : t("admin.supplier.product.noPurchase")}</td>
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
  const [period, setPeriod] = useState<LedgerPeriod>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [paying, setPaying] = useState(false);
  const [docStatus, setDocStatus] = useState("all");
  const [docQuery, setDocQuery] = useState("");
  const [moveQuery, setMoveQuery] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState(false);
  const [detail, setDetail] = useState<{ kind: "movement" | "document" | "product"; id: string } | null>(null);
  const [linkTarget, setLinkTarget] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const supplier = props.supplier;
  const scope = useMemo(() => supplierScopeIds(supplier.id, props.suppliers), [supplier.id, props.suppliers]);
  const invoices = useMemo(() => props.invoices.filter((invoice) => invoice.supplierId && scope.has(invoice.supplierId)), [props.invoices, scope]);
  const payments = useMemo(() => (props.payments ?? []).filter((payment) => scope.has(payment.supplierId)), [props.payments, scope]);
  const openings = useMemo(() => (props.openings ?? []).filter((opening) => scope.has(opening.supplierId)), [props.openings, scope]);
  const today = todayIso();
  const ready = props.payments !== null && props.openings !== null;
  const range = period === "month" ? monthRange(0) : period === "prev" ? monthRange(-1) : { from: customFrom, to: customTo };
  const rangeReady = Boolean(range.from && range.to);
  const from = rangeReady ? range.from : "";
  const to = rangeReady ? range.to : "";
  const ledger = useMemo(
    () => buildSupplierLedger({ invoices, payments, openings, from: from || undefined, to: to || undefined, today }),
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
    setEditing(false);
    props.onToast(t("admin.supplier.saved"));
  };

  const productInput = useMemo(() => ({
    supplierId: supplier.id,
    scope,
    ingredients: props.ingredients,
    maps: props.itemMaps ?? [],
    offers: props.offers,
    records: props.records,
  }), [supplier.id, scope, props.ingredients, props.itemMaps, props.offers, props.records]);
  const productRows = useMemo(
    () => supplierProductRows({ ...productInput, includeHistory: false }),
    [productInput]
  );
  const detailProduct = detail?.kind === "product" ? productRows.find((row) => row.name === detail.id) ?? null : null;
  const detailHistory = useMemo(() => {
    if (!detailProduct) return [];
    const records = detailProduct.ingredientId
      ? productInput.records.filter((record) => record.productId === detailProduct.ingredientId)
      : [];
    return supplierProductRows({ ...productInput, records }).find((row) => row.name === detailProduct.name)?.history ?? [];
  }, [detailProduct, productInput]);
  const stockRows = useMemo(
    () => supplierStockRows({ scope, movements: props.movements, invoices }),
    [scope, props.movements, invoices]
  );
  const movementRows = rows.filter((row) => row.id !== "period-opening" && row.id !== "period-closing" && (!moveQuery || `${row.reference} ${row.description}`.toLowerCase().includes(moveQuery.trim().toLowerCase())));
  const detailRow = detail?.kind === "movement" ? rows.find((row) => row.id === detail.id) ?? null : null;
  const detailInvoice = detail?.kind === "document" ? invoices.find((invoice) => invoice.id === detail.id) ?? null : null;
  const sourceInvoices = useMemo(() => {
    if (!detailProduct?.ingredientId) return [];
    const ids = new Set(
      props.records
        .filter((record) => record.productId === detailProduct.ingredientId && record.supplierId && scope.has(record.supplierId) && record.invoiceId)
        .map((record) => record.invoiceId as string)
    );
    return invoices.filter((invoice) => ids.has(invoice.id));
  }, [detailProduct, props.records, scope, invoices]);
  const rowLabel = (row: (typeof rows)[number]) =>
    row.id === "period-opening" ? t("admin.supplier.periodOpening") : row.id === "period-closing" ? t("admin.supplier.periodClosing") : t(`admin.supplier.kind.${row.kind}`);
  const contactBits = [
    supplier.contactName,
    supplier.phone || (supplier.contactName || supplier.paymentTerms ? t("admin.supplier.phoneMissing") : ""),
    supplier.paymentTerms,
  ].filter(Boolean);
  const contactLine = contactBits.length ? contactBits.join(" · ") : t("admin.supplier.contactMissing");

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
  const shownMovements = rangeReady
    ? rows.filter((row) => {
        const q = moveQuery.trim().toLowerCase();
        if (!q) return true;
        return `${row.reference ?? ""} ${row.description} ${rowLabel(row)}`.toLowerCase().includes(q);
      })
    : [];
  const recentMoves = rangeReady ? movementRows.slice(-5).reverse() : [];
  const openDocs = ledger.openDocuments.filter((doc) => doc.id !== "opening" && doc.open > 0.009);
  const plannedPayments = payments
    .filter((payment) => payment.status === "planned")
    .slice()
    .sort((a, b) => (a.dueAt || a.paidAt).localeCompare(b.dueAt || b.paidAt));
  const coverInvoices = invoices.filter((invoice) => isApprovedDocument(invoice) && invoice.documentType !== "delivery" && invoice.documentType !== "credit");

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <button type="button" className="text-sm text-turquoise" onClick={props.onBack}>{t("admin.supplier.back")}</button>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-turquoise/15 text-sm font-semibold text-dark-brown">{initials(supplier.name)}</span>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold text-dark-brown sm:text-2xl">{supplier.name}</h1>
            <p className="break-words text-sm text-coffee/70">{contactLine}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="turquoise" onClick={() => setPaying(true)}>{t("admin.supplier.pay.record")}</Button>
          <Button type="button" variant="outline" onClick={() => props.onAddDocument?.()}>{t("admin.supplier.addDocument")}</Button>
          <Button type="button" variant="outline" onClick={() => { setMore(false); setDetail(null); setEditing(true); }}>{t("admin.supplier.editDetails")}</Button>
          <Button type="button" variant="outline" onClick={() => { setEditing(false); setDetail(null); setMore(true); }}>{t("admin.supplier.more")}</Button>
        </div>
      </header>
      {props.loadError ? <p className="text-sm text-red-700">{props.loadError}</p> : null}
      {actionError ? <p className="text-sm text-red-700">{actionError}</p> : null}
      {matches.length ? (
        <button type="button" className="text-sm text-amber-900" onClick={() => { setEditing(false); setDetail(null); setMore(true); }}>
          {t("admin.supplier.merge.title")} ({matches.length})
        </button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {(["month", "prev", "custom"] as const).map((item) => (
          <button key={item} type="button" className={`rounded-full px-3 py-1.5 text-sm ${period === item ? "bg-turquoise text-white" : "bg-white text-coffee/80 shadow-sm"}`} onClick={() => setPeriod(item)}>
            {t(`admin.supplier.period.${item}`)}
          </button>
        ))}
        {period === "custom" ? (
          <>
            <input className="h-9 rounded-xl border border-beige-dark/30 bg-white px-2 text-sm" type="date" value={customFrom} aria-label={t("admin.supplier.filter.from")} onChange={(event) => setCustomFrom(event.target.value)} />
            <input className="h-9 rounded-xl border border-beige-dark/30 bg-white px-2 text-sm" type="date" value={customTo} aria-label={t("admin.supplier.filter.to")} onChange={(event) => setCustomTo(event.target.value)} />
          </>
        ) : null}
      </div>
      {!ready ? <SummarySkeleton /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneyFigure emphasis label={t("admin.supplier.balance")} value={moneyBalance(ledger.balance, t)} caption={t("admin.supplier.balanceCaption")} />
          <MoneyFigure label={t("admin.supplier.overdue")} value={formatIls(ledger.overdue)} caption={t("admin.supplier.balanceCaption")} />
          {rangeReady ? (
            <>
              <MoneyFigure label={t("admin.supplier.periodPurchases")} value={formatIls(ledger.periodPurchases)} caption={t("admin.supplier.period.caption")} />
              <MoneyFigure label={t("admin.supplier.periodPayments")} value={formatIls(ledger.periodPayments)} caption={t("admin.supplier.period.caption")} />
            </>
          ) : (
            <article className="col-span-2 rounded-2xl bg-white p-4 text-sm text-coffee/70 shadow-sm">{t("admin.supplier.period.needRange")}</article>
          )}
        </div>
      )}
      <div className="rounded-2xl bg-white px-4 py-2 text-sm text-dark-brown shadow-sm">
        <span className="text-coffee/70">{t("admin.supplier.nextPayment")}</span>
        <span className="ms-2 font-medium">
          {!ready ? t("admin.supplier.loading") : ledger.nextPayment ? `${showDate(ledger.nextPayment.date)} · ${formatIls(ledger.nextPayment.amount)}` : t("admin.supplier.nextNone")}
        </span>
      </div>
      <nav className="flex flex-wrap gap-x-4 border-b border-beige-dark/20">
        {(["overview", "movements", "documents", "products"] as const).map((item) => (
          <button key={item} type="button" className={`border-b-2 px-1 pb-2 text-sm ${tab === item ? "border-turquoise font-semibold text-dark-brown" : "border-transparent text-coffee/70"}`} onClick={() => setTab(item)}>
            {t(item === "documents" ? "admin.supplier.tab.documentsTitle" : item === "products" ? "admin.supplier.tab.productsTitle" : `admin.supplier.tab.${item}`)}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-dark-brown">{t("admin.supplier.overview.upcoming")}</h2>
              <button type="button" className="text-sm text-turquoise" onClick={() => setTab("movements")}>{t("admin.supplier.overview.seeAll")}</button>
            </div>
            {!ready ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : plannedPayments.length === 0 && openDocs.every((doc) => !doc.dueDate || doc.dueDate < today) ? <p className="text-sm text-coffee/60">{t("admin.supplier.overview.emptyUpcoming")}</p> : (
              <div className="space-y-2 text-sm">
                {openDocs.filter((doc) => doc.dueDate && doc.dueDate >= today).slice(0, 5).map((doc) => (
                  <button key={doc.id} type="button" className="flex w-full justify-between gap-2 text-start" onClick={() => { setEditing(false); setMore(false); setDetail({ kind: "document", id: doc.id }); }}>
                    <span className="min-w-0 break-words">{showDate(doc.dueDate)} · {doc.number || t("admin.supplier.kind.invoice")}</span>
                    <span className="shrink-0 tabular-nums">{formatIls(doc.open)}</span>
                  </button>
                ))}
                {plannedPayments.map((payment) => (
                  <p key={payment.id}>{showDate(payment.dueAt || payment.paidAt)} · {formatIls(payment.amount)} · {payment.reference || t("admin.supplier.pay.planned")}</p>
                ))}
              </div>
            )}
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-dark-brown">{t("admin.supplier.overview.openInvoices")}</h2>
              <button type="button" className="text-sm text-turquoise" onClick={() => setTab("documents")}>{t("admin.supplier.overview.seeAll")}</button>
            </div>
            {!ready ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : openDocs.length === 0 ? <p className="text-sm text-coffee/60">{t("admin.supplier.overview.emptyOpen")}</p> : (
              <div className="space-y-2">
                {openDocs.slice(0, 5).map((doc) => (
                  <button key={doc.id} type="button" className="flex w-full items-center justify-between gap-2 text-start text-sm" onClick={() => { setEditing(false); setMore(false); setDetail({ kind: "document", id: doc.id }); }}>
                    <span className="min-w-0 break-words">{doc.number || t("admin.supplier.kind.invoice")}{doc.dueDate ? ` · ${showDate(doc.dueDate)}` : ` · ${t("admin.supplier.aging.missing")}`}</span>
                    <span className="shrink-0 tabular-nums">{formatIls(doc.open)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-dark-brown">{t("admin.supplier.overview.recent")}</h2>
              <button type="button" className="text-sm text-turquoise" onClick={() => setTab("movements")}>{t("admin.supplier.overview.seeAll")}</button>
            </div>
            {!ready ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : !rangeReady ? <p className="text-sm text-coffee/60">{t("admin.supplier.period.needRange")}</p> : recentMoves.length === 0 ? <p className="text-sm text-coffee/60">{t("admin.supplier.overview.emptyRecent")}</p> : (
              <div className="space-y-2">
                {recentMoves.map((row) => (
                  <button key={row.id} type="button" className="flex w-full items-center justify-between gap-2 text-start text-sm" onClick={() => { setEditing(false); setMore(false); setDetail({ kind: "movement", id: row.id }); }}>
                    <span className="min-w-0 break-words">{showDate(row.at)} · {rowLabel(row)}{row.reference ? ` · ${row.reference}` : ""}</span>
                    <span className="shrink-0 tabular-nums">{formatIls(row.balanceAfter)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-dark-brown">{t("admin.supplier.tab.aging")}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MoneyFigure label={t("admin.supplier.aging.current")} value={ready ? formatIls(ledger.aging.current) : t("admin.supplier.loading")} />
              <MoneyFigure label={t("admin.supplier.aging.d1")} value={ready ? formatIls(ledger.aging.d1_30) : t("admin.supplier.loading")} />
              <MoneyFigure label={t("admin.supplier.aging.d31")} value={ready ? formatIls(ledger.aging.d31_60) : t("admin.supplier.loading")} />
              <MoneyFigure label={t("admin.supplier.aging.d61")} value={ready ? formatIls(ledger.aging.d61_90) : t("admin.supplier.loading")} />
              <MoneyFigure label={t("admin.supplier.aging.d90")} value={ready ? formatIls(ledger.aging.d90) : t("admin.supplier.loading")} />
              <MoneyFigure label={t("admin.supplier.aging.missing")} value={ready ? formatIls(ledger.aging.missing) : t("admin.supplier.loading")} />
            </div>
          </section>
        </div>
      )}

      {tab === "movements" && (
        <div className="space-y-4">
          <Input value={moveQuery} onChange={(event) => setMoveQuery(event.target.value)} placeholder={t("admin.supplier.search")} className="max-w-md bg-white" />
          {!ready ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : !rangeReady ? <p className="text-sm text-coffee/60">{t("admin.supplier.period.needRange")}</p> : (
            <>
              <div className="hidden overflow-hidden rounded-2xl bg-white shadow-sm md:block">
                <table className="w-full table-fixed text-sm">
                  <thead className="text-xs text-coffee/60">
                    <tr className="border-b border-beige-dark/15">
                      <th className="px-3 py-2 text-start font-medium">{t("admin.supplier.col.date")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("admin.supplier.col.action")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("admin.supplier.col.reference")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("admin.supplier.col.increase")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("admin.supplier.col.decrease")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("admin.supplier.col.balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownMovements.length === 0 ? <tr><td colSpan={6} className="px-3 py-4 text-coffee/60">{t("admin.supplier.empty")}</td></tr> : shownMovements.map((row) => (
                      <tr key={row.id} className="cursor-pointer border-b border-beige-dark/10" onClick={() => { setEditing(false); setMore(false); setDetail({ kind: "movement", id: row.id }); }}>
                        <td className="px-3 py-2">{showDate(row.at)}</td>
                        <td className="px-3 py-2">{rowLabel(row)}</td>
                        <td className="px-3 py-2">{row.reference ? <button type="button" className="text-turquoise" onClick={(event) => { event.stopPropagation(); setEditing(false); setMore(false); setDetail({ kind: "movement", id: row.id }); }}>{row.reference}</button> : ""}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{row.increase ? formatIls(row.increase) : ""}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{row.decrease ? formatIls(row.decrease) : ""}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{moneyBalance(row.balanceAfter, t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <MovementCards rows={shownMovements} labelFor={rowLabel} onOpen={(id) => { setEditing(false); setMore(false); setDetail({ kind: "movement", id }); }} />
            </>
          )}
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-dark-brown">{t("admin.supplier.stockTitle")}</h2>
            <p className="mt-1 text-xs text-coffee/55">{t("admin.supplier.stock.note")}</p>
            {stockRows.length === 0 ? <p className="mt-2 text-sm text-coffee/60">{t("admin.supplier.empty")}</p> : (
              <div className="mt-3 space-y-2">
                {stockRows.map((movement) => {
                  const product = props.ingredients.find((item) => item.id === movement.productId);
                  return (
                    <div key={movement.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-beige-dark/10 py-2 text-sm">
                      <span className="min-w-0 break-words">{showDate(movement.receivedAt)} · {product?.name || movement.productId} · {t(`admin.inventory.movement.${movement.type}`, movement.type)} · {movement.quantity} {movement.unit ? t(unitLabelKey(movement.unit)) : ""}</span>
                      {movement.invoiceId ? <button type="button" className="text-turquoise" onClick={() => { setEditing(false); setMore(false); setDetail({ kind: "document", id: movement.invoiceId! }); }}>{t("admin.supplier.doc.view")}</button> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "documents" && !ready ? <p className="text-sm text-coffee/60">{t("admin.supplier.loading")}</p> : null}
      {tab === "documents" && ready ? (
        <DocumentsTab
          invoices={invoices}
          payments={payments}
          covered={covered}
          status={docStatus}
          query={docQuery}
          today={today}
          onStatus={setDocStatus}
          onQuery={setDocQuery}
          onInspect={(id) => { setEditing(false); setMore(false); setDetail({ kind: "document", id }); }}
        />
      ) : null}

      {tab === "products" && (
        <div className="rounded-2xl bg-white p-3 shadow-sm sm:p-4">
          <ProductTable rows={productRows} records={props.records} scope={scope} onOpen={(name) => { setEditing(false); setMore(false); setDetail({ kind: "product", id: name }); }} />
        </div>
      )}

      {editing ? (
        <SidePanel title={t("admin.supplier.editDetails")} onClose={() => setEditing(false)}>
          <form key={supplier.updatedAt} className="grid gap-3" onSubmit={(event) => void profileSave(event)}>
            <Field name="name" label={t("admin.inventory.supplierName")} defaultValue={supplier.name} />
            <Field name="taxId" label={t("admin.supplier.businessNumber")} defaultValue={supplier.taxId || ""} />
            <Field name="contactName" label={t("admin.supplier.contact")} defaultValue={supplier.contactName || ""} />
            <Field name="phone" label={t("admin.settings.phone")} defaultValue={supplier.phone || ""} />
            <Field name="email" label={t("admin.inventory.supplierEmail")} defaultValue={supplier.email || ""} />
            <Field name="paymentTerms" label={t("admin.supplier.paymentTerms")} defaultValue={supplier.paymentTerms || ""} />
            <Button type="submit" variant="turquoise" disabled={busy}>{t("common.save")}</Button>
            {profileError ? <p className="text-sm text-red-700">{profileError}</p> : null}
          </form>
        </SidePanel>
      ) : null}

      {more ? (
        <SidePanel title={t("admin.supplier.more")} onClose={() => setMore(false)}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void downloadLedgerWorkbook(`${supplier.name}-ledger.xlsx`, [{ name: "ledger", rows: exportRows() }]).catch(() => setActionError(t("admin.supplier.saveFailed")))}>{t("admin.supplier.export.excel")}</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void downloadLedgerPdf(`${supplier.name}-ledger.pdf`, supplier.name, exportRows()).catch(() => setActionError(t("admin.supplier.saveFailed")))}>{t("admin.supplier.export.pdf")}</Button>
            </div>
            <OpeningForm supplierId={supplier.id} current={openings.find((item) => item.supplierId === supplier.id)} actor={props.actor} onToast={props.onToast} />
            {matches.map((match) => {
              const identity = supplierIdentityMatch(supplier, match, props.invoices);
              const reason = identity.reasons.map((item) => (item === "tax" ? t("admin.supplier.businessNumber") : item === "phone" ? t("admin.settings.phone") : t("admin.supplier.tab.documents"))).join(" · ");
              return (
                <div key={match.id} className="rounded-xl bg-amber-50 px-3 py-2 text-sm">
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
            <div>
              <h3 className="mb-2 font-medium text-dark-brown">{t("admin.supplier.tab.history")}</h3>
              <div className="space-y-1 text-sm">
                {(supplier.audit ?? []).map((event, index) => (
                  <p key={`${event.at}-${index}`}>{showDate(event.at)}{event.actor ? ` · ${event.actor}` : ""} · {event.action}{event.detail ? ` · ${event.detail}` : ""}</p>
                ))}
                {payments.flatMap((payment) => (payment.history ?? []).map((event, index) => (
                  <p key={`${payment.id}-${index}`}>{showDate(event.at)}{event.actor ? ` · ${event.actor}` : ""} · {event.change} · {payment.reference || payment.id}</p>
                )))}
                {openings.flatMap((opening) => (opening.history ?? []).map((event, index) => (
                  <p key={`${opening.id}-${index}`}>{showDate(event.at)}{event.actor ? ` · ${event.actor}` : ""} · {event.change}</p>
                )))}
                {(supplier.audit ?? []).length + payments.reduce((sum, payment) => sum + (payment.history?.length ?? 0), 0) + openings.reduce((sum, opening) => sum + (opening.history?.length ?? 0), 0) === 0 ? (
                  <p className="text-coffee/60">{t("admin.supplier.overview.emptyRecent")}</p>
                ) : null}
              </div>
            </div>
          </div>
        </SidePanel>
      ) : null}

      {detail?.kind === "movement" && detailRow ? (
        <SidePanel title={rowLabel(detailRow)} onClose={() => setDetail(null)}>
          <div className="space-y-2 text-sm">
            <p>{t("admin.supplier.col.date")}: {showDate(detailRow.at)}</p>
            {detailRow.reference ? <p>{t("admin.supplier.col.reference")}: {detailRow.reference}</p> : null}
            {detailRow.description ? <p className="break-words">{detailRow.description}</p> : null}
            <p className="text-end tabular-nums">{t("admin.supplier.col.increase")}: {detailRow.increase ? formatIls(detailRow.increase) : ""}</p>
            <p className="text-end tabular-nums">{t("admin.supplier.col.decrease")}: {detailRow.decrease ? formatIls(detailRow.decrease) : ""}</p>
            <p className="text-end text-lg font-semibold tabular-nums">{moneyBalance(detailRow.balanceAfter, t)}</p>
            {detailRow.sourceId && detailRow.kind !== "payment" && detailRow.kind !== "opening" ? (
              <button type="button" className="text-turquoise" onClick={() => props.onOpenInvoice?.(detailRow.sourceId!)}>{t("admin.supplier.doc.view")}</button>
            ) : null}
            {detailRow.kind === "payment" ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const payment = payments.find((item) => item.id === detailRow.sourceId);
                  if (!payment || !window.confirm(t("admin.supplier.pay.cancel"))) return;
                  setActionError(null);
                  const result = await cancelSupplierPayment(payment, props.actor);
                  if (!result.success) setActionError(result.error);
                  else props.onToast(t("admin.supplier.pay.cancelled"));
                }}
              >
                {t("admin.supplier.pay.cancel")}
              </Button>
            ) : null}
          </div>
        </SidePanel>
      ) : null}

      {detail?.kind === "document" && detailInvoice ? (
        <SidePanel title={detailInvoice.invoiceNumber || t("admin.supplier.kind.invoice")} onClose={() => setDetail(null)}>
          <DocumentDetail
            invoice={detailInvoice}
            payments={payments}
            covered={covered}
            today={today}
            covers={coverInvoices}
            linkTarget={linkTarget}
            linkError={linkError}
            actor={props.actor}
            onLinkTarget={setLinkTarget}
            onLinkError={setLinkError}
            onOpenInvoice={props.onOpenInvoice}
            onToast={props.onToast}
          />
        </SidePanel>
      ) : null}
      {detail?.kind === "document" && detail && !detailInvoice ? (
        <SidePanel title={t("admin.supplier.tab.documentsTitle")} onClose={() => setDetail(null)}>
          <p className="text-sm text-coffee/70">{t("admin.supplier.amountMissing")}</p>
        </SidePanel>
      ) : null}

      {detail?.kind === "product" && detailProduct ? (
        <SidePanel title={detailProduct.name} onClose={() => setDetail(null)}>
          <div className="space-y-3 text-sm">
            {detailProduct.sku ? <p className="text-xs text-coffee/55">{detailProduct.sku}</p> : null}
            <p>{t("admin.supplier.product.ingredient")}: {detailProduct.ingredientName || t("admin.supplier.product.noIngredient")}</p>
            <p>{t("admin.supplier.product.group")}: {detailProduct.compareGroup || t("admin.supplier.product.noGroup")}</p>
            <p>{t("admin.supplier.product.pack")}: {formatPack(detailProduct.pack, t) || (detailProduct.price == null ? t("admin.supplier.product.noPurchase") : "")}</p>
            <p className="text-lg font-semibold tabular-nums">{priceText(detailProduct, props.records, scope, t)}</p>
            <p>{detailProduct.date ? showDate(detailProduct.date) : ""}</p>
            <div>
              <h3 className="mb-1 font-medium">{t("admin.supplier.product.history")}</h3>
              {detailHistory.length === 0 ? <p className="text-coffee/60">{t("admin.supplier.product.noPurchase")}</p> : detailHistory.map((item) => (
                <p key={`${item.date}-${item.price}`} className="tabular-nums">{showDate(item.date)} · {formatIls(item.price)}{item.unit ? ` / ${t(unitLabelKey(item.unit))}` : ""}</p>
              ))}
            </div>
            <div>
              <h3 className="mb-1 font-medium">{t("admin.supplier.product.sources")}</h3>
              {sourceInvoices.length === 0 ? <p className="text-coffee/60">{t("admin.supplier.product.sourcesEmpty")}</p> : sourceInvoices.map((invoice) => (
                <button key={invoice.id} type="button" className="block text-turquoise" onClick={() => { setDetail({ kind: "document", id: invoice.id }); }}>{invoice.invoiceNumber || invoice.id}</button>
              ))}
            </div>
          </div>
        </SidePanel>
      ) : null}

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

function DocumentDetail(props: {
  invoice: PurchaseInvoice;
  payments: SupplierPayment[];
  covered: Set<string>;
  today: string;
  covers: PurchaseInvoice[];
  linkTarget: string;
  linkError: string | null;
  actor?: string;
  onLinkTarget: (value: string) => void;
  onLinkError: (value: string | null) => void;
  onOpenInvoice?: (invoiceId: string, lineId?: string) => void;
  onToast: LedgerProps["onToast"];
}) {
  const t = useT();
  const settlement = invoiceSettlement(props.invoice, props.payments, props.covered);
  const tag = payTagForInvoice(props.invoice, settlement.open, settlement.settled, settlement.countsAsDebt, props.today);
  return (
    <div className="space-y-3 text-sm">
      <p>{t("admin.supplier.col.date")}: {props.invoice.invoiceDate ? showDate(props.invoice.invoiceDate) : ""}</p>
      <p>{t("admin.supplier.doc.due")}: {props.invoice.dueDate ? showDate(props.invoice.dueDate) : t("admin.supplier.aging.missing")}</p>
      <p className="text-end tabular-nums">{t("admin.supplier.doc.net")}: {amountOrMissing(headerNet(props.invoice), t)}</p>
      <p className="text-end tabular-nums">{t("admin.supplier.doc.vat")}: {amountOrMissing(headerVat(props.invoice), t)}</p>
      <p className="text-end text-lg font-semibold tabular-nums">{t("admin.supplier.doc.gross")}: {formatIls(documentGross(props.invoice))}</p>
      <p className="text-end tabular-nums">{t("admin.supplier.doc.paid")}: {formatIls(settlement.settled)}</p>
      <p className="text-end tabular-nums">{t("admin.supplier.doc.balance")}: {settlement.effect > 0 ? formatIls(settlement.open) : settlement.effect < 0 ? moneyBalance(settlement.effect, t) : t("admin.supplier.doc.noDebt")}</p>
      {tag ? <StatusTag tag={tag} /> : <p>{statusText(props.invoice, t)}</p>}
      <button type="button" className="text-turquoise" onClick={() => props.onOpenInvoice?.(props.invoice.id, props.invoice.lines[0]?.key)}>{t("admin.supplier.doc.view")}</button>
      {props.invoice.documentType === "delivery" && !props.covered.has(props.invoice.id) ? (
        <div>
          <select className="h-9 w-full rounded-xl border border-beige-dark/30 px-2 text-sm" value={props.linkTarget} onChange={(event) => props.onLinkTarget(event.target.value)}>
            <option value="">{t("admin.supplier.doc.link")}</option>
            {props.covers.map((cover) => <option key={cover.id} value={cover.id}>{cover.invoiceNumber}</option>)}
          </select>
          {props.linkTarget ? (
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={async () => {
                props.onLinkError(null);
                const result = await linkDeliveryToInvoice(props.invoice.id, props.linkTarget, props.actor);
                if (!result.success) props.onLinkError(result.error);
                else {
                  props.onLinkTarget("");
                  props.onToast(t("admin.supplier.doc.linked"));
                }
              }}
            >
              {t("common.save")}
            </Button>
          ) : null}
          {props.linkError ? <p className="mt-2 text-sm text-red-700">{props.linkError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function DocumentsTab(props: {
  invoices: PurchaseInvoice[];
  payments: SupplierPayment[];
  covered: Set<string>;
  status: string;
  query: string;
  today: string;
  onStatus: (value: string) => void;
  onQuery: (value: string) => void;
  onInspect: (id: string) => void;
}) {
  const t = useT();
  const q = props.query.trim().toLowerCase();
  const rows = props.invoices.filter((invoice) => {
    if (props.status === "approved" && !isApprovedDocument(invoice)) return false;
    if (props.status === "pending" && isApprovedDocument(invoice)) return false;
    if (!q) return true;
    return `${invoice.invoiceNumber} ${invoice.supplierName}`.toLowerCase().includes(q);
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder={t("admin.supplier.search")} className="bg-white sm:max-w-xs" />
        <select className="h-10 rounded-xl border border-beige-dark/30 bg-white px-2 text-sm" value={props.status} aria-label={t("admin.supplier.filter.status")} onChange={(event) => props.onStatus(event.target.value)}>
          <option value="all">{t("admin.supplier.filter.all")}</option>
          <option value="approved">{t("admin.supplier.status.approved")}</option>
          <option value="pending">{t("admin.supplier.status.needs_review")}</option>
        </select>
      </div>
      <div className="hidden overflow-hidden rounded-2xl bg-white shadow-sm md:block">
        <table className="w-full table-fixed text-sm">
          <thead className="text-xs text-coffee/60">
            <tr className="border-b border-beige-dark/15">
              <th className="px-3 py-2 text-start font-medium">{t("admin.supplier.doc.number")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("admin.supplier.col.date")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("admin.supplier.doc.due")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("admin.supplier.doc.gross")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("admin.supplier.doc.balance")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("admin.supplier.doc.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-4 text-coffee/60">{t("admin.supplier.empty")}</td></tr> : rows.map((invoice) => {
              const settlement = invoiceSettlement(invoice, props.payments, props.covered);
              const tag = payTagForInvoice(invoice, settlement.open, settlement.settled, settlement.countsAsDebt, props.today);
              return (
                <tr key={invoice.id} className="cursor-pointer border-b border-beige-dark/10" onClick={() => props.onInspect(invoice.id)}>
                  <td className="px-3 py-2"><button type="button" className="text-turquoise" onClick={(event) => { event.stopPropagation(); props.onInspect(invoice.id); }}>{invoice.invoiceNumber || t("admin.supplier.kind.invoice")}</button></td>
                  <td className="px-3 py-2">{invoice.invoiceDate ? showDate(invoice.invoiceDate) : ""}</td>
                  <td className="px-3 py-2">{invoice.dueDate ? showDate(invoice.dueDate) : t("admin.supplier.aging.missing")}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatIls(documentGross(invoice))}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{settlement.effect > 0 ? formatIls(settlement.open) : settlement.effect < 0 ? moneyBalance(settlement.effect, t) : t("admin.supplier.doc.noDebt")}</td>
                  <td className="px-3 py-2">{tag ? <StatusTag tag={tag} /> : statusText(invoice, t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.length === 0 ? <p className="text-sm text-coffee/60">{t("admin.supplier.empty")}</p> : rows.map((invoice) => {
          const settlement = invoiceSettlement(invoice, props.payments, props.covered);
          const tag = payTagForInvoice(invoice, settlement.open, settlement.settled, settlement.countsAsDebt, props.today);
          return (
            <button key={invoice.id} type="button" className="w-full rounded-2xl bg-white p-3 text-start shadow-sm" onClick={() => props.onInspect(invoice.id)}>
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{invoice.invoiceNumber || t("admin.supplier.kind.invoice")}</span>
                <span className="tabular-nums">{formatIls(documentGross(invoice))}</span>
              </span>
              <span className="mt-1 flex items-center justify-between gap-2 text-xs text-coffee/70">
                <span>{invoice.invoiceDate ? showDate(invoice.invoiceDate) : ""}</span>
                {tag ? <StatusTag tag={tag} /> : <span>{statusText(invoice, t)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
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
