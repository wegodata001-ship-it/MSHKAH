"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminCard } from "@/features/admin/components/admin-card";
import { QuickCreateIngredientPanel } from "@/features/admin/costing/quick-create-ingredient";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { DEFAULT_VAT_RATE } from "@/lib/inventory/vat";
import { emptyInvoiceLine, finalizeInvoiceLine, invoiceSummary, INVOICE_UNITS } from "@/lib/inventory/invoice-lines";
import type { PurchaseDocumentType, PurchaseInvoice, PurchaseInvoiceLine, Supplier } from "@/lib/inventory/types";
import { saveFinanceInvoice, savePurchaseInvoiceDraft } from "@/services/inventoryService";
import { invoiceMismatch } from "@/lib/inventory/invoice-finance";
import { InvoiceSourcePreview } from "@/features/admin/inventory/invoice-source-preview";
import { InvoiceStockTransfer } from "@/features/admin/inventory/invoice-stock-transfer";
import { InvoiceSupplierField, NoSupplierStockWarning } from "@/features/admin/inventory/invoice-supplier-field";
import { uploadImageWithProgress } from "@/services/storageService";
import { STORAGE_PATHS } from "@/lib/firebase/collections";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function SupplierInvoiceForm({
  invoice,
  ingredients,
  suppliers,
  vatRate = DEFAULT_VAT_RATE,
  focusLineKey,
  onClose,
  onToast,
}: {
  invoice: PurchaseInvoice | "new";
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  vatRate?: number;
  focusLineKey?: string | null;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const initial: PurchaseInvoice =
    invoice === "new"
      ? {
          id: "",
          supplierName: "",
          invoiceNumber: "",
          invoiceDate: todayIso(),
          receivedAt: todayIso(),
          documentType: "invoice",
          status: "draft",
          lines: [emptyInvoiceLine(vatRate)],
          createdAt: new Date().toISOString(),
        }
      : {
          ...invoice,
          lines: invoice.lines.length ? invoice.lines : [emptyInvoiceLine(vatRate)],
        };

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [createForKey, setCreateForKey] = useState<string | null>(null);
  const [askStock, setAskStock] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [warnNoSupplier, setWarnNoSupplier] = useState(false);
  const [allowNoSupplier, setAllowNoSupplier] = useState(false);
  const locked = form.status === "saved" || form.status === "approved";

  const summary = useMemo(() => invoiceSummary(form.lines, vatRate), [form.lines, vatRate]);
  useEffect(() => {
    if (!focusLineKey) return;
    const nodes = document.querySelectorAll<HTMLElement>(`[data-invoice-line="${CSS.escape(focusLineKey)}"]`);
    const target = [...nodes].find((node) => node.getClientRects().length > 0) ?? nodes[0];
    target?.scrollIntoView?.({ block: "center" });
  }, [focusLineKey, form.lines]);
  const supplierName = suppliers.find((item) => item.id === form.supplierId)?.name ?? form.supplierName;
  const canSave = Boolean(form.invoiceDate) && !locked;
  const mismatch = invoiceMismatch(form);

  const updateLine = (key: string, patch: Partial<PurchaseInvoiceLine>) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? finalizeInvoiceLine({ ...line, ...patch }, vatRate) : line)),
    }));
  };

  if (transfer) {
    return (
      <InvoiceStockTransfer
        invoice={form}
        ingredients={ingredients}
        suppliers={suppliers}
        skipSupplierWarning={allowNoSupplier}
        onToast={onToast}
        onClose={onClose}
      />
    );
  }

  const persistDraft = async (next = form) => {
    const result = await savePurchaseInvoiceDraft({
      ...next,
      id: next.id || undefined,
      supplierName,
    });
    if (!result.success) return null;
    if (!next.id) setForm((current) => ({ ...current, id: result.data }));
    return result.data;
  };

  const attachFile = async (file: File) => {
    if (locked) return;
    const id = form.id || (await persistDraft()) || `draft-${Date.now()}`;
    const ext = file.name.split(".").pop() ?? "bin";
    const uploaded = await uploadImageWithProgress(file, `${STORAGE_PATHS.invoices}/${id}/${Date.now()}.${ext}`);
    setForm((current) => ({
      ...current,
      id: current.id || id,
      fileName: file.name,
      fileUrl: uploaded.success ? uploaded.data : current.fileUrl,
    }));
    if (!uploaded.success) onToast(t("admin.inventory.attachmentKept"), "error");
  };

  return (
    <AdminCard title={t("admin.inventory.supplierInvoices")}>
      {(form.sourceFile || form.fileUrl) && (
        <div className="mb-4">
          <InvoiceSourcePreview source={form.sourceFile} fallbackUrl={form.fileUrl} fileName={form.fileName} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{t("admin.costing.supplier")} *</Label>
          <div className="mt-1">
            <InvoiceSupplierField
              suppliers={suppliers}
              supplierId={form.supplierId}
              supplierName={form.supplierName}
              supplierTaxId={form.supplierTaxId}
              disabled={locked}
              onSelect={(item) =>
                setForm({
                  ...form,
                  supplierId: item?.id,
                  supplierName: item?.name ?? "",
                  supplierTaxId: item?.taxId ?? form.supplierTaxId,
                })
              }
            />
          </div>
        </div>
        <div>
          <Label>{t("admin.inventory.invoiceNumber")}</Label>
          <Input className="mt-1" disabled={locked} value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} />
        </div>
        <div>
          <Label>{t("admin.inventory.invoiceDate")} *</Label>
          <Input className="mt-1" type="date" disabled={locked} value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
        </div>
        <div>
          <Label>{t("admin.inventory.receivedAt")}</Label>
          <Input className="mt-1" type="date" disabled={locked} value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} />
        </div>
        <div>
          <Label>{t("admin.inventory.documentType")}</Label>
          <select
            className="mt-1 h-10 w-full rounded-xl border border-beige-dark/40 px-3 text-sm"
            disabled={locked}
            value={form.documentType ?? "invoice"}
            onChange={(e) => setForm({ ...form, documentType: e.target.value as PurchaseDocumentType })}
          >
            <option value="invoice">{t("admin.inventory.doc.invoice")}</option>
            <option value="credit">{t("admin.inventory.doc.credit")}</option>
            <option value="receipt">{t("admin.inventory.doc.receipt")}</option>
            <option value="other">{t("admin.inventory.doc.other")}</option>
          </select>
        </div>
        <div>
          <Label>{t("admin.inventory.attachment")}</Label>
          <Input
            className="mt-1"
            type="file"
            disabled={locked}
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void attachFile(file);
              e.target.value = "";
            }}
          />
          <p className="mt-1 text-xs text-coffee/50">{t("admin.inventory.attachmentHint")}</p>
          {form.fileName && <p className="text-xs text-coffee/70">{form.fileName}</p>}
        </div>
        <div className="sm:col-span-2">
          <Label>{t("admin.costing.notes")}</Label>
          <Textarea className="mt-1" disabled={locked} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {form.lines.map((line) => (
          <div
            key={line.key}
            id={`invoice-line-${line.key}`}
            data-invoice-line={line.key}
            className={`grid gap-2 rounded-2xl border p-3 md:grid-cols-6 ${focusLineKey === line.key ? "border-amber-500 ring-2 ring-amber-500" : "border-beige-dark/15"}`}
          >
            {line.originalDescription ? <p className="text-sm font-medium md:col-span-6">{line.originalDescription}</p> : null}
            <div className="md:col-span-2">
              <Label>{t("admin.inventory.product")}</Label>
              <select
                className="mt-1 h-10 w-full rounded-xl border px-2 text-sm"
                disabled={locked}
                value={line.productId ?? ""}
                onChange={(e) => {
                  const product = ingredients.find((item) => item.id === e.target.value);
                  updateLine(line.key, {
                    productId: e.target.value || undefined,
                    rawName: product?.name ?? "",
                    unit: (product?.purchaseUnit as PurchaseUnit) || line.unit,
                  });
                }}
              >
                <option value="">{t("admin.inventory.matchExisting")}</option>
                {ingredients.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {!locked && (
                <button type="button" className="mt-1 text-xs text-turquoise" onClick={() => setCreateForKey(line.key)}>
                  + {t("admin.inventory.createProduct")}
                </button>
              )}
            </div>
            <div>
              <Label>{t("admin.inventory.qty")}</Label>
              <Input className="mt-1" type="number" min="0" step="0.01" disabled={locked} value={line.quantity ?? ""} onChange={(e) => updateLine(line.key, { quantity: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <Label>{t("admin.costing.unit")}</Label>
              <select className="mt-1 h-10 w-full rounded-xl border px-2 text-sm" disabled={locked} value={line.unit ?? "kg"} onChange={(e) => updateLine(line.key, { unit: e.target.value as PurchaseUnit })}>
                {INVOICE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>{t(unitLabelKey(unit))}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("admin.inventory.unitCost")}</Label>
              <Input className="mt-1" type="number" min="0" step="0.01" disabled={locked} value={line.unitPrice ?? ""} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <Label>{t("admin.inventory.discount")}</Label>
              <Input className="mt-1" type="number" min="0" step="0.01" disabled={locked} value={line.discount ?? ""} onChange={(e) => updateLine(line.key, { discount: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <Label>{t("admin.inventory.vat")}</Label>
              <select className="mt-1 h-10 w-full rounded-xl border px-2 text-sm" disabled={locked} value={line.vatType} onChange={(e) => updateLine(line.key, { vatType: e.target.value as PurchaseInvoiceLine["vatType"] })}>
                <option value="inclusive">{t("admin.inventory.vatInclusive")}</option>
                <option value="exclusive">{t("admin.inventory.vatExclusive")}</option>
                <option value="exempt">{t("admin.inventory.vatExempt")}</option>
              </select>
            </div>
            <div className="flex items-end justify-between md:col-span-6">
              <p className="text-sm">{t("admin.inventory.lineTotal")}: {formatIls(finalizeInvoiceLine(line, vatRate).priceIncludingVat ?? 0)}</p>
              {!locked && form.lines.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, lines: form.lines.filter((item) => item.key !== line.key) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!locked && (
          <Button type="button" variant="outline" onClick={() => setForm({ ...form, lines: [...form.lines, emptyInvoiceLine(vatRate)] })}>
            <Plus className="h-4 w-4" /> {t("admin.inventory.addLine")}
          </Button>
        )}
      </div>

      <div className="mt-5 grid gap-2 rounded-2xl bg-beige/40 p-4 text-sm sm:grid-cols-2">
        <p>{t("admin.costing.supplier")}: {supplierName || "—"}</p>
        <p>{t("admin.inventory.summaryItems")}: {summary.itemCount}</p>
        <p>{t("admin.inventory.costBeforeVat")}: {formatIls(summary.beforeVat)}</p>
        <p>{t("admin.inventory.vat")}: {formatIls(summary.vat)}</p>
        <p className="font-semibold sm:col-span-2">{t("admin.inventory.invoiceTotal")}: {formatIls(summary.includingVat)}</p>
      </div>
      {mismatch.hasMismatch && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{t("admin.finance.mismatch")}</p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
        {locked && form.stockStatus !== "posted" && (
          <Button type="button" variant="outline" onClick={() => setTransfer(true)}>{t("admin.finance.transferLater")}</Button>
        )}
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || !canSave}
          onClick={async () => {
            if (saving || !canSave) return;
            setSaving(true);
            const lines = summary.lines;
            const id = form.id || (await persistDraft({ ...form, lines, supplierName }));
            if (!id) {
              setSaving(false);
              onToast(t("admin.costing.saveFailed"), "error");
              return;
            }
            const result = await saveFinanceInvoice({
              ...form,
              id,
              supplierName,
              lines,
              status: "draft",
            });
            setSaving(false);
            if (!result.success) {
              onToast(result.error === "DUPLICATE_INVOICE" ? t("admin.inventory.smart.duplicate") : result.error, "error");
              return;
            }
            setForm((current) => ({ ...current, id: result.data, status: "saved", stockStatus: "none" }));
            setAskStock(true);
            onToast(t("admin.finance.saved"));
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.finance.saveFinance")}
        </Button>
      </div>
      {askStock && (
        <div className="mt-4 rounded-2xl bg-turquoise/5 p-4">
          <p className="font-medium">{t("admin.finance.askStock")}</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("admin.finance.notNow")}</Button>
            <Button
              type="button"
              variant="turquoise"
              onClick={() => {
                if (!form.supplierId && !allowNoSupplier) {
                  setWarnNoSupplier(true);
                  return;
                }
                setAskStock(false);
                setTransfer(true);
              }}
            >
              {t("admin.finance.transferNow")}
            </Button>
          </div>
        </div>
      )}
      <NoSupplierStockWarning
        open={warnNoSupplier}
        onCancel={() => setWarnNoSupplier(false)}
        onContinue={() => {
          setAllowNoSupplier(true);
          setWarnNoSupplier(false);
          setAskStock(false);
          setTransfer(true);
        }}
      />

      <QuickCreateIngredientPanel
        open={createForKey != null}
        existing={ingredients}
        onClose={() => setCreateForKey(null)}
        onCreated={(item) => {
          if (createForKey) {
            updateLine(createForKey, { productId: item.id, rawName: item.name, unit: item.purchaseUnit });
          }
          setCreateForKey(null);
        }}
        onUseExisting={(item) => {
          if (createForKey) {
            updateLine(createForKey, { productId: item.id, rawName: item.name, unit: item.purchaseUnit });
          }
          setCreateForKey(null);
        }}
      />
    </AdminCard>
  );
}
