"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/components/providers/locale-provider";
import { buildReportCopy } from "@/lib/reports/pdf/copy";
import { paginateReport } from "@/lib/reports/pdf/paginate";
import type { ReportFilters, ReportPayload } from "@/lib/reports/types";
import { ReportA4Pages } from "@/features/admin/reports/pdf/report-pages";
import { downloadReportPdf, printReportPdf } from "@/features/admin/reports/pdf/export-report-pdf";

export function ReportPreviewModal({
  open,
  onOpenChange,
  payload,
  filters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: ReportPayload;
  filters: ReportFilters;
}) {
  const t = useT();
  const [busy, setBusy] = useState<"pdf" | "print" | null>(null);
  const copy = useMemo(() => buildReportCopy(payload, filters, t), [payload, filters, t]);
  const pages = useMemo(() => paginateReport(payload), [payload]);
  const landscape = pages[0]?.orientation === "landscape";

  const run = async (action: "pdf" | "print") => {
    setBusy(action);
    try {
      if (action === "pdf") await downloadReportPdf(payload, filters, t);
      else await printReportPdf(payload, filters, t);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,980px)] max-w-none flex-col overflow-hidden bg-stone-200 p-0">
        <DialogHeader className="shrink-0 border-b border-beige-dark/20 bg-warm-white px-5 py-3">
          <DialogTitle>{t("admin.reports.preview")}</DialogTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="turquoise" disabled={!!busy} onClick={() => void run("pdf")}>
              {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t("admin.reports.downloadPdf")}
            </Button>
            <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run("print")}>
              {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {t("admin.reports.print")}
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-5">
          <div
            className="mx-auto space-y-5"
            style={{ width: landscape ? "min(100%, 920px)" : "min(100%, 680px)" }}
          >
            <div
              className="report-preview-scale origin-top"
              style={{
                transform: landscape ? "scale(0.72)" : "scale(0.82)",
                transformOrigin: "top center",
              }}
            >
              <div className="flex flex-col items-center gap-6">
                <ReportA4Pages pages={pages} payload={payload} copy={copy} />
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReportPdfActions({
  payload,
  getPayload,
  filters,
  compact,
}: {
  payload?: ReportPayload;
  getPayload?: () => Promise<ReportPayload>;
  filters: ReportFilters;
  compact?: boolean;
}) {
  const t = useT();
  const [resolved, setResolved] = useState<ReportPayload | null>(payload ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "pdf" | "print" | null>(null);

  useEffect(() => {
    if (payload) setResolved(payload);
  }, [payload]);

  const ensure = async () => {
    if (resolved) return resolved;
    if (!getPayload) throw new Error("REPORT_PAYLOAD_MISSING");
    const next = await getPayload();
    setResolved(next);
    return next;
  };

  const run = async (action: "preview" | "pdf" | "print") => {
    setBusy(action);
    try {
      const next = await ensure();
      if (action === "preview") setOpen(true);
      else if (action === "pdf") await downloadReportPdf(next, filters, t);
      else await printReportPdf(next, filters, t);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size={compact ? "sm" : "default"} disabled={!!busy} onClick={() => void run("preview")}>
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          {t("admin.reports.preview")}
        </Button>
        <Button type="button" variant={compact ? "outline" : "turquoise"} size={compact ? "sm" : "default"} disabled={!!busy} onClick={() => void run("pdf")}>
          {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t("admin.reports.downloadPdf")}
        </Button>
        <Button type="button" variant="outline" size={compact ? "sm" : "default"} disabled={!!busy} onClick={() => void run("print")}>
          {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          {t("admin.reports.print")}
        </Button>
      </div>
      {resolved ? (
        <ReportPreviewModal open={open} onOpenChange={setOpen} payload={resolved} filters={filters} />
      ) : null}
    </>
  );
}
