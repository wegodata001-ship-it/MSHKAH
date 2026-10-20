"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { PosExcelPreviewTable } from "@/features/admin/inventory/pos-excel-preview";
import { formatIls } from "@/lib/costing/money";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { posPriceUpdatePreview, POS_EXCEL_FIELDS, type PosColumnMap } from "@/lib/inventory/pos-excel";
import { isAutoProductRow, planPosApply, type PosApplyDecision } from "@/lib/inventory/pos-apply";
import type { PosImport, PosSaleLine } from "@/lib/inventory/types";
import { applyPosExcelImport, savePosColumnMap, savePosDraft } from "@/services/inventoryService";
import { PosExcelSummary } from "@/features/admin/inventory/pos-excel-summary";
import { SalesAiPanel } from "@/features/admin/inventory/sales-ai-panel";
import { SalesInsightCenter } from "@/features/admin/inventory/sales-insight-center";
import { dateLooksLikeEpoch } from "@/lib/inventory/pos-excel";
import type { InventoryHubProps } from "@/features/admin/inventory/inventory-hub";

const PARSE_TIMEOUT_MS = 90_000;

type Stage = "idle" | "selected" | "reading" | "ready" | "summary" | "applying" | "applied" | "saving" | "saved" | "error";

type Review = {
  fileName: string;
  fileHash: string;
  period: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  sourcePeriodFrom?: string | null;
  sourcePeriodTo?: string | null;
  reportGeneratedAt?: string | null;
  uploadedAt?: string;
  periodNeedsReview?: boolean;
  lines: PosSaleLine[];
  summary?: { itemCount: number; quantitySum: number; reportedRevenueSum: number | null };
  sourceTotals?: { itemCount: number | null; quantitySum: number | null; reportedRevenueSum: number | null } | null;
  gaps?: { items: number | null; quantity: number | null; reportedRevenue: number | null };
  sheets?: { name: string; rowCount: number }[];
  selectedSheet?: string | null;
  headerRow?: number | null;
  headerDetected?: boolean;
  rawHeaders?: string[];
  rawPreview?: string[][];
  columnMap?: PosColumnMap;
  needsMapping?: boolean;
  existingId?: string;
  duplicate?: boolean;
};

function fileSizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function PosExcelPanel(props: InventoryHubProps & { opened?: PosImport | null; onCloseOpened?: () => void }) {
  const t = useT();
  const authFetch = useAuthFetch();
  const inputRef = useRef<HTMLInputElement>(null);
  const parseLock = useRef(false);
  const saveLock = useRef(false);
  const [review, setReview] = useState<Review | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>(
    props.opened?.inventoryStatus === "posted" ? "applied" : props.opened ? "ready" : "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [periodConfirmed, setPeriodConfirmed] = useState(Boolean(props.opened?.periodConfirmed));
  const [overlapAcknowledged, setOverlapAcknowledged] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, PosApplyDecision>>({});
  const [excludedKeys, setExcludedKeys] = useState<string[]>(props.opened?.excludedKeys ?? []);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [savedImportId, setSavedImportId] = useState<string | null>(props.opened?.id ?? null);
  const [priceLine, setPriceLine] = useState<PosSaleLine | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState("");
  const [columnMap, setColumnMap] = useState<PosColumnMap>({});
  const busy = stage === "reading" || stage === "saving" || stage === "applying";
  const opened = props.opened;

  async function parse(next: File, extras?: { sheetName?: string; headerRow?: string; columnMap?: PosColumnMap }) {
    if (parseLock.current) return;
    parseLock.current = true;
    setStage("reading");
    setError(null);
    setReview(null);
    setDecisions({});
    setExcludedKeys([]);
    setApplyResult(null);
    setOverlapAcknowledged(false);
    props.onCloseOpened?.();
    const form = new FormData();
    form.set("file", next);
    if (extras?.sheetName) form.set("sheetName", extras.sheetName);
    if (extras?.headerRow) form.set("headerRow", extras.headerRow);
    if (extras?.columnMap && Object.keys(extras.columnMap).length) form.set("columnMap", JSON.stringify(extras.columnMap));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
    try {
      const response = await authFetch("/api/admin/inventory/pos/parse", { method: "POST", body: form, signal: controller.signal });
      let json: Record<string, unknown> = {};
      try {
        json = await response.json();
      } catch {
        setError(t("admin.pos.invalidResponse"));
        setStage("error");
        return;
      }
      if (!response.ok || json.ok === false) {
        setError(String(json.message || json.error || t("admin.pos.readFailed")));
        setStage("error");
        return;
      }
      const nextReview = {
        ...json,
        lines: Array.isArray(json.lines) ? (json.lines as PosSaleLine[]) : [],
        sourcePeriodFrom: (json.sourcePeriodFrom as string | null | undefined) ?? (json.periodFrom as string | null | undefined) ?? null,
        sourcePeriodTo: (json.sourcePeriodTo as string | null | undefined) ?? (json.periodTo as string | null | undefined) ?? null,
      } as Review;
      setPeriodConfirmed(false);
      setReview(nextReview);
      setSheetName(String(json.selectedSheet || extras?.sheetName || ""));
      setHeaderRow(json.headerRow ? String(json.headerRow) : extras?.headerRow || "");
      setColumnMap((json.columnMap as PosColumnMap) || extras?.columnMap || {});
      setStage(nextReview.lines.length ? "ready" : "error");
      if (!nextReview.lines.length) setError(t("admin.pos.emptyImport"));
      if (nextReview.duplicate && nextReview.lines.length) props.onToast(t("admin.pos.excelExists"), "error");
    } catch (caught) {
      setError(caught instanceof DOMException && caught.name === "AbortError" ? t("admin.pos.readTimeout") : t("admin.pos.networkFailed"));
      setStage("error");
    } finally {
      window.clearTimeout(timer);
      parseLock.current = false;
    }
  }

  const current = opened && !review
    ? {
        fileName: opened.fileName,
        fileHash: opened.fileHash,
        period: opened.period,
        periodFrom: opened.periodFrom,
        periodTo: opened.periodTo,
        sourcePeriodFrom: opened.sourcePeriodFrom ?? opened.periodFrom,
        sourcePeriodTo: opened.sourcePeriodTo ?? opened.periodTo,
        reportGeneratedAt: opened.reportGeneratedAt,
        uploadedAt: opened.uploadedAt,
        periodNeedsReview: opened.periodNeedsReview,
        lines: opened.lines ?? [],
        summary: {
          itemCount: opened.itemCount ?? opened.lines?.length ?? 0,
          quantitySum: opened.quantitySum ?? 0,
          reportedRevenueSum: opened.reportedRevenueSum ?? null,
        },
        selectedSheet: opened.sheetName,
        headerRow: opened.headerRow,
        sourceTotals: opened.sourceTotals,
      }
    : review;

  const selectedLines = (current?.lines ?? []).filter((line) => isAutoProductRow(line) && !excludedKeys.includes(line.key));
  const summary = {
    itemCount: selectedLines.length,
    quantitySum: selectedLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    reportedRevenueSum: selectedLines.reduce((sum, line) => {
      const value = line.reportedRevenue ?? line.netTotal;
      return value == null ? sum : (sum ?? 0) + Number(value);
    }, null as number | null),
  };
  const reviewCount = selectedLines.filter((line) => !line.menuProductId || line.reviewReason).length;
  const plan = useMemo(
    () =>
      current
        ? planPosApply({
            lines: current.lines,
            products: props.products,
            maps: props.maps,
            recipes: props.recipes,
            ingredients: props.ingredients,
            movements: props.movements,
            imports: props.posImports,
            fileHash: current.fileHash,
            sourceItemCount: current.sourceTotals?.itemCount ?? null,
            sourceQuantitySum: current.sourceTotals?.quantitySum ?? null,
            sourceRevenueSum: current.sourceTotals?.reportedRevenueSum ?? null,
            periodNeedsReview: current.periodNeedsReview,
            periodConfirmed,
            periodFrom: current.periodFrom,
            periodTo: current.periodTo,
            overlapAcknowledged,
            decisions,
            excludedKeys,
          })
        : null,
    [current, props.products, props.maps, props.recipes, props.ingredients, props.movements, props.posImports, periodConfirmed, overlapAcknowledged, decisions, excludedKeys]
  );

  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.pos.excelUpload")}>
        <ProcessSteps
          stage={opened && !review ? (opened.inventoryStatus === "posted" ? "applied" : "ready") : stage}
          saved={stage === "applied" || opened?.inventoryStatus === "posted"}
          hasPreview={Boolean((review ?? opened)?.lines?.length)}
        />
        {!file && !opened && (
          <label className="mt-3 flex cursor-pointer flex-col items-center rounded-3xl border border-dashed border-coffee/25 px-6 py-10">
            <Upload className="h-8 w-8" />
            <p className="mt-3 font-semibold">{t("admin.pos.chooseFile")}</p>
            <p className="text-sm text-coffee/55">XLSX / CSV</p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const next = e.target.files?.[0];
                e.target.value = "";
                if (!next) return;
                setFile(next);
                setReview(null);
                setError(null);
                setStage("selected");
                props.onCloseOpened?.();
              }}
            />
          </label>
        )}
        {file && (
          <div className="mt-3 rounded-2xl border border-beige-dark/20 px-4 py-3 text-sm">
            <p className="font-medium">{file.name}</p>
            <p className="text-coffee/60">{fileSizeLabel(file.size)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
                {t("admin.pos.replaceFile")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setReview(null);
                  setError(null);
                  setStage("idle");
                }}
              >
                {t("admin.pos.removeFile")}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => {
                  const next = e.target.files?.[0];
                  e.target.value = "";
                  if (!next) return;
                  setFile(next);
                  setReview(null);
                  setError(null);
                  setStage("selected");
                }}
              />
            </div>
          </div>
        )}
        {file && (stage === "selected" || stage === "error") && (
          <Button className="mt-4" type="button" variant="turquoise" disabled={busy} onClick={() => void parse(file, { sheetName, headerRow, columnMap })}>
            {stage === "error" ? t("admin.pos.retryRead") : t("admin.pos.startRead")}
          </Button>
        )}
        {stage === "reading" && (
          <p className="mt-4 flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("admin.pos.reading")}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        )}
        {review && !review.lines.length && (review.needsMapping || review.rawPreview?.length) && (
          <ColumnMapEditor
            review={review}
            sheetName={sheetName}
            headerRow={headerRow}
            columnMap={columnMap}
            file={file}
            busy={busy}
            onSheet={setSheetName}
            onHeader={setHeaderRow}
            onMap={setColumnMap}
            onApply={() => file && void parse(file, { sheetName, headerRow, columnMap })}
            onSaveMap={async () => {
              const saved = await savePosColumnMap({
                headers: review.rawHeaders ?? [],
                columnMap: Object.fromEntries(Object.entries(columnMap).filter((entry): entry is [string, number] => typeof entry[1] === "number")),
                sheetName,
                headerRow: headerRow ? Number(headerRow) : null,
              });
              if (saved.success) props.onToast(t("admin.pos.mapSaved"));
              else props.onToast(saved.error, "error");
            }}
          />
        )}
      </AdminCard>

      {current && current.lines.length > 0 && (stage === "ready" || stage === "summary" || stage === "applying" || stage === "applied" || stage === "error" || opened) && (
        <AdminCard title={t("admin.pos.excelReview")}>
          <p className="rounded-xl bg-beige/50 px-3 py-2 text-sm font-semibold">{t("admin.pos.infoOnly")}</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <p>{t("admin.pos.fileName")}: {current.fileName}</p>
            <p>{t("admin.pos.sheet")}: {current.selectedSheet || "—"}</p>
            <p>{t("admin.pos.dataPeriod")}: {current.periodFrom && current.periodTo && !dateLooksLikeEpoch(current.periodFrom) ? `${current.periodFrom} – ${current.periodTo}` : t("admin.pos.dateUnrecognized")}</p>
            <p>{t("admin.pos.itemCount")}: {summary.itemCount}</p>
            <p>{t("admin.pos.rowsNeedReview")}: {reviewCount}</p>
            <p>{t("admin.pos.quantitySum")}: {summary.quantitySum}</p>
            <p>{t("admin.pos.reportedRevenue")}: {summary.reportedRevenueSum == null ? "—" : formatIls(summary.reportedRevenueSum)}</p>
          </div>
          {current.sourceTotals && (
            <p className="mt-2 text-sm text-coffee/70">
              {t("admin.pos.sourceTotals")}: {current.sourceTotals.itemCount ?? "—"} / {current.sourceTotals.quantitySum ?? "—"} / {current.sourceTotals.reportedRevenueSum == null ? "—" : formatIls(current.sourceTotals.reportedRevenueSum)}
            </p>
          )}
          <p className="mt-1 text-sm text-coffee/70">
            {t("admin.pos.selectedTotals")}: {summary.itemCount} / {summary.quantitySum} / {summary.reportedRevenueSum == null ? "—" : formatIls(summary.reportedRevenueSum)}
          </p>
          {current.periodNeedsReview && current.sourcePeriodFrom && (
            <p className="mt-3 text-sm text-coffee/60">
              {t("admin.pos.originalPeriod")}: {current.sourcePeriodFrom} – {current.sourcePeriodTo || current.sourcePeriodFrom}
            </p>
          )}
          {review?.needsMapping && <p className="mt-3 text-sm text-red-700">{t("admin.pos.needMapping")}</p>}
          {plan && (
            <div className="mt-4">
              <SalesInsightCenter
                fileName={current.fileName}
                lines={current.lines}
                products={props.products}
                periodFrom={current.periodFrom}
                periodTo={current.periodTo}
                periodNeedsReview={current.periodNeedsReview}
                plan={plan}
                onSavePeriod={(from, to) => {
                  const sourceFrom = current.sourcePeriodFrom ?? current.periodFrom;
                  const sourceTo = current.sourcePeriodTo ?? current.periodTo;
                  const nextPeriod = from === to ? from : `${from}:${to}`;
                  setReview({
                    ...(review ?? {
                      fileName: opened?.fileName ?? current.fileName,
                      fileHash: opened?.fileHash ?? current.fileHash,
                      lines: current.lines,
                      summary: current.summary,
                      selectedSheet: current.selectedSheet,
                      headerRow: current.headerRow,
                      existingId: opened?.id,
                      periodNeedsReview: current.periodNeedsReview,
                    }),
                    period: nextPeriod,
                    periodFrom: from,
                    periodTo: to,
                    sourcePeriodFrom: review?.sourcePeriodFrom ?? sourceFrom,
                    sourcePeriodTo: review?.sourcePeriodTo ?? sourceTo,
                    periodNeedsReview: false,
                  });
                  setPeriodConfirmed(true);
                  setError(null);
                  props.onToast(t("admin.pos.periodSaved"));
                }}
              />
            </div>
          )}
          {(savedImportId || opened?.id) && (
            <div className="mt-4">
              <SalesAiPanel importId={(savedImportId || opened?.id) as string} autoAnalyze={Boolean(savedImportId) && savedImportId !== opened?.id} />
            </div>
          )}

          {review && (review.needsMapping || review.rawPreview?.length) && !current.lines.length && (
            <ColumnMapEditor
              review={review}
              sheetName={sheetName}
              headerRow={headerRow}
              columnMap={columnMap}
              file={file}
              busy={busy}
              onSheet={setSheetName}
              onHeader={setHeaderRow}
              onMap={setColumnMap}
              onApply={() => file && void parse(file, { sheetName, headerRow, columnMap })}
              onSaveMap={async () => {
                const saved = await savePosColumnMap({
                  headers: review.rawHeaders ?? [],
                  columnMap: Object.fromEntries(Object.entries(columnMap).filter((entry): entry is [string, number] => typeof entry[1] === "number")),
                  sheetName,
                  headerRow: headerRow ? Number(headerRow) : null,
                });
                if (saved.success) props.onToast(t("admin.pos.mapSaved"));
                else props.onToast(saved.error, "error");
              }}
            />
          )}

          {current.lines.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-coffee/70">{t("admin.pos.excelReview")}</summary>
              <PosExcelPreviewTable
                lines={current.lines}
                products={props.products}
                locale={props.locale}
                excludedKeys={excludedKeys}
                onExclude={(keys) => setExcludedKeys((prev) => [...new Set([...prev, ...keys])])}
                onRestore={(keys) => setExcludedKeys((prev) => prev.filter((key) => !keys.includes(key)))}
                onLines={(lines) => {
                  if (review) setReview({ ...review, lines });
                }}
                onUpdatePrice={setPriceLine}
              />
            </details>
          )}

          {current.lines.length > 0 && (stage === "ready" || stage === "error") && (
            <Button className="mt-4" type="button" variant="turquoise" disabled={busy} onClick={() => setStage("summary")}>
              {t("admin.pos.continueSummary")}
            </Button>
          )}
        </AdminCard>
      )}

      {current && (stage === "summary" || stage === "applying" || stage === "applied") && (
        <AdminCard title={t("admin.pos.excelSummary")}>
          <PosExcelSummary
            plan={plan!}
            products={props.products}
            periodLabel={current.periodFrom && current.periodTo ? `${current.periodFrom} – ${current.periodTo}` : current.period}
            periodFrom={current.periodFrom}
            periodTo={current.periodTo}
            sourcePeriodFrom={current.sourcePeriodFrom ?? current.periodFrom}
            sourcePeriodTo={current.sourcePeriodTo ?? current.periodTo}
            periodNeedsReview={Boolean(current.periodNeedsReview)}
            periodConfirmed={periodConfirmed}
            overlapAcknowledged={overlapAcknowledged}
            busy={busy}
            error={error}
            onSavePeriod={(from, to) => {
              const sourceFrom = current.sourcePeriodFrom ?? current.periodFrom;
              const sourceTo = current.sourcePeriodTo ?? current.periodTo;
              const nextPeriod = from === to ? from : `${from}:${to}`;
              const nextReview: Review = {
                ...(review ?? {
                  fileName: opened?.fileName ?? current.fileName,
                  fileHash: opened?.fileHash ?? current.fileHash,
                  lines: current.lines,
                  summary: current.summary,
                  selectedSheet: current.selectedSheet,
                  headerRow: current.headerRow,
                  existingId: opened?.id,
                  periodNeedsReview: current.periodNeedsReview,
                }),
                period: nextPeriod,
                periodFrom: from,
                periodTo: to,
                sourcePeriodFrom: review?.sourcePeriodFrom ?? sourceFrom,
                sourcePeriodTo: review?.sourcePeriodTo ?? sourceTo,
              };
              setReview(nextReview);
              setPeriodConfirmed(true);
              setError(null);
              props.onToast(t("admin.pos.periodSaved"));
            }}
            onOverlapAck={setOverlapAcknowledged}
            onDecision={(key, decision) => setDecisions((prev) => ({ ...prev, [key]: { ...prev[key], ...decision } }))}
            onSaveSales={() => void commitImport("sales")}
            onApply={() => void commitImport("stock")}
          />
          {stage === "applying" && (
            <p className="mt-3 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("admin.pos.applying")}
            </p>
          )}
          {applyResult && <p className="mt-2 text-sm text-turquoise">{applyResult}</p>}
        </AdminCard>
      )}

      {priceLine?.menuProductId && (
        <PriceConfirm
          line={priceLine}
          currentPrice={props.products.find((item) => item.id === priceLine.menuProductId)?.price}
          onClose={() => setPriceLine(null)}
          onToast={props.onToast}
        />
      )}
    </div>
  );

  async function commitImport(mode: "sales" | "stock") {
    if (!current || saveLock.current) return;
    const source = review ?? (opened
      ? {
          fileName: opened.fileName,
          fileHash: opened.fileHash,
          period: opened.period,
          periodFrom: opened.periodFrom,
          periodTo: opened.periodTo,
          reportGeneratedAt: opened.reportGeneratedAt,
          uploadedAt: opened.uploadedAt,
          periodNeedsReview: opened.periodNeedsReview,
          lines: opened.lines ?? [],
          existingId: opened.id,
          selectedSheet: opened.sheetName,
          headerRow: opened.headerRow,
        }
      : null);
    if (!source || !plan) return;
    if (mode === "stock" && plan.blockers.length && !plan.resumePartial) {
      setError(t(`admin.pos.block.${plan.blockers[0]}`));
      return;
    }
    if (mode === "sales" && (plan.blockers.includes("period-review") || plan.blockers.includes("empty"))) {
      setError(t(`admin.pos.block.${plan.blockers.find((item) => item === "period-review" || item === "empty")}`));
      return;
    }
    saveLock.current = true;
    setError(null);
    setApplyResult(null);
    setStage(mode === "stock" ? "applying" : "saving");
    const payload: Omit<PosImport, "id" | "createdAt"> & { id?: string } = {
      kind: "excel-info",
      fileName: source.fileName,
      fileHash: source.fileHash,
      source: "pos-file",
      period: current.period,
      periodFrom: current.periodFrom,
      periodTo: current.periodTo,
      sourcePeriodFrom: current.sourcePeriodFrom ?? current.periodFrom,
      sourcePeriodTo: current.sourcePeriodTo ?? current.periodTo,
      reportGeneratedAt: source.reportGeneratedAt,
      uploadedAt: source.uploadedAt,
      periodNeedsReview: current.periodNeedsReview,
      periodConfirmed,
      status: "saved",
      financeStatus: "none",
      infoOnly: true,
      lines: current.lines,
      itemCount: plan.selectedItemCount,
      quantitySum: plan.selectedQuantitySum,
      reportedRevenueSum: plan.selectedRevenueSum,
      sheetName: source.selectedSheet,
      headerRow: source.headerRow,
      id: source.existingId,
      excludedKeys,
      sourceTotals: current.sourceTotals ?? null,
    };
    try {
      const saved = await savePosDraft(payload);
      if (saved.success) setSavedImportId(saved.data);
      if (!saved.success) {
        setError(saved.error);
        setStage("summary");
        return;
      }
      if (mode === "sales") {
        props.onToast(t("admin.insight.saveSales"));
        setStage("summary");
        return;
      }
      const applied = await applyPosExcelImport({
        draft: { ...payload, id: saved.data, createdAt: source.uploadedAt || new Date().toISOString() },
        rows: plan.rows,
        periodConfirmed,
        overlapAcknowledged,
      });
      if (!applied.success) {
        const code = applied.error;
        setError(
          code === "period-review" || code === "empty-import" || code === "already-applied"
            ? t(`admin.pos.block.${code === "empty-import" ? "empty" : code}`)
            : code
        );
        setStage("summary");
        return;
      }
      if (!applied.data.complete) {
        setError(t("admin.pos.applyIncomplete"));
        setApplyResult(t("admin.pos.applyIncomplete"));
        setStage("summary");
        return;
      }
      setApplyResult(t("admin.pos.applyDone"));
      props.onToast(t("admin.pos.applyDone"));
      setStage("applied");
    } catch {
      setError(t("admin.pos.networkFailed"));
      setStage("summary");
    } finally {
      saveLock.current = false;
    }
  }
}


function ProcessSteps({ stage, saved, hasPreview }: { stage: Stage; saved: boolean; hasPreview: boolean }) {
  const t = useT();
  const steps: { id: Stage; label: string; on: boolean }[] = [
    { id: "selected", label: t("admin.pos.stepSelected"), on: stage !== "idle" },
    { id: "reading", label: t("admin.pos.stepReading"), on: stage === "reading" || hasPreview || saved },
    { id: "ready", label: t("admin.pos.stepReady"), on: (hasPreview && stage !== "reading") || saved },
    { id: "summary", label: t("admin.pos.stepSummary"), on: stage === "summary" || stage === "applying" || saved },
    { id: "applying", label: t("admin.pos.stepApplying"), on: stage === "applying" || saved },
    { id: "applied", label: t("admin.pos.stepApplied"), on: saved },
  ];
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {steps.map((step) => (
        <li key={step.id} className={`rounded-full px-2 py-1 ${step.on ? "bg-turquoise/15 text-coffee" : "bg-beige/40 text-coffee/45"}`}>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function ColumnMapEditor({
  review,
  sheetName,
  headerRow,
  columnMap,
  file,
  busy,
  onSheet,
  onHeader,
  onMap,
  onApply,
  onSaveMap,
}: {
  review: Review;
  sheetName: string;
  headerRow: string;
  columnMap: PosColumnMap;
  file: File | null;
  busy: boolean;
  onSheet: (value: string) => void;
  onHeader: (value: string) => void;
  onMap: (value: PosColumnMap | ((current: PosColumnMap) => PosColumnMap)) => void;
  onApply: () => void;
  onSaveMap: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-beige-dark/20 p-3">
      <p className="font-medium">{t("admin.pos.columnMap")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-coffee/60">{t("admin.pos.sheet")}</span>
          <select className="h-10 w-full rounded-lg border px-2" value={sheetName} onChange={(e) => onSheet(e.target.value)}>
            {(review.sheets ?? []).map((sheet) => (
              <option key={sheet.name} value={sheet.name}>
                {sheet.name} ({sheet.rowCount})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-coffee/60">{t("admin.pos.headerRow")}</span>
          <input className="h-10 w-full rounded-lg border px-2" value={headerRow} onChange={(e) => onHeader(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      <div className="overflow-x-auto text-xs">
        <table className="min-w-full">
          <tbody>
            {(review.rawPreview ?? []).map((row, index) => (
              <tr key={`raw-${index}`}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="whitespace-pre-wrap border border-beige-dark/15 px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {POS_EXCEL_FIELDS.map((field) => (
          <label key={field} className="text-sm">
            <span className="mb-1 block text-coffee/60">{t(`admin.pos.field.${field}`)}</span>
            <select
              className="h-10 w-full rounded-lg border px-2"
              value={columnMap[field] ?? ""}
              onChange={(e) =>
                onMap((currentMap) => ({
                  ...currentMap,
                  [field]: e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            >
              <option value="">{t("admin.pos.skipColumn")}</option>
              {(review.rawHeaders?.length ? review.rawHeaders : review.rawPreview?.[0] ?? []).map((header, index) => (
                <option key={`${field}-${index}`} value={index}>
                  {index + 1}. {header || t("admin.pos.emptyCell")}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!file || busy} onClick={onApply}>
          {t("admin.pos.applyMap")}
        </Button>
        <Button type="button" variant="outline" disabled={!review.rawHeaders?.length || busy} onClick={onSaveMap}>
          {t("admin.pos.saveMap")}
        </Button>
      </div>
    </div>
  );
}

function PriceConfirm({
  line,
  currentPrice,
  onClose,
  onToast,
}: {
  line: PosSaleLine;
  currentPrice?: number;
  onClose: () => void;
  onToast: InventoryHubProps["onToast"];
}) {
  const t = useT();
  const authFetch = useAuthFetch();
  const preview = posPriceUpdatePreview(currentPrice, line.unitPrice);
  return (
    <AdminCard title={t("admin.pos.updatePrice")}>
      <p className="text-sm">{t("admin.pos.averageNotList")}</p>
      <p className="mt-2 text-sm">
        {t("admin.pos.currentPrice")}: {preview.currentPrice == null ? "—" : formatIls(preview.currentPrice)}
      </p>
      <p className="text-sm">
        {t("admin.pos.newPrice")}: {preview.proposedAverage == null ? "—" : formatIls(preview.proposedAverage)}
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="turquoise"
          onClick={async () => {
            const response = await authFetch("/api/admin/pos/price", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productId: line.menuProductId,
                currentPrice: preview.currentPrice,
                newPrice: preview.proposedAverage,
                confirmAverage: true,
              }),
            });
            const json = await response.json();
            if (!response.ok || !json.ok) {
              onToast(t("admin.pos.priceFailed"), "error");
              return;
            }
            onToast(t("admin.pos.priceUpdated"));
            onClose();
          }}
        >
          {t("admin.pos.confirmPrice")}
        </Button>
      </div>
    </AdminCard>
  );
}
