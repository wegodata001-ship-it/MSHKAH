"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, ScanSearch, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { InvoiceSourcePreview } from "@/features/admin/inventory/invoice-source-preview";
import { formatIls } from "@/lib/costing/money";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { readJsonSafe } from "@/lib/http/read-json-safe";
import {
  canPostZReport,
  overlapRequiresAck,
  overlapReviewRequired,
  periodNeedsConfirm,
  refreshZDerived,
  zAmountToPost,
} from "@/lib/inventory/pos-z";
import type { PosZPayment, PosZReport } from "@/lib/inventory/types";
import { saveZDraft } from "@/services/inventoryService";
import type { InventoryHubProps } from "@/features/admin/inventory/inventory-hub";

function moneyText(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function parseMoney(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/[,\s₪]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function mergeReports(remote: PosZReport[], local: PosZReport[]): PosZReport[] {
  const byId = new Map<string, PosZReport>();
  for (const item of remote) byId.set(item.id, item);
  for (const item of local) {
    const current = byId.get(item.id);
    if (!current || (item.updatedAt && (!current.updatedAt || item.updatedAt >= current.updatedAt))) {
      byId.set(item.id, { ...current, ...item });
    }
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
}

export function PosZPanel(props: InventoryHubProps) {
  const t = useT();
  const authFetch = useAuthFetch();
  const [local, setLocal] = useState<PosZReport[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overlapAck, setOverlapAck] = useState(false);
  const [periodOverlapAck, setPeriodOverlapAck] = useState(false);
  const [busy, setBusy] = useState<"upload" | "scan" | "save" | "post" | null>(null);
  const [overlapReviewAck, setOverlapReviewAck] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const uploadLock = useRef(false);
  const scanLock = useRef<string | null>(null);
  const drafts = useMemo(() => mergeReports(props.zReports, local), [props.zReports, local]);
  const active = drafts.find((item) => item.id === activeId) ?? drafts[0] ?? null;
  const postCheck = active
    ? canPostZReport(active, { overlapReviewAcknowledged: overlapReviewAck })
    : { ok: false as const, reason: "empty-extract" as const };

  function upsert(report: PosZReport) {
    setLocal((current) => {
      const next = current.filter((item) => item.id !== report.id);
      next.unshift(report);
      return next;
    });
    setActiveId(report.id);
  }

  async function upload(files: File[], attachToId?: string) {
    if (uploadLock.current || busy) return;
    uploadLock.current = true;
    setBusy("upload");
    setScreenError(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("file", file));
      if (attachToId) form.set("attachToId", attachToId);
      const response = await authFetch("/api/admin/pos/z/upload", { method: "POST", body: form });
      const json = await readJsonSafe(response);
      if (json.duplicate) {
        props.onToast(t("admin.pos.zExists"), "error");
        if (json.existingId) setActiveId(String(json.existingId));
        return;
      }
      if (!response.ok || !json.ok) {
        const message = String(json.message || t("admin.pos.zUploadFailed"));
        setScreenError(message);
        props.onToast(message, "error");
        return;
      }
      const next = (json.reports as PosZReport[]) ?? [];
      next.forEach(upsert);
      setOverlapAck(false);
      setPeriodOverlapAck(false);
      setOverlapReviewAck(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("admin.pos.zUploadFailed");
      setScreenError(message);
      props.onToast(message, "error");
    } finally {
      uploadLock.current = false;
      setBusy(null);
    }
  }

  async function scan(report: PosZReport, options?: { recheckOverlap?: boolean; forceAi?: boolean }) {
    if (busy || scanLock.current === report.id) return;
    scanLock.current = report.id;
    setBusy("scan");
    setScreenError(null);
    upsert({ ...report, scanStatus: "scanning", lastScanError: null, updatedAt: new Date().toISOString() });
    try {
      const response = await authFetch("/api/admin/pos/z/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: report.id,
          recheckOverlap: options?.recheckOverlap === true,
          forceAi: options?.forceAi === true,
        }),
      });
      const json = await readJsonSafe(response);
      const scanned = (json.report ?? (Array.isArray(json.reports) ? json.reports[0] : undefined)) as PosZReport | undefined;
      if (scanned) upsert(refreshZDerived(scanned));
      if (!response.ok || !json.ok) {
        const message =
          String(json.message || "") ||
          (json.error === "empty-extract"
            ? t("admin.pos.scanEmpty")
            : json.error === "empty-response" || json.error === "invalid-json"
              ? t("admin.pos.scanBadResponse")
              : t("admin.pos.scanErrorKeepDraft"));
        setScreenError(message);
        if (!scanned) upsert({ ...report, scanStatus: "failed", lastScanError: message, updatedAt: new Date().toISOString() });
        props.onToast(message, "error");
        return;
      }
      setOverlapAck(false);
      setPeriodOverlapAck(false);
      setOverlapReviewAck(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("admin.pos.scanErrorKeepDraft");
      setScreenError(message);
      upsert({ ...report, scanStatus: "failed", lastScanError: message, updatedAt: new Date().toISOString() });
      props.onToast(message, "error");
    } finally {
      scanLock.current = null;
      setBusy(null);
    }
  }

  function patch(update: Partial<PosZReport>) {
    if (!active) return;
    upsert(refreshZDerived({ ...active, ...update, updatedAt: new Date().toISOString() }));
  }

  const scanning = busy === "scan" || active?.scanStatus === "scanning";
  const uploadedOnly = active && (active.scanStatus === "uploaded" || (!active.scanStatus && !active.salesTotal && !active.payments?.length));

  return (
    <div className="space-y-4">
      <label className={`flex flex-col items-center rounded-3xl border border-dashed border-coffee/25 px-6 py-10 ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
        <Upload className="h-8 w-8" />
        <p className="mt-3 font-semibold">{t("admin.pos.zUpload")}</p>
        <p className="text-sm text-coffee/55">JPG / PNG / PDF</p>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          multiple
          className="hidden"
          disabled={Boolean(busy)}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void upload(files);
          }}
        />
      </label>

      {drafts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {drafts.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm ${item.id === active?.id ? "bg-coffee text-white" : "bg-beige/50"}`}
              onClick={() => setActiveId(item.id)}
            >
              {item.reportNumber || item.businessName || item.id.slice(0, 6)} ·{" "}
              {item.status === "posted" ? t("admin.pos.zPosted") : t("admin.pos.zDraft")}
            </button>
          ))}
        </div>
      )}

      {active && (
        <AdminCard title={t("admin.pos.zReview")}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,13rem)_1fr]">
            <div className="space-y-2">
              {(active.sourceFiles ?? []).map((source) => (
                <InvoiceSourcePreview key={source.storagePath} source={source} />
              ))}
              <label className={`block text-sm text-turquoise ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
                {t("admin.pos.addImage")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="hidden"
                  disabled={Boolean(busy)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload([file], active.id);
                  }}
                />
              </label>
            </div>

            <div className="space-y-4">
              {uploadedOnly && !scanning && (
                <p className="rounded-2xl bg-beige/40 px-3 py-2 text-sm">{t("admin.pos.uploadedReady")}</p>
              )}
              {scanning && (
                <p className="flex items-center gap-2 rounded-2xl bg-turquoise/10 px-3 py-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("admin.pos.scanningProgress")}
                </p>
              )}
              {(screenError || active.lastScanError) && !scanning && (
                <p className="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-800">{screenError || active.lastScanError}</p>
              )}
              {active.scanStatus === "partial" && (
                <p className="rounded-2xl bg-amber-50 px-3 py-2 text-sm">{t("admin.pos.scanPartial")}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="turquoise"
                  disabled={Boolean(busy) || !active.sourceFiles?.length}
                  onClick={() =>
                    void scan(active, {
                      forceAi: Boolean(active.fields?.length || active.payments?.length || active.salesTotal != null),
                    })
                  }
                >
                  <ScanSearch className="ms-1 h-4 w-4" />
                  {active.fields?.length || active.payments?.length ? t("admin.pos.rescanAi") : t("admin.pos.startAiScan")}
                </Button>
                {(screenError || active.scanStatus === "failed") && (
                  <Button type="button" variant="outline" disabled={Boolean(busy) || !active.sourceFiles?.length} onClick={() => void scan(active)}>
                    {t("admin.pos.retryScan")}
                  </Button>
                )}
                {overlapReviewRequired(active.websiteOverlap) && (active.fields?.length || active.payments?.length || active.salesTotal != null) && (
                  <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void scan(active, { recheckOverlap: true })}>
                    {t("admin.pos.recheckOverlap")}
                  </Button>
                )}
              </div>

              {(active.fields?.length || active.payments?.length || active.salesTotal != null) && (
                <ExtractedEditor report={active} onPatch={patch} t={t} />
              )}
            </div>
          </div>

          {overlapReviewRequired(active.websiteOverlap) && (
            <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm">
              <p className="font-semibold">{t("admin.pos.overlapIncomplete")}</p>
              <p className="mt-1">{t("admin.pos.overlapIncompleteDetail")}</p>
              {(active.websiteOverlap?.invalidOrderCount ?? 0) > 0 && (
                <p className="mt-1 text-xs text-coffee/70">
                  {active.websiteOverlap?.invalidOrderCount} · {(active.websiteOverlap?.invalidOrderIds ?? []).join(", ")}
                </p>
              )}
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" checked={overlapReviewAck} onChange={(e) => setOverlapReviewAck(e.target.checked)} />
                <span>{t("admin.pos.overlapIncompleteAck")}</span>
              </label>
            </div>
          )}
          {overlapRequiresAck(active.websiteOverlap) && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={overlapAck} onChange={(e) => setOverlapAck(e.target.checked)} />
              <span>
                {t("admin.pos.websiteOverlap")} ({active.websiteOverlap?.orderCount} · {formatIls(active.websiteOverlap?.amount ?? 0)})
              </span>
            </label>
          )}
          {(active.periodOverlapIds?.length ?? 0) > 0 && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={periodOverlapAck} onChange={(e) => setPeriodOverlapAck(e.target.checked)} />
              <span>{t("admin.pos.periodOverlap")}</span>
            </label>
          )}

          <p className="mt-3 text-xs text-coffee/55">{t("admin.pos.noStockChange")}</p>
          <p className="text-xs text-coffee/55">{t("admin.pos.oneIncome")}</p>
          <p className="text-xs text-coffee/55">{t("admin.pos.creditSummaryNotTender")}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={async () => {
                setBusy("save");
                setScreenError(null);
                try {
                  const saved = await saveZDraft({ ...active, status: "draft" });
                  if (!saved.success) {
                    setScreenError(saved.error);
                    props.onToast(saved.error, "error");
                  } else {
                    props.onToast(t("admin.pos.draftSaved"));
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : t("admin.pos.postFailed");
                  setScreenError(message);
                  props.onToast(message, "error");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("admin.pos.saveDraft")}
            </Button>
            <Button
              type="button"
              variant="turquoise"
              disabled={Boolean(busy) || !postCheck.ok}
              onClick={async () => {
                const amount = zAmountToPost(active);
                const previewOk = window.confirm(
                  `${t("admin.pos.confirmPost")}\n${active.periodFrom || active.businessDate || "—"} – ${active.periodTo || "—"}\n${amount == null ? "—" : formatIls(amount)}`
                );
                if (!previewOk) return;
                setBusy("post");
                setScreenError(null);
                try {
                  const response = await authFetch("/api/admin/pos/z/approve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      reportId: active.id,
                      report: active,
                      overlapAcknowledged: overlapAck,
                      periodOverlapAcknowledged: periodOverlapAck,
                      overlapReviewAcknowledged: overlapReviewAck,
                    }),
                  });
                  const json = await readJsonSafe(response);
                  if (!response.ok || !json.ok) {
                    const message =
                      json.error === "already-posted"
                        ? t("admin.pos.alreadyPosted")
                        : json.error === "website-overlap"
                          ? t("admin.pos.websiteOverlap")
                          : json.error === "period-overlap"
                            ? t("admin.pos.periodOverlap")
                            : json.error === "overlap-incomplete"
                              ? t("admin.pos.overlapIncomplete")
                              : json.error === "duplicate"
                                ? t("admin.pos.zExists")
                                : json.error === "period-unconfirmed"
                                  ? t("admin.pos.confirmPeriod")
                                  : String(json.message || t("admin.pos.postFailed"));
                    setScreenError(message);
                    props.onToast(message, "error");
                    return;
                  }
                  props.onToast(t("admin.pos.zPostedOk"));
                  upsert({
                    ...active,
                    status: "posted",
                    financeEntryId: typeof json.financeEntryId === "string" ? json.financeEntryId : active.financeEntryId,
                    updatedAt: new Date().toISOString(),
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : t("admin.pos.postFailed");
                  setScreenError(message);
                  props.onToast(message, "error");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("admin.pos.approveFinance")}
            </Button>
            {!postCheck.ok && postCheck.reason === "period-unconfirmed" && (
              <span className="self-center text-xs text-coffee/60">{t("admin.pos.confirmPeriod")}</span>
            )}
            {!postCheck.ok && postCheck.reason === "overlap-incomplete" && (
              <span className="self-center text-xs text-coffee/60">{t("admin.pos.overlapIncomplete")}</span>
            )}
          </div>
        </AdminCard>
      )}
    </div>
  );
}

function ExtractedEditor({
  report,
  onPatch,
  t,
}: {
  report: PosZReport;
  onPatch: (update: Partial<PosZReport>) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t("admin.pos.businessName")} value={report.businessName ?? ""} onChange={(value) => onPatch({ businessName: value || null })} />
        <Field label={t("admin.pos.reportType")} value={report.reportType ?? ""} onChange={(value) => onPatch({ reportType: value || null })} />
        <Field label={t("admin.pos.reportNumber")} value={report.reportNumber ?? ""} onChange={(value) => onPatch({ reportNumber: value || null })} />
        <Field label={t("admin.pos.register")} value={report.registerId ?? ""} onChange={(value) => onPatch({ registerId: value || null })} />
        <Field label={t("admin.pos.cashier")} value={report.cashier ?? ""} onChange={(value) => onPatch({ cashier: value || null })} />
        <Field label={t("admin.pos.branch")} value={report.branch ?? ""} onChange={(value) => onPatch({ branch: value || null })} />
        <Field label={t("admin.pos.periodFrom")} value={report.periodFrom ?? ""} onChange={(value) => onPatch({ periodFrom: value || null })} />
        <Field label={t("admin.pos.periodTo")} value={report.periodTo ?? ""} onChange={(value) => onPatch({ periodTo: value || null })} />
        <Field label={t("admin.pos.printedAt")} value={report.printedAt ?? ""} onChange={(value) => onPatch({ printedAt: value || null })} />
        <Field label={t("admin.pos.businessDate")} value={report.businessDate ?? ""} onChange={(value) => onPatch({ businessDate: value || null })} />
      </div>

      {periodNeedsConfirm(report) && (
        <label className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-sm">
          <input type="checkbox" checked={report.periodConfirmed === true} onChange={(e) => onPatch({ periodConfirmed: e.target.checked })} />
          <span>{t("admin.pos.confirmPeriod")}</span>
        </label>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold">{t("admin.pos.extractedTable")}</p>
        <div className="overflow-x-auto rounded-2xl border border-beige-dark/15">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-beige/40 text-right">
              <tr>
                <th className="px-3 py-2 font-medium">{t("admin.pos.sourceLabel")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.pos.detectedValue")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.pos.txnCount")}</th>
              </tr>
            </thead>
            <tbody>
              {(report.payments ?? []).map((payment, index) => (
                <tr key={`p-${index}`} className="border-t border-beige-dark/10">
                  <td className="px-3 py-1.5">
                    <Input
                      value={payment.sourceLabel || payment.method}
                      onChange={(e) =>
                        onPatch({
                          payments: replacePayment(report.payments, index, {
                            ...payment,
                            method: e.target.value,
                            sourceLabel: e.target.value,
                          }),
                        })
                      }
                    />
                    {payment.amount == null && <p className="mt-1 text-xs text-amber-700">{t("admin.pos.needsReview")}</p>}
                    {payment.role === "tender-summary" && <p className="mt-1 text-xs text-coffee/50">{t("admin.pos.paymentRoleSummary")}</p>}
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      value={moneyText(payment.amount)}
                      inputMode="decimal"
                      placeholder={t("admin.pos.missingValue")}
                      onChange={(e) =>
                        onPatch({
                          payments: replacePayment(report.payments, index, { ...payment, amount: parseMoney(e.target.value) }),
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      value={moneyText(payment.count)}
                      inputMode="numeric"
                      placeholder={t("admin.pos.missingValue")}
                      onChange={(e) =>
                        onPatch({
                          payments: replacePayment(report.payments, index, { ...payment, count: parseMoney(e.target.value) }),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
              <MoneyRow label={t("admin.pos.salesBeforeVat")} value={report.salesBeforeVat} onChange={(value) => onPatch({ salesBeforeVat: value })} missing={t("admin.pos.missingValue")} />
              <MoneyRow label={t("admin.pos.vatTotal")} value={report.vatTotal} onChange={(value) => onPatch({ vatTotal: value })} missing={t("admin.pos.missingValue")} />
              <MoneyRow
                label={t("admin.pos.salesIncludingVat")}
                value={report.salesIncludingVat ?? report.salesTotal}
                onChange={(value) => onPatch({ salesIncludingVat: value, salesTotal: value })}
                missing={t("admin.pos.missingValue")}
              />
              <MoneyRow
                label={t("admin.pos.receiptsTotal")}
                value={report.receiptsTotal}
                onChange={(value) => onPatch({ receiptsTotal: value })}
                count={report.receiptsCount}
                onCount={(value) => onPatch({ receiptsCount: value })}
                missing={t("admin.pos.missingValue")}
              />
              <MoneyRow label={t("admin.pos.returnsTotal")} value={report.returnsTotal} onChange={(value) => onPatch({ returnsTotal: value })} missing={t("admin.pos.missingValue")} />
              <MoneyRow label={t("admin.pos.discountsTotal")} value={report.discountsTotal} onChange={(value) => onPatch({ discountsTotal: value })} missing={t("admin.pos.missingValue")} />
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold">{t("admin.pos.extrasTitle")}</p>
        <p className="mb-2 text-xs text-coffee/55">{t("admin.pos.extrasHint")}</p>
        <div className="space-y-2">
          {(report.extraAmounts ?? []).map((extra, index) => (
            <div key={`${extra.sourceLabel}-${index}`} className="grid grid-cols-2 gap-2">
              <Input
                value={extra.sourceLabel}
                onChange={(e) =>
                  onPatch({
                    extraAmounts: (report.extraAmounts ?? []).map((item, i) => (i === index ? { ...item, sourceLabel: e.target.value } : item)),
                  })
                }
              />
              <Input
                value={moneyText(extra.amount)}
                inputMode="decimal"
                placeholder={t("admin.pos.missingValue")}
                onChange={(e) =>
                  onPatch({
                    extraAmounts: (report.extraAmounts ?? []).map((item, i) => (i === index ? { ...item, amount: parseMoney(e.target.value) } : item)),
                  })
                }
              />
            </div>
          ))}
          {!report.extraAmounts?.length && <p className="text-sm text-coffee/45">—</p>}
        </div>
      </div>

      {(report.checks ?? []).length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">{t("admin.pos.checksTitle")}</p>
          <ul className="space-y-1 text-sm">
            {report.checks!.map((check) => (
              <li key={check.id} className={check.ok ? "text-emerald-800" : "text-amber-800"}>
                {check.ok ? t("admin.pos.checkOk") : t("admin.pos.checkGap")} · {check.label}
                {check.gap != null ? ` (${check.gap})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-coffee/55">{t("admin.pos.cashNotCount")}</p>
    </div>
  );
}

function replacePayment(list: PosZPayment[] | undefined, index: number, next: PosZPayment): PosZPayment[] {
  const copy = [...(list ?? [])];
  copy[index] = next;
  return copy;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-coffee/60">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" />
    </label>
  );
}

function MoneyRow({
  label,
  value,
  onChange,
  count,
  onCount,
  missing,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  count?: number | null;
  onCount?: (value: number | null) => void;
  missing: string;
}) {
  return (
    <tr className="border-t border-beige-dark/10">
      <td className="px-3 py-1.5">{label}</td>
      <td className="px-3 py-1.5">
        <Input value={moneyText(value)} inputMode="decimal" placeholder={missing} onChange={(e) => onChange(parseMoney(e.target.value))} />
        {value == null && <p className="mt-1 text-xs text-amber-700">{missing}</p>}
      </td>
      <td className="px-3 py-1.5">
        {onCount ? (
          <Input value={moneyText(count)} inputMode="numeric" placeholder={missing} onChange={(e) => onCount(parseMoney(e.target.value))} />
        ) : null}
      </td>
    </tr>
  );
}
