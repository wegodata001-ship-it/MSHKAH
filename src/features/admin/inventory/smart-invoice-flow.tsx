"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminCard } from "@/features/admin/components/admin-card";
import { QuickCreateIngredientPanel } from "@/features/admin/costing/quick-create-ingredient";
import { useT } from "@/components/providers/locale-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { stockInDisplayUnit } from "@/lib/inventory/issue";
import type { CostingIngredient } from "@/lib/costing/types";
import { finalizeInvoiceLine, invoiceSummary } from "@/lib/inventory/invoice-lines";
import { applyInvoiceLineSave, existingProductForInvoiceName, invoiceAssignmentPlan, invoiceCreateProductDraft, newInvoiceProductPatch, plannedCreateGroups, plannedIngredientName, preferredSupplierAssignments } from "@/lib/inventory/invoice-line-review";
import { createIngredient } from "@/services/costingService";
import type { InvoiceExtractResponse } from "@/lib/inventory/invoice-extract";
import type { PurchaseInvoice, PurchaseInvoiceLine, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { rememberSupplierAlias, saveFinanceInvoice, savePurchaseInvoiceDraft, saveSupplierItemMap, transferInvoiceLinesToStock } from "@/services/inventoryService";
import { InvoiceSupplierField, NoSupplierStockWarning } from "@/features/admin/inventory/invoice-supplier-field";
import { compareInvoiceTotals, headerGross } from "@/lib/inventory/invoice-finance";
import { InvoiceLinesReview, type InvoiceLinesReviewHandle } from "@/features/admin/inventory/invoice-lines-review";
import { applyComputedTotals, intakeFailureMessageKey, intakeStatusUncertain, invoiceApproveBlockers } from "@/lib/inventory/invoice-intake";
import { invoiceAfterPersist, InvoiceLineSaveError, invoiceLineBlockers } from "@/lib/inventory/invoice-line-status";
import { isPostedInvoice, matchSupplier } from "@/lib/inventory/invoice-smart-match";
import { InvoiceCaptureStage } from "@/features/admin/inventory/invoice-capture-stage";
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
  maps,
  offers,
  invoices = [],
  vatRate,
  initialInvoice,
  initialLineKey,
  onClose,
  onToast,
  onManual,
  onOpenExisting,
  onViewInventory,
  onRequestCancel,
}: {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  maps?: SupplierItemMap[];
  offers?: SupplierOffer[];
  invoices?: PurchaseInvoice[];
  vatRate: number;
  initialInvoice?: PurchaseInvoice | null;
  initialLineKey?: string | null;
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
  onManual: () => void;
  onOpenExisting?: (invoice: PurchaseInvoice) => void;
  onViewInventory?: () => void;
  /**
   * Opens the invoice-cancellation dialog in the parent. The parent is
   * responsible for threading inventory movements into the dialog, so the
   * detail screen only has to surface the trash button here.
   */
  onRequestCancel?: (invoice: PurchaseInvoice) => void;
}) {
  const t = useT();
  const authFetch = useAuthFetch();
  const [busy, setBusy] = useState(false);
  const [scanPhase, setScanPhase] = useState<"idle" | "preparing" | "scanning" | "processing">("idle");
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const scanning = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(initialInvoice ?? null);
  const invoiceRef = useRef(invoice);
  useEffect(() => {
    const current = invoiceRef.current;
    if (!current || !invoice || current === invoice) {
      invoiceRef.current = invoice;
      return;
    }
    const score = (doc: PurchaseInvoice) =>
      doc.lines.filter((line) => Boolean(line.productId) && line.matchConfirmed !== false).length + (doc.id ? 1000 : 0);
    if (score(invoice) >= score(current)) invoiceRef.current = invoice;
  }, [invoice]);
  const invoicesRef = useRef(invoices);
  invoicesRef.current = invoices;
  const ingredientsRef = useRef(ingredients);
  ingredientsRef.current = ingredients;
  const savingRef = useRef(false);
  const [phase, setPhase] = useState<"idle" | "checking" | "posting" | "creating">("idle");
  const [holdIntake, setHoldIntake] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [askStock, setAskStock] = useState(false);
  const [receipt, setReceipt] = useState<PurchaseInvoice | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [warnNoSupplier, setWarnNoSupplier] = useState(false);
  const [allowNoSupplier, setAllowNoSupplier] = useState(false);
  const [editedKeys, setEditedKeys] = useState<Set<string>>(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(initialLineKey ?? null);
  useEffect(() => {
    if (initialLineKey) setHighlightKey(initialLineKey);
  }, [initialLineKey]);
  const [highlightField, setHighlightField] = useState<string | null>(null);
  const [workingLines, setWorkingLines] = useState<PurchaseInvoiceLine[]>([]);
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const linesRef = useRef<InvoiceLinesReviewHandle>(null);
  const invoiceRevision = useRef(0);
  const persistChain = useRef(Promise.resolve());

  const summary = useMemo(() => (invoice ? invoiceSummary(invoice.lines, vatRate) : null), [invoice, vatRate]);
  const missing = useMemo(() => (invoice ? missingInvoiceFields(invoice) : []), [invoice]);
  const incompleteLines = useMemo(() => (invoice ? incompleteInvoiceLineCount(invoice.lines) : 0), [invoice]);

  const scan = async (nextFile: File | null = file, invoiceId = invoice?.id) => {
    if (scanning.current || busy) return;
    if (!nextFile && !invoiceId) return;
    scanning.current = true;
    setBusy(true);
    setScanPhase(nextFile ? "preparing" : "scanning");
    setError(null);
    setLastRequestId(null);
    setRetryAfterSeconds(null);
    try {
      const body = new FormData();
      if (nextFile && !invoiceId) body.set("file", nextFile);
      if (invoiceId) body.set("invoiceId", invoiceId);
      if (nextFile && invoiceId && !invoice?.sourceFile) body.set("file", nextFile);
      // Flip to "scanning" once the body is prepared; "processing" is set
      // right after the response lands and before we merge lines, so staff
      // see what is actually happening at each stage.
      setScanPhase("scanning");
      const response = await authFetch("/api/admin/inventory/invoice/extract", { method: "POST", body });
      setScanPhase("processing");
      const data = (await response.json()) as InvoiceExtractResponse;
      if (data.requestId) setLastRequestId(data.requestId);
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
      setScanPhase("idle");
    }
  };

  const scanPhaseLabel = (() => {
    if (scanPhase === "preparing") return t("admin.inventory.smart.phase.preparing");
    if (scanPhase === "scanning") return t("admin.inventory.smart.phase.scanning");
    if (scanPhase === "processing") return t("admin.inventory.smart.phase.processing");
    return t("admin.inventory.smart.scan");
  })();

  const update = (patch: Partial<PurchaseInvoice>) => {
    const current = invoiceRef.current;
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      audit: [...(current.audit ?? []), { at: new Date().toISOString(), action: "edit", detail: Object.keys(patch).join(",") }],
    };
    invoiceRef.current = next;
    setEditedKeys((keys) => new Set([...keys, ...Object.keys(patch)]));
    setInvoice(next);
  };

  if (!invoice) {
    const detail = [
      error,
      retryAfterSeconds != null ? t("admin.inventory.smart.retryAfter").replace("{when}", formatRetryAfterWhen(retryAfterSeconds)) : null,
      lastRequestId ? `${t("admin.inventory.smart.requestId")}: ${lastRequestId}` : null,
    ].filter(Boolean).join(" · ");
    return (
      <InvoiceCaptureStage
        busy={busy}
        phaseLabel={scanPhaseLabel}
        error={detail || null}
        onScan={(next) => {
          setFile(next);
          setError(null);
          if (preview) URL.revokeObjectURL(preview);
          setPreview(next.type.startsWith("image/") ? URL.createObjectURL(next) : null);
          void scan(next);
        }}
        onClose={onClose}
        onManual={onManual}
      />
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

  const stockPosted = invoice.stockStatus === "posted" || Boolean(invoice.inventoryPostedAt);
  const locked = stockPosted;
  const postedDuplicate = Boolean(invoice.duplicateSnapshot?.posted || (invoice.duplicateOf && invoices.find((item) => item.id === invoice.duplicateOf && isPostedInvoice(item))));
  const invoiceDate = toDateOnly(invoice.invoiceDate) || "";
  const receivedAt = toDateOnly(invoice.receivedAt) || "";
  const dueDate = toDateOnly(invoice.dueDate) || "";
  const vatRateValue = invoice.vatRate == null ? "" : invoice.vatRate > 1 ? invoice.vatRate : invoice.vatRate * 100;
  const reviewState = invoiceReviewState(invoice, invoice.scanStatus === "failed" || Boolean(error));
  const reviewLines = workingLines.length ? workingLines : invoice.lines;
  const productById = Object.fromEntries(ingredients.map((item) => [item.id, { baseUnit: item.baseUnit, purchaseUnit: item.purchaseUnit }]));
  const blockers = invoiceApproveBlockers({ ...invoice, lines: reviewLines }, { dirtyKeys });
  const lineBlockers = invoiceLineBlockers(reviewLines, { dirtyKeys, productById });
  const assignmentPlan = invoiceAssignmentPlan(reviewLines, ingredients);
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

  const saveWorkingLine = async (line: PurchaseInvoiceLine) => {
    const current = invoiceRef.current;
    if (!current) throw new Error(t("admin.inventory.smart.saveFailedRetry"));
    const next = applyComputedTotals(applyInvoiceLineSave(current, finalizeInvoiceLine(line, vatRate)));
    invoiceRevision.current += 1;
    invoiceRef.current = next;
    setInvoice(next);
    const job = persistChain.current.then(async () => {
      const snapshot = invoiceRef.current;
      const snapshotRevision = invoiceRevision.current;
      if (!snapshot) return;
      const saved = await persistDraft(snapshot);
      if (!saved.success) {
        throw new Error(
          saved.error === "PERMISSION_DENIED"
            ? t("admin.inventory.smart.permissionSystem")
            : saved.error || t("admin.inventory.smart.saveFailedRetry")
        );
      }
      const latest = invoiceRef.current ?? snapshot;
      const resolved = invoiceAfterPersist(latest, snapshot, saved.data, invoiceRevision.current, snapshotRevision);
      invoiceRef.current = resolved;
      setInvoice(resolved);
    });
    persistChain.current = job.then(() => undefined, () => undefined);
    await job;
    const latest = invoiceRef.current;
    const latestLine = latest?.lines.find((row) => row.key === line.key);
    if (
      !latest?.supplierId ||
      !latestLine?.productId ||
      latestLine.unit !== line.unit ||
      latestLine.quantity !== line.quantity ||
      latestLine.unitPrice !== line.unitPrice ||
      latestLine.productId !== line.productId ||
      latestLine.rawName !== line.rawName
    ) {
      return;
    }
    await saveSupplierItemMap({
      supplierId: latest.supplierId,
      supplierProductName: latestLine.originalDescription || latestLine.rawName,
      supplierSku: latestLine.sku,
      inventoryProductId: latestLine.productId,
      purchaseUnit: latestLine.unit ?? undefined,
      packageQuantity: latestLine.quantity ?? undefined,
      conversion: latestLine.conversionFactor ?? undefined,
    });
  };

  const materializePlannedLines = async (source: PurchaseInvoiceLine[], supplierName?: string) => {
    const groups = plannedCreateGroups(source);
    if (!groups.length) return source;
    setPhase("creating");
    const catalog = [...ingredientsRef.current];
    const linked = new Map<string, { id: string; category?: string }>();
    for (const group of groups) {
      if (!group.name.trim()) throw new Error("CREATE_FAILED");
      const sample = source.find((line) => line.key === group.lineKeys[0]);
      if (!sample) throw new Error("CREATE_FAILED");
      const found = existingProductForInvoiceName(group.name, catalog);
      const product = found ?? (await (async () => {
        const created = await createIngredient({
          ...invoiceCreateProductDraft({ ...sample, rawName: group.name }, supplierName),
          category: sample.category,
        });
        if (created.success === false) {
          throw new Error(created.error || "CREATE_FAILED");
        }
        if (!created.data) {
          throw new Error("CREATE_FAILED");
        }
        catalog.push(created.data);
        return created.data;
      })());
      linked.set(group.key, { id: product.id, category: product.category });
    }
    return source.map((line) => {
      const group = groups.find((item) => item.lineKeys.includes(line.key));
      const product = group ? linked.get(group.key) : undefined;
      if (!product) return line;
      return {
        ...line,
        ...newInvoiceProductPatch({ id: product.id, category: product.category }, line.category || product.category),
        rawName: line.rawName,
        originalDescription: line.originalDescription,
        plannedProductName: plannedIngredientName(line),
      };
    });
  };

  const rememberAssignments = async (lines: PurchaseInvoiceLine[], supplierId?: string) => {
    if (!supplierId) return;
    for (const line of preferredSupplierAssignments(lines)) {
      const supplierProductName = (line.originalDescription || line.rawName || "").trim();
      const inventoryProductId = line.productId;
      if (!supplierProductName || !inventoryProductId) continue;
      const saved = await saveSupplierItemMap({
        supplierId,
        supplierProductName,
        supplierSku: line.sku,
        inventoryProductId,
        purchaseUnit: line.unit ?? undefined,
        packageQuantity: line.quantity ?? undefined,
        conversion: line.conversionFactor ?? undefined,
      });
      if (!saved.success) throw new Error("ASSIGN_FAILED");
    }
  };

  const postedInvoiceNow = (id?: string | null) => {
    if (!id) return null;
    const found = invoicesRef.current.find((row) => row.id === id);
    if (!found) return null;
    const postedCount = found.lines.filter((line) => line.postedToStock).length;
    if ((found.stockStatus === "posted" || found.stockStatus === "partial") && postedCount > 0) return found;
    return null;
  };

  const recoverPostedInvoice = async (id?: string | null) => {
    const immediate = postedInvoiceNow(id);
    if (immediate) return immediate;
    if (!id) return null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const found = postedInvoiceNow(id);
      if (found) return found;
    }
    return null;
  };

  const focusBlocker = (lineKey: string, field: string) => {
    setHighlightKey(lineKey);
    setHighlightField(field);
    setFocusField("lines");
    window.setTimeout(() => {
      const visible = (id: string) => {
        const nodes = document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`);
        for (const node of nodes) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return node;
        }
        return null;
      };
      const row = visible(`invoice-line-${lineKey}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      const node = visible(`invoice-line-${lineKey}-${field}`);
      const target =
        node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement
          ? node
          : node?.querySelector("select, input, textarea");
      if (target instanceof HTMLElement) target.focus();
    }, 60);
  };

  const finishPosted = (postedInvoice: PurchaseInvoice) => {
    invoiceRef.current = postedInvoice;
    setInvoice(postedInvoice);
    setReceipt(postedInvoice);
    setIntakeError(null);
    setHoldIntake(false);
    const postedCount = postedInvoice.lines.filter((line) => line.postedToStock).length;
    onToast(t("admin.inventory.smart.postedSummary").replace("{count}", String(postedCount)));
  };

  const failIntake = (code?: string) => {
    setPhase("idle");
    const key =
      code === "LINE_SAVE_FAILED"
        ? "admin.inventory.smart.lineUpdateFailed"
        :       code === "DRAFT_FAILED"
          ? "admin.costing.saveFailed"
          : code === "CREATE_FAILED" || code === "ASSIGN_FAILED"
            ? "admin.inventory.smart.ingredientCreateFailed"
            : intakeFailureMessageKey(code);
    const message = t(key);
    onToast(message, "error");
    setIntakeError(message);
  };

  const postReadyInvoice = async (ready: PurchaseInvoice) => {
    const already = postedInvoiceNow(ready.id);
    if (already) {
      finishPosted(already);
      return;
    }
    setPhase("posting");
    const stock = await transferInvoiceLinesToStock(ready, undefined, { skipFinanceSave: true });
    if (!stock.success && (stock.error === "ALREADY_POSTED" || intakeStatusUncertain(stock.error))) {
      const recovered = await recoverPostedInvoice(ready.id);
      if (recovered) {
        finishPosted(recovered);
        return;
      }
      if (stock.error === "ALREADY_POSTED") {
        failIntake("ALREADY_POSTED");
        return;
      }
    }
    const postedInvoice = stock.success && stock.data ? stock.data : undefined;
    const postedCount = postedInvoice?.lines.filter((line) => line.postedToStock).length ?? 0;
    if (!stock.success || !postedInvoice || (postedInvoice.stockStatus !== "posted" && postedInvoice.stockStatus !== "partial") || postedCount === 0) {
      failIntake(stock.success ? "STOCK_POST_FAILED" : stock.error);
      return;
    }
    finishPosted(postedInvoice);
  };

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <AdminCard title={t("admin.inventory.smart.review")}>
        {existingDoc && (
          <div className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
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
        {error && (
          <div className="mb-2 space-y-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm font-medium text-red-700">{error}</p>
            {retryAfterSeconds != null && (
              <p className="text-sm text-coffee/70">{t("admin.inventory.smart.retryAfter").replace("{when}", formatRetryAfterWhen(retryAfterSeconds))}</p>
            )}
            {lastRequestId && (
              <p dir="ltr" className="text-[11px] font-mono text-coffee/50">
                {t("admin.inventory.smart.requestId")}: {lastRequestId}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant="turquoise"
                disabled={busy || locked}
                onClick={() => void scan(invoice.sourceFile ? null : file, invoice.id)}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {scanPhaseLabel}
                  </>
                ) : (
                  t("admin.inventory.smart.retry")
                )}
              </Button>
              <label className="inline-flex">
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const next = e.target.files?.[0] ?? null;
                    if (next) {
                      setFile(next);
                      void scan(next, invoice.id);
                    }
                  }}
                />
                <span className="inline-flex h-10 cursor-pointer items-center rounded-xl border bg-warm-white px-3 text-sm">
                  {t("admin.inventory.smart.chooseOtherFile")}
                </span>
              </label>
            </div>
          </div>
        )}
        {reviewState === "incomplete" && !error && (
          <div className="mb-2 rounded-xl bg-red-50 px-3 py-1.5 text-sm text-red-800">
            <p className="font-medium">{t("admin.inventory.smart.scanIncomplete")}</p>
          </div>
        )}
        {reviewState === "partial" && (
          <div className="mb-2 rounded-xl bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
            <p className="font-medium">{t("admin.inventory.smart.partialScan")}</p>
          </div>
        )}
        {reviewState === "ready" && !error && (
          <div className="mb-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">
            <p className="font-medium">{t("admin.inventory.smart.readyReview")}</p>
          </div>
        )}
        <div className="mb-2 grid min-w-0 gap-2 lg:grid-cols-4">
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
        <details className="mb-2 rounded-xl bg-beige/30 px-3 py-1.5" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm font-medium">{t("admin.inventory.smart.moreDetails")}</summary>
          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
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
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {scanPhaseLabel}
                </>
              ) : (
                t("admin.inventory.archive.rescan")
              )}
            </Button>
          </div>
        </details>
        <div className="min-w-0">
          <InvoiceSourcePreview source={invoice.sourceFile} fallbackUrl={preview} fileName={invoice.fileName} />
        </div>
        <div id="invoice-lines" className="mt-3 min-w-0">
          <p className="mb-2 text-sm font-semibold text-dark-brown dark:text-warm-white">{t("admin.inventory.smart.lines")}</p>
          <InvoiceLinesReview
            ref={linesRef}
            lines={invoice.lines}
            ingredients={ingredients}
            maps={maps}
            offers={offers}
            suppliers={suppliers}
            supplierId={invoice.supplierId}
            supplierName={invoice.supplierName}
            vatRate={vatRate}
            invoiceId={invoice.id}
            locked={locked || postedDuplicate}
            highlightKey={highlightKey}
            highlightField={highlightField}
            onWorkingChange={(lines, keys) => {
              setWorkingLines(lines);
              setDirtyKeys(keys);
            }}
            onChangeLines={(lines) => update({ lines: lines.map((line) => finalizeInvoiceLine(line, vatRate)) })}
            onUpdateLine={saveWorkingLine}
          />
          {summary && (
            <InvoiceTotalSummary invoice={{ ...invoice, lines: invoice.lines }} t={t} />
          )}
        </div>
      </AdminCard>

      <div id="invoice-approve-bar" className="relative z-30 flex w-full flex-col gap-3 bg-cream sm:flex-row sm:flex-wrap sm:items-end sm:justify-end">
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
            try {
              await linesRef.current?.saveAll();
            } catch (error) {
              setSaving(false);
              const message = error instanceof Error ? error.message : t("admin.inventory.smart.saveFailedRetry");
              onToast(message, "error");
              setIntakeError(message);
              if (error instanceof InvoiceLineSaveError) focusBlocker(error.lineKey, "update");
              return;
            }
            const current = invoiceRef.current ? applyComputedTotals(invoiceRef.current) : flushLines();
            if (!current) {
              setSaving(false);
              return;
            }
            const result = await persistDraft(current);
            setSaving(false);
            if (!result.success) {
              onToast(result.error === "PERMISSION_DENIED" ? t("admin.inventory.smart.permissionSystem") : result.error || t("admin.costing.saveFailed"), "error");
              return;
            }
            const stored = invoiceAfterPersist({ ...current, status: "draft" as const }, current, result.data, invoiceRevision.current, invoiceRevision.current);
            invoiceRef.current = stored;
            setInvoice(stored);
            onToast(t("admin.inventory.smart.saveDraft"));
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.smart.saveDraft")}
        </Button>
        <div id="invoice-intake-notice" className="w-full space-y-1 text-end sm:max-w-md">
          <p className="text-xs text-coffee/70">
            {t("admin.inventory.smart.assignmentSummary")
              .replace("{create}", String(assignmentPlan.createCount))
              .replace("{existing}", String(assignmentPlan.existingRows))}
          </p>
          {intakeError && <p className="text-sm font-medium text-red-700">{intakeError}</p>}
          {lineBlockers.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-start text-xs text-amber-950">
              <p className="font-medium">
                {holdIntake
                  ? t("admin.inventory.smart.intakeNotStarted").replace("{count}", String(lineBlockers.length))
                  : t("admin.inventory.smart.needsTreatment").replace("{count}", String(lineBlockers.length))}
              </p>
              <ul className="mt-1 space-y-1">
                {lineBlockers.map((item) => (
                  <li key={item.lineKey}>
                    <button type="button" className="underline" onClick={() => focusBlocker(item.lineKey, item.field)}>
                      {item.lineIndex}. {item.productName || "—"} — {t(item.labelKey)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {blockers.filter((item) => item.field !== "lines").map((item) => (
            <button
              key={item.key}
              type="button"
              className="ms-2 text-xs text-amber-800 underline"
              onClick={() => {
                setFocusField(item.field ?? item.key);
                if (item.field === "invoiceDate") document.getElementById("invoice-date")?.focus();
              }}
            >
              {t(item.labelKey).replace("{count}", String(item.count ?? 0))}
            </button>
          ))}
          {(stockPosted || postedDuplicate) && (
            <p className="text-xs font-medium text-coffee">{t("admin.inventory.smart.alreadyPosted")}</p>
          )}
          <Button
            type="button"
            variant="turquoise"
            data-intake-phase={phase}
            className="relative z-30 min-h-11 w-full touch-manipulation sm:w-auto"
            disabled={saving || stockPosted || postedDuplicate}
            onClick={async () => {
              if (!invoice || savingRef.current) return;
    savingRef.current = true;
    flushSync(() => {
      setSaving(true);
      setPhase("checking");
      setIntakeError(null);
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    try {
                try {
                  await linesRef.current?.saveAll();
                } catch (error) {
                  setPhase("idle");
                  const message = error instanceof InvoiceLineSaveError
                    ? error.message
                    : error instanceof Error && error.message
                      ? error.message
                      : t("admin.inventory.smart.saveFailedRetry");
                  onToast(message, "error");
                  setIntakeError(message);
                  if (error instanceof InvoiceLineSaveError) focusBlocker(error.lineKey, "update");
                  return;
                }
                const savedLines = invoiceRef.current?.lines ?? linesRef.current?.preview() ?? invoice.lines;
                const base = invoiceRef.current ?? invoice;
                const current = applyComputedTotals({ ...base, lines: savedLines });
                invoiceRef.current = current;
                setInvoice(current);
                setWorkingLines(current.lines);
                setDirtyKeys([]);
                const nextLineBlockers = invoiceLineBlockers(current.lines, {
                  productById: Object.fromEntries(ingredientsRef.current.map((item) => [item.id, { baseUnit: item.baseUnit, purchaseUnit: item.purchaseUnit }])),
                });
                const nextHeader = invoiceApproveBlockers(current);
      if (nextLineBlockers.length || nextHeader.length) {
        setHoldIntake(true);
        const count = nextLineBlockers.length || nextHeader.length;
        setIntakeError(t("admin.inventory.smart.intakeNotStarted").replace("{count}", String(count)));
        const first = nextLineBlockers[0];
        if (first) focusBlocker(first.lineKey, first.field);
        else document.getElementById("invoice-intake-notice")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
                let createdLines = current.lines;
                try {
                  createdLines = await materializePlannedLines(current.lines, current.supplierName);
                } catch (error) {
                  const code = error instanceof Error ? error.message : "CREATE_FAILED";
                  failIntake(code === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "CREATE_FAILED");
                  return;
                }
                const withProducts = applyComputedTotals({ ...current, lines: createdLines });
                invoiceRef.current = withProducts;
                setInvoice(withProducts);
                const draft = await persistDraft(withProducts);
                if (!draft.success) {
                  failIntake(draft.error === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "DRAFT_FAILED");
                  return;
                }
                const withId = { ...withProducts, id: draft.data };
                invoiceRef.current = withId;
                setInvoice(withId);
                const finance = await saveFinanceInvoice({
                  ...withId,
                  status: "needs_review",
                  approvedBy: "admin",
                });
                if (!finance.success) {
                  failIntake(finance.error);
                  return;
                }
                let ready = { ...withId, id: finance.data, status: "saved" as const, stockStatus: withId.stockStatus ?? ("none" as const) };
                if (!ready.supplierId && ready.supplierName) {
                  const match = matchSupplier(ready.supplierName, ready.supplierTaxId, suppliers);
                  if (match.kind === "exact" && match.supplier) {
                    ready = { ...ready, supplierId: match.supplier.id, supplierName: match.supplier.name };
                  }
                }
                invoiceRef.current = ready;
                setInvoice(ready);
                try {
                  await rememberAssignments(ready.lines, ready.supplierId);
                } catch {
                  failIntake("ASSIGN_FAILED");
                  return;
                }
                await postReadyInvoice(ready);
              } finally {
                savingRef.current = false;
                setSaving(false);
                setPhase("idle");
              }
            }}
          >
            {phase === "checking" ? (
              <><Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("admin.inventory.smart.checkingLines")}</>
            ) : phase === "creating" ? (
              <><Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("admin.inventory.smart.creatingIngredients")}</>
            ) : phase === "posting" ? (
              <><Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("admin.inventory.smart.postingStock")}</>
            ) : (
              t("admin.inventory.smart.approveStock")
            )}
          </Button>
          {invoice && invoice.id && onRequestCancel && invoice.status !== "cancelled" ? (
            <Button
              type="button"
              variant="ghost"
              className="h-10 text-red-700 hover:bg-red-50"
              disabled={saving}
              onClick={() => {
                if (!invoice) return;
                onRequestCancel(invoice);
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("admin.invoice.cancel.action")}
            </Button>
          ) : null}
          {invoice && (invoice.status === "saved" || invoice.status === "approved") && invoice.stockStatus !== "posted" && (
            <Button
              type="button"
              variant="turquoise"
              disabled={saving}
              onClick={async () => {
                if (!invoice || savingRef.current) return;
                savingRef.current = true;
                flushSync(() => {
                  setSaving(true);
                  setPhase("posting");
                  setIntakeError(null);
                });
                try {
                  try {
                    await linesRef.current?.saveAll();
                  } catch (error) {
                    const message = error instanceof Error ? error.message : t("admin.inventory.smart.saveFailedRetry");
                    onToast(message, "error");
                    setIntakeError(message);
                    if (error instanceof InvoiceLineSaveError) focusBlocker(error.lineKey, "update");
                    return;
                  }
                  let ready = invoiceRef.current ?? invoice;
                  if (!ready.supplierId && ready.supplierName) {
                    const match = matchSupplier(ready.supplierName, ready.supplierTaxId, suppliers);
                    if (match.kind === "exact" && match.supplier) {
                      ready = { ...ready, supplierId: match.supplier.id, supplierName: match.supplier.name };
                    }
                  }
                  try {
                    const createdLines = await materializePlannedLines(ready.lines, ready.supplierName);
                    ready = { ...ready, lines: createdLines };
                    const saved = await persistDraft(ready);
                    if (!saved.success) {
                      failIntake(saved.error === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "DRAFT_FAILED");
                      return;
                    }
                    ready = { ...ready, id: saved.data };
                    invoiceRef.current = ready;
                    setInvoice(ready);
                    await rememberAssignments(ready.lines, ready.supplierId);
                  } catch {
                    failIntake("CREATE_FAILED");
                    return;
                  }
                  await postReadyInvoice(ready);
                } finally {
                  savingRef.current = false;
                  setSaving(false);
                  setPhase("idle");
                }
              }}
            >
              {phase === "creating" ? (
                <><Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("admin.inventory.smart.creatingIngredients")}</>
              ) : phase === "posting" ? (
                <><Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("admin.inventory.smart.postingStock")}</>
              ) : (
                t("admin.inventory.postSavedStock")
              )}
            </Button>
          )}
        </div>
      </div>
      {receipt && (
        <AdminCard title={t("admin.inventory.smart.intakeComplete")}>
          <p className="mb-2 text-sm text-coffee/70">
            {t("admin.inventory.smart.postedSummary").replace("{count}", String(receipt.lines.filter((line) => line.postedToStock).length))}
            {receipt.invoiceNumber ? ` · ${receipt.invoiceNumber}` : ""}
          </p>
          <ul className="space-y-1 text-sm">
            {receipt.lines.filter((line) => line.postedToStock && line.quantityIn != null).map((line) => {
              const product = ingredients.find((item) => item.id === line.productId);
              const qty = product && line.quantityIn != null ? stockInDisplayUnit(line.quantityIn, product) : line.quantity;
              const before = product && line.quantityBefore != null ? stockInDisplayUnit(line.quantityBefore, product) : line.quantityBefore;
              const after = product && line.quantityAfter != null ? stockInDisplayUnit(line.quantityAfter, product) : line.quantityAfter;
              const unit = product ? t(unitLabelKey(product.purchaseUnit)) : line.unit ?? "";
              return (
                <li key={line.key}>
                  {product?.name || line.rawName}: {qty} {unit}
                  {before != null && after != null ? ` · ${before} → ${after} ${unit}` : ""}
                </li>
              );
            })}
          </ul>
          {onViewInventory && (
            <Button type="button" variant="turquoise" className="mt-3" onClick={onViewInventory}>
              {t("admin.inventory.smart.viewInventory")}
            </Button>
          )}
        </AdminCard>
      )}
      {askStock && invoice && (
        <AdminCard title={t("admin.finance.savedTitle")}>
          <p className="text-sm">
            {t("admin.finance.grossTotal")}: {formatMoneyOrDash(headerGross(invoice), t)}
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
          const current = invoiceRef.current;
          const line = current?.lines.find((row) => row.key === createKey);
          if (line) {
            void saveWorkingLine(
              finalizeInvoiceLine({ ...line, ...newInvoiceProductPatch(item, line.category || item.category) }, vatRate)
            );
          }
          setCreateKey(null);
        }}
        onUseExisting={(item) => {
          const current = invoiceRef.current;
          const line = current?.lines.find((row) => row.key === createKey);
          if (line) {
            void saveWorkingLine(
              finalizeInvoiceLine(
                { ...line, productId: item.id, matchKind: "exact", matchConfirmed: true, rowStatus: "matched", category: item.category },
                vatRate
              )
            );
          }
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

/**
 * Render a monetary value or the "not detected" placeholder. We don't want
 * to show "₪0.00" when the scanner returned no data for a field, because
 * that reads as "the invoice is for zero" rather than "we didn't read it".
 */
function InvoiceTotalSummary({ invoice, t }: { invoice: PurchaseInvoice; t: (key: string) => string }) {
  const check = compareInvoiceTotals(invoice);
  const matched = check.validationStatus === "pass";
  return (
    <div className={cn("mt-3 grid gap-1 rounded-xl p-2.5 text-sm sm:grid-cols-2", matched ? "bg-beige/40" : "bg-amber-50")}>
      <p>{t("admin.inventory.smart.totalBeforeVat")}: {formatMoneyOrDash(check.sourceNet, t)}</p>
      <p>{t("admin.inventory.smart.totalVat")}: {formatMoneyOrDash(check.sourceVat, t)}</p>
      <p className="font-semibold">{t("admin.inventory.smart.sourceInvoiceTotal")}: {formatMoneyOrDash(check.invoiceTotalFromSource, t)}</p>
      <p>{t("admin.inventory.smart.calculatedLinesTotal")}: {formatMoneyOrDash(check.calculatedLinesTotal, t)}</p>
      <p>{t("admin.inventory.smart.difference")}: {formatMoneyOrDash(check.differenceAmount, t)}</p>
      <p>{t("admin.inventory.smart.validationStatus")}: {matched ? t("admin.inventory.smart.statusMatch") : check.validationStatus === "missing" ? t("admin.inventory.smart.notDetected") : t("admin.inventory.smart.statusReview")}</p>
      <p className="sm:col-span-2 font-medium">
        {matched ? t("admin.inventory.smart.matchMessage") : check.validationStatus === "review" ? t("admin.inventory.smart.mismatchMessage") : t("admin.inventory.smart.notDetected")}
      </p>
    </div>
  );
}

function formatMoneyOrDash(value: number | null | undefined, t: (key: string) => string): string {
  if (value == null || !Number.isFinite(value)) return t("admin.inventory.smart.notDetected");
  return formatIls(value);
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



