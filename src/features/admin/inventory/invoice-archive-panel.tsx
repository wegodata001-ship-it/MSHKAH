"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ClipboardList,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  Image as ImageIcon,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { archiveStatus, invoiceArchiveQuery } from "@/lib/inventory/invoice-archive";
import { buildInvoiceDocument } from "@/lib/inventory/invoice-document";
import { headerGross } from "@/lib/inventory/invoice-finance";
import type { InvoiceScanStatus, PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";
import { InvoicePdfViewer } from "@/features/admin/inventory/invoice-pdf-viewer";
import { downloadBlob } from "@/features/admin/inventory/invoice-pdf";
import { InvoiceRemovalDialog } from "@/features/admin/inventory/invoice-removal-dialog";
import { ExportMenu, fetchReport, saveBlob } from "@/features/admin/reports/export-menu";
import {
  fetchArchivedInvoices,
  fetchInvoiceBundle,
  fetchInvoiceSource,
} from "@/services/invoice-admin-client";

type AddDocumentAction =
  | "scan"
  | "upload-pdf"
  | "upload-image"
  | "camera"
  | "manual"
  | "import-list";

type AiState = {
  configured: boolean;
  reachable: boolean;
} | null;

type Supplier = { id: string; name: string };

const FILTERS = ["all", "review", "approved", "posted", "failed", "cancelled"] as const;

type StockState = "none" | "partial" | "posted";

function stockState(invoice: PurchaseInvoice): StockState {
  // A cancelled invoice no longer affects the stock, even if its line flags
  // still carry the historical `postedToStock` fact for audit.
  if (invoice.status === "cancelled") return "none";
  if (invoice.stockStatus === "posted") return "posted";
  if (invoice.stockStatus === "partial") return "partial";
  const lines: PurchaseInvoiceLine[] = invoice.lines ?? [];
  const posted = lines.filter((line) => line.postedToStock).length;
  if (posted > 0 && posted < lines.length) return "partial";
  if (lines.length > 0 && posted === lines.length) return "posted";
  return "none";
}

export function InvoiceArchivePanel({
  invoices,
  suppliers = [],
  aiState,
  onAddAction,
  onOpen,
  onRescan,
  onTransfer,
  onDelete,
  onToast,
}: {
  invoices: PurchaseInvoice[];
  suppliers?: Supplier[];
  aiState?: AiState;
  onAddAction?: (action: AddDocumentAction) => void;
  onOpen: (invoice: PurchaseInvoice) => void;
  onRescan: (invoice: PurchaseInvoice) => void;
  onTransfer: (invoice: PurchaseInvoice) => void;
  onDelete?: (invoice: PurchaseInvoice) => void;
  onToast?: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scope, setScope] = useState<"active" | "archive">("active");
  const [sourceFilter, setSourceFilter] = useState<"all" | "with" | "without">("all");
  const [archived, setArchived] = useState<PurchaseInvoice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [removal, setRemoval] = useState<"selected" | "all" | null>(null);
  const [viewer, setViewer] = useState<{
    doc: ReturnType<typeof buildInvoiceDocument>;
    source: { mimeType: string; filename?: string | null; bytes: Uint8Array } | null;
    invoice: PurchaseInvoice;
    mode: "system" | "source";
  } | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; name: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !moreOpen) return;
    function onDocDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || moreRef.current?.contains(target)) return;
      setMenuOpen(false);
      setMoreOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, moreOpen]);

  useEffect(() => {
    void refreshArchive();
  }, []);

  const listed = scope === "archive" ? archived : invoices;
  const rows = useMemo(
    () =>
      invoiceArchiveQuery(listed, { filter, query, from: from || undefined, to: to || undefined })
        .filter((invoice) => (supplierId ? invoice.supplierId === supplierId : true))
        .filter((invoice) => {
          const hasSource = Boolean(invoice.sourceFile?.storagePath || invoice.fileUrl);
          if (sourceFilter === "with") return hasSource;
          if (sourceFilter === "without") return !hasSource;
          return true;
        }),
    [listed, filter, query, from, to, supplierId, sourceFilter]
  );

  const counts = useMemo(() => {
    let review = 0;
    let waiting = 0;
    let posted = 0;
    for (const invoice of listed) {
      const status = archiveStatus(invoice);
      if (status === "needs_review" || status === "uploaded" || status === "scanning") review += 1;
      else if (status === "approved" || status === "ready") waiting += 1;
      else if (status === "posted") posted += 1;
    }
    return { review, waiting, posted };
  }, [listed]);

  const supplierOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const invoice of listed) {
      if (invoice.supplierId && invoice.supplierName && !seen.has(invoice.supplierId)) {
        seen.set(invoice.supplierId, invoice.supplierName);
      }
    }
    for (const supplier of suppliers) {
      if (!seen.has(supplier.id)) seen.set(supplier.id, supplier.name);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [listed, suppliers]);

  function trigger(action: AddDocumentAction) {
    setMenuOpen(false);
    onAddAction?.(action);
  }

  async function refreshArchive() {
    setArchived(await fetchArchivedInvoices());
  }

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const visible = new Set(rows.map((invoice) => invoice.id));
      if (checked) return Array.from(new Set([...current, ...visible]));
      return current.filter((id) => !visible.has(id));
    });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((current) => (checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id)));
  }

  function closePdfPreview() {
    setPdfPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function exportInvoice(invoice: PurchaseInvoice, format: "pdf" | "xlsx", view = false) {
    setPdfBusy(invoice.id);
    try {
      const file = await fetchReport({ kind: "invoice", format, scope: "filtered", ids: [invoice.id] });
      if (view) {
        const url = URL.createObjectURL(file.blob);
        setPdfPreview((current) => {
          if (current) URL.revokeObjectURL(current.url);
          return { url, name: file.filename };
        });
      } else {
        saveBlob(file.blob, file.filename);
      }
    } catch {
      onToast?.(t("admin.export.err.EXPORT_FAILED"), "error");
    } finally {
      setPdfBusy(null);
    }
  }

  async function openSource(invoice: PurchaseInvoice) {
    setPdfBusy(invoice.id);
    try {
      const bundle = await fetchInvoiceBundle(invoice.id);
      const doc = buildInvoiceDocument({
        invoice: bundle?.invoice ?? invoice,
        movements: bundle?.movements,
        paidAmount: bundle?.paidAmount,
        paymentsIncluded: Boolean(bundle),
        productNames: bundle?.productNames,
      });
      const source = await fetchInvoiceSource(invoice.id);
      setViewer({ doc, source, invoice: bundle?.invoice ?? invoice, mode: source ? "source" : "system" });
    } catch {
      onToast?.(t("admin.inventory.hub.pdf.failed"), "error");
    } finally {
      setPdfBusy(null);
    }
  }

  function downloadReport() {
    const header = ["date", "number", "supplier", "amount", "review", "stock", "source", "id"];
    const lines = rows.map((invoice) => [
      invoice.invoiceDate || "",
      invoice.invoiceNumber || "",
      invoice.supplierName || "",
      headerGross(invoice) ?? "",
      archiveStatus(invoice),
      stockState(invoice),
      invoice.sourceFile?.storagePath ? "yes" : "no",
      invoice.id,
    ]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), "mishkat-invoices.csv");
  }

  const allVisibleSelected = rows.length > 0 && rows.every((invoice) => selected.includes(invoice.id));

  const scanDisabled = Boolean(aiState && aiState.configured && !aiState.reachable);
  const scanLabel = aiState?.configured && aiState.reachable
    ? t("admin.inventory.hub.menu.scan")
    : aiState?.configured
      ? t("admin.inventory.hub.menu.scanRetry")
      : t("admin.inventory.hub.menu.scanDisabled");

  const empty = rows.length === 0;

  return (
    <div className="space-y-4">
      <HubHero
        title={t("admin.inventory.hub.title")}
        subtitle={t("admin.inventory.hub.subtitle")}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((value) => !value)}
        menuRef={menuRef}
        onCamera={() => trigger("camera")}
      >
        <HubMenuItem
          icon={<FileUp className="h-4 w-4" />}
          label={t("admin.inventory.hub.menu.uploadPdf")}
          onClick={() => trigger("upload-pdf")}
        />
        <HubMenuItem
          icon={<ImageIcon className="h-4 w-4" />}
          label={t("admin.inventory.hub.menu.uploadImage")}
          onClick={() => trigger("upload-image")}
        />
        <HubMenuItem
          icon={<Camera className="h-4 w-4" />}
          label={t("admin.inventory.hub.menu.camera")}
          onClick={() => trigger("camera")}
        />
        {aiState?.configured ? (
          <HubMenuItem
            icon={<FileText className="h-4 w-4" />}
            label={scanLabel}
            onClick={() => trigger("scan")}
            disabled={scanDisabled}
          />
        ) : null}
        <HubMenuItem
          icon={<Pencil className="h-4 w-4" />}
          label={t("admin.inventory.hub.menu.manual")}
          onClick={() => trigger("manual")}
        />
        <HubMenuItem
          icon={<ClipboardList className="h-4 w-4" />}
          label={t("admin.inventory.hub.menu.importList")}
          onClick={() => trigger("import-list")}
        />
      </HubHero>

      <SummaryStrip
        items={[
          {
            icon: <Receipt className="h-4 w-4" />,
            label: t("admin.inventory.hub.summary.review"),
            value: counts.review,
            tone: "amber",
            active: filter === "review",
            onClick: () => setFilter(filter === "review" ? "all" : "review"),
          },
          {
            icon: <Database className="h-4 w-4" />,
            label: t("admin.inventory.hub.summary.waiting"),
            value: counts.waiting,
            tone: "sky",
            active: filter === "approved",
            onClick: () => setFilter(filter === "approved" ? "all" : "approved"),
          },
          {
            icon: <PackageCheck className="h-4 w-4" />,
            label: t("admin.inventory.hub.summary.posted"),
            value: counts.posted,
            tone: "turquoise",
            active: filter === "posted",
            onClick: () => setFilter(filter === "posted" ? "all" : "posted"),
          },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-beige-dark/30 bg-warm-white p-0.5 text-xs">
          {(["active", "archive"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setScope(item); setSelected([]); }}
              className={cn("rounded-full px-3 py-1", scope === item ? "bg-turquoise text-white" : "text-coffee/70")}
            >
              {t(`admin.inventory.hub.scope.${item}`)}
            </button>
          ))}
        </div>
        <ExportMenu
          kind="invoices"
          ids={selected}
          filters={{
            supplierId: supplierId || undefined,
            from: from || undefined,
            to: to || undefined,
            query: query || undefined,
            status: filter,
            source: sourceFilter,
            invoiceScope: scope,
          }}
          onError={(message) => onToast?.(message, "error")}
        />
        <div className="relative" ref={moreRef}>
          <Button type="button" variant="outline" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} aria-haspopup="menu">
            <MoreHorizontal className="h-4 w-4" />
            {t("admin.inventory.hub.more")}
          </Button>
          {moreOpen ? (
            <div role="menu" className="absolute end-0 z-20 mt-2 w-64 rounded-2xl border border-beige-dark/20 bg-warm-white p-1 shadow-elevated">
              <HubMenuItem icon={<Receipt className="h-4 w-4" />} label={t("admin.inventory.hub.more.select")} onClick={() => { setMoreOpen(false); toggleAll(true); }} />
              <HubMenuItem icon={<Trash2 className="h-4 w-4" />} label={t("admin.inventory.hub.more.deleteSelected")} disabled={!selected.length} onClick={() => { setMoreOpen(false); setRemoval("selected"); }} />
              <HubMenuItem icon={<Trash2 className="h-4 w-4" />} label={t("admin.inventory.hub.more.deleteAll")} onClick={() => { setMoreOpen(false); setRemoval("all"); }} />
              <HubMenuItem icon={<Download className="h-4 w-4" />} label={t("admin.inventory.hub.more.download")} onClick={() => { setMoreOpen(false); downloadReport(); }} />
              <HubMenuItem icon={<RefreshCw className="h-4 w-4" />} label={t("admin.inventory.hub.more.refresh")} onClick={() => { setMoreOpen(false); void refreshArchive(); }} />
            </div>
          ) : null}
        </div>
      </div>
      {selected.length ? (
        <div className="flex items-center justify-between rounded-2xl bg-turquoise/10 px-3 py-2 text-sm text-dark-brown">
          <span>{t("admin.inventory.hub.selected").replace("{count}", String(selected.length))}</span>
          <button type="button" className="text-xs text-coffee/70" onClick={() => setSelected([])}>{t("admin.inventory.hub.clearSelection")}</button>
        </div>
      ) : null}
      <FilterRow
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        supplierId={supplierId}
        onSupplierChange={setSupplierId}
        suppliers={supplierOptions}
        from={from}
        onFromChange={setFrom}
        to={to}
        onToChange={setTo}
        sourceFilter={sourceFilter}
        onSourceFilter={setSourceFilter}
        t={t}
      />
      {empty ? (
        <EmptyState onAdd={() => setMenuOpen(true)} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-beige-dark/15 bg-warm-white shadow-soft md:block">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-beige/50 text-xs text-coffee/60">
                <tr className="h-10">
                  <th className="px-3 text-start">
                    <input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleAll(event.target.checked)} aria-label={t("admin.inventory.hub.cols.select")} />
                  </th>
                  <th className="px-3 text-start font-medium">{t("admin.inventory.invoiceDate")}</th>
                  <th className="px-3 text-start font-medium">{t("admin.inventory.invoiceNumber")}</th>
                  <th className="px-3 text-start font-medium">{t("admin.costing.supplier")}</th>
                  <th className="px-3 text-end font-medium">{t("admin.inventory.hub.cols.amount")}</th>
                  <th className="px-3 text-start font-medium">{t("admin.inventory.hub.cols.reviewState")}</th>
                  <th className="px-3 text-start font-medium">{t("admin.inventory.hub.cols.stockState")}</th>
                  <th className="px-3 text-start font-medium">{t("admin.inventory.hub.cols.documents")}</th>
                  <th className="px-3 text-end font-medium">{t("admin.inventory.hub.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => {
                  const status = archiveStatus(invoice);
                  const stock = stockState(invoice);
                  const gross = headerGross(invoice);
                  return (
                    <tr key={invoice.id} className="border-t border-beige-dark/10 align-top hover:bg-beige/30">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selected.includes(invoice.id)} onChange={(event) => toggleOne(invoice.id, event.target.checked)} aria-label={invoice.invoiceNumber || invoice.id} />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                        {invoice.invoiceDate || (invoice.uploadedAt || invoice.createdAt || "").slice(0, 10) || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-medium">{invoice.invoiceNumber || "—"}</td>
                      <td className="px-3 py-3">{invoice.supplierName || "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-end tabular-nums font-semibold">
                        {gross != null ? formatIls(gross) : "—"}
                      </td>
                      <td className="px-3 py-3"><StatusPill status={status} t={t} /></td>
                      <td className="px-3 py-3"><StockPill state={stock} t={t} /></td>
                      <td className="px-3 py-3">
                        <DocumentActions invoice={invoice} busy={pdfBusy === invoice.id} onView={() => void exportInvoice(invoice, "pdf", true)} onDownload={() => void exportInvoice(invoice, "pdf")} onExcel={() => void exportInvoice(invoice, "xlsx")} onSource={() => void openSource(invoice)} t={t} />
                      </td>
                      <td className="px-3 py-3 text-end">
                        <RowActions invoice={invoice} status={status} stock={stock} archived={scope === "archive"} onOpen={onOpen} onRescan={onRescan} onTransfer={onTransfer} onDelete={onDelete} t={t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((invoice) => {
              const status = archiveStatus(invoice);
              const stock = stockState(invoice);
              const gross = headerGross(invoice);
              return (
                <div key={invoice.id} className="rounded-2xl border border-beige-dark/15 bg-warm-white p-3 shadow-soft">
                  <div className="flex items-start gap-2">
                    <input className="mt-1" type="checkbox" checked={selected.includes(invoice.id)} onChange={(event) => toggleOne(invoice.id, event.target.checked)} aria-label={invoice.invoiceNumber || invoice.id} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-coffee/55 tabular-nums">
                        {invoice.invoiceDate || (invoice.uploadedAt || invoice.createdAt || "").slice(0, 10) || "—"}
                      </p>
                      <p className="font-semibold text-dark-brown">{invoice.supplierName || "—"}</p>
                      <p className="text-xs text-coffee/60">
                        {t("admin.inventory.invoiceNumber")}: {invoice.invoiceNumber || "—"}
                      </p>
                    </div>
                    <p className="text-base font-semibold tabular-nums">{gross != null ? formatIls(gross) : "—"}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusPill status={status} t={t} />
                    <StockPill state={stock} t={t} />
                  </div>
                  <div className="mt-3">
                    <DocumentActions invoice={invoice} busy={pdfBusy === invoice.id} onView={() => void exportInvoice(invoice, "pdf", true)} onDownload={() => void exportInvoice(invoice, "pdf")} onExcel={() => void exportInvoice(invoice, "xlsx")} onSource={() => void openSource(invoice)} t={t} />
                  </div>
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    <RowActions invoice={invoice} status={status} stock={stock} archived={scope === "archive"} onOpen={onOpen} onRescan={onRescan} onTransfer={onTransfer} onDelete={onDelete} t={t} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {removal ? (
        <InvoiceRemovalDialog
          target={removal}
          scope={scope}
          ids={selected}
          onClose={() => setRemoval(null)}
          onDone={(message, variant) => {
            setRemoval(null);
            setSelected([]);
            void refreshArchive();
            onToast?.(message, variant);
          }}
        />
      ) : null}
      {viewer ? (
        <InvoicePdfViewer
          doc={viewer.doc}
          source={viewer.source}
          initialMode={viewer.mode}
          invoiceId={viewer.invoice.id}
          invoiceNumber={viewer.invoice.invoiceNumber || viewer.invoice.id}
          onClose={() => setViewer(null)}
          onToast={onToast}
        />
      ) : null}
      {pdfPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-brown/50 p-4" onClick={closePdfPreview}>
          <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-warm-white shadow-elevated" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-beige-dark/20 px-4 py-3">
              <p className="truncate text-sm font-semibold text-dark-brown">{pdfPreview.name}</p>
              <Button type="button" variant="outline" onClick={closePdfPreview}>{t("admin.export.close")}</Button>
            </div>
            <iframe title={pdfPreview.name} src={pdfPreview.url} className="min-h-0 flex-1 bg-white" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HubHero({
  title,
  subtitle,
  menuOpen,
  onMenuToggle,
  menuRef,
  onCamera,
  children,
}: {
  title: string;
  subtitle: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onCamera: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="relative overflow-visible rounded-3xl border border-beige-dark/15 bg-gradient-to-br from-warm-white via-beige/40 to-beige/70 p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-dark-brown">{title}</h2>
          <p className="mt-1 text-sm text-coffee/70">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="turquoise" className="min-h-12 px-5 text-base" onClick={onCamera}>
            <Camera className="h-5 w-5" />
            {t("admin.inventory.smart.camera")}
          </Button>
          <div className="relative" ref={menuRef}>
          <Button type="button" variant="turquoise" onClick={onMenuToggle} aria-expanded={menuOpen} aria-haspopup="menu">
            <Plus className="h-4 w-4" />
            {t("admin.inventory.hub.addDocument")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", menuOpen && "rotate-180")} />
          </Button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute end-0 top-[calc(100%+0.5rem)] z-20 w-60 overflow-hidden rounded-2xl border border-beige-dark/20 bg-warm-white p-1 shadow-elevated"
            >
              {children}
            </div>
          ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function HubMenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-dark-brown transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-beige/70"
      )}
    >
      <span className="text-coffee/70">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

type SummaryTone = "amber" | "sky" | "turquoise";
const SUMMARY_TONES: Record<SummaryTone, { bg: string; text: string; accent: string }> = {
  amber: { bg: "bg-amber-50", text: "text-amber-900", accent: "ring-amber-200" },
  sky: { bg: "bg-sky-50", text: "text-sky-900", accent: "ring-sky-200" },
  turquoise: { bg: "bg-turquoise/10", text: "text-turquoise", accent: "ring-turquoise/40" },
};

function SummaryStrip({
  items,
}: {
  items: {
    icon: React.ReactNode;
    label: string;
    value: number;
    tone: SummaryTone;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {items.map((item) => {
        const tone = SUMMARY_TONES[item.tone];
        return (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={cn(
              "flex items-center justify-between gap-2 rounded-2xl border border-beige-dark/15 bg-warm-white px-3 py-2 text-start transition",
              "shadow-soft hover:shadow-elevated",
              item.active && cn("ring-2", tone.accent)
            )}
          >
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-coffee/60">{item.label}</p>
              <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone.text)}>{item.value}</p>
            </div>
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", tone.bg, tone.text)}>
              {item.icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FilterRow({
  filter,
  onFilterChange,
  query,
  onQueryChange,
  supplierId,
  onSupplierChange,
  suppliers,
  from,
  onFromChange,
  to,
  onToChange,
  sourceFilter,
  onSourceFilter,
  t,
}: {
  filter: (typeof FILTERS)[number];
  onFilterChange: (next: (typeof FILTERS)[number]) => void;
  query: string;
  onQueryChange: (next: string) => void;
  supplierId: string;
  onSupplierChange: (next: string) => void;
  suppliers: { id: string; name: string }[];
  from: string;
  onFromChange: (next: string) => void;
  to: string;
  onToChange: (next: string) => void;
  sourceFilter: "all" | "with" | "without";
  onSourceFilter: (next: "all" | "with" | "without") => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/50" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("admin.inventory.archive.search")}
            className="h-9 ps-9 text-sm"
          />
        </div>
        <select
          value={supplierId}
          onChange={(event) => onSupplierChange(event.target.value)}
          className="h-9 min-w-[10rem] rounded-xl border border-beige-dark/30 bg-warm-white px-2 text-sm"
        >
          <option value="">{t("admin.inventory.hub.allSuppliers")}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
        <Input className="h-9 w-36 text-sm" type="date" value={from} onChange={(event) => onFromChange(event.target.value)} />
        <Input className="h-9 w-36 text-sm" type="date" value={to} onChange={(event) => onToChange(event.target.value)} />
        <select
          value={sourceFilter}
          onChange={(event) => onSourceFilter(event.target.value as "all" | "with" | "without")}
          className="h-9 rounded-xl border border-beige-dark/30 bg-warm-white px-2 text-sm"
        >
          <option value="all">{t("admin.inventory.hub.sourceFilter.all")}</option>
          <option value="with">{t("admin.inventory.hub.sourceFilter.with")}</option>
          <option value="without">{t("admin.inventory.hub.sourceFilter.without")}</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onFilterChange(item)}
            className={cn(
              "h-7 rounded-full border px-3 text-xs font-medium transition",
              filter === item
                ? "border-turquoise bg-turquoise text-white"
                : "border-beige-dark/30 bg-warm-white text-coffee/70 hover:bg-beige/50"
            )}
          >
            {t(`admin.inventory.archive.filter.${item}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-beige-dark/40 bg-warm-white p-10 text-center shadow-soft">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-beige/70 text-turquoise">
        <Receipt className="h-7 w-7" />
      </div>
      <div>
        <p className="text-lg font-semibold text-dark-brown">{t("admin.inventory.hub.empty.title")}</p>
        <p className="mt-1 text-sm text-coffee/70">{t("admin.inventory.hub.empty.subtitle")}</p>
      </div>
      <Button type="button" variant="turquoise" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        {t("admin.inventory.hub.empty.cta")}
      </Button>
    </div>
  );
}

function DocumentActions({
  invoice,
  busy,
  onView,
  onDownload,
  onExcel,
  onSource,
  t,
}: {
  invoice: PurchaseInvoice;
  busy: boolean;
  onView: () => void;
  onDownload: () => void;
  onExcel: () => void;
  onSource: () => void;
  t: (key: string) => string;
}) {
  const hasSource = Boolean(invoice.sourceFile?.storagePath || invoice.fileUrl);
  return (
    <div className="flex flex-wrap gap-1">
      <Button type="button" variant="outline" className="h-8 rounded-lg px-2 text-xs" disabled={busy} onClick={onView}>
        <Eye className="h-3.5 w-3.5" />
        {t("admin.export.viewPdf")}
      </Button>
      <Button type="button" variant="ghost" className="h-8 rounded-lg px-2 text-xs" disabled={busy} onClick={onDownload}>
        <Download className="h-3.5 w-3.5" />
        {t("admin.export.pdf")}
      </Button>
      <Button type="button" variant="ghost" className="h-8 rounded-lg px-2 text-xs" disabled={busy} onClick={onExcel}>
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {t("admin.export.excel")}
      </Button>
      <Button type="button" variant="ghost" className="h-8 rounded-lg px-2 text-xs" disabled={!hasSource || busy} onClick={onSource}>
        {t("admin.inventory.hub.pdf.source")}
      </Button>
    </div>
  );
}

function RowActions({
  invoice,
  status,
  stock,
  archived,
  onOpen,
  onRescan,
  onTransfer,
  onDelete,
  t,
}: {
  invoice: PurchaseInvoice;
  status: InvoiceScanStatus;
  stock: StockState;
  archived?: boolean;
  onOpen: (invoice: PurchaseInvoice) => void;
  onRescan: (invoice: PurchaseInvoice) => void;
  onTransfer: (invoice: PurchaseInvoice) => void;
  onDelete?: (invoice: PurchaseInvoice) => void;
  t: (key: string) => string;
}) {
  const cancelled = status === "cancelled";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button type="button" variant="outline" className="h-8 rounded-lg px-2 text-xs" disabled={archived} onClick={() => onOpen(invoice)}>
        {t("admin.inventory.hub.pdf.open")}
      </Button>
      {!cancelled && (invoice.sourceFile || invoice.fileUrl) ? (
        <Button
          type="button"
          variant="ghost"
          className="h-8 rounded-lg px-2 text-xs text-coffee/70"
          onClick={() => onRescan(invoice)}
        >
          {t("admin.inventory.archive.rescan")}
        </Button>
      ) : null}
      {!cancelled && stock !== "posted" && (status === "approved" || status === "ready") ? (
        <Button
          type="button"
          variant="turquoise"
          className="h-8 rounded-lg px-2 text-xs"
          onClick={() => onTransfer(invoice)}
        >
          {t("admin.finance.confirmTransfer")}
        </Button>
      ) : null}
      {!cancelled && onDelete ? (
        <Button
          type="button"
          variant="ghost"
          className="h-8 rounded-lg px-2 text-xs text-red-700 hover:bg-red-50"
          onClick={() => onDelete(invoice)}
          aria-label={t("admin.invoice.cancel.action")}
          title={t("admin.invoice.cancel.action")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function StatusPill({ status, t }: { status: InvoiceScanStatus; t: (key: string) => string }) {
  const styles: Record<InvoiceScanStatus, string> = {
    uploaded: "bg-stone-100 text-stone-700 ring-stone-200",
    scanning: "bg-sky-50 text-sky-800 ring-sky-200",
    needs_review: "bg-amber-50 text-amber-900 ring-amber-200",
    ready: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    posted: "bg-turquoise/10 text-turquoise ring-turquoise/30",
    failed: "bg-red-50 text-red-700 ring-red-200",
    cancelled: "bg-stone-100 text-stone-500 ring-stone-200",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", styles[status])}>
      {t(`admin.inventory.archive.status.${status}`)}
    </span>
  );
}

function StockPill({ state, t }: { state: StockState; t: (key: string) => string }) {
  const styles: Record<StockState, string> = {
    none: "bg-stone-100 text-stone-600 ring-stone-200",
    partial: "bg-amber-50 text-amber-900 ring-amber-200",
    posted: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", styles[state])}>
      {t(`admin.inventory.hub.stock.${state}`)}
    </span>
  );
}

export type { AddDocumentAction };
