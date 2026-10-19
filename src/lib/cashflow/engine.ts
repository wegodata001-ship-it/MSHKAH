import { roundMoney } from "@/lib/costing/money";
import type { BreakEvenFixedCost, PaymentSchedule } from "@/lib/breakeven/types";

export type { PaymentSchedule };
export type CashFlowStatus = "expected" | "partial" | "done" | "overdue" | "cancelled";
export type CashFlowSource = "fixed" | "invoice" | "manual" | "z" | "transfer";

export type CashFlowEntry = {
  id: string;
  kind: "forecast" | "settlement" | "transfer" | "override" | "link";
  direction?: "in" | "out";
  amount?: number;
  date?: string;
  description?: string;
  counterparty?: string;
  account?: string;
  status?: "expected" | "done" | "cancelled";
  fixedCostId?: string;
  occurrenceKey?: string;
  originalDate?: string;
  scope?: "instance" | "future";
  invoiceId?: string;
  appliesToKey?: string;
  zReportId?: string;
  paymentMethod?: string;
  moneyLocation?: "cash" | "card" | "bank";
  history?: { at: string; change: string }[];
};

export type CashInvoice = {
  id: string;
  supplierName: string;
  invoiceNumber?: string;
  dueDate?: string | null;
  gross: number | null;
  net?: number | null;
};

export type CashZPayment = {
  reportId: string;
  businessDate?: string | null;
  method: string;
  amount: number;
};

export type CashFlowLine = {
  id: string;
  date: string | null;
  description: string;
  counterparty: string;
  inflow: number;
  outflow: number;
  status: CashFlowStatus;
  forecast: boolean;
  source: CashFlowSource;
  balance: number | null;
  countsInBalance: boolean;
  internal?: boolean;
  occurrenceKey?: string;
  plannedDate?: string;
  fixedCostId?: string;
  invoiceId?: string;
  entryId?: string;
  zReportId?: string;
  paymentMethod?: string;
  missing?: "payment-date" | "due-date" | "gross" | "settlement";
};

export type CashFlowPoint = { date: string; balance: number; actual: boolean };

export type CashFlowBuild = {
  openingSet: boolean;
  opening: number | null;
  openingDate: string | null;
  inflows: number;
  outflows: number;
  closing: number | null;
  lines: CashFlowLine[];
  undated: CashFlowLine[];
  needsSettlement: CashFlowLine[];
  points: CashFlowPoint[];
};

const STEP: Record<PaymentSchedule, number> = {
  once: 0,
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  yearly: 12,
};

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function clampBillingDate(year: number, month: number, billingDay: number): string {
  const day = Math.min(Math.max(1, billingDay), daysInMonth(year, month));
  return isoDate(year, month, day);
}

export function billingDayFromDate(value: string): number | null {
  const parsed = parseIso(value);
  return parsed?.day ?? null;
}

export function fixedCashAmount(
  cost: Pick<BreakEvenFixedCost, "amount" | "vatMode" | "vatRate">,
  fallbackVatRate = 0
): number {
  if (cost.vatMode !== "before") return roundMoney(cost.amount);
  const rate = cost.vatRate ?? fallbackVatRate;
  if (!(rate > 0)) return roundMoney(cost.amount);
  return roundMoney(cost.amount * (1 + rate));
}

export function posExcelCashInflows(): [] {
  return [];
}

type Schedule = { frequency: PaymentSchedule; billingDay: number; start: string; end: string | null };

export function paymentScheduleOf(
  cost: Pick<BreakEvenFixedCost, "paymentFrequency" | "billingDay" | "billingStart" | "nextPaymentDate" | "billingEnd">
): Schedule | null {
  if (!cost.paymentFrequency) return null;
  const start = cost.billingStart || cost.nextPaymentDate || "";
  if (!parseIso(start)) return null;
  const billingDay = cost.billingDay || billingDayFromDate(cost.nextPaymentDate || start);
  if (!billingDay) return null;
  return { frequency: cost.paymentFrequency, billingDay, start, end: cost.billingEnd || null };
}

export function nextOccurrence(
  cost: Pick<BreakEvenFixedCost, "paymentFrequency" | "billingDay" | "billingStart" | "nextPaymentDate" | "billingEnd">,
  today: string
): string | null {
  const schedule = paymentScheduleOf(cost);
  const start = parseIso(today);
  if (!schedule || !start) return null;
  const dates = paymentDates({
    ...schedule,
    rangeStart: today,
    rangeEnd: isoDate(start.year + 2, start.month, daysInMonth(start.year + 2, start.month)),
  });
  return dates[0]?.date ?? null;
}

export function paymentDates(input: {
  frequency: PaymentSchedule;
  billingDay: number;
  start: string;
  end?: string | null;
  rangeStart: string;
  rangeEnd: string;
}): { date: string; keySuffix: string }[] {
  if (input.frequency === "once") {
    const date = input.start;
    if (date >= input.rangeStart && date <= input.rangeEnd && (!input.end || date <= input.end)) {
      return [{ date, keySuffix: "once" }];
    }
    return [];
  }
  const start = parseIso(input.start);
  if (!start) return [];
  const dates: { date: string; keySuffix: string }[] = [];
  let year = start.year;
  let month = start.month;
  for (let index = 0; index < 360; index += 1) {
    const date = clampBillingDate(year, month, input.billingDay);
    if (date > input.rangeEnd && date > (input.end || input.rangeEnd)) break;
    const open = !input.end || date <= input.end;
    if (date >= input.start && date >= input.rangeStart && date <= input.rangeEnd && open) {
      dates.push({ date, keySuffix: input.frequency === "yearly" ? String(year) : `${year}-${pad(month)}` });
    }
    if (date > input.rangeEnd) break;
    const next = addMonths(year, month, STEP[input.frequency]);
    year = next.year;
    month = next.month;
  }
  return dates;
}

type Obligation = {
  key: string;
  date: string;
  amount: number;
  description: string;
  counterparty: string;
  source: CashFlowSource;
  direction: "in" | "out";
  plannedDate?: string;
  fixedCostId?: string;
  invoiceId?: string;
  entryId?: string;
};

export function buildCashFlow(input: {
  fixed: BreakEvenFixedCost[];
  invoices?: CashInvoice[];
  entries?: CashFlowEntry[];
  zPayments?: CashZPayment[];
  opening?: { amount: number; date: string } | null;
  rangeStart: string;
  rangeEnd: string;
  today: string;
  vatRate?: number;
  posExcelRows?: unknown[];
}): CashFlowBuild {
  void input.posExcelRows;
  const entries = input.entries ?? [];
  const activeEntries = entries.filter((entry) => entry.status !== "cancelled");
  const vatRate = input.vatRate ?? 0;
  const undated: CashFlowLine[] = [];
  const obligations: Obligation[] = [];
  const links = new Set(
    activeEntries.filter((entry) => entry.kind === "link" && entry.occurrenceKey).map((entry) => entry.occurrenceKey as string)
  );

  for (const cost of input.fixed) {
    if (cost.active === false) continue;
    const schedule = paymentScheduleOf(cost);
    if (!schedule) {
      undated.push(undatedFixed(cost, vatRate));
      continue;
    }
    const amount = fixedCashAmount(cost, vatRate);
    for (const occurrence of paymentDates({ ...schedule, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd })) {
      const key = `${cost.id}:${occurrence.keySuffix}`;
      if (links.has(key)) continue;
      const override = overrideFor(key, occurrence.date, cost.id, activeEntries);
      if (override?.status === "cancelled") continue;
      obligations.push({
        key,
        date: override ? movedDate(occurrence.date, override) : occurrence.date,
        plannedDate: occurrence.date,
        amount: override?.amount ?? amount,
        description: cost.name,
        counterparty: cost.paymentAccount || "",
        source: "fixed",
        direction: "out",
        fixedCostId: cost.id,
      });
    }
  }

  for (const invoice of input.invoices ?? []) {
    if (invoice.gross == null) {
      undated.push({
        id: `invoice-gross-${invoice.id}`,
        date: null,
        description: invoice.supplierName || invoice.invoiceNumber || invoice.id,
        counterparty: invoice.supplierName,
        inflow: 0,
        outflow: 0,
        status: "expected",
        forecast: true,
        source: "invoice",
        balance: null,
        countsInBalance: false,
        invoiceId: invoice.id,
        missing: "gross",
      });
      continue;
    }
    if (!invoice.dueDate) {
      undated.push({
        id: `invoice-due-${invoice.id}`,
        date: null,
        description: invoice.invoiceNumber || invoice.supplierName,
        counterparty: invoice.supplierName,
        inflow: 0,
        outflow: invoice.gross,
        status: "expected",
        forecast: true,
        source: "invoice",
        balance: null,
        countsInBalance: false,
        invoiceId: invoice.id,
        missing: "due-date",
      });
      continue;
    }
    if (invoice.dueDate < input.rangeStart || invoice.dueDate > input.rangeEnd) continue;
    obligations.push({
      key: `invoice:${invoice.id}`,
      date: invoice.dueDate,
      amount: invoice.gross,
      description: invoice.invoiceNumber || invoice.supplierName,
      counterparty: invoice.supplierName,
      source: "invoice",
      direction: "out",
      invoiceId: invoice.id,
    });
  }

  for (const entry of activeEntries) {
    if (entry.kind !== "forecast" || !entry.date || entry.amount == null || !entry.direction) continue;
    if (entry.date < input.rangeStart || entry.date > input.rangeEnd) continue;
    obligations.push({
      key: `manual:${entry.id}`,
      date: entry.date,
      amount: entry.amount,
      description: entry.description || "",
      counterparty: entry.counterparty || entry.account || "",
      source: "manual",
      direction: entry.direction,
      entryId: entry.id,
    });
  }

  const lines: CashFlowLine[] = [];
  for (const obligation of obligations) {
    const applied = activeEntries.filter(
      (entry) => entry.kind === "settlement" && entry.appliesToKey === obligation.key && entry.amount != null && entry.date
    );
    const paid = roundMoney(applied.reduce((sum, entry) => sum + (entry.amount ?? 0), 0));
    const remaining = roundMoney(obligation.amount - paid);
    if (remaining > 0.009) {
      const partial = paid > 0.009;
      lines.push({
        id: `due-${obligation.key}`,
        date: obligation.date,
        description: obligation.description,
        counterparty: obligation.counterparty,
        inflow: obligation.direction === "in" ? remaining : 0,
        outflow: obligation.direction === "out" ? remaining : 0,
        plannedDate: obligation.plannedDate,
        status: remainingStatus(obligation.date, input.today, partial),
        forecast: true,
        source: obligation.source,
        balance: null,
        countsInBalance: counts(obligation.date, input.opening),
        occurrenceKey: obligation.key,
        fixedCostId: obligation.fixedCostId,
        invoiceId: obligation.invoiceId,
        entryId: obligation.entryId,
      });
    }
    for (const entry of applied) {
      lines.push(settlementLine(entry, obligation, input.opening));
    }
  }

  for (const entry of activeEntries) {
    if (entry.kind !== "settlement" || entry.appliesToKey || entry.zReportId || !entry.date || entry.amount == null || !entry.direction) continue;
    if (entry.date < input.rangeStart || entry.date > input.rangeEnd) continue;
    lines.push({
      id: `paid-${entry.id}`,
      date: entry.date,
      description: entry.description || "",
      counterparty: entry.counterparty || entry.account || "",
      inflow: entry.direction === "in" ? entry.amount : 0,
      outflow: entry.direction === "out" ? entry.amount : 0,
      status: "done",
      forecast: false,
      source: "manual",
      balance: null,
      countsInBalance: counts(entry.date, input.opening),
      entryId: entry.id,
    });
  }

  for (const entry of activeEntries) {
    if (entry.kind !== "transfer" || !entry.date || entry.amount == null) continue;
    if (entry.date < input.rangeStart || entry.date > input.rangeEnd) continue;
    lines.push({
      id: `move-${entry.id}`,
      date: entry.date,
      description: entry.description || "",
      counterparty: entry.account || "",
      inflow: entry.amount,
      outflow: entry.amount,
      status: "done",
      forecast: false,
      source: "transfer",
      balance: null,
      countsInBalance: counts(entry.date, input.opening),
      internal: true,
      entryId: entry.id,
    });
  }

  const needsSettlement: CashFlowLine[] = [];
  for (const payment of input.zPayments ?? []) {
    if (!(payment.amount > 0)) continue;
    const settled = activeEntries.some(
      (entry) =>
        entry.kind === "settlement" &&
        entry.zReportId === payment.reportId &&
        entry.paymentMethod === payment.method &&
        entry.date &&
        entry.moneyLocation
    );
    if (settled) {
      const entry = activeEntries.find(
        (item) => item.kind === "settlement" && item.zReportId === payment.reportId && item.paymentMethod === payment.method
      );
      if (entry?.date && entry.amount != null && entry.date >= input.rangeStart && entry.date <= input.rangeEnd) {
        lines.push({
          id: `z-${entry.id}`,
          date: entry.date,
          description: payment.method,
          counterparty: entry.moneyLocation || "",
          inflow: entry.amount,
          outflow: 0,
          status: "done",
          forecast: false,
          source: "z",
          balance: null,
          countsInBalance: counts(entry.date, input.opening),
          zReportId: payment.reportId,
          paymentMethod: payment.method,
          entryId: entry.id,
        });
      }
      continue;
    }
    needsSettlement.push({
      id: `z-open-${payment.reportId}-${payment.method}`,
      date: null,
      description: payment.method,
      counterparty: payment.businessDate || "",
      inflow: payment.amount,
      outflow: 0,
      status: "expected",
      forecast: true,
      source: "z",
      balance: null,
      countsInBalance: false,
      zReportId: payment.reportId,
      paymentMethod: payment.method,
      missing: "settlement",
    });
  }

  lines.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id));

  const openingSet = input.opening != null && Number.isFinite(input.opening.amount) && Boolean(input.opening.date);
  let balance = openingSet ? input.opening!.amount : null;
  let actual = true;
  const points: CashFlowPoint[] = [];
  if (openingSet && balance != null && input.opening) {
    points.push({ date: input.opening.date, balance, actual: true });
  }
  for (const line of lines) {
    if (!line.countsInBalance || balance == null) {
      line.balance = null;
      continue;
    }
    balance = roundMoney(balance + line.inflow - line.outflow);
    line.balance = balance;
    if (line.forecast) actual = false;
    if (line.date) points.push({ date: line.date, balance, actual });
  }

  const counted = lines.filter((line) => line.countsInBalance && !line.internal);
  const inflows = roundMoney(counted.reduce((sum, line) => sum + line.inflow, 0));
  const outflows = roundMoney(counted.reduce((sum, line) => sum + line.outflow, 0));
  const closing = openingSet && balance != null ? balance : null;

  return {
    openingSet,
    opening: openingSet ? input.opening!.amount : null,
    openingDate: openingSet ? input.opening!.date : null,
    inflows,
    outflows,
    closing,
    lines,
    undated,
    needsSettlement,
    points,
  };
}

export function appendHistory(entry: CashFlowEntry, at: string, change: string): CashFlowEntry {
  return { ...entry, history: [...(entry.history ?? []), { at, change }] };
}

function undatedFixed(cost: BreakEvenFixedCost, vatRate: number): CashFlowLine {
  return {
    id: `undated-${cost.id}`,
    date: null,
    description: cost.name,
    counterparty: cost.paymentAccount || "",
    inflow: 0,
    outflow: fixedCashAmount(cost, vatRate),
    status: "expected",
    forecast: true,
    source: "fixed",
    balance: null,
    countsInBalance: false,
    fixedCostId: cost.id,
    missing: "payment-date",
  };
}

function movedDate(original: string, override: CashFlowEntry): string {
  if (!override.date) return original;
  if (override.scope !== "future") return override.date;
  const next = parseIso(override.date);
  const current = parseIso(original);
  if (!next || !current) return override.date;
  return clampBillingDate(current.year, current.month, next.day);
}

function overrideFor(key: string, date: string, fixedCostId: string, entries: CashFlowEntry[]): CashFlowEntry | null {
  const instance = entries.find((entry) => entry.kind === "override" && entry.scope !== "future" && entry.occurrenceKey === key);
  if (instance) return instance;
  const futures = entries
    .filter(
      (entry) =>
        entry.kind === "override" &&
        entry.scope === "future" &&
        entry.fixedCostId === fixedCostId &&
        entry.originalDate &&
        entry.originalDate <= date
    )
    .sort((a, b) => (b.originalDate ?? "").localeCompare(a.originalDate ?? ""));
  return futures[0] ?? null;
}

function settlementLine(entry: CashFlowEntry, obligation: Obligation, opening: { date: string } | null | undefined): CashFlowLine {
  const direction = entry.direction ?? "out";
  return {
    id: `paid-${entry.id}`,
    date: entry.date ?? null,
    description: entry.description || obligation.description,
    counterparty: entry.counterparty || obligation.counterparty,
    inflow: direction === "in" ? entry.amount ?? 0 : 0,
    outflow: direction === "out" ? entry.amount ?? 0 : 0,
    status: "done",
    forecast: false,
    source: obligation.source,
    balance: null,
    countsInBalance: Boolean(entry.date) && counts(entry.date ?? "", opening),
    occurrenceKey: obligation.key,
    fixedCostId: obligation.fixedCostId,
    invoiceId: obligation.invoiceId,
    entryId: entry.id,
  };
}

function counts(date: string, opening: { date: string } | null | undefined): boolean {
  if (!opening?.date) return false;
  return date >= opening.date;
}

function remainingStatus(date: string, today: string, partial: boolean): CashFlowStatus {
  if (date < today) return "overdue";
  return partial ? "partial" : "expected";
}

function statusRank(status: CashFlowStatus): number {
  if (status === "expected" || status === "partial" || status === "overdue") return 0;
  if (status === "done") return 1;
  return 2;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseIso(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}
