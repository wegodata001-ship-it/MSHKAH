"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { formatIls } from "@/lib/costing/money";
import { MeasureUnitSelect } from "@/features/admin/measure-unit-select";
import {
  blankEditableLine,
  draftFromInvoice,
  draftsEqual,
  recalculateEditableLine,
  type EditableInvoiceDraft,
  type EditableInvoiceLine,
} from "@/lib/inventory/invoice-edit";
import type { PurchaseInvoice } from "@/lib/inventory/types";
import type { PurchaseUnit } from "@/lib/costing/types";

export function InvoiceEditDialog({
  invoice,
  suppliers,
  products = [],
  onClose,
  onSaved,
  onViewSource,
}: {
  invoice: PurchaseInvoice;
  suppliers: Array<{ id: string; name: string }>;
  products?: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (invoice: PurchaseInvoice) => void;
  onViewSource?: (invoice: PurchaseInvoice) => void;
}) {
  const t = useT();
  const initial = useMemo(() => draftFromInvoice(invoice), [invoice]);
  const [draft, setDraft] = useState<EditableInvoiceDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = !draftsEqual(draft, initial);
  const posted = invoice.stockStatus === "posted" || Boolean(invoice.inventoryPostedAt);
  const sourceUrl = invoice.sourceFile?.downloadUrl || invoice.fileUrl;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function close() {
    if (dirty && !window.confirm(t("admin.inventory.editInvoice.unsaved"))) return;
    onClose();
  }

  function updateLine(key: string, edit: Parameters<typeof recalculateEditableLine>[1]) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => line.key === key ? recalculateEditableLine(line, edit) : line),
    }));
  }

  function patchLine(key: string, patch: Partial<EditableInvoiceLine>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => line.key === key ? { ...line, ...patch } : line),
    }));
  }

  async function save() {
    setBusy(true);
    setError("");
    const result = await clientAdminFetch<{ invoice: PurchaseInvoice }>("/api/admin/inventory/invoice/edit", {
      invoiceId: invoice.id,
      draft,
    });
    setBusy(false);
    if (!result.ok || !result.data?.invoice) {
      setError(t("admin.inventory.editInvoice.failed"));
      return;
    }
    onSaved(result.data.invoice);
  }

  const knownKeys = new Set((invoice.lines ?? []).map((line) => line.key));
  const net = draft.lines.reduce((sum, line) => sum + (line.lineExcludingVat ?? 0), 0);
  const vat = draft.lines.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0);
  const gross = draft.lines.reduce((sum, line) => sum + (line.lineIncludingVat ?? 0), 0);

  return (
    <AdminModal open onOpenChange={(next) => !next && close()} size="xl">
      <AdminModalHeader onClose={close}>
        <AdminModalTitle>{t("admin.inventory.editInvoice")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-4">
        {dirty ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("admin.inventory.editInvoice.unsaved")}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span>{t("admin.costing.supplier")}</span>
            <select
              className="h-10 w-full rounded-xl border border-beige-dark/30 bg-white px-2"
              value={draft.supplierId}
              onChange={(event) => {
                const supplier = suppliers.find((item) => item.id === event.target.value);
                setDraft((current) => ({ ...current, supplierId: event.target.value, supplierName: supplier?.name || current.supplierName }));
              }}
            >
              {!draft.supplierId ? <option value="">{draft.supplierName || "—"}</option> : null}
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>{t("admin.inventory.invoiceNumber")}</span>
            <Input value={draft.invoiceNumber} onChange={(event) => setDraft((current) => ({ ...current, invoiceNumber: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{t("admin.inventory.invoiceDate")}</span>
            <Input type="date" value={draft.invoiceDate} onChange={(event) => setDraft((current) => ({ ...current, invoiceDate: event.target.value }))} />
          </label>
          <div className="flex items-end">
            {sourceUrl || onViewSource ? (
              <Button type="button" variant="outline" className="h-10" onClick={() => onViewSource ? onViewSource(invoice) : window.open(sourceUrl, "_blank", "noopener")}>
                {t("admin.inventory.editInvoice.viewSource")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="text-xs text-coffee/60">
              <tr>
                <th className="px-1 py-2 text-start">{t("admin.inventory.product")}</th>
                <th className="px-1 py-2 text-start">{t("admin.costing.category")}</th>
                <th className="px-1 py-2 text-end">{t("admin.inventory.qty")}</th>
                <th className="px-1 py-2 text-start">{t("admin.costing.unit")}</th>
                <th className="px-1 py-2 text-end">{t("admin.inventory.unitPrice")}</th>
                <th className="px-1 py-2 text-end">{t("admin.inventory.discount")}</th>
                <th className="px-1 py-2 text-end">{t("admin.inventory.vat")}</th>
                <th className="px-1 py-2 text-end">{t("admin.inventory.lineTotal")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line) => (
                <tr key={line.key} className="border-t border-beige-dark/10 align-top">
                  <td className="px-1 py-2">
                    <Input value={line.name} onChange={(event) => patchLine(line.key, { name: event.target.value })} />
                    {products.length ? (
                      <select className="mt-1 h-8 w-full rounded-lg border px-1 text-xs" value={line.productId ?? ""} onChange={(event) => patchLine(line.key, { productId: event.target.value || undefined })}>
                        {!line.productId ? <option value="">{t("admin.inventory.editInvoice.noProduct")}</option> : null}
                        {line.productId && !products.some((product) => product.id === line.productId) ? <option value={line.productId}>{line.productId}</option> : null}
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                    ) : null}
                    {!line.productId && !knownKeys.has(line.key) ? <p className="mt-1 text-[11px] text-amber-800">{t("admin.inventory.editInvoice.unassigned")}</p> : null}
                  </td>
                  <td className="px-1 py-2"><Input value={line.category} onChange={(event) => patchLine(line.key, { category: event.target.value })} /></td>
                  <td className="px-1 py-2"><Input className="text-end" value={line.quantity ?? ""} onChange={(event) => updateLine(line.key, { field: "quantity", quantity: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                  <td className="px-1 py-2">
                    <MeasureUnitSelect value={line.unit} onChange={(unit) => patchLine(line.key, { unit: unit as PurchaseUnit })} />
                  </td>
                  <td className="px-1 py-2"><Input className="text-end" value={line.unitPrice ?? ""} onChange={(event) => updateLine(line.key, { field: "unitPrice", unitPrice: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                  <td className="px-1 py-2"><Input className="text-end" value={line.discount ?? ""} onChange={(event) => updateLine(line.key, { field: "discount", discount: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                  <td className="px-1 py-2">
                    <select className="mb-1 h-8 w-full rounded-lg border px-1 text-xs" value={line.basis} onChange={(event) => updateLine(line.key, { field: "basis", basis: event.target.value as EditableInvoiceLine["basis"] })}>
                      <option value="excluding">{t("admin.inventory.priceBasis.excluding")}</option>
                      <option value="including">{t("admin.inventory.priceBasis.including")}</option>
                      <option value="exempt">{t("admin.inventory.priceBasis.exempt")}</option>
                    </select>
                    <Input className="text-end" value={line.vatPercent ?? ""} onChange={(event) => updateLine(line.key, { field: "vatRate", vatRate: event.target.value === "" ? null : Number(event.target.value) / 100 })} />
                  </td>
                  <td className="px-1 py-2">
                    <Input className="text-end font-semibold" value={line.lineTotal ?? ""} onChange={(event) => updateLine(line.key, { field: "lineTotal", lineTotal: event.target.value === "" ? null : Number(event.target.value) })} />
                    <p className="mt-1 text-[11px] text-coffee/55">{t("admin.inventory.priceExVat")} {line.lineExcludingVat != null ? formatIls(line.lineExcludingVat) : "—"} · {t("admin.inventory.vat")} {line.vatAmount != null ? formatIls(line.vatAmount) : "—"} · {t("admin.inventory.priceIncVat")} {line.lineIncludingVat != null ? formatIls(line.lineIncludingVat) : "—"}</p>
                  </td>
                  <td className="px-1 py-2">
                    <Button type="button" variant="ghost" className="h-8" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { ...line, key: blankEditableLine(line.vatPercent, line.basis).key }] }))}>{t("admin.inventory.editInvoice.duplicateLine")}</Button>
                    <Button type="button" variant="ghost" className="h-8 text-red-700" onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}>{t("admin.inventory.editInvoice.removeLine")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {draft.lines.map((line) => (
            <div key={line.key} className="space-y-2 rounded-2xl border border-beige-dark/15 p-3">
              <Input value={line.name} onChange={(event) => patchLine(line.key, { name: event.target.value })} />
              {products.length ? (
                <select className="h-10 w-full rounded-xl border px-2" value={line.productId ?? ""} onChange={(event) => patchLine(line.key, { productId: event.target.value || undefined })}>
                  {!line.productId ? <option value="">{t("admin.inventory.editInvoice.noProduct")}</option> : null}
                  {line.productId && !products.some((product) => product.id === line.productId) ? <option value={line.productId}>{line.productId}</option> : null}
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              ) : null}
              {!line.productId && !knownKeys.has(line.key) ? <p className="text-[11px] text-amber-800">{t("admin.inventory.editInvoice.unassigned")}</p> : null}
              <Input value={line.category} placeholder={t("admin.costing.category")} onChange={(event) => patchLine(line.key, { category: event.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input value={line.quantity ?? ""} placeholder={t("admin.inventory.qty")} onChange={(event) => updateLine(line.key, { field: "quantity", quantity: event.target.value === "" ? null : Number(event.target.value) })} />
                <MeasureUnitSelect value={line.unit} onChange={(unit) => patchLine(line.key, { unit: unit as PurchaseUnit })} />
                <Input value={line.unitPrice ?? ""} placeholder={t("admin.inventory.unitPrice")} onChange={(event) => updateLine(line.key, { field: "unitPrice", unitPrice: event.target.value === "" ? null : Number(event.target.value) })} />
                <Input value={line.discount ?? ""} placeholder={t("admin.inventory.discount")} onChange={(event) => updateLine(line.key, { field: "discount", discount: event.target.value === "" ? null : Number(event.target.value) })} />
                <select className="h-10 rounded-xl border px-2 text-sm" value={line.basis} onChange={(event) => updateLine(line.key, { field: "basis", basis: event.target.value as EditableInvoiceLine["basis"] })}>
                  <option value="excluding">{t("admin.inventory.priceBasis.excluding")}</option>
                  <option value="including">{t("admin.inventory.priceBasis.including")}</option>
                  <option value="exempt">{t("admin.inventory.priceBasis.exempt")}</option>
                </select>
                <Input value={line.vatPercent ?? ""} placeholder={t("admin.inventory.vat")} onChange={(event) => updateLine(line.key, { field: "vatRate", vatRate: event.target.value === "" ? null : Number(event.target.value) / 100 })} />
                <Input className="col-span-2 text-end font-semibold" value={line.lineTotal ?? ""} placeholder={t("admin.inventory.lineTotal")} onChange={(event) => updateLine(line.key, { field: "lineTotal", lineTotal: event.target.value === "" ? null : Number(event.target.value) })} />
              </div>
              <p className="text-xs text-coffee/60">{t("admin.inventory.priceExVat")} {line.lineExcludingVat != null ? formatIls(line.lineExcludingVat) : "—"} · {t("admin.inventory.vat")} {line.vatAmount != null ? formatIls(line.vatAmount) : "—"}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" className="h-8" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { ...line, key: blankEditableLine(line.vatPercent, line.basis).key }] }))}>{t("admin.inventory.editInvoice.duplicateLine")}</Button>
                <Button type="button" variant="ghost" className="h-8 text-red-700" onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}>{t("admin.inventory.editInvoice.removeLine")}</Button>
              </div>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, blankEditableLine(current.lines[0]?.vatPercent ?? 18, current.lines[0]?.basis ?? "excluding")] }))}>
          {t("admin.inventory.editInvoice.addProduct")}
        </Button>
        <div className="rounded-2xl bg-beige/40 p-3 text-sm">
          <p>{t("admin.inventory.table.beforeVat")}: {formatIls(net)}</p>
          <p>{t("admin.inventory.vat")}: {formatIls(vat)}</p>
          <p className="font-semibold">{t("admin.inventory.table.includingVat")}: {formatIls(gross)}</p>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>{t("admin.inventory.editInvoice.cancel")}</Button>
          <Button type="button" variant="turquoise" disabled={busy || !dirty} onClick={() => void save()}>{posted ? t("admin.inventory.editInvoice.updateStock") : t("admin.inventory.editInvoice.save")}</Button>
        </div>
      </AdminModalBody>
    </AdminModal>
  );
}
