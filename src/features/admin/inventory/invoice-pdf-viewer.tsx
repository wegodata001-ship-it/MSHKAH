"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Printer, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/components/providers/locale-provider";
import { buildInvoiceDocument, layoutInvoicePages, type InvoiceDocument } from "@/lib/inventory/invoice-document";
import { InvoicePdfPages } from "@/features/admin/inventory/invoice-pdf-pages";
import { buildInvoicePdfBlob, downloadBlob, invoicePdfFilename, printPdfBlob, toArrayBuffer, type InvoiceSourceBytes } from "@/features/admin/inventory/invoice-pdf";
import { saveInvoicePdfCopy } from "@/services/invoice-admin-client";

export function InvoicePdfViewer({
  doc,
  source,
  invoiceId,
  invoiceNumber,
  initialMode = "system",
  onClose,
  onToast,
}: {
  doc: InvoiceDocument;
  source: InvoiceSourceBytes | null;
  invoiceId: string;
  invoiceNumber: string;
  initialMode?: "system" | "source";
  onClose: () => void;
  onToast?: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const pages = useMemo(() => layoutInvoicePages(doc), [doc]);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"system" | "source">(initialMode === "source" && source ? "source" : "system");
  const [busy, setBusy] = useState(false);
  const sourceUrl = useMemo(() => (source ? URL.createObjectURL(new Blob([toArrayBuffer(source.bytes)], { type: source.mimeType })) : null), [source]);
  const image = source?.mimeType.startsWith("image/");
  const pdf = source?.mimeType.includes("pdf");

  async function produce(kind: "download" | "print") {
    setBusy(true);
    try {
      const blob = await buildInvoicePdfBlob(doc, source);
      if (kind === "download") downloadBlob(blob, invoicePdfFilename(invoiceNumber));
      else await printPdfBlob(blob);
      const saved = await saveInvoicePdfCopy(invoiceId, blob);
      onToast?.(
        saved.ok ? t("admin.inventory.hub.pdf.saved") : t("admin.inventory.hub.pdf.downloaded"),
        saved.ok ? "success" : "error"
      );
    } catch {
      onToast?.(t("admin.inventory.hub.pdf.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] w-[min(960px,96vw)] max-w-5xl flex-col overflow-hidden bg-warm-white">
        <DialogHeader className="text-start">
          <DialogTitle>{t("admin.inventory.hub.pdf.view")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={mode === "system" ? "turquoise" : "outline"} className="h-8 text-xs" onClick={() => setMode("system")}>
            {t("admin.inventory.hub.pdf.system")}
          </Button>
          {source ? (
            <Button type="button" variant={mode === "source" ? "turquoise" : "outline"} className="h-8 text-xs" onClick={() => setMode("source")}>
              {t("admin.inventory.hub.pdf.original")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => void produce("download")}>
            <Download className="h-3.5 w-3.5" />
            {t("admin.inventory.hub.pdf.download")}
          </Button>
          <Button type="button" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => void produce("print")}>
            <Printer className="h-3.5 w-3.5" />
            {t("admin.inventory.hub.pdf.print")}
          </Button>
          {mode === "system" ? (
            <>
              <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))} aria-label={t("admin.inventory.hub.pdf.zoomOut")}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))} aria-label={t("admin.inventory.hub.pdf.zoomIn")}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" className="h-8 px-2" disabled={page === 0} onClick={() => setPage((value) => value - 1)} aria-label={t("admin.inventory.hub.pdf.prev")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-xs tabular-nums text-coffee/70">{page + 1} / {pages.length}</span>
              <Button type="button" variant="ghost" className="h-8 px-2" disabled={page >= pages.length - 1} onClick={() => setPage((value) => value + 1)} aria-label={t("admin.inventory.hub.pdf.next")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-beige/40 p-3">
          {mode === "source" && sourceUrl && image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sourceUrl} alt="" className="mx-auto max-w-full" />
          ) : null}
          {mode === "source" && sourceUrl && pdf ? (
            <iframe title={t("admin.inventory.hub.pdf.original")} src={sourceUrl} className="h-[70dvh] w-full rounded-xl bg-white" />
          ) : null}
          {mode === "source" && source && !image && !pdf ? (
            <p className="text-sm text-coffee/70">{doc.source.note}</p>
          ) : null}
          {mode === "system" ? (
            <div className="mx-auto origin-top" style={{ transform: `scale(${zoom})`, width: "210mm" }}>
              <InvoicePdfPages doc={doc} pages={[pages[page]!]} pageNumber={page + 1} pageCount={pages.length} />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function documentFromBundle(input: {
  invoice: Parameters<typeof buildInvoiceDocument>[0]["invoice"];
  movements: Parameters<typeof buildInvoiceDocument>[0]["movements"];
  paidAmount: number;
  productNames: Record<string, string>;
}) {
  return buildInvoiceDocument({
    invoice: input.invoice,
    movements: input.movements,
    paidAmount: input.paidAmount,
    paymentsIncluded: true,
    productNames: input.productNames,
    generatedAt: new Date().toISOString(),
  });
}
