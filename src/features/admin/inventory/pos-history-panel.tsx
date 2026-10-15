"use client";

import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { formatIls } from "@/lib/costing/money";
import { compareExcelToZ } from "@/lib/inventory/pos-z";
import { priorExcelFinanceWrites, priorExcelStockWrites } from "@/lib/inventory/pos-excel";
import type { InventoryHubProps } from "@/features/admin/inventory/inventory-hub";

export function PosHistoryPanel(props: InventoryHubProps & { onOpenExcel?: (item: import("@/lib/inventory/types").PosImport) => void }) {
  const t = useT();
  const stockImpact = priorExcelStockWrites(props.movements);
  const financeImpact = priorExcelFinanceWrites(props.posImports);
  const rows = [
    ...props.posImports.map((item) => ({
      id: item.id,
      kind: "excel" as const,
      fileName: item.fileName,
      period: item.periodFrom && item.periodTo ? `${item.periodFrom} – ${item.periodTo}` : item.period,
      uploadedAt: item.uploadedAt || item.createdAt,
      status: !item.lines?.length
        ? t("admin.pos.emptyImport")
        : item.inventoryStatus === "posted"
          ? t("admin.pos.stepApplied")
          : item.inventoryStatus === "partial"
            ? t("admin.pos.resumePartial")
            : t("admin.pos.savedAsInfo"),
      source: item.fileName,
      financeId: null as string | null,
      revenue: item.reportedRevenueSum ?? null,
    })),
    ...props.zReports.map((item) => ({
      id: item.id,
      kind: "z" as const,
      fileName: item.sourceFiles?.[0]?.originalFilename || item.reportNumber || item.id,
      period: item.periodFrom && item.periodTo ? `${item.periodFrom} – ${item.periodTo}` : item.businessDate || "",
      uploadedAt: item.createdAt,
      status: item.status === "posted" ? t("admin.pos.zPosted") : t("admin.pos.zDraft"),
      source: item.sourceFiles?.[0]?.downloadUrl || "",
      financeId: item.financeEntryId ?? null,
      revenue: item.salesTotal ?? null,
    })),
  ].sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));

  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.pos.history")}>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={`${row.kind}-${row.id}`} className="rounded-2xl border border-beige-dark/20 px-4 py-3 text-sm">
              <p className="font-medium">
                {row.kind === "excel" ? t("admin.pos.excelTab") : t("admin.pos.zTab")} · {row.fileName}
              </p>
              <p className="text-coffee/65">
                {t("admin.pos.dataPeriod")}: {row.period || "—"} · {t("admin.pos.uploadedAt")}: {row.uploadedAt ? new Date(row.uploadedAt).toLocaleString() : "—"}
              </p>
              <p>
                {row.status}
                {row.financeId ? ` · ${t("admin.pos.financeLink")}: ${row.financeId}` : ""}
              </p>
              {row.kind === "excel" && (
                <button type="button" className="text-turquoise" onClick={() => {
                  const item = props.posImports.find((entry) => entry.id === row.id);
                  if (item) props.onOpenExcel?.(item);
                }}>
                  {t("admin.pos.openSaved")}
                </button>
              )}
              {row.source && row.kind === "z" && (
                <a className="text-turquoise" href={row.source} target="_blank" rel="noreferrer">
                  {t("admin.pos.sourceLink")}
                </a>
              )}
            </div>
          ))}
          {!rows.length && <p className="text-sm text-coffee/55">{t("admin.pos.noHistory")}</p>}
        </div>
      </AdminCard>

      <AdminCard title={t("admin.pos.compareTitle")}>
        <p className="text-sm text-coffee/65">{t("admin.pos.compareHint")}</p>
        <div className="mt-3 space-y-2">
          {props.posImports.map((excel) => {
            const match = props.zReports.find((report) => {
              const from = report.periodFrom ?? report.businessDate;
              const to = report.periodTo ?? report.businessDate;
              return Boolean(from && to && excel.periodFrom && excel.periodTo && from <= excel.periodTo && to >= excel.periodFrom);
            });
            const state = compareExcelToZ({
              excelRevenue: excel.reportedRevenueSum ?? null,
              zSales: match?.salesTotal ?? null,
              sameRegister: true,
              overlappingPeriod: Boolean(match),
            });
            return (
              <p key={excel.id} className="text-sm">
                {excel.fileName}: {state === "no-z" ? t("admin.pos.noZ") : state === "partial" ? t("admin.pos.partialCover") : state === "match" ? t("admin.pos.compareMatch") : t("admin.pos.infoOnly")}
                {excel.reportedRevenueSum != null ? ` · ${formatIls(excel.reportedRevenueSum)}` : ""}
                {match?.salesTotal != null ? ` / Z ${formatIls(match.salesTotal)}` : ""}
              </p>
            );
          })}
        </div>
      </AdminCard>

      {(stockImpact.length > 0 || financeImpact.length > 0) && (
        <AdminCard title={t("admin.pos.priorImpact")}>
          <p className="text-sm">{t("admin.pos.priorImpactHint")}</p>
          {stockImpact.length > 0 && (
            <p className="mt-2 text-sm">
              {t("admin.pos.priorStock")}: {stockImpact.length} · {Array.from(new Set(stockImpact.map((row) => row.posImportId))).join(", ")}
            </p>
          )}
          {financeImpact.length > 0 && (
            <p className="mt-2 text-sm">
              {t("admin.pos.priorFinance")}: {financeImpact.map((item) => item.id).join(", ")}
            </p>
          )}
        </AdminCard>
      )}
    </div>
  );
}
