"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { adminKpiCard, adminTableHeader, adminTableRow } from "@/features/admin/components/admin-styles";
import { formatIls } from "@/lib/costing/money";
import { purchaseInvoicesForCashFlow } from "@/lib/inventory/supplier-ledger";
import type { PosZReport, PurchaseInvoice } from "@/lib/inventory/types";
import {
  buildCashFlow,
  cashPosition,
  checksDueSoon,
  dailyForecast,
  type CashFlowEntry,
  type CashFlowLine,
  type CashFlowStatus,
  type CashZPayment,
} from "@/lib/cashflow/engine";
import type { BreakEvenFixedCost } from "@/lib/breakeven/types";
import { subscribeToBreakEvenFixedCosts } from "@/services/breakevenService";
import {
  entryStamp,
  saveCashFlowEntry,
  saveCashOpening,
  subscribeCashFlowEntries,
  subscribeCashOpening,
  type CashOpening,
} from "@/services/cashflowService";

type Editor = {
  lineId: string;
  mode: "edit" | "pay" | "receive" | "link" | "scope";
  date: string;
  amount: string;
  invoiceId: string;
  description: string;
  direction: "in" | "out";
  location: "cash" | "card" | "bank";
};

function localIso(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, rawMonth] = month.split("-").map(Number);
  const last = new Date(year, rawMonth, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}` };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function zCashPayments(reports: PosZReport[]): CashZPayment[] {
  return reports.flatMap((report) => {
    const payments = (report.payments ?? []).filter((payment) => payment.amount != null && payment.amount > 0);
    const tenders = payments.filter((payment) => payment.role === "tender");
    const chosen = tenders.length ? tenders : payments.filter((payment) => payment.role !== "tender-summary");
    return chosen.map((payment) => ({
      reportId: report.id,
      businessDate: report.businessDate,
      method: payment.method,
      amount: payment.amount ?? 0,
    }));
  });
}

export function CashFlowPanel({
  invoices,
  zReports,
  vatRate,
  onToast,
}: {
  invoices: PurchaseInvoice[];
  zReports: PosZReport[];
  vatRate: number;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const initial = monthBounds(monthKey());
  const [fixed, setFixed] = useState<BreakEvenFixedCost[]>([]);
  const [entries, setEntries] = useState<CashFlowEntry[]>([]);
  const [opening, setOpening] = useState<CashOpening | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [month, setMonth] = useState(monthKey());
  const [rangeStart, setRangeStart] = useState(initial.start);
  const [rangeEnd, setRangeEnd] = useState(initial.end);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(localIso());
  const [openingEditing, setOpeningEditing] = useState(false);
  const [openingSaving, setOpeningSaving] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [openingStatus, setOpeningStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<"overview" | "moves" | "invoices" | "checks" | "z" | "forecast">("overview");
  const [forecast, setForecast] = useState({ description: "", amount: "", date: localIso(), direction: "out" as "in" | "out" });
  const [checkDraft, setCheckDraft] = useState({ number: "", party: "", amount: "", due: localIso(), direction: "out" as "in" | "out", bank: "" });
  const [transfer, setTransfer] = useState({ description: "", amount: "", date: localIso() });
  const [settlementDrafts, setSettlementDrafts] = useState<Record<string, { date: string; location: "cash" | "card" | "bank" }>>({});

  useEffect(() => subscribeToBreakEvenFixedCosts(setFixed), []);
  useEffect(
    () =>
      subscribeCashFlowEntries(
        (items) => {
          setEntries(items);
          setLoadError(null);
        },
        (message) => setLoadError(message)
      ),
    [retryToken]
  );
  useEffect(
    () =>
      subscribeCashOpening(
        (value) => {
          setOpening(value);
          setLoadError(null);
        },
        (message) => {
          setLoadError(message);
          setOpening((current) => (current === undefined ? null : current));
        }
      ),
    [retryToken]
  );

  useEffect(() => {
    if (opening && !openingEditing) {
      setOpeningAmount(String(opening.amount));
      setOpeningDate(opening.date);
    }
  }, [opening, openingEditing]);

  const flow = useMemo(
    () =>
      buildCashFlow({
        fixed,
        invoices: purchaseInvoicesForCashFlow(invoices),
        entries,
        zPayments: zCashPayments(zReports),
        opening: opening ?? null,
        rangeStart,
        rangeEnd,
        today: localIso(),
        vatRate,
      }),
    [entries, fixed, invoices, opening, rangeEnd, rangeStart, vatRate, zReports]
  );
  const position = useMemo(() => cashPosition(flow), [flow]);
  const days = useMemo(() => dailyForecast(flow, rangeStart, rangeEnd).filter((day) => day.expectedIn || day.expectedOut || day.date === localIso()), [flow, rangeEnd, rangeStart]);
  const soonChecks = checksDueSoon(flow.lines, localIso());

  async function persist(action: () => Promise<{ success: boolean; error?: string }>) {
    setSaving(true);
    setError(null);
    const result = await action();
    setSaving(false);
    if (!result.success) {
      setError(result.error || t("admin.cashflow.saveFailed"));
      return false;
    }
    onToast(t("admin.cashflow.saved"));
    return true;
  }

  async function saveOpeningBalance() {
    const trimmed = openingAmount.trim();
    if (!trimmed) {
      setOpeningError(t("admin.cashflow.openingAmountRequired"));
      return;
    }
    if (!openingDate) {
      setOpeningError(t("admin.cashflow.openingDateRequired"));
      return;
    }
    const amount = Number(trimmed);
    if (!Number.isFinite(amount)) {
      setOpeningError(t("admin.cashflow.openingAmountInvalid"));
      return;
    }
    setOpeningError(null);
    setOpeningSaving(true);
    setOpeningStatus("saving");
    const result = await saveCashOpening({ amount, date: openingDate });
    setOpeningSaving(false);
    if (!result.success) {
      setOpeningStatus("idle");
      setOpeningError(result.error || t("admin.cashflow.saveFailed"));
      return;
    }
    setOpeningStatus("saved");
    setOpeningEditing(false);
    onToast(t("admin.cashflow.openingSaved"));
  }

  async function addForecast() {
    const amount = Number(forecast.amount);
    if (!forecast.description.trim() || !Number.isFinite(amount) || amount <= 0 || !forecast.date) return;
    const ok = await persist(() =>
      saveCashFlowEntry({
        id: "",
        kind: "forecast",
        direction: forecast.direction,
        amount,
        date: forecast.date,
        description: forecast.description.trim(),
        status: "expected",
        history: [{ at: entryStamp(), change: "forecast" }],
      })
    );
    if (ok) setForecast({ description: "", amount: "", date: localIso(), direction: "out" });
  }

  async function addCheck() {
    const amount = Number(checkDraft.amount);
    if (!checkDraft.number.trim() || !Number.isFinite(amount) || amount <= 0 || !checkDraft.due) return;
    const sourceKey = `check:${checkDraft.direction}:${checkDraft.number.trim()}:${checkDraft.due}`;
    if (entries.some((entry) => entry.sourceKey === sourceKey && entry.status !== "cancelled")) {
      setError(t("admin.cashflow.duplicate"));
      return;
    }
    const ok = await persist(() =>
      saveCashFlowEntry({
        id: "",
        kind: "check",
        direction: checkDraft.direction,
        amount,
        date: checkDraft.due,
        description: checkDraft.number.trim(),
        counterparty: checkDraft.party.trim(),
        bankName: checkDraft.bank.trim(),
        checkNumber: checkDraft.number.trim(),
        checkState: "future",
        sourceKey,
        status: "expected",
        history: [{ at: entryStamp(), change: "check" }],
      })
    );
    if (ok) setCheckDraft({ number: "", party: "", amount: "", due: localIso(), direction: "out", bank: "" });
  }

  async function markCheck(entryId: string, checkState: "cleared" | "bounced") {
    const current = entries.find((entry) => entry.id === entryId);
    if (!current) return;
    await persist(() =>
      saveCashFlowEntry({
        ...current,
        checkState,
        status: checkState === "cleared" ? "done" : "cancelled",
        clearedDate: checkState === "cleared" ? localIso() : current.clearedDate,
        history: [...(current.history ?? []), { at: entryStamp(), change: checkState }],
      })
    );
  }

  async function addTransfer() {
    const amount = Number(transfer.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !transfer.date) return;
    const ok = await persist(() =>
      saveCashFlowEntry({
        id: "",
        kind: "transfer",
        amount,
        date: transfer.date,
        description: transfer.description.trim() || t("admin.cashflow.transfer"),
        status: "done",
        history: [{ at: entryStamp(), change: "transfer" }],
      })
    );
    if (ok) setTransfer({ description: "", amount: "", date: localIso() });
  }

  async function recordStandalone(direction: "in" | "out") {
    const amount = Number(forecast.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !forecast.date) return;
    const ok = await persist(() =>
      saveCashFlowEntry({
        id: "",
        kind: "settlement",
        direction,
        amount,
        date: forecast.date,
        description: forecast.description.trim(),
        status: "done",
        history: [{ at: entryStamp(), change: direction === "in" ? "receipt" : "payment" }],
      })
    );
    if (ok) setForecast({ description: "", amount: "", date: localIso(), direction: "out" });
  }

  function plannedAmount(line: CashFlowLine): number {
    const paid = entries
      .filter((entry) => entry.kind === "settlement" && entry.appliesToKey === line.occurrenceKey)
      .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    return Math.round(((line.outflow || line.inflow) + paid) * 100) / 100;
  }

  function openEditor(line: CashFlowLine, mode: Editor["mode"]) {
    setEditor({
      lineId: line.id,
      mode,
      date: line.date ?? localIso(),
      amount: String(mode === "edit" ? plannedAmount(line) : line.outflow || line.inflow),
      invoiceId: "",
      description: line.description,
      direction: line.inflow > 0 ? "in" : "out",
      location: "bank",
    });
  }

  async function saveEditor(scope?: "instance" | "future") {
    if (!editor) return;
    const line = flow.lines.find((item) => item.id === editor.lineId);
    const amount = Number(editor.amount);
    if (!line || !Number.isFinite(amount) || amount < 0 || !editor.date) return;
    if (editor.mode === "edit" && line.fixedCostId && line.occurrenceKey && !line.occurrenceKey.endsWith(":once") && !scope) {
      setEditor({ ...editor, mode: "scope" });
      return;
    }
    const history = [{ at: entryStamp(), change: scope ? `override-${scope}` : editor.mode }];
    let entry: CashFlowEntry;
    if (editor.mode === "link") {
      if (!editor.invoiceId || !line.occurrenceKey) return;
      entry = { id: "", kind: "link", fixedCostId: line.fixedCostId, occurrenceKey: line.occurrenceKey, invoiceId: editor.invoiceId, history };
    } else if (editor.mode === "pay" || editor.mode === "receive") {
      entry = {
        id: "",
        kind: "settlement",
        direction: editor.mode === "receive" ? "in" : "out",
        amount,
        date: editor.date,
        description: line.description,
        counterparty: line.counterparty,
        appliesToKey: line.occurrenceKey,
        status: "done",
        history,
      };
    } else if (line.source === "manual" && line.entryId) {
      const current = entries.find((item) => item.id === line.entryId);
      entry = {
        ...(current ?? { id: line.entryId, kind: "forecast" }),
        amount,
        date: editor.date,
        status: "expected",
        history: [...(current?.history ?? []), ...history],
      };
    } else {
      entry = {
        id: "",
        kind: "override",
        scope: scope ?? "instance",
        fixedCostId: line.fixedCostId,
        occurrenceKey: scope === "future" ? undefined : line.occurrenceKey,
        originalDate: line.plannedDate ?? line.date ?? undefined,
        date: editor.date,
        amount,
        status: "expected",
        history,
      };
    }
    const ok = await persist(() => saveCashFlowEntry(entry));
    if (ok) setEditor(null);
  }

  async function saveZSettlement(line: CashFlowLine) {
    const draft = settlementDrafts[line.id];
    if (!draft?.date || !line.zReportId || !line.paymentMethod) {
      setError(t("admin.cashflow.missingSettlement"));
      return;
    }
    const ok = await persist(() =>
      saveCashFlowEntry({
        id: "",
        kind: "settlement",
        direction: "in",
        amount: line.inflow,
        date: draft.date,
        zReportId: line.zReportId,
        paymentMethod: line.paymentMethod,
        moneyLocation: draft.location,
        description: line.description,
        status: "done",
        history: [{ at: entryStamp(), change: "settlement" }],
      })
    );
    if (ok) {
      setSettlementDrafts((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
    }
  }

  const statusLabel: Record<CashFlowStatus, string> = {
    expected: t("admin.cashflow.status.expected"),
    partial: t("admin.cashflow.status.partial"),
    done: t("admin.cashflow.status.done"),
    overdue: t("admin.cashflow.status.overdue"),
    cancelled: t("admin.cashflow.status.cancelled"),
  };

  const visibleLines = flow.lines.filter((line) => {
    if (tab === "invoices") return line.source === "invoice";
    if (tab === "checks") return line.source === "check";
    if (tab === "z") return line.source === "z";
    return true;
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[28px] font-semibold text-dark-brown">{t("admin.cashflow.title")}</h2>
        <p className="mt-1 text-base text-coffee/70">{t("admin.cashflow.lead")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label={t("admin.cashflow.actualBalance")} value={position.actual == null ? "—" : formatIls(position.actual)} />
        <Kpi label={t("admin.cashflow.expectedIn")} value={formatIls(position.expectedIn)} />
        <Kpi label={t("admin.cashflow.expectedOut")} value={formatIls(position.expectedOut)} />
        <Kpi label={t("admin.cashflow.projected")} value={position.projected == null ? "—" : formatIls(position.projected)} />
        <Kpi label={t("admin.cashflow.checksSoon")} value={String(soonChecks.length)} />
        <Kpi label={t("admin.cashflow.overdue")} value={String(flow.lines.filter((line) => line.status === "overdue").length)} />
      </div>
      {position.actual == null && <p className="text-sm text-amber-800">{t("admin.cashflow.needOpening")}</p>}
      {position.projected != null && position.projected < 0 && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{t("admin.cashflow.negative")}</p>
      )}
      {flow.needsSettlement.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("admin.cashflow.zOpen").replace("{count}", String(flow.needsSettlement.length))}</p>
      )}
      <div className="flex gap-2 overflow-x-auto">
        {(["overview", "moves", "invoices", "checks", "z", "forecast"] as const).map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} className={`shrink-0 rounded-full px-3 py-2 text-sm font-semibold ${tab === item ? "bg-turquoise text-warm-white" : "bg-warm-white text-coffee"}`}>
            {t(`admin.cashflow.tab.${item}`)}
          </button>
        ))}
      </div>
      {tab === "forecast" && (
        <div className="space-y-2">
          {days.length === 0 && <p className="text-sm text-coffee/60">{t("admin.cashflow.needOpening")}</p>}
          {days.map((day) => (
            <div key={day.date} className={`grid grid-cols-2 gap-2 rounded-2xl border px-3 py-3 text-sm lg:grid-cols-4 ${day.closing < 0 ? "border-red-300 bg-red-50" : "border-beige-dark/20 bg-warm-white"}`}>
              <p className="font-semibold">{day.date}</p>
              <p>{t("admin.cashflow.dayOpen")}: {formatIls(day.opening)}</p>
              <p className="text-emerald-700">{t("admin.cashflow.expectedIn")}: {formatIls(day.expectedIn)}</p>
              <p className="text-red-700">{t("admin.cashflow.expectedOut")}: {formatIls(day.expectedOut)}</p>
              <p className="font-bold">{t("admin.cashflow.dayClose")}: {formatIls(day.closing)}</p>
            </div>
          ))}
        </div>
      )}
      {tab === "checks" && (
        <AdminCard title={t("admin.cashflow.tab.checks")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder={t("admin.cashflow.checkNumber")} value={checkDraft.number} onChange={(event) => setCheckDraft({ ...checkDraft, number: event.target.value })} />
            <Input placeholder={t("admin.cashflow.party")} value={checkDraft.party} onChange={(event) => setCheckDraft({ ...checkDraft, party: event.target.value })} />
            <Input placeholder={t("admin.cashflow.amount")} value={checkDraft.amount} onChange={(event) => setCheckDraft({ ...checkDraft, amount: event.target.value })} inputMode="decimal" />
            <Input type="date" value={checkDraft.due} onChange={(event) => setCheckDraft({ ...checkDraft, due: event.target.value })} />
            <Input placeholder={t("admin.cashflow.bank")} value={checkDraft.bank} onChange={(event) => setCheckDraft({ ...checkDraft, bank: event.target.value })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant={checkDraft.direction === "out" ? "turquoise" : "outline"} onClick={() => setCheckDraft({ ...checkDraft, direction: "out" })}>{t("admin.cashflow.checkOut")}</Button>
            <Button type="button" variant={checkDraft.direction === "in" ? "turquoise" : "outline"} onClick={() => setCheckDraft({ ...checkDraft, direction: "in" })}>{t("admin.cashflow.checkIn")}</Button>
            <Button type="button" variant="turquoise" className="min-h-11" disabled={saving} onClick={() => void addCheck()}>{t("admin.cashflow.addCheck")}</Button>
          </div>
        </AdminCard>
      )}
      <div className="space-y-2 lg:hidden">
        {visibleLines.map((line) => (
          <article key={line.id} className="rounded-2xl border border-beige-dark/20 bg-warm-white p-3">
            <p className="text-lg font-semibold">{line.counterparty || line.description}</p>
            <p className="text-sm text-coffee/70">{line.description}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{line.outflow ? formatIls(line.outflow) : formatIls(line.inflow)}</p>
            <p className="text-sm">{line.date || "—"} · {statusLabel[line.status]}{line.forecast ? ` · ${t("admin.cashflow.notActual")}` : ""}</p>
            {line.source === "check" && line.entryId && line.forecast && (
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="outline" className="min-h-11" onClick={() => void markCheck(line.entryId!, "cleared")}>{t("admin.cashflow.markCleared")}</Button>
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => void markCheck(line.entryId!, "bounced")}>{t("admin.cashflow.markBounced")}</Button>
              </div>
            )}
          </article>
        ))}
      </div>
      <AdminCard title={t("admin.cashflow.title")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs">
            <span>{t("admin.cashflow.month")}</span>
            <Input
              type="month"
              value={month}
              onChange={(event) => {
                const next = event.target.value;
                setMonth(next);
                const bounds = monthBounds(next);
                setRangeStart(bounds.start);
                setRangeEnd(bounds.end);
              }}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("admin.cashflow.from")}</span>
            <Input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("admin.cashflow.to")}</span>
            <Input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
          </label>
        </div>
        {opening === undefined ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-coffee/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("admin.cashflow.loading")}
          </div>
        ) : (
          <div className="mt-4 space-y-2 rounded-xl border border-beige-dark/40 bg-warm-white p-3">
            {opening != null && !openingEditing ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <p className="text-xs text-coffee/60">{t("admin.cashflow.opening")}</p>
                  <p className="text-lg font-semibold tabular-nums">{formatIls(opening.amount)}</p>
                  <p className="text-xs text-coffee/55">{t("admin.cashflow.openingDate")}: {opening.date}</p>
                </div>
                <Button type="button" variant="outline" onClick={() => { setOpeningEditing(true); setOpeningError(null); setOpeningStatus("idle"); }}>
                  {t("admin.cashflow.editOpening")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {opening == null ? <p className="text-sm text-coffee/80">{t("admin.cashflow.openingMissing")}</p> : null}
                <p className="text-xs text-coffee/60">{t("admin.cashflow.openingHelp")}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="space-y-1 text-xs">
                    <span>{t("admin.cashflow.openingAmount")}</span>
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={openingAmount}
                      onChange={(event) => setOpeningAmount(event.target.value)}
                      aria-label={t("admin.cashflow.openingAmount")}
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span>{t("admin.cashflow.openingDate")}</span>
                    <Input
                      type="date"
                      value={openingDate}
                      onChange={(event) => setOpeningDate(event.target.value)}
                      aria-label={t("admin.cashflow.openingDate")}
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <Button type="button" variant="turquoise" disabled={openingSaving} onClick={saveOpeningBalance}>
                      {openingSaving
                        ? t("admin.cashflow.saving")
                        : openingStatus === "saved"
                          ? t("admin.cashflow.openingSaved")
                          : t("admin.cashflow.saveOpening")}
                    </Button>
                    {opening != null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={openingSaving}
                        onClick={() => {
                          setOpeningEditing(false);
                          setOpeningError(null);
                          setOpeningStatus("idle");
                          setOpeningAmount(String(opening.amount));
                          setOpeningDate(opening.date);
                        }}
                      >
                        {t("admin.cashflow.cancel")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {openingError ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-red-700">
                    <span>{openingError}</span>
                    <Button type="button" variant="outline" size="sm" disabled={openingSaving} onClick={saveOpeningBalance}>
                      {t("admin.cashflow.retry")}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            {opening != null && opening.date > rangeStart ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>{t("admin.cashflow.openingLater").replace("{date}", opening.date).replace("{range}", rangeStart)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRangeStart(opening.date);
                    setMonth(opening.date.slice(0, 7));
                  }}
                >
                  {t("admin.cashflow.alignRangeToOpening")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
        {loadError ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium text-red-700">
            <span>
              {t("admin.cashflow.loadFailed")}: {/permission/i.test(loadError) ? t("admin.cashflow.permissions") : loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setRetryToken((value) => value + 1)}>
              {t("admin.cashflow.retry")}
            </Button>
          </div>
        ) : null}
        {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
      </AdminCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label={t("admin.cashflow.opening")} value={flow.openingSet ? formatIls(flow.opening ?? 0) : "—"} hint={flow.openingDate ?? ""} />
        <Summary label={t("admin.cashflow.receipts")} value={formatIls(flow.inflows)} />
        <Summary label={t("admin.cashflow.payments")} value={formatIls(flow.outflows)} />
        <Summary label={t("admin.cashflow.closing")} value={flow.closing == null ? "—" : formatIls(flow.closing)} negative={flow.closing != null && flow.closing < 0} />
      </div>
      {!flow.openingSet ? (
        <p className="rounded-xl bg-beige/60 px-3 py-2 text-sm text-coffee/80">{t("admin.cashflow.noBalance")}</p>
      ) : null}

      <BalanceChart points={flow.points} actualLabel={t("admin.cashflow.actual")} forecastLabel={t("admin.cashflow.forecast")} />

      <AdminCard title={t("admin.cashflow.addForecast")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Input value={forecast.description} placeholder={t("admin.cashflow.description")} onChange={(event) => setForecast({ ...forecast, description: event.target.value })} />
          <select
            className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm"
            value={forecast.direction}
            onChange={(event) => setForecast({ ...forecast, direction: event.target.value as "in" | "out" })}
          >
            <option value="out">{t("admin.cashflow.out")}</option>
            <option value="in">{t("admin.cashflow.in")}</option>
          </select>
          <Input type="number" value={forecast.amount} placeholder={t("admin.cashflow.amount")} onChange={(event) => setForecast({ ...forecast, amount: event.target.value })} />
          <Input type="date" value={forecast.date} onChange={(event) => setForecast({ ...forecast, date: event.target.value })} />
          <Button type="button" variant="outline" disabled={saving} onClick={addForecast}>
            <Plus className="h-4 w-4" />
            {saving ? t("admin.cashflow.saving") : t("admin.cashflow.addForecast")}
          </Button>
          <Button type="button" variant="turquoise" disabled={saving} onClick={() => recordStandalone("out")}>
            {t("admin.cashflow.recordPayment")}
          </Button>
          <Button type="button" variant="turquoise" disabled={saving} onClick={() => recordStandalone("in")}>
            {t("admin.cashflow.recordReceipt")}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Input value={transfer.description} placeholder={t("admin.cashflow.transfer")} onChange={(event) => setTransfer({ ...transfer, description: event.target.value })} />
          <Input type="number" value={transfer.amount} placeholder={t("admin.cashflow.amount")} onChange={(event) => setTransfer({ ...transfer, amount: event.target.value })} />
          <Input type="date" value={transfer.date} onChange={(event) => setTransfer({ ...transfer, date: event.target.value })} />
          <Button type="button" variant="outline" disabled={saving} onClick={addTransfer}>
            {t("admin.cashflow.transfer")}
          </Button>
        </div>
      </AdminCard>

      {(flow.undated.length > 0 || flow.needsSettlement.length > 0) && (
        <AdminCard title={t("admin.cashflow.undatedTitle")}>
          <ul className="max-h-48 space-y-2 overflow-auto text-sm">
            {flow.undated.map((line) => (
              <li key={line.id} className="rounded-lg bg-amber-50 px-3 py-2">
                {line.description} · {line.missing === "gross" ? t("admin.cashflow.missingGross") : line.missing === "due-date" ? t("admin.cashflow.missingDue") : t("admin.cashflow.missingDate")}
                {line.outflow > 0 ? ` · ${formatIls(line.outflow)}` : ""}
              </li>
            ))}
            {flow.needsSettlement.map((line) => (
              <li key={line.id} className="grid grid-cols-1 gap-2 rounded-lg bg-amber-50 px-3 py-2 sm:grid-cols-5 sm:items-center">
                <span className="sm:col-span-2">
                  {line.description} · {formatIls(line.inflow)} · {t("admin.cashflow.missingSettlement")}
                </span>
                <Input
                  type="date"
                  value={settlementDrafts[line.id]?.date ?? ""}
                  onChange={(event) =>
                    setSettlementDrafts((current) => ({
                      ...current,
                      [line.id]: { date: event.target.value, location: current[line.id]?.location ?? "bank" },
                    }))
                  }
                />
                <select
                  className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm"
                  value={settlementDrafts[line.id]?.location ?? "bank"}
                  onChange={(event) =>
                    setSettlementDrafts((current) => ({
                      ...current,
                      [line.id]: { date: current[line.id]?.date ?? "", location: event.target.value as "cash" | "card" | "bank" },
                    }))
                  }
                >
                  <option value="cash">{t("admin.cashflow.location.cash")}</option>
                  <option value="card">{t("admin.cashflow.location.card")}</option>
                  <option value="bank">{t("admin.cashflow.location.bank")}</option>
                </select>
                <Button type="button" size="sm" variant="turquoise" disabled={saving} onClick={() => saveZSettlement(line)}>
                  {saving ? t("admin.cashflow.saving") : t("admin.cashflow.save")}
                </Button>
              </li>
            ))}
          </ul>
        </AdminCard>
      )}

      <AdminCard title={t("admin.cashflow.title")}>
        <div className="hidden overflow-x-auto lg:block">
          <table className="min-w-full text-sm">
            <thead className={adminTableHeader}>
              <tr className="text-start">
                <th className="p-2">{t("admin.cashflow.date")}</th>
                <th className="p-2">{t("admin.cashflow.description")}</th>
                <th className="p-2">{t("admin.cashflow.party")}</th>
                <th className="p-2">{t("admin.cashflow.in")}</th>
                <th className="p-2">{t("admin.cashflow.out")}</th>
                <th className="p-2">{t("admin.cashflow.status")}</th>
                <th className="p-2">{t("admin.cashflow.balance")}</th>
                <th className="p-2">{t("admin.cashflow.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((line) => (
                <tr key={line.id} className={`${adminTableRow} ${line.forecast ? "bg-amber-50/80" : ""}`}>
                  <td className="p-2">{line.date ?? "—"}</td>
                  <td className="p-2">{line.description}</td>
                  <td className="p-2">{line.counterparty || "—"}</td>
                  <td className="p-2">{line.inflow ? formatIls(line.inflow) : "—"}</td>
                  <td className="p-2">{line.outflow ? formatIls(line.outflow) : "—"}</td>
                  <td className={`p-2 ${line.status === "overdue" ? "font-medium text-red-700" : ""}`}>{statusLabel[line.status]}</td>
                  <td className={`p-2 ${line.balance != null && line.balance < 0 ? "font-medium text-red-700" : ""}`}>
                    {line.balance == null ? "—" : formatIls(line.balance)}
                  </td>
                  <td className="p-2">
                    {line.forecast && (
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => openEditor(line, "edit")}>
                          {t("admin.cashflow.edit")}
                        </Button>
                        {line.outflow > 0 && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => openEditor(line, "pay")}>
                            {t("admin.cashflow.recordPayment")}
                          </Button>
                        )}
                        {line.inflow > 0 && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => openEditor(line, "receive")}>
                            {t("admin.cashflow.recordReceipt")}
                          </Button>
                        )}
                        {line.fixedCostId && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => openEditor(line, "link")}>
                            {t("admin.cashflow.linkInvoice")}
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!flow.lines.length && (
                <tr>
                  <td colSpan={8} className="p-3 text-coffee/60">
                    {t("admin.cashflow.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editor && (
          <div className="mt-3 space-y-2 rounded-xl border border-beige-dark/30 p-3">
            {editor.mode === "scope" ? (
              <>
                <p className="text-sm font-medium">{t("admin.cashflow.scopeQuestion")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="turquoise" disabled={saving} onClick={() => saveEditor("instance")}>
                    {t("admin.cashflow.scopeInstance")}
                  </Button>
                  <Button type="button" variant="outline" disabled={saving} onClick={() => saveEditor("future")}>
                    {t("admin.cashflow.scopeFuture")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditor(null)}>
                    {t("admin.cashflow.cancel")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {editor.mode !== "link" && (
                  <>
                    <Input type="date" value={editor.date} onChange={(event) => setEditor({ ...editor, date: event.target.value })} />
                    <Input type="number" value={editor.amount} onChange={(event) => setEditor({ ...editor, amount: event.target.value })} />
                  </>
                )}
                {editor.mode === "link" && (
                  <select className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm lg:col-span-2" value={editor.invoiceId} onChange={(event) => setEditor({ ...editor, invoiceId: event.target.value })}>
                    <option value="">{t("admin.cashflow.linkInvoice")}</option>
                    {invoices.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.invoiceNumber} · {invoice.supplierName}
                      </option>
                    ))}
                  </select>
                )}
                <Button type="button" variant="turquoise" disabled={saving} onClick={() => saveEditor()}>
                  {saving ? t("admin.cashflow.saving") : t("admin.cashflow.save")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                  {t("admin.cashflow.cancel")}
                </Button>
              </div>
            )}
          </div>
        )}
      </AdminCard>
    </div>
  );
}

function Summary({ label, value, hint, negative }: { label: string; value: string; hint?: string; negative?: boolean }) {
  return (
    <div className={adminKpiCard}>
      <p className="text-xs text-coffee/60">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${negative ? "text-red-700" : ""}`}>{value}</p>
      {hint ? <p className="text-xs text-coffee/50">{hint}</p> : null}
    </div>
  );
}

function BalanceChart({
  points,
  actualLabel,
  forecastLabel,
}: {
  points: { date: string; balance: number; actual: boolean }[];
  actualLabel: string;
  forecastLabel: string;
}) {
  if (points.length < 2) return null;
  const width = 320;
  const height = 120;
  const values = points.map((point) => point.balance);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.balance - min) / span) * (height - 8) - 4;
    return { ...point, x, y };
  });
  const actual = coords.filter((point) => point.actual);
  const path = (rows: typeof coords) => rows.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const forecastStart = coords.findIndex((point) => !point.actual);
  const forecastPath = forecastStart <= 0 ? coords.filter((point) => !point.actual) : coords.slice(Math.max(0, forecastStart - 1));
  return (
    <AdminCard title={`${actualLabel} / ${forecastLabel}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" role="img">
        <path d={path(actual)} fill="none" stroke="#0f766e" strokeWidth="2" />
        {forecastPath.length > 1 && <path d={path(forecastPath)} fill="none" stroke="#d97706" strokeWidth="2" strokeDasharray="4 3" />}
      </svg>
    </AdminCard>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-beige-dark/15 bg-warm-white px-3 py-3">
      <p className="text-sm text-coffee/65">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-dark-brown">{value}</p>
    </div>
  );
}
