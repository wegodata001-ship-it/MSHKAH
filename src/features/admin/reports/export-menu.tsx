"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { getFirebaseAuth } from "@/lib/firebase";
import type { ExportFilters, ReportFormat, ReportKind } from "@/lib/reports/export/types";

export async function fetchReport(input: {
  kind: ReportKind;
  format: ReportFormat;
  scope: "all" | "filtered";
  ids?: string[];
  filters?: ExportFilters;
}): Promise<{ blob: Blob; filename: string }> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("PERMISSION_DENIED");
  const token = await user.getIdToken();
  const response = await fetch("/api/admin/reports/export", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new Error(payload?.code || "EXPORT_FAILED");
  }
  const blob = await response.blob();
  const header = response.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(header);
  return { blob, filename: match?.[1] || "MISHKAT-report" };
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function printReportBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.src = url;
  document.body.appendChild(frame);
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("EXPORT_PRINT_TIMEOUT")), 15000);
    frame.onload = () => {
      window.clearTimeout(timer);
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      resolve();
    };
  }).finally(() => {
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  });
}

export function ExportMenu({
  kind,
  filters,
  ids,
  onError,
}: {
  kind: ReportKind;
  filters?: ExportFilters;
  ids?: string[];
  onError?: (message: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(format: ReportFormat, scope: "all" | "filtered" | "selected", print = false) {
    setBusy(true);
    setOpen(false);
    try {
      const selected = scope === "selected" && ids?.length ? ids : undefined;
      const file = await fetchReport({
        kind: format === "zip" ? "zip" : kind,
        format,
        scope: scope === "all" ? "all" : "filtered",
        ids: selected,
        filters: scope === "all" ? undefined : filters,
      });
      if (print) await printReportBlob(file.blob);
      else saveBlob(file.blob, file.filename);
    } catch (error) {
      onError?.(error instanceof Error ? t(`admin.export.err.${error.message}`) : t("admin.export.err.EXPORT_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Download className="h-4 w-4" />
        {t("admin.export.menu")}
      </Button>
      {open ? (
        <div role="menu" className="absolute end-0 z-30 mt-2 w-64 rounded-2xl border border-beige-dark/20 bg-warm-white p-1 shadow-elevated">
          <MenuItem icon={<FileText className="h-4 w-4" />} label={t("admin.export.pdf")} onClick={() => void run("pdf", ids?.length ? "selected" : "filtered")} />
          <MenuItem icon={<FileSpreadsheet className="h-4 w-4" />} label={t("admin.export.excel")} onClick={() => void run("xlsx", ids?.length ? "selected" : "filtered")} />
          <MenuItem icon={<Printer className="h-4 w-4" />} label={t("admin.export.print")} onClick={() => void run("pdf", ids?.length ? "selected" : "filtered", true)} />
          <MenuItem icon={<Download className="h-4 w-4" />} label={t("admin.export.all")} onClick={() => void run("xlsx", "all")} />
          <MenuItem icon={<Download className="h-4 w-4" />} label={t("admin.export.filtered")} onClick={() => void run("xlsx", "filtered")} />
          <MenuItem icon={<Download className="h-4 w-4" />} label={t("admin.export.zip")} onClick={() => void run("zip", "all")} />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-dark-brown hover:bg-beige/70">
      <span className="text-coffee/70">{icon}</span>
      {label}
    </button>
  );
}
