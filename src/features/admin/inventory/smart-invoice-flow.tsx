"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { rememberSupplierAlias, saveFinanceInvoice, savePurchaseInvoiceDraft } from "@/services/inventoryService";
import { InvoiceSupplierField, NoSupplierStockWarning } from "@/features/admin/inventory/invoice-supplier-field";
import { invoiceMismatch, headerGross } from "@/lib/inventory/invoice-finance";
import { InvoiceLinesReview, type InvoiceLinesReviewHandle } from "@/features/admin/inventory/invoice-lines-review";
import { applyComputedTotals, invoiceApproveBlockers } from "@/lib/inventory/invoice-intake";
import { isPostedInvoice, matchSupplier } from "@/lib/inventory/invoice-smart-match";
import { InvoiceSourcePreview } from "@/features/admin/inventory/invoice-source-preview";
import { InvoiceStockTransfer } from "@/features/admin/inventory/invoice-stock-transfer";
import { toDateOnly } from "@/lib/dates/normalize";
import {
  confidenceTone,
  incompleteInvoiceLineCount,
  mergeScannedInvoice,
  missingInvoiceFields,
  publicScanErrorCode,
  scanErrorMessageKey,
  validateInvoiceTotals,
} from "@/lib/inventory/invoice-archive";
import { formatRetryAfterWhen, parseRetryAfterSeconds } from "@/lib/ai/gemini-limits";
import { invoiceHasExtractedData, invoiceReviewState } from "@/lib/inventory/scan-review-state";
import { uploadImageWithProgress } from "@/services/storageService";
import { STORAGE_PATHS } from "@/lib/firebase/collections";
import { cn } from "@/lib/utils";

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
  invoices = [],
  vatRate,
  initialInvoice,
  onClose,
  onToast,
  onManual,
  onOpenExisting,
}: {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  invoices?: PurchaseInvoice[];
  vatRate: number;
  initialInvoice?: PurchaseInvoice | null;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
  onManual: () => void;
  onOpenExisting?: (invoice: PurchaseInvoice) => void;
}) {
  const t = useT();
  const authFetch = useAuthFetch();
  const [busy, setBusy] = useState(false);
  const scanning = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(initialInvoice ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [askStock, setAskStock] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [warnNoSupplier, setWarnNoSupplier] = useState(false);
  const [allowNoSupplier, setAllowNoSupplier] = useState(false);
  const [editedKeys, setEditedKeys] = useState<Set<string>>(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"source" | "lines">("lines");
  const [focusField, setFocusField] = useState<string | null>(null);
  const linesRef = useRef<InvoiceLinesReviewHandle>(null);

  const summary = useMemo(() => (invoice ? invoiceSummary(invoice.lines, vatRate) : null), [invoice, vatRate]);
  const missing = useMemo(() => (invoice ? missingInvoiceFields(invoice) : []), [invoice]);
  const incompleteLines = useMemo(() => (invoice ? incompleteInvoiceLineCount(invoice.lines) : 0), [invoice]);

  const takeFile = (next: File | null) => {
    if (!next) return;
    setFile(next);
    setError(null);
    setInvoice(null);
    setEditedKeys(new Set());
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(next));
  };

  const scan = async (nextFile: File | null = file, invoiceId = invoice?.id) => {
    if (scanning.current || busy) return;
    if (!nextFile && !invoiceId) return;
    scanning.current = true;
    setBusy(true);
    setError(null);
    setRetryAfterSeconds(null);
    try {
      const body = new FormData();
      if (nextFile && !invoiceId) body.set("file", nextFile);
      if (invoiceId) body.set("invoiceId", invoiceId);
      if (nextFile && invoiceId && !invoice?.sourceFile) body.set("file", nextFile);
      const response = await authFetch("/api/admin/inventory/invoice/extract", { method: "POST", body });
      const data = (await response.json()) as InvoiceExtractResponse;
      const retryAfter = data.retryAfterSeconds ?? parseRetryAfterSeconds({ header: response.headers.get("Retry-After") });
      if (retryAfter) setRetryAfterSeconds(retryAfter);
      const extracted = data.invoice ? invoiceHasExtractedData(data.invoice) : Boolean(data.extraction?.invoiceNumber?.value || data.extraction?.lines?.length);
      const empty = !extracted;
      if (!response.ok || data.code === "EXTRACTION_FAILED" || empty) {
        const mapped = publicScanErrorCode(data.errorCode || data.code || data.error || "EXTRACTION_FAILED", data.providerStatus);
        setError(t(scanErrorMessageKey(mapped)));
        setInvoice((prev) => {
          if (prev) {
            return {
              ...prev,
              id: data.invoice?.id || prev.id,
              sourceFile: data.invoice?.sourceFile ?? prev.sourceFile,
              fileName: data.invoice?.fileName ?? prev.fileName,
              fileHash: data.invoice?.fileHash ?? prev.fileHash,
              fileUrl: data.invoice?.fileUrl ?? prev.fileUrl,
              scanStatus: "failed",
            };
          }
          return data.invoice ? { ...data.invoice, scanStatus: "failed" } : prev;
        });
        return;
      }
      if (data.invoice) {
        setInvoice((prev) => mergeScannedInvoice(prev, data.invoice as PurchaseInvoice, editedKeys));
        if (data.persistWarning) setError(t("admin.inventory.smart.err.SCAN_FAILED"));
      }
    } catch {
      setError(t("admin.inventory.smart.err.SCAN_FAILED"));
    } finally {
      scanning.current = false;
      setBusy(false);
    }
  };

  const update = (patch: Partial<PurchaseInvoice>) => {
    if (!invoice) return;
    setEditedKeys((current) => new Set([...current, ...Object.keys(patch)]));
    setInvoice({
      ...invoice,
      ...patch,
      audit: [...(invoice.audit ?? []), { at: new Date().toISOString(), action: "edit", detail: Object.keys(patch).join(",") }],
    });
  };

  const updateLine = (key: string, patch: Partial<PurchaseInvoiceLine>) => {
    if (!invoice) return;
    setEditedKeys((current) => new Set([...current, `line:${key}`]));
    setInvoice({
      ...invoice,
      lines: invoice.lines.map((line) => (line.key === key ? finalizeInvoiceLine({ ...line, ...patch }, vatRate) : line)),
      audit: [...(invoice.audit ?? []), { at: new Date().toISOString(), action: "edit", detail: `line:${key}` }],
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
        {error && (
          <div className="mt-3 space-y-1">
            <p className="text-sm font-medium text-red-700">{t("admin.inventory.smart.scanIncomplete")}</p>
            <p className="text-sm text-red-600">{error}</p>
            {retryAfterSeconds != null && (
              <p className="text-sm text-coffee/70">{t("admin.inventory.smart.retryAfter").replace("{when}", formatRetryAfterWhen(retryAfterSeconds))}</p>
            )}
          </div>
        )}
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
            <Button type="button" variant="outline" disabled={busy || !file} onClick={() => void scan(file)}>
              {t("admin.inventory.smart.retry")}
            </Button>
          )}
          <Button type="button" variant="turquoise" disabled={busy || !file} onClick={() => void scan(file)}>
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

  const locked = invoice.status === "saved" || invoice.status === "approved" || isPostedInvoice(invoice);
  const postedDuplicate = Boolean(invoice.duplicateSnapshot?.posted || (invoice.duplicateOf && invoices.find((item) => item.id === invoice.duplicateOf && isPostedInvoice(item))));
  const mismatch = invoiceMismatch(applyComputedTotals(invoice));
  const invoiceDate = toDateOnly(invoice.invoiceDate) || "";
  const receivedAt = toDateOnly(invoice.receivedAt) || "";
  const dueDate = toDateOnly(invoice.dueDate) || "";
  const vatRateValue = invoice.vatRate == null ? "" : invoice.vatRate > 1 ? invoice.vatRate : invoice.vatRate * 100;
  const reviewState = invoiceReviewState(invoice, invoice.scanStatus === "failed" || Boolean(error));
  const blockers = invoiceApproveBlockers(invoice);
  const supplierGuess = !invoice.supplierId && invoice.supplierName
    ? matchSupplier(invoice.supplierName, invoice.supplierTaxId, suppliers)
    : null;
  const existingSupplier = Boolean(invoice.supplierId);
  const existingDoc = invoice.duplicateSnapshot || (invoice.duplicateOf ? invoices.find((item) => item.id === invoice.duplicateOf) : null);

  const flushLines = () => {
    const next = linesRef.current?.flush();
    if (next && invoice) {
      const merged = applyComputedTotals({ ...invoice, lines: next.map((line) => finalizeInvoiceLine(line, vatRate)) });
      setInvoice(merged);
      return merged;
    }
    return invoice ? applyComputedTotals(invoice) : invoice;
  };

  const persistDraft = async (current: PurchaseInvoice) => {
    return savePurchaseInvoiceDraft({
      ...current,
      id: current.id || undefined,
      status: current.status === "saved" || current.status === "approved" ? current.status : "draft",
    });
  };

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <AdminCard title={t("admin.inventory.smart.review")}>
        {existingDoc && (
          <div className="mb-3 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-950">
            <p className="font-medium">{t("admin.inventory.smart.existingDoc")}</p>
            <p className="mt-1">
              {existingDoc.invoiceNumber || invoice.invoiceNumber || "—"}
              {" · "}
              {existingDoc.supplierName || invoice.supplierName || t("admin.inventory.noSupplier")}
              {" · "}
              {toDateOnly(existingDoc.invoiceDate) || existingDoc.invoiceDate || "—"}
              {" · "}
              {existingDoc.status || invoice.status}
            </p>
            {postedDuplicate ? (
              <p className="mt-2 font-medium text-red-700">{t("admin.inventory.smart.alreadyPosted")}</p>
            ) : (
              <p className="mt-2">{t("admin.inventory.smart.continueDraft")}</p>
            )}
            <Button
              type="button"
              variant="turquoise"
              className="mt-3"
              onClick={() => {
                const found = invoices.find((item) => item.id === (existingDoc.id || invoice.duplicateOf));
                if (found) {
                  setInvoice(found);
                  onOpenExisting?.(found);
                }
              }}
            >
              {t("admin.inventory.smart.openExisting")}
            </Button>
          </div>
        )}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {retryAfterSeconds != null && (
          <p className="mb-3 text-sm text-coffee/70">{t("admin.inventory.smart.retryAfter").replace("{when}", formatRetryAfterWhen(retryAfterSeconds))}</p>
        )}
        {reviewState === "incomplete" && (
          <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-medium">{t("admin.inventory.smart.scanIncomplete")}</p>
          </div>
        )}
        {reviewState === "partial" && (
          <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">{t("admin.inventory.smart.partialScan")}</p>
          </div>
        )}
        {reviewState === "ready" && !error && (
          <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <p className="font-medium">{t("admin.inventory.smart.readyReview")}</p>
          </div>
        )}
        <div className="mb-3 grid min-w-0 gap-3 lg:grid-cols-4">
          <Field label={t("admin.costing.supplier")} confidence={invoice.headerConfidence?.supplier}>
            <InvoiceSupplierField
              suppliers={suppliers}
              supplierId={invoice.supplierId}
              supplierName={invoice.supplierName}
              supplierTaxId={invoice.supplierTaxId}
              disabled={locked}
              onSelect={(item) => {
                const scanned = invoice.supplierName;
                update({
                  supplierId: item?.id,
                  supplierName: item?.name ?? scanned ?? "",
                  supplierTaxId: item?.taxId ?? invoice.supplierTaxId,
                });
                if (item && scanned && scanned !== item.name) void rememberSupplierAlias(item.id, scanned);
              }}
              onCreated={(item) => {
                if (invoice.supplierName && invoice.supplierName !== item.name) void rememberSupplierAlias(item.id, invoice.supplierName);
                onToast(t("admin.inventory.supplierSaved"));
              }}
            />
            {existingSupplier && <p className="mt-1 text-xs font-medium text-emerald-700">{t("admin.inventory.smart.existingSupplier")}</p>}
            {!invoice.supplierId && existingDoc && (
              <p className="mt-1 text-xs text-amber-800">{t("admin.inventory.smart.noLinkedSupplier")}</p>
            )}
            {supplierGuess?.kind === "suggest" && supplierGuess.supplier && (
              <button
                type="button"
                className="mt-1 text-xs text-turquoise"
                onClick={() => {
                  const item = supplierGuess.supplier!;
                  update({ supplierId: item.id, supplierName: item.name, supplierTaxId: item.taxId ?? invoice.supplierTaxId });
                  if (invoice.supplierName) void rememberSupplierAlias(item.id, invoice.supplierName);
                }}
              >
                {t("admin.inventory.smart.confirmSupplier")}: {supplierGuess.supplier.name}
              </button>
            )}
          </Field>
          <Field label={t("admin.inventory.invoiceNumber")} confidence={invoice.headerConfidence?.invoiceNumber}>
            <Input className="min-w-0" value={invoice.invoiceNumber || ""} placeholder={t("admin.inventory.smart.notDetected")} disabled={locked} onChange={(e) => update({ invoiceNumber: e.target.value })} />
          </Field>
          <Field label={t("admin.inventory.invoiceDate")}>
            <Input id="invoice-date" className={cn("min-w-0", focusField === "invoiceDate" && "ring-2 ring-turquoise")} type="date" value={invoiceDate} disabled={locked} onChange={(e) => update({ invoiceDate: e.target.value })} />
          </Field>
          <Field label={t("admin.inventory.dueDate")}>
            <Input className="min-w-0" type="date" value={dueDate} disabled={locked} onChange={(e) => update({ dueDate: e.target.value || undefined })} />
          </Field>
        </div>
        <details className="mb-3 rounded-2xl bg-beige/30 px-3 py-2" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm font-medium">{t("admin.inventory.smart.moreDetails")}</summary>
          <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
            <Field label={t("admin.inventory.receivedAt")}>
              <Input className="min-w-0" type="date" value={receivedAt} disabled={locked} onChange={(e) => update({ receivedAt: e.target.value })} />
            </Field>
            <Field label={t("admin.finance.currency")}>
              <Input className="min-w-0" value={invoice.currency ?? ""} placeholder={t("admin.inventory.smart.notDetected")} disabled={locked} onChange={(e) => update({ currency: e.target.value || undefined })} />
            </Field>
            <Field label={t("admin.finance.paymentMethod")}>
              <Input className="min-w-0" value={invoice.paymentMethod ?? ""} disabled={locked} onChange={(e) => update({ paymentMethod: e.target.value || null })} />
            </Field>
            <Field label={t("admin.finance.netTotal")}>
              <Input className="min-w-0" type="number" value={invoice.netAmount ?? invoice.subtotal ?? ""} placeholder={t("admin.inventory.smart.notDetected")} disabled={locked} onChange={(e) => update({ netAmount: e.target.value === "" ? null : Number(e.target.value), subtotal: e.target.value === "" ? null : Number(e.target.value), sourceNet: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label={t("admin.inventory.vatRate")}>
              <Input className="min-w-0" type="number" value={vatRateValue} placeholder={t("admin.inventory.smart.notDetected")} disabled={locked} onChange={(e) => update({ vatRate: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label={t("admin.finance.vatTotal")}>
              <Input className="min-w-0" type="number" value={invoice.vatAmount ?? invoice.vatTotal ?? ""} placeholder={t("admin.inventory.smart.notDetected")} disabled={locked} onChange={(e) => update({ vatAmount: e.target.value === "" ? null : Number(e.target.value), vatTotal: e.target.value === "" ? null : Number(e.target.value), sourceVat: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label={t("admin.finance.grossTotal")}>
              <Input className="min-w-0" type="number" value={invoice.grossAmount ?? invoice.grandTotal ?? ""} placeholder={t("admin.inventory.smart.notDetected")} disabled={locked} onChange={(e) => update({ grossAmount: e.target.value === "" ? null : Number(e.target.value), grandTotal: e.target.value === "" ? null : Number(e.target.value), sourceGross: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Button type="button" variant="outline" className="h-8 self-end text-xs" disabled={busy} onClick={() => void scan(invoice.sourceFile ? null : file, invoice.id)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("admin.inventory.archive.rescan")}
            </Button>
          </div>
        </details>
        <div className="mb-3 flex gap-2 lg:hidden">
          <FilterTab active={mobileTab === "source"} onClick={() => setMobileTab("source")}>{t("admin.inventory.smart.sourceTab")}</FilterTab>
          <FilterTab active={mobileTab === "lines"} onClick={() => setMobileTab("lines")}>{t("admin.inventory.smart.linesTab")}</FilterTab>
        </div>
        <div className={cn("min-w-0 rounded-2xl bg-beige/30 p-3", mobileTab === "lines" && "hidden lg:block")}>
          <InvoiceSourcePreview source={invoice.sourceFile} fallbackUrl={preview} fileName={invoice.fileName} />
        </div>
      </AdminCard>

      <div className={cn(mobileTab === "source" && "hidden lg:block")}>
      <AdminCard title={t("admin.inventory.smart.lines")}>
        <InvoiceLinesReview
          ref={linesRef}
          lines={invoice.lines}
          ingredients={ingredients}
          supplierName={invoice.supplierName}
          vatRate={vatRate}
          locked={locked || postedDuplicate}
          onChangeLine={updateLine}
          onChangeLines={(lines) => update({ lines: lines.map((line) => finalizeInvoiceLine(line, vatRate)) })}
          onUpdateLine={async (line) => {
            const next = applyComputedTotals({
              ...invoice,
              lines: invoice.lines.map((row) => (row.key === line.key ? finalizeInvoiceLine(line, vatRate) : row)),
            });
            setInvoice(next);
            const saved = await persistDraft(next);
            if (!saved.success) throw new Error(saved.error || t("admin.inventory.smart.lineUpdateFailed"));
            setInvoice({ ...next, id: saved.data });
          }}
        />
        {summary && (
          <div className="mt-4 grid gap-1 rounded-2xl bg-beige/40 p-3 text-sm sm:grid-cols-2">
            <p>{t("admin.inventory.smart.sourceAmounts")}: {formatIls(invoice.sourceNet ?? invoice.netAmount ?? 0)} / {formatIls(invoice.sourceVat ?? invoice.vatAmount ?? 0)} / {formatIls(invoice.sourceGross ?? invoice.grossAmount ?? 0)}</p>
            <p>{t("admin.inventory.smart.computedAmounts")}: {formatIls(summary.beforeVat)} / {formatIls(summary.vat)} / {formatIls(summary.includingVat)}</p>
            <p className="font-semibold">{t("admin.finance.linesGross")}: {formatIls(summary.includingVat)}</p>
            <p>{t("admin.inventory.summaryItems")}: {summary.itemCount}</p>
            {(invoice.validation ?? mismatch).hasMismatch && (
              <p className="sm:col-span-2 text-amber-800">
                {t("admin.inventory.smart.diff")}: {formatIls((invoice.validation?.grossDiff ?? mismatch.grossDiff) ?? (summary.includingVat - (invoice.sourceGross ?? invoice.grossAmount ?? 0)))}
              </p>
            )}
          </div>
        )}
      </AdminCard>
      </div>

      <div className="flex flex-wrap items-end justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => {
          if (linesRef.current?.dirtyCount()) {
            const ok = window.confirm(t("admin.inventory.smart.unsavedLines"));
            if (!ok) return;
            flushLines();
          }
          onClose();
        }}>{t("common.cancel")}</Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving || locked}
          onClick={async () => {
            if (!invoice || saving) return;
            setSaving(true);
            const current = flushLines();
            if (!current) {
              setSaving(false);
              return;
            }
            const result = await persistDraft(current);
            setSaving(false);
            if (!result.success) {
              onToast(t("admin.costing.saveFailed"), "error");
              return;
            }
            setInvoice({ ...current, id: result.data, status: "draft" });
            onToast(t("admin.inventory.smart.saveDraft"));
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.smart.saveDraft")}
        </Button>
        <div className="space-y-1 text-end">
          {blockers.length > 0 && (
            <div className="text-xs text-amber-800">
              {blockers.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="ms-2 underline"
                  onClick={() => {
                    setFocusField(item.field ?? item.key);
                    if (item.field === "invoiceDate") document.getElementById("invoice-date")?.focus();
                    if (item.field === "lines") setMobileTab("lines");
                  }}
                >
                  {t(item.labelKey).replace("{count}", String(item.count ?? 0))}
                </button>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="turquoise"
            disabled={saving || locked || postedDuplicate || blockers.length > 0}
            onClick={async () => {
              if (!invoice || saving || blockers.length) return;
              setSaving(true);
              const current = flushLines();
              if (!current) {
                setSaving(false);
                return;
              }
              const draft = await persistDraft(current);
              if (!draft.success) {
                setSaving(false);
                onToast(t("admin.costing.saveFailed"), "error");
                return;
              }
              const result = await saveFinanceInvoice({
                ...current,
                id: draft.data,
                status: "needs_review",
                approvedBy: "admin",
              });
              setSaving(false);
              if (!result.success) {
                onToast(result.error === "DUPLICATE_INVOICE" ? t("admin.inventory.smart.duplicate") : result.error, "error");
                return;
              }
              setInvoice({ ...current, id: result.data, status: "saved", stockStatus: "none" });
              setAskStock(true);
              onToast(t("admin.finance.saved"));
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.smart.approveStock")}
          </Button>
        </div>
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

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-8 rounded-full px-3 text-xs font-medium", active ? "bg-turquoise text-white" : "bg-beige/70 text-coffee/70")}>
      {children}
    </button>
  );
}


