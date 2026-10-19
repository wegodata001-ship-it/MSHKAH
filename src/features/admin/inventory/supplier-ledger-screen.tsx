"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { formatIls } from "@/lib/costing/money";
import {
  documentPayTag,
  splitPackLabel,
  type DocumentPayTag,
  type SupplierLedgerRow,
  type SupplierProductRow,
} from "@/lib/inventory/supplier-ledger";
import type { PurchaseInvoice, PurchasePriceRecord } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

export type LedgerTab = "overview" | "movements" | "documents" | "products";
export type LedgerPeriod = "month" | "prev" | "custom";

const PAGE_SIZE = 8;

export function monthRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end) };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second || name.trim().slice(0, 2)).toUpperCase();
}

export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000]">
      <button type="button" className="absolute inset-0 bg-dark-brown/40" aria-label={t("admin.supplier.close")} onClick={onClose} />
      <aside className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col overflow-y-auto bg-warm-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-beige-dark/15 bg-warm-white px-4 py-3">
          <h2 className="text-base font-semibold text-dark-brown">{title}</h2>
          <button type="button" className="text-sm text-turquoise" onClick={onClose}>{t("admin.supplier.close")}</button>
        </div>
        <div className="space-y-3 px-4 py-4">{children}</div>
      </aside>
    </div>,
    document.body
  );
}

export function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-2xl bg-white shadow-sm" />
      ))}
    </div>
  );
}

export function MoneyFigure({ label, value, caption, emphasis }: { label: string; value: string; caption?: string; emphasis?: boolean }) {
  return (
    <article className="rounded-2xl bg-white p-3 shadow-sm sm:p-4">
      <p className="text-xs text-coffee/70">{label}</p>
      <p className={cn("mt-1 font-semibold text-dark-brown tabular-nums", emphasis ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl")}>{value}</p>
      {caption ? <p className="mt-1 text-[11px] text-coffee/55">{caption}</p> : null}
    </article>
  );
}

export function StatusTag({ tag }: { tag: DocumentPayTag }) {
  const t = useT();
  const tone = {
    open: "bg-beige text-dark-brown",
    partial: "bg-amber-50 text-amber-900",
    paid: "bg-emerald-50 text-emerald-800",
    overdue: "bg-red-50 text-red-800",
    credit: "bg-turquoise/10 text-turquoise",
  }[tag];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>{t(`admin.supplier.tag.${tag}`)}</span>;
}

export function formatPack(pack: string | undefined, t: (key: string) => string): string | null {
  const parts = splitPackLabel(pack);
  if (!parts) return null;
  if (!parts.unit) return parts.quantity;
  return `${parts.quantity} ${t(unitLabelKey(parts.unit))}`;
}

export function priceVatKey(row: SupplierProductRow, records: PurchasePriceRecord[], scope: Set<string>): "including" | "before" | "unknown" {
  if (row.price == null || !row.ingredientId) return "unknown";
  const record = records.find((item) =>
    Boolean(item.supplierId && scope.has(item.supplierId) && item.productId === row.ingredientId && item.purchaseDate === row.date)
  );
  if (!record) return "unknown";
  if (record.priceIncludingVat && row.price === record.priceIncludingVat) return "including";
  if (row.price === record.priceBeforeVat || row.price === record.unitPriceNet || row.price === record.unitCost) return "before";
  return "unknown";
}

export function payTagForInvoice(invoice: PurchaseInvoice, open: number, settled: number, countsAsDebt: boolean, today: string): DocumentPayTag | null {
  return documentPayTag({
    documentType: invoice.documentType,
    open,
    settled,
    dueDate: invoice.dueDate,
    today,
    countsAsDebt,
  });
}

export function ProductTable({
  rows,
  records,
  scope,
  onOpen,
}: {
  rows: SupplierProductRow[];
  records: PurchasePriceRecord[];
  scope: Set<string>;
  onOpen: (name: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "priced" | "missing">("all");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "priced" && row.price == null) return false;
      if (filter === "missing" && row.price != null) return false;
      if (!q) return true;
      return [row.name, row.sku, row.ingredientName].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [rows, query, filter]);
  useEffect(() => setPage(0), [query, filter, rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("admin.supplier.product.search")} className="sm:max-w-xs" />
        <div className="flex flex-wrap gap-1">
          {(["all", "priced", "missing"] as const).map((item) => (
            <button key={item} type="button" className={cn("rounded-full px-3 py-1 text-xs", filter === item ? "bg-turquoise text-white" : "bg-beige/70 text-coffee/70")} onClick={() => setFilter(item)}>
              {t(item === "all" ? "admin.supplier.product.filterAll" : item === "priced" ? "admin.supplier.product.withPrice" : "admin.supplier.product.missingPrice")}
            </button>
          ))}
        </div>
      </div>
      <div className="hidden md:block">
        <table className="w-full table-fixed text-sm">
          <thead className="text-xs text-coffee/60">
            <tr className="border-b border-beige-dark/15 text-start">
              <th className="px-2 py-2 font-medium">{t("admin.supplier.product.name")}</th>
              <th className="px-2 py-2 font-medium">{t("admin.supplier.product.ingredient")}</th>
              <th className="px-2 py-2 font-medium">{t("admin.supplier.product.pack")}</th>
              <th className="px-2 py-2 text-end font-medium">{t("admin.supplier.product.price")}</th>
              <th className="px-2 py-2 font-medium">{t("admin.supplier.col.date")}</th>
              <th className="px-2 py-2 font-medium">{t("admin.supplier.product.details")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? <tr><td colSpan={6} className="px-2 py-4 text-coffee/60">{t("admin.supplier.empty")}</td></tr> : visible.map((row) => (
              <ProductLine key={row.name} row={row} records={records} scope={scope} onOpen={onOpen} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {visible.length === 0 ? <p className="text-sm text-coffee/60">{t("admin.supplier.empty")}</p> : visible.map((row) => (
          <button key={row.name} type="button" className="w-full rounded-2xl bg-white p-3 text-start shadow-sm" onClick={() => onOpen(row.name)}>
            <ProductIdentity row={row} />
            <p className="mt-1 text-sm text-coffee/80">{row.ingredientName || t("admin.supplier.product.noIngredient")}</p>
            <p className="mt-1 text-sm font-medium tabular-nums">{priceText(row, records, scope, t)}</p>
          </button>
        ))}
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button type="button" variant="outline" className="h-8" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{t("admin.supplier.pagePrev")}</Button>
          <span className="text-coffee/60">{page + 1} / {pages}</span>
          <Button type="button" variant="outline" className="h-8" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>{t("admin.supplier.pageNext")}</Button>
        </div>
      ) : null}
    </div>
  );
}

function ProductLine({ row, records, scope, onOpen }: { row: SupplierProductRow; records: PurchasePriceRecord[]; scope: Set<string>; onOpen: (name: string) => void }) {
  const t = useT();
  return (
    <tr className="border-b border-beige-dark/10 align-top">
      <td className="px-2 py-2"><ProductIdentity row={row} /></td>
      <td className="px-2 py-2">{row.ingredientName || t("admin.supplier.product.noIngredient")}</td>
      <td className="px-2 py-2">{formatPack(row.pack, t) || (row.price == null ? t("admin.supplier.product.noPurchase") : "")}</td>
      <td className="px-2 py-2 text-end tabular-nums">{priceText(row, records, scope, t)}</td>
      <td className="px-2 py-2">{row.date ? showDate(row.date) : row.price == null ? t("admin.supplier.product.noPurchase") : ""}</td>
      <td className="px-2 py-2"><button type="button" className="text-turquoise" onClick={() => onOpen(row.name)}>{t("admin.supplier.product.details")}</button></td>
    </tr>
  );
}

function ProductIdentity({ row }: { row: SupplierProductRow }) {
  return (
    <div className="min-w-0">
      <p className="break-words font-medium text-dark-brown">{row.name}</p>
      {row.sku ? <p className="break-all text-[11px] text-coffee/55">{row.sku}</p> : null}
    </div>
  );
}

export function priceText(row: SupplierProductRow, records: PurchasePriceRecord[], scope: Set<string>, t: (key: string) => string): string {
  if (row.price == null) return t("admin.supplier.product.noPurchase");
  const unit = row.unit ? t(unitLabelKey(row.unit)) : "";
  const vat = t(`admin.supplier.vat.${priceVatKey(row, records, scope)}`);
  return `${formatIls(row.price)}${unit ? ` / ${unit}` : ""} · ${vat}`;
}

export function showDate(value?: string): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

export function amountOrMissing(value: number | null | undefined, t: (key: string) => string): string {
  if (value == null || !Number.isFinite(value)) return t("admin.supplier.amountMissing");
  return formatIls(value);
}

export function MovementCards({ rows, labelFor, onOpen }: { rows: SupplierLedgerRow[]; labelFor: (row: SupplierLedgerRow) => string; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <div className="space-y-2 md:hidden">
      {rows.length === 0 ? <p className="text-sm text-coffee/60">{t("admin.supplier.empty")}</p> : rows.map((row) => (
        <button key={row.id} type="button" className="w-full rounded-2xl bg-white p-3 text-start shadow-sm" onClick={() => onOpen(row.id)}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelFor(row)}</span>
            <span className="tabular-nums">{formatIls(row.balanceAfter)}</span>
          </span>
          <span className="mt-1 block text-xs text-coffee/60">{showDate(row.at)}{row.reference ? ` · ${row.reference}` : ""}</span>
        </button>
      ))}
    </div>
  );
}
