"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Camera, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminCard } from "@/features/admin/components/admin-card";
import { QuickCreateIngredientPanel } from "@/features/admin/costing/quick-create-ingredient";
import { useT } from "@/components/providers/locale-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient } from "@/lib/costing/types";
import { finalizeInvoiceLine, invoiceSummary } from "@/lib/inventory/invoice-lines";
import { invoiceCreateProductDraft, newInvoiceProductPatch } from "@/lib/inventory/invoice-line-review";
import type { InvoiceExtractResponse } from "@/lib/inventory/invoice-extract";
import type { PurchaseInvoice, PurchaseInvoiceLine, Supplier } from "@/lib/inventory/types";
import { saveFinanceInvoice, savePurchaseInvoiceDraft } from "@/services/inventoryService";
import { InvoiceSupplierField, NoSupplierStockWarning } from "@/features/admin/inventory/invoice-supplier-field";
import { invoiceMismatch, headerGross } from "@/lib/inventory/invoice-finance";
import { InvoiceLinesReview } from "@/features/admin/inventory/invoice-lines-review";
import { InvoiceSourcePreview } from "@/features/admin/inventory/invoice-source-preview";
import { InvoiceStockTransfer } from "@/features/admin/inventory/invoice-stock-transfer";
import { confidenceTone, publicScanErrorCode, scanErrorMessageKey, validateInvoiceTotals } from "@/lib/inventory/invoice-archive";
import { uploadImageWithProgress } from "@/services/storageService";
import { STORAGE_PATHS } from "@/lib/firebase/collections";

export function useSmartInvoiceEnabled() {
  const authFetch = useAuthFetch();
  const [state, setState] = useState<{
    configured: boolean;
    reachable: boolean;
    provider: string | null;
    model: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void authFetch("/api/admin/inventory/invoice/ai-status")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setState({
            configured: Boolean(data.configured),
            reachable: Boolean(data.reachable),
            provider: data.provider ?? null,
            model: data.model ?? null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ configured: false, reachable: false, provider: null, model: null });
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch]);
  return state;
}

export function SmartInvoiceFlow({
  ingredients,
  suppliers,
  vatRate,
  initialInvoice,
  onClose,
  onToast,
  onManual,
}: {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  vatRate: number;
  initialInvoice?: PurchaseInvoice | null;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
  onManual: () => void;
}) {
  const t = useT();
  const authFetch = useAuthFetch();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(initialInvoice ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [askStock, setAskStock] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [warnNoSupplier, setWarnNoSupplier] = useState(false);
  const [allowNoSupplier, setAllowNoSupplier] = useState(false);

  const summary = useMemo(() => (invoice ? invoiceSummary(invoice.lines, vatRate) : null), [invoice, vatRate]);

  const takeFile = (next: File | null) => {
    if (!next) return;
    setFile(next);
    setError(null);
    setInvoice(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(next));
  };

  const scan = async (nextFile = file, invoiceId = invoice?.id) => {
    if (!nextFile && !invoiceId) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      if (nextFile && !invoice?.sourceFile) body.set("file", nextFile);
      else if (nextFile && !invoiceId) body.set("file", nextFile);
      if (invoiceId) body.set("invoiceId", invoiceId);
      if (!body.has("file") && !body.has("invoiceId") && nextFile) body.set("file", nextFile);
      const response = await authFetch("/api/admin/inventory/invoice/extract", { method: "POST", body });
      const data = (await response.json()) as InvoiceExtractResponse;
      if (data.invoice) setInvoice(data.invoice);
      if (!response.ok || !data.invoice?.lines?.length) {
        const mapped = publicScanErrorCode(data.errorCode || data.code || data.error, data.providerStatus);
        setError(t(scanErrorMessageKey(mapped)));
        return;
      }
    } catch {
      setError(t("admin.inventory.smart.err.SCAN_FAILED"));
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Partial<PurchaseInvoice>) => {
    if (!invoice) return;
    setInvoice({
      ...invoice,
      ...patch,
      audit: [...(invoice.audit ?? []), { at: new Date().toISOString(), action: "edit", detail: Object.keys(patch).join(",") }],
    });
  };

  const updateLine = (key: string, patch: Partial<PurchaseInvoiceLine>) => {
    if (!invoice) return;
    update({
      lines: invoice.lines.map((line) => (line.key === key ? finalizeInvoiceLine({ ...line, ...patch }, vatRate) : line)),
    });
  };

  if (!invoice) {
    return (
      <AdminCard title={t("admin.inventory.smart.title")}>
        <label
          className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-turquoise/40 bg-turquoise/5 px-6 py-10 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            takeFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <Upload className="h-8 w-8 text-turquoise" />
          <p className="font-medium">{t("admin.inventory.smart.drop")}</p>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="inline-flex">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
            />
            <span className="inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm">
              <Camera className="h-4 w-4" /> {t("admin.inventory.smart.camera")}
            </span>
          </label>
          <label className="inline-flex">
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
            />
            <span className="inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm">
              <FileUp className="h-4 w-4" /> {t("admin.inventory.attachment")}
            </span>
          </label>
        </div>
        {file && (
          <p className="mt-3 text-sm text-coffee/70">
            {file.name} · {t(`admin.inventory.doc.${file.type.includes("pdf") ? "invoice" : "other"}`)}
          </p>
        )}
        {preview && file && !file.type.includes("pdf") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="mt-3 max-h-64 rounded-xl border object-contain" />
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" variant="outline" onClick={onManual}>{t("admin.inventory.smart.manual")}</Button>
          {error && (
            <label className="inline-flex">
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
              />
              <span className="inline-flex h-10 cursor-pointer items-center rounded-xl border px-3 text-sm">
                {t("admin.inventory.smart.chooseOtherFile")}
              </span>
            </label>
          )}
          {error && (
            <Button type="button" variant="outline" disabled={busy || !file} onClick={() => void scan()}>
              {t("admin.inventory.smart.retry")}
            </Button>
          )}
          <Button type="button" variant="turquoise" disabled={busy || !file} onClick={() => void scan()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.smart.scan")}
          </Button>
        </div>
      </AdminCard>
    );
  }

  if (transfer && invoice) {
    return (
      <InvoiceStockTransfer
        invoice={invoice}
        ingredients={ingredients}
        suppliers={suppliers}
        skipSupplierWarning={allowNoSupplier}
        onToast={onToast}
        onClose={onClose}
      />
    );
  }

  const locked = invoice.status === "saved" || invoice.status === "approved";
  const mismatch = invoiceMismatch(invoice);
  const canSave = Boolean(invoice.invoiceDate) && !invoice.duplicateOf && !locked;

  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.inventory.smart.review")}>
        {invoice.duplicateOf && (
          <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{t("admin.inventory.smart.duplicate")}</p>
        )}
        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          <SummaryStat label={t("admin.finance.compareNet")} value={invoice.netAmount ?? invoice.subtotal} />
          <SummaryStat label={t("admin.inventory.vat")} value={invoice.vatAmount ?? invoice.vatTotal} />
          <SummaryStat label={t("admin.finance.compareGross")} value={invoice.grossAmount ?? invoice.grandTotal} />
          <SummaryStat label={t("admin.inventory.summaryItems")} value={invoice.lines.length} count />
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => void scan(file, invoice.id)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("admin.inventory.archive.rescan")}
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-beige/30 p-3">
            <InvoiceSourcePreview
              source={invoice.sourceFile}
              fallbackUrl={preview}
              fileName={invoice.fileName}
            />
          </div>
          <div className="grid gap-3">
            <Field label={`${t("admin.costing.supplier")} *`} confidence={invoice.headerConfidence?.supplier}>
              <InvoiceSupplierField
                suppliers={suppliers}
                supplierId={invoice.supplierId}
                supplierName={invoice.supplierName}
                supplierTaxId={invoice.supplierTaxId}
                disabled={locked}
                onSelect={(item) =>
                  update({
                    supplierId: item?.id,
                    supplierName: item?.name ?? "",
                    supplierTaxId: item?.taxId ?? invoice.supplierTaxId,
                  })
                }
                onCreated={() => onToast(t("admin.inventory.supplierSaved"))}
              />
            </Field>
            <Field label={t("admin.inventory.invoiceNumber")} confidence={invoice.headerConfidence?.invoiceNumber}>
              <Input value={invoice.invoiceNumber || ""} placeholder={t("admin.inventory.smart.notDetected")} disabled={locked} onChange={(e) => update({ invoiceNumber: e.target.value })} />
            </Field>
            <Field label={`${t("admin.inventory.invoiceDate")} *`} confidence={invoice.headerConfidence?.invoiceDate}>
              <Input type="date" value={invoice.invoiceDate} disabled={locked} onChange={(e) => update({ invoiceDate: e.target.value })} />
            </Field>
            <Field label={t("admin.finance.receivedAt")}>
              <Input type="date" value={invoice.receivedAt} disabled={locked} onChange={(e) => update({ receivedAt: e.target.value })} />
            </Field>
            <Field label={t("admin.finance.currency")}>
              <Input value={invoice.currency ?? ""} disabled={locked} onChange={(e) => update({ currency: e.target.value || undefined })} />
            </Field>
            <Field label={t("admin.finance.paymentMethod")}>
              <Input value={invoice.paymentMethod ?? ""} disabled={locked} onChange={(e) => update({ paymentMethod: e.target.value || null })} />
            </Field>
            <Field label={t("admin.finance.netTotal")}>
              <Input type="number" value={invoice.netAmount ?? invoice.subtotal ?? ""} disabled={locked} onChange={(e) => update({ netAmount: e.target.value ? Number(e.target.value) : null, subtotal: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label={t("admin.finance.vatTotal")}>
              <Input type="number" value={invoice.vatAmount ?? invoice.vatTotal ?? ""} disabled={locked} onChange={(e) => update({ vatAmount: e.target.value ? Number(e.target.value) : null, vatTotal: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label={t("admin.finance.grossTotal")}>
              <Input type="number" value={invoice.grossAmount ?? invoice.grandTotal ?? ""} disabled={locked} onChange={(e) => update({ grossAmount: e.target.value ? Number(e.target.value) : null, grandTotal: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
        </div>
      </AdminCard>

      <AdminCard title={t("admin.inventory.smart.lines")}>
        <InvoiceLinesReview
          lines={invoice.lines}
          ingredients={ingredients}
          supplierName={invoice.supplierName}
          vatRate={vatRate}
          locked={locked}
          onChangeLine={updateLine}
          onChangeLines={(lines) => update({ lines: lines.map((line) => finalizeInvoiceLine(line, vatRate)) })}
          onCreateProduct={setCreateKey}
        />
        {summary && (
          <div className="mt-4 grid gap-1 rounded-2xl bg-beige/40 p-3 text-sm sm:grid-cols-2">
            <p>{t("admin.finance.linesNet")}: {formatIls(summary.beforeVat)}</p>
            <p>{t("admin.finance.linesVat")}: {formatIls(summary.vat)}</p>
            <p className="font-semibold">{t("admin.finance.linesGross")}: {formatIls(summary.includingVat)}</p>
            <p>{t("admin.inventory.summaryItems")}: {summary.itemCount}</p>
          </div>
        )}
        {(invoice.validation ?? mismatch).hasMismatch && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">{t("admin.finance.mismatch")}</p>
            <p>
              {t("admin.inventory.smart.linesSum")}: {formatIls((invoice.validation ?? validateInvoiceTotals({ lines: invoice.lines, headerNet: invoice.netAmount, headerVat: invoice.vatAmount, headerGross: invoice.grossAmount })).lineNetSum)}
              {" · "}
              {t("admin.inventory.vat")}: {formatIls(invoice.validation?.lineVatSum ?? mismatch.lineVat)}
              {" · "}
              {t("admin.inventory.smart.computedGross")}: {formatIls((invoice.validation?.computedGross ?? mismatch.lineGross))}
              {" · "}
              {t("admin.inventory.smart.invoiceGross")}: {formatIls(invoice.grossAmount ?? invoice.grandTotal ?? 0)}
              {" · "}
              {t("admin.inventory.smart.diff")}: {formatIls((invoice.validation?.grossDiff ?? mismatch.grossDiff) ?? 0)}
            </p>
          </div>
        )}
      </AdminCard>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="button" variant="outline" onClick={onManual}>{t("admin.inventory.smart.manual")}</Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || !canSave}
          onClick={async () => {
            if (!invoice || saving || !canSave) return;
            setSaving(true);
            let fileUrl = invoice.sourceFile?.downloadUrl || invoice.fileUrl;
            if (file && !fileUrl) {
              const uploaded = await uploadImageWithProgress(file, `${STORAGE_PATHS.invoices}/smart/${Date.now()}-${file.name}`);
              if (!uploaded.success) {
                setSaving(false);
                onToast(t("admin.inventory.smart.err.STORAGE_FAILED"), "error");
                return;
              }
              fileUrl = uploaded.data;
            }
            const draft = await savePurchaseInvoiceDraft({
              ...invoice,
              id: invoice.id || undefined,
              fileUrl,
              status: "needs_review",
            });
            if (!draft.success) {
              setSaving(false);
              onToast(t("admin.costing.saveFailed"), "error");
              return;
            }
            const result = await saveFinanceInvoice({
              ...invoice,
              id: draft.data,
              fileUrl,
              status: "needs_review",
              approvedBy: "admin",
            });
            setSaving(false);
            if (!result.success) {
              onToast(result.error === "DUPLICATE_INVOICE" ? t("admin.inventory.smart.duplicate") : result.error, "error");
              return;
            }
            setInvoice({ ...invoice, id: result.data, fileUrl, status: "saved", stockStatus: "none" });
            setAskStock(true);
            onToast(t("admin.finance.saved"));
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.finance.saveFinance")}
        </Button>
      </div>
      {askStock && invoice && (
        <AdminCard title={t("admin.finance.savedTitle")}>
          <p className="text-sm">
            {t("admin.finance.grossTotal")}: {formatIls(headerGross(invoice) ?? summary?.includingVat ?? 0)}
            {" · "}
            {t("admin.costing.supplier")}: {invoice.supplierName || "—"}
            {" · "}
            {t("admin.inventory.summaryItems")}: {invoice.lines.length}
          </p>
          <p className="mt-2 font-medium">{t("admin.finance.askStock")}</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("admin.finance.notNow")}</Button>
            <Button
              type="button"
              variant="turquoise"
              onClick={() => {
                if (!invoice.supplierId && !allowNoSupplier) {
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
        </AdminCard>
      )}

      <QuickCreateIngredientPanel
        open={createKey != null}
        existing={ingredients}
        initial={createKey ? invoiceCreateProductDraft(invoice.lines.find((line) => line.key === createKey) ?? invoice.lines[0], invoice.supplierName) : undefined}
        onClose={() => setCreateKey(null)}
        onCreated={(item) => {
          if (createKey) {
            const line = invoice.lines.find((row) => row.key === createKey);
            updateLine(createKey, newInvoiceProductPatch(item, line?.category || item.category));
          }
          setCreateKey(null);
        }}
        onUseExisting={(item) => {
          if (createKey) updateLine(createKey, { productId: item.id, matchKind: "exact", matchConfirmed: true, rowStatus: "matched", category: item.category });
          setCreateKey(null);
        }}
      />
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
    </div>
  );
}

function Field({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence?: number | null;
  children: ReactNode;
}) {
  const tone = confidenceTone(confidence);
  return (
    <div>
      <Label>
        {label}
        {confidence != null && (
          <span className={tone === "bad" ? "ms-2 text-xs text-red-600" : tone === "warn" ? "ms-2 text-xs text-amber-700" : "ms-2 text-xs text-coffee/50"}>
            {Math.round(confidence * 100)}%
          </span>
        )}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SummaryStat({ label, value, count }: { label: string; value: number | null | undefined; count?: boolean }) {
  return (
    <div className="rounded-2xl bg-beige/40 px-3 py-2">
      <p className="text-xs text-coffee/55">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{count ? value ?? 0 : value != null ? formatIls(value) : "—"}</p>
    </div>
  );
}


