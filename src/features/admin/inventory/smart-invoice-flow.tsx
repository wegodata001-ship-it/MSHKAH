"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Camera, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminCard } from "@/features/admin/components/admin-card";
import { QuickCreateIngredientPanel } from "@/features/admin/costing/quick-create-ingredient";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { useT } from "@/components/providers/locale-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { INVOICE_UNITS, finalizeInvoiceLine, invoiceSummary } from "@/lib/inventory/invoice-lines";
import { needsReview } from "@/lib/inventory/invoice-extract";
import type { InvoiceExtractResponse } from "@/lib/inventory/invoice-extract";
import type { PurchaseInvoice, PurchaseInvoiceLine, Supplier } from "@/lib/inventory/types";
import { approvePurchaseInvoice, savePurchaseInvoiceDraft, saveSupplier } from "@/services/inventoryService";
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
  vatRate,
  onClose,
  onToast,
  onManual,
}: {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  vatRate: number;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
  onManual: () => void;
}) {
  const t = useT();
  const authFetch = useAuthFetch();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [createSupplier, setCreateSupplier] = useState(false);

  const summary = useMemo(() => (invoice ? invoiceSummary(invoice.lines, vatRate) : null), [invoice, vatRate]);

  const takeFile = (next: File | null) => {
    if (!next) return;
    setFile(next);
    setError(null);
    setInvoice(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(next));
  };

  const scan = async (nextFile = file) => {
    if (!nextFile) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", nextFile);
      const response = await authFetch("/api/admin/inventory/invoice/extract", { method: "POST", body });
      const data = (await response.json()) as InvoiceExtractResponse;
      if (!response.ok || !data.invoice) {
        setError(
          data.error === "ai-not-configured"
            ? t("admin.inventory.smart.notConfigured")
            : t("admin.inventory.smart.unavailable")
        );
        return;
      }
      setInvoice(data.invoice);
    } catch {
      setError(t("admin.inventory.smart.unavailable"));
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

  const locked = invoice.status === "approved";
  const canApprove = Boolean(invoice.supplierId) && Boolean(invoice.invoiceDate) && (summary?.itemCount ?? 0) > 0 && !invoice.duplicateOf && !locked;

  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.inventory.smart.review")}>
        {invoice.duplicateOf && (
          <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{t("admin.inventory.smart.duplicate")}</p>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-beige/30 p-3">
            <p className="mb-2 text-xs font-semibold text-coffee/55">{t("admin.inventory.smart.original")}</p>
            {preview && file && !file.type.includes("pdf") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="max-h-[420px] w-full rounded-xl object-contain" />
            ) : (
              <p className="text-sm">{invoice.fileName}</p>
            )}
          </div>
          <div className="grid gap-3">
            <Field label={`${t("admin.costing.supplier")} *`}>
              <select
                className="h-10 w-full rounded-xl border px-3 text-sm"
                value={invoice.supplierId ?? ""}
                disabled={locked}
                onChange={(e) => {
                  const supplier = suppliers.find((item) => item.id === e.target.value);
                  update({ supplierId: e.target.value || undefined, supplierName: supplier?.name ?? invoice.supplierName });
                }}
              >
                <option value="">{t("admin.inventory.noSupplier")}</option>
                {suppliers.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              {!invoice.supplierId && (
                <button type="button" className="mt-1 text-xs text-turquoise" onClick={() => setCreateSupplier(true)}>
                  {t("admin.inventory.createSupplier")}
                </button>
              )}
            </Field>
            <Field label={t("admin.inventory.invoiceNumber")}>
              <Input value={invoice.invoiceNumber} disabled={locked} onChange={(e) => update({ invoiceNumber: e.target.value })} />
            </Field>
            <Field label={`${t("admin.inventory.invoiceDate")} *`}>
              <Input type="date" value={invoice.invoiceDate} disabled={locked} onChange={(e) => update({ invoiceDate: e.target.value })} />
            </Field>
            <p className="text-sm">
              {t("admin.inventory.vat")}: {invoice.vatStatus === "detected" ? t("admin.inventory.smart.vatDetected") : t("admin.inventory.smart.vatReview")}
              {invoice.grandTotal != null ? ` · ${t("admin.inventory.invoiceTotal")}: ${formatIls(invoice.grandTotal)}` : ""}
            </p>
          </div>
        </div>
      </AdminCard>

      <AdminCard title={t("admin.inventory.smart.lines")}>
        <div className="space-y-3">
          {invoice.lines.map((line) => (
            <div key={line.key} className="rounded-2xl border border-beige-dark/15 p-3">
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <StatusChip status={line.rowStatus} t={t} />
                {line.confidence != null && (
                  <span className={cn("rounded-full px-2 py-0.5", needsReview(line.confidence) ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800")}>
                    {Math.round(line.confidence * 100)}%
                  </span>
                )}
              </div>
              <p className="text-sm text-coffee/60">{t("admin.inventory.smart.original")}: {line.rawName}</p>
              {line.productId && (
                <p className="text-sm">
                  {t("admin.inventory.smart.suggestedMatch")}: {ingredients.find((item) => item.id === line.productId)?.name}
                  {line.matchConfidence != null ? ` · ${Math.round(line.matchConfidence * 100)}%` : ""}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {line.productId && (
                  <button
                    type="button"
                    className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800"
                    onClick={() => updateLine(line.key, { matchKind: "exact", rowStatus: "matched", needsReview: false })}
                  >
                    {t("admin.inventory.smart.confirmMatch")}
                  </button>
                )}
                <button type="button" className="text-turquoise" onClick={() => updateLine(line.key, { productId: undefined, matchKind: "none", rowStatus: "unmapped" })}>
                  {t("admin.inventory.smart.chooseOther")}
                </button>
                <button type="button" className="text-turquoise" onClick={() => setCreateKey(line.key)}>
                  {t("admin.inventory.createProduct")}
                </button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-4">
                <select
                  className="h-10 rounded-xl border px-2 text-sm"
                  value={line.productId ?? ""}
                  disabled={locked}
                  onChange={(e) => updateLine(line.key, { productId: e.target.value || undefined, matchKind: "exact", rowStatus: e.target.value ? "matched" : "unmapped" })}
                >
                  <option value="">{t("admin.inventory.matchExisting")}</option>
                  {ingredients.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                <Input type="number" min="0" value={line.quantity ?? ""} disabled={locked} onChange={(e) => updateLine(line.key, { quantity: e.target.value ? Number(e.target.value) : null })} />
                <select className="h-10 rounded-xl border px-2 text-sm" value={line.unit ?? "kg"} disabled={locked} onChange={(e) => updateLine(line.key, { unit: e.target.value as PurchaseUnit })}>
                  {INVOICE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>{t(unitLabelKey(unit))}</option>
                  ))}
                </select>
                <Input type="number" min="0" value={line.unitPrice ?? ""} disabled={locked} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-coffee/65">
                {line.newNormalized != null && <span>{t("admin.inventory.normalizedPrice")}: {formatIls(line.newNormalized, 4)}</span>}
                {line.previousNormalized != null && line.newNormalized != null && (
                  <span>
                    {t("admin.inventory.listPrice")}: {formatIls(line.previousNormalized, 4)} → {formatIls(line.newNormalized, 4)}
                    {line.priceChangePercent != null ? ` (${line.priceChangePercent > 0 ? "+" : ""}${line.priceChangePercent.toFixed(0)}%)` : ""}
                  </span>
                )}
                {line.cheaperSupplierName && (
                  <span className="text-amber-700">
                    {t("admin.inventory.smart.cheaper")}: {line.cheaperSupplierName} {formatIls(line.cheaperSupplierPrice ?? 0, 4)}
                  </span>
                )}
                {line.conversionNote && <span>{t("admin.inventory.smart.conversion")}: {line.conversionNote}</span>}
                <button type="button" className="text-turquoise" onClick={() => setCreateKey(line.key)}>+ {t("admin.inventory.createProduct")}</button>
              </div>
            </div>
          ))}
        </div>
        {summary && (
          <div className="mt-4 grid gap-1 rounded-2xl bg-beige/40 p-3 text-sm sm:grid-cols-2">
            <p>{t("admin.inventory.costBeforeVat")}: {formatIls(summary.beforeVat)}</p>
            <p>{t("admin.inventory.vat")}: {formatIls(summary.vat)}</p>
            <p className="font-semibold">{t("admin.inventory.invoiceTotal")}: {formatIls(summary.includingVat)}</p>
            <p>{t("admin.inventory.summaryItems")}: {summary.itemCount}</p>
          </div>
        )}
      </AdminCard>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="button" variant="outline" onClick={onManual}>{t("admin.inventory.smart.manual")}</Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || !canApprove}
          onClick={async () => {
            if (!invoice || saving || !canApprove) return;
            setSaving(true);
            let fileUrl = invoice.fileUrl;
            if (file && !fileUrl) {
              const uploaded = await uploadImageWithProgress(file, `${STORAGE_PATHS.invoices}/smart/${Date.now()}-${file.name}`);
              if (uploaded.success) fileUrl = uploaded.data;
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
            const result = await approvePurchaseInvoice({
              ...invoice,
              id: draft.data,
              fileUrl,
              status: "needs_review",
              approvedBy: "admin",
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
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.approveReceipt")}
        </Button>
      </div>

      <QuickCreateIngredientPanel
        open={createKey != null}
        existing={ingredients}
        initialName={invoice.lines.find((line) => line.key === createKey)?.rawName}
        onClose={() => setCreateKey(null)}
        onCreated={(item) => {
          if (createKey) updateLine(createKey, { productId: item.id, matchKind: "exact", rowStatus: "matched" });
          setCreateKey(null);
        }}
        onUseExisting={(item) => {
          if (createKey) updateLine(createKey, { productId: item.id, matchKind: "exact", rowStatus: "matched" });
          setCreateKey(null);
        }}
      />
      {createSupplier && (
        <CreateSupplierInline
          name={invoice.supplierName}
          taxId={invoice.supplierTaxId}
          onClose={() => setCreateSupplier(false)}
          onCreated={(item) => {
            update({ supplierId: item.id, supplierName: item.name });
            setCreateSupplier(false);
            onToast(t("admin.inventory.supplierSaved"));
          }}
        />
      )}
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
  return (
    <div>
      <Label>
        {label}
        {confidence != null && <span className="ms-2 text-xs text-coffee/50">{Math.round(confidence * 100)}%</span>}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function StatusChip({ status, t }: { status?: PurchaseInvoiceLine["rowStatus"]; t: (key: string) => string }) {
  const label =
    status === "new"
      ? t("admin.inventory.smart.statusNew")
      : status === "review"
        ? t("admin.inventory.smart.statusReview")
        : status === "unknown-unit"
          ? t("admin.inventory.smart.statusUnit")
          : status === "price-anomaly"
            ? t("admin.inventory.smart.statusAnomaly")
            : status === "unmapped"
              ? t("admin.inventory.smart.statusUnmapped")
              : t("admin.inventory.smart.statusMatched");
  return <span className="rounded-full bg-beige px-2 py-0.5">{label}</span>;
}

function CreateSupplierInline({
  name,
  taxId,
  onClose,
  onCreated,
}: {
  name?: string;
  taxId?: string;
  onClose: () => void;
  onCreated: (item: Supplier) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(name ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <AdminCard title={t("admin.inventory.createSupplier")}>
      <Input value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || !value.trim()}
          onClick={async () => {
            setSaving(true);
            const result = await saveSupplier({ name: value, taxId });
            setSaving(false);
            if (result.success) onCreated(result.data);
          }}
        >
          {t("admin.inventory.saveSupplier")}
        </Button>
      </div>
    </AdminCard>
  );
}
