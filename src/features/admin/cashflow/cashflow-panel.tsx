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
  const [month, setMonth] = useState(monthKey());
  const [rangeStart, setRangeStart] = useState(initial.start);
  const [rangeEnd, setRangeEnd] = useState(initial.end);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(localIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [forecast, setForecast] = useState({ description: "", amount: "", date: localIso(), direction: "out" as "in" | "out" });
  const [transfer, setTransfer] = useState({ description: "", amount: "", date: localIso() });
  const [settlementDrafts, setSettlementDrafts] = useState<Record<string, { date: string; location: "cash" | "card" | "bank" }>>({});

  useEffect(() => subscribeToBreakEvenFixedCosts(setFixed), []);
  useEffect(() => subscribeCashFlowEntries(setEntries, setLoadError), []);
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
    []
  );

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
    const amount = Number(openingAmount);
    if (!Number.isFinite(amount) || !openingDate) {
      setError(t("admin.cashflow.openingMissing"));
      return;
    }
    const ok = await persist(() => saveCashOpening({ amount, date: openingDate }));
    if (ok) setOpeningAmount("");
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

  return (
    <div className="space-y-4">
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
        ) : opening == null ? (
          <div className="mt-4 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">{t("admin.cashflow.openingMissing")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input type="number" value={openingAmount} placeholder={t("admin.cashflow.opening")} onChange={(event) => setOpeningAmount(event.target.value)} />
              <Input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} />
              <Button type="button" variant="turquoise" disabled={saving} onClick={saveOpeningBalance}>
                {saving ? t("admin.cashflow.saving") : t("admin.cashflow.saveOpening")}
              </Button>
            </div>
          </div>
        ) : null}
        {loadError && <p className="mt-3 text-sm font-medium text-red-700">{t("admin.cashflow.loadFailed")}: {loadError}</p>}
        {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
      </AdminCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label={t("admin.cashflow.opening")} value={flow.openingSet ? formatIls(flow.opening ?? 0) : "—"} hint={flow.openingDate ?? ""} />
        <Summary label={t("admin.cashflow.receipts")} value={formatIls(flow.inflows)} />
        <Summary label={t("admin.cashflow.payments")} value={formatIls(flow.outflows)} />
        <Summary label={t("admin.cashflow.closing")} value={flow.closing == null ? "—" : formatIls(flow.closing)} negative={flow.closing != null && flow.closing < 0} />
      </div>

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
        <div className="overflow-x-auto">
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
              {flow.lines.map((line) => (
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
