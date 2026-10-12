"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { archiveStatus, invoiceArchiveQuery } from "@/lib/inventory/invoice-archive";
import { headerGross, headerNet, headerVat } from "@/lib/inventory/invoice-finance";
import type { InvoiceScanStatus, PurchaseInvoice } from "@/lib/inventory/types";

const FILTERS = ["all", "review", "approved", "posted", "failed"] as const;

export function InvoiceArchivePanel({
  invoices,
  onOpen,
  onRescan,
  onTransfer,
}: {
  invoices: PurchaseInvoice[];
  onOpen: (invoice: PurchaseInvoice) => void;
  onRescan: (invoice: PurchaseInvoice) => void;
  onTransfer: (invoice: PurchaseInvoice) => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rows = useMemo(
    () => invoiceArchiveQuery(invoices, { filter, query, from: from || undefined, to: to || undefined }),
    [invoices, filter, query, from, to]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`h-8 rounded-full px-3 text-xs font-medium ${filter === item ? "bg-turquoise text-white" : "bg-beige/70 text-coffee/70"}`}
          >
            {t(`admin.inventory.archive.filter.${item}`)}
          </button>
        ))}
        <Input className="h-8 min-w-[12rem] flex-1 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.inventory.archive.search")} />
        <Input className="h-8 w-36 text-sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input className="h-8 w-36 text-sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-beige-dark/15">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-beige/50 text-xs text-coffee/60">
            <tr className="h-10">
              <th className="px-2 text-start font-medium">{t("admin.inventory.archive.uploadedAt")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.invoiceDate")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.invoiceNumber")}</th>
              <th className="px-2 text-start font-medium">{t("admin.costing.supplier")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.status")}</th>
              <th className="px-2 text-start font-medium">{t("admin.finance.compareNet")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.vat")}</th>
              <th className="px-2 text-start font-medium">{t("admin.finance.compareGross")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.summaryItems")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.archive.source")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.archive.uploadedBy")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.archive.stock")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => {
              const status = archiveStatus(invoice);
              return (
                <tr key={invoice.id} className="h-14 border-t border-beige-dark/10">
                  <td className="px-2">{(invoice.uploadedAt || invoice.createdAt || "").slice(0, 10)}</td>
                  <td className="px-2">{invoice.invoiceDate || "—"}</td>
                  <td className="px-2">{invoice.invoiceNumber || "—"}</td>
                  <td className="px-2">{invoice.supplierName || "—"}</td>
                  <td className="px-2"><StatusPill status={status} t={t} /></td>
                  <td className="px-2 tabular-nums">{headerNet(invoice) != null ? formatIls(headerNet(invoice)!) : "—"}</td>
                  <td className="px-2 tabular-nums">{headerVat(invoice) != null ? formatIls(headerVat(invoice)!) : "—"}</td>
                  <td className="px-2 tabular-nums">{headerGross(invoice) != null ? formatIls(headerGross(invoice)!) : "—"}</td>
                  <td className="px-2">{invoice.lines?.length ?? 0}</td>
                  <td className="px-2 uppercase">{invoice.sourceFile?.kind || (invoice.fileName?.endsWith(".pdf") ? "pdf" : "—")}</td>
                  <td className="px-2">{invoice.createdBy || invoice.sourceFile?.uploadedBy || "—"}</td>
                  <td className="px-2">{invoice.stockStatus === "posted" ? t("admin.finance.stockPosted") : t("admin.finance.stockNone")}</td>
                  <td className="px-2">
                    <div className="flex flex-wrap gap-1">
                      <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={() => onOpen(invoice)}>{t("admin.inventory.smart.editRow")}</Button>
                      {invoice.sourceFile?.downloadUrl && (
                        <a className="inline-flex h-7 items-center rounded-xl border px-2 text-xs" href={invoice.sourceFile.downloadUrl} target="_blank" rel="noreferrer">
                          {t("admin.inventory.archive.viewSource")}
                        </a>
                      )}
                      <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={() => onRescan(invoice)}>{t("admin.inventory.archive.rescan")}</Button>
                      {invoice.stockStatus !== "posted" && invoice.status === "saved" && (
                        <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={() => onTransfer(invoice)}>{t("admin.finance.confirmTransfer")}</Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-coffee/55">{t("admin.inventory.noInvoices")}</p>
      )}
    </div>
  );
}

function StatusPill({ status, t }: { status: InvoiceScanStatus; t: (key: string) => string }) {
  const styles: Record<InvoiceScanStatus, string> = {
    uploaded: "bg-stone-100 text-stone-700",
    scanning: "bg-sky-50 text-sky-800",
    needs_review: "bg-amber-50 text-amber-800",
    ready: "bg-emerald-50 text-emerald-800",
    approved: "bg-emerald-50 text-emerald-800",
    posted: "bg-turquoise/15 text-turquoise",
    failed: "bg-red-50 text-red-700",
    cancelled: "bg-stone-100 text-stone-500",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>{t(`admin.inventory.archive.status.${status}`)}</span>;
}
