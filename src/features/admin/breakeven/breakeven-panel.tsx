"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Save, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { AdminEmptyState } from "@/features/admin/components/admin-empty-state";
import { formatIls, formatPercent } from "@/lib/costing/money";
import {
  computeBreakEven,
  monthBounds,
  monthlyEquivalent,
  productContribution,
  simulateBreakEven,
  snapshotChange,
} from "@/lib/breakeven/compute";
import {
  DEFAULT_BREAK_EVEN_SETTINGS,
  FIXED_COST_PRESETS,
  VARIABLE_COST_PRESETS,
  type BreakEvenFixedCost,
  type BreakEvenResult,
  type BreakEvenSettings,
  type BreakEvenSnapshot,
  type BreakEvenVariableCost,
  type BreakEvenVatMode,
  type CostFrequency,
  type VariableCostKind,
} from "@/lib/breakeven/types";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { Order, Product } from "@/types";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import { subscribeToOrders } from "@/services/orderService";
import {
  deleteFixedCost,
  deleteVariableCost,
  saveBreakEvenSettings,
  saveBreakEvenSnapshot,
  saveFixedCost,
  saveVariableCost,
  subscribeToBreakEvenFixedCosts,
  subscribeToBreakEvenSettings,
  subscribeToBreakEvenSnapshots,
  subscribeToBreakEvenVariableCosts,
} from "@/services/breakevenService";
import { cn } from "@/lib/utils";

type Period = "today" | "week" | "month" | "custom";

function rangeFor(period: Period, customFrom: string, customTo: string, now = new Date()) {
  if (period === "custom" && customFrom && customTo) return { from: customFrom, to: customTo };
  const iso = now.toISOString().slice(0, 10);
  if (period === "today") return { from: iso, to: iso };
  if (period === "week") {
    const start = new Date(now);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    return { from: start.toISOString().slice(0, 10), to: iso };
  }
  const month = monthBounds(now);
  return { from: month.from, to: month.to };
}

function money(value: number | null | undefined) {
  return value == null ? "—" : formatIls(value);
}

function fill(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

export function BreakEvenPanel({
  recipes,
  ingredients,
  products,
  vatRate,
  costingVatMode,
}: {
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  products: Product[];
  vatRate: number;
  costingVatMode: "before" | "including";
}) {
  const t = useT();
  const { locale } = useLocale();
  const [fixed, setFixed] = useState<BreakEvenFixedCost[]>([]);
  const [variable, setVariable] = useState<BreakEvenVariableCost[]>([]);
  const [settings, setSettings] = useState<BreakEvenSettings>({
    ...DEFAULT_BREAK_EVEN_SETTINGS,
    vatBasis: costingVatMode,
    vatRate,
  });
  const [snapshots, setSnapshots] = useState<BreakEvenSnapshot[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [simOpen, setSimOpen] = useState(false);
  const [sim, setSim] = useState({
    sellingLift: 0,
    foodCostLift: 0,
    rent: 0,
    salaries: 0,
    cardPercent: 0,
    operatingDays: settings.operatingDays,
    averageOrderValue: 0,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      subscribeToBreakEvenFixedCosts(setFixed),
      subscribeToBreakEvenVariableCosts(setVariable),
      subscribeToBreakEvenSettings((value) => {
        setSettings({
          ...value,
          vatRate: value.vatRate || vatRate,
          vatBasis: value.createdAt ? value.vatBasis : costingVatMode,
        });
        setSim((current) => ({ ...current, operatingDays: value.operatingDays }));
      }),
      subscribeToBreakEvenSnapshots(setSnapshots),
      subscribeToOrders({ status: "all" }, setOrders, () => undefined),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [vatRate, costingVatMode]);

  const bounds = useMemo(
    () => rangeFor(period, customFrom, customTo),
    [period, customFrom, customTo]
  );
  const month = useMemo(() => monthBounds(), []);

  const result = useMemo(
    () =>
      computeBreakEven({
        settings: { ...settings, vatRate: settings.vatRate || vatRate },
        fixed,
        variable,
        orders,
        recipes,
        ingredients,
        from: bounds.from,
        to: bounds.to,
      }),
    [settings, vatRate, fixed, variable, orders, recipes, ingredients, bounds]
  );

  const simulated = useMemo(
    () =>
      simulateBreakEven(result, {
        ...sim,
        averageOrderValue: sim.averageOrderValue || result.averageOrderValue || undefined,
      }),
    [result, sim]
  );
  const shown = simOpen ? simulated : result;

  const dishRows = useMemo(
    () =>
      products
        .map((product) =>
          productContribution(product.id, getProductDisplayName(product, locale), product.price, recipes, ingredients)
        )
        .filter((row): row is NonNullable<typeof row> => row != null)
        .sort((a, b) => (b.contributionRatio ?? 0) - (a.contributionRatio ?? 0)),
    [products, recipes, ingredients, locale]
  );

  const previous = snapshots.find((item) => item.monthKey < month.key);
  const currentSnap = snapshots.find((item) => item.monthKey === month.key);

  async function persistSettings(next: BreakEvenSettings) {
    setSettings(next);
    await saveBreakEvenSettings(next);
  }

  async function persistSnapshot() {
    setSaving(true);
    const saved = await saveBreakEvenSnapshot(month.key, result);
    setSaving(false);
    setMessage(saved.success ? t("admin.breakeven.snapshotSaved") : t("admin.breakeven.saveFailed"));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("admin.breakeven.title")}</h2>
          <p className="text-sm text-coffee/60">{t("admin.breakeven.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["today", "week", "month", "custom"] as Period[]).map((item) => (
            <Button key={item} size="sm" variant={period === item ? "turquoise" : "outline"} onClick={() => setPeriod(item)}>
              {t(`admin.breakeven.period.${item}`)}
            </Button>
          ))}
        </div>
      </div>

      {period === "custom" && (
        <div className="flex flex-wrap gap-2">
          <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}

      <SettingsBar settings={settings} onChange={persistSettings} />

      {!shown.canCompute ? (
        <AdminEmptyState
          icon={AlertTriangle}
          title={t("admin.breakeven.cannot")}
          hint={shown.missing.map((item) => t(`admin.breakeven.missing.${item}`)).join(" · ")}
        />
      ) : (
        <DashboardBlock result={shown} />
      )}

      {shown.canCompute && <ForecastBlock result={shown} />}
      {shown.canCompute && <BreakEvenChart result={shown} />}
      {shown.alerts.length > 0 && <AlertsBlock result={shown} />}

      <div className="grid gap-5 xl:grid-cols-2">
        <FixedCostsCard items={fixed} operatingDays={settings.operatingDays} />
        <VariableCostsCard items={variable} />
      </div>

      <SimulatorCard
        open={simOpen}
        onToggle={() => setSimOpen((value) => !value)}
        sim={sim}
        onChange={setSim}
        result={simulated}
        onSave={async () => {
          setSaving(true);
          await persistSettings({ ...settings, operatingDays: sim.operatingDays || settings.operatingDays });
          if (sim.rent) {
            await saveFixedCost({
              name: t("admin.breakeven.fixed.rent"),
              amount: sim.rent,
              frequency: "monthly",
              category: "rent",
              vatMode: settings.vatBasis,
              vatRate: settings.vatRate,
              active: true,
            });
          }
          if (sim.salaries) {
            await saveFixedCost({
              name: t("admin.breakeven.fixed.salaries"),
              amount: sim.salaries,
              frequency: "monthly",
              category: "salaries",
              vatMode: settings.vatBasis,
              vatRate: settings.vatRate,
              active: true,
            });
          }
          if (sim.cardPercent) {
            await saveVariableCost({
              name: t("admin.breakeven.variable.cardPercent"),
              kind: "percent",
              amount: sim.cardPercent,
              vatMode: "exempt",
              active: true,
            });
          }
          setSimOpen(false);
          setSaving(false);
          setMessage(t("admin.breakeven.saved"));
        }}
        saving={saving}
      />

      <ProductMarginCard rows={dishRows} />

      <HistoryCard
        snapshots={snapshots}
        previous={previous}
        current={currentSnap}
        onSave={persistSnapshot}
        saving={saving}
        monthKey={month.key}
      />

      {message && <p className="text-sm text-turquoise">{message}</p>}
    </div>
  );
}

function SettingsBar({
  settings,
  onChange,
}: {
  settings: BreakEvenSettings;
  onChange: (next: BreakEvenSettings) => void;
}) {
  const t = useT();
  return (
    <AdminCard title={t("admin.breakeven.settings")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-coffee/60">{t("admin.breakeven.operatingDays")}</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={settings.operatingDays}
            onChange={(e) => onChange({ ...settings, operatingDays: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-coffee/60">{t("admin.breakeven.vatBasis")}</span>
          <select
            className="h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
            value={settings.vatBasis}
            onChange={(e) => onChange({ ...settings, vatBasis: e.target.value as "before" | "including" })}
          >
            <option value="before">{t("admin.breakeven.vatBefore")}</option>
            <option value="including">{t("admin.breakeven.vatIncluding")}</option>
          </select>
        </label>
        <p className="self-end text-xs text-coffee/55">{t("admin.breakeven.vatHint")}</p>
      </div>
    </AdminCard>
  );
}

function DashboardBlock({ result }: { result: BreakEvenResult }) {
  const t = useT();
  const progress = Math.round((result.progress ?? 0) * 100);
  return (
    <AdminCard title={t("admin.breakeven.title")} icon={<Target className="h-4 w-4 text-turquoise" />}>
      <div className="space-y-4">
        <div>
          <p className="text-3xl font-semibold">{money(result.breakEvenMonthly)}</p>
          <p className="text-sm text-coffee/55">{t("admin.breakeven.perMonth")}</p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-beige">
          <div
            className={cn("h-full rounded-full", result.achieved ? "bg-emerald-600" : "bg-turquoise")}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t("admin.breakeven.sold")} value={money(result.revenue)} />
          <Stat
            label={result.achieved ? t("admin.breakeven.above") : t("admin.breakeven.short")}
            value={money(result.achieved ? result.aboveBreakEven : result.gap)}
          />
          <Stat label={t("admin.breakeven.progress")} value={`${progress}%`} />
        </div>
        {result.achieved && (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {t("admin.breakeven.achieved")}
          </p>
        )}
        <p className="text-xs text-coffee/50">{t("admin.breakeven.notNetProfit")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label={t("admin.breakeven.dailyTarget")} value={money(result.breakEvenDaily)} />
          <Stat label={t("admin.breakeven.actualDaily")} value={money(result.dailyAverage)} />
          <Stat
            label={t("admin.breakeven.dailyGap")}
            value={
              result.breakEvenDaily != null && result.dailyAverage != null
                ? money(result.dailyAverage - result.breakEvenDaily)
                : "—"
            }
          />
          <Stat
            label={t("admin.breakeven.ordersNeeded")}
            value={result.ordersRequiredDaily == null ? "—" : String(Math.ceil(result.ordersRequiredDaily))}
          />
          <Stat label={t("admin.breakeven.aov")} value={money(result.averageOrderValue)} />
        </div>
      </div>
    </AdminCard>
  );
}

function ForecastBlock({ result }: { result: BreakEvenResult }) {
  const t = useT();
  return (
    <AdminCard title={t("admin.breakeven.forecastTitle")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("admin.breakeven.elapsed")} value={String(result.elapsedDays)} />
        <Stat label={t("admin.breakeven.remaining")} value={String(result.remainingDays)} />
        <Stat label={t("admin.breakeven.forecast")} value={money(result.forecast)} />
        <Stat label={t("admin.breakeven.requiredFromNow")} value={money(result.requiredDailyFromNow)} />
      </div>
      <p className="mt-3 text-sm">
        {result.forecastGap != null && result.forecastGap >= 0
          ? t("admin.breakeven.forecastPass")
          : fill(t("admin.breakeven.forecastFail"), {
              amount: money(result.forecastGap != null ? Math.abs(result.forecastGap) : null),
            })}
      </p>
      {result.requiredDailyFromNow != null && result.remainingDays > 0 && (
        <p className="mt-1 text-sm text-coffee/70">
          {fill(t("admin.breakeven.needPerDay"), { amount: money(result.requiredDailyFromNow) })}
        </p>
      )}
    </AdminCard>
  );
}

function AlertsBlock({ result }: { result: BreakEvenResult }) {
  const t = useT();
  return (
    <div className="space-y-2">
      {result.alerts.includes("achieved") && (
        <Alert tone="ok">{t("admin.breakeven.alert.achieved")}</Alert>
      )}
      {result.alerts.includes("weekLeft") && (
        <Alert tone="warn">
          {fill(t("admin.breakeven.alert.weekLeft"), {
            days: String(result.remainingDays),
            amount: money(result.gap),
          })}
        </Alert>
      )}
      {result.alerts.includes("requiredDaily") && (
        <Alert tone="warn">
          {fill(t("admin.breakeven.alert.requiredDaily"), { amount: money(result.requiredDailyFromNow) })}
        </Alert>
      )}
    </div>
  );
}

function BreakEvenChart({ result }: { result: BreakEvenResult }) {
  const t = useT();
  const points = result.daily;
  if (!points.length || result.breakEvenMonthly == null) return null;
  const maxY = Math.max(result.breakEvenMonthly, ...points.map((point) => point.cumulative), 1);
  const w = 640;
  const h = 180;
  const x = (index: number) => (points.length <= 1 ? 0 : (index / (points.length - 1)) * (w - 24) + 12);
  const y = (value: number) => h - 16 - (value / maxY) * (h - 28);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.cumulative)}`).join(" ");
  const target = `M12,${y(result.breakEvenMonthly)} L${w - 12},${y(result.breakEvenMonthly)}`;
  const crossIndex = result.crossedOn ? points.findIndex((point) => point.date === result.crossedOn) : -1;
  return (
    <AdminCard title={t("admin.breakeven.chart")}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full" role="img">
        <path d={target} stroke="#c4b5a0" strokeDasharray="6 4" fill="none" />
        <path d={line} stroke="#0f766e" strokeWidth="2.5" fill="none" />
        {crossIndex >= 0 && (
          <circle cx={x(crossIndex)} cy={y(points[crossIndex]!.cumulative)} r="5" fill="#059669" />
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-coffee/60">
        <span>{t("admin.breakeven.cumulative")}</span>
        <span>{t("admin.breakeven.targetLine")}</span>
        {result.crossedOn && <span>{t("admin.breakeven.crossedOn")}: {result.crossedOn}</span>}
      </div>
    </AdminCard>
  );
}

function FixedCostsCard({ items, operatingDays }: { items: BreakEvenFixedCost[]; operatingDays: number }) {
  const t = useT();
  const [draft, setDraft] = useState({
    name: "",
    amount: "",
    frequency: "monthly" as CostFrequency,
    category: "other",
    vatMode: "before" as BreakEvenVatMode,
  });
  return (
    <AdminCard title={t("admin.breakeven.fixedTitle")}>
      <div className="mb-3 flex flex-wrap gap-1">
        {FIXED_COST_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="rounded-full bg-beige/50 px-2 py-1 text-xs"
            onClick={() => setDraft((current) => ({ ...current, name: t(`admin.breakeven.fixed.${preset}`), category: preset }))}
          >
            {t(`admin.breakeven.fixed.${preset}`)}
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("admin.breakeven.name")} />
        <Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="₪" />
        <select className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm" value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as CostFrequency })}>
          <option value="daily">{t("admin.breakeven.freq.daily")}</option>
          <option value="weekly">{t("admin.breakeven.freq.weekly")}</option>
          <option value="monthly">{t("admin.breakeven.freq.monthly")}</option>
          <option value="yearly">{t("admin.breakeven.freq.yearly")}</option>
        </select>
        <VatSelect value={draft.vatMode} onChange={(vatMode) => setDraft({ ...draft, vatMode })} />
        <Button
          size="sm"
          onClick={async () => {
            if (!draft.name || !(Number(draft.amount) > 0)) return;
            await saveFixedCost({ ...draft, amount: Number(draft.amount), active: true });
            setDraft({ name: "", amount: "", frequency: "monthly", category: "other", vatMode: "before" });
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <CostList
        rows={items.map((item) => ({
          id: item.id,
          title: item.name,
          meta: `${t(`admin.breakeven.freq.${item.frequency}`)} · ${money(monthlyEquivalent(item.amount, item.frequency, operatingDays))}`,
          active: item.active,
          onToggle: () => saveFixedCost({ ...item, active: !item.active }),
          onDelete: () => deleteFixedCost(item.id),
        }))}
        empty={t("admin.breakeven.noFixed")}
      />
    </AdminCard>
  );
}

function VariableCostsCard({ items }: { items: BreakEvenVariableCost[] }) {
  const t = useT();
  const [draft, setDraft] = useState({
    name: "",
    amount: "",
    kind: "percent" as VariableCostKind,
    vatMode: "exempt" as BreakEvenVatMode,
  });
  return (
    <AdminCard title={t("admin.breakeven.variableTitle")}>
      <div className="mb-3 flex flex-wrap gap-1">
        {VARIABLE_COST_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="rounded-full bg-beige/50 px-2 py-1 text-xs"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                name: t(`admin.breakeven.variable.${preset}`),
                kind: preset === "cardPercent" || preset === "platform" ? "percent" : "per_order",
              }))
            }
          >
            {t(`admin.breakeven.variable.${preset}`)}
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("admin.breakeven.name")} />
        <Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
        <select className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as VariableCostKind })}>
          <option value="percent">{t("admin.breakeven.kind.percent")}</option>
          <option value="per_order">{t("admin.breakeven.kind.perOrder")}</option>
          <option value="fixed">{t("admin.breakeven.kind.fixed")}</option>
        </select>
        <VatSelect value={draft.vatMode} onChange={(vatMode) => setDraft({ ...draft, vatMode })} />
        <Button
          size="sm"
          onClick={async () => {
            if (!draft.name || !(Number(draft.amount) > 0)) return;
            await saveVariableCost({ ...draft, amount: Number(draft.amount), active: true });
            setDraft({ name: "", amount: "", kind: "percent", vatMode: "exempt" });
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <CostList
        rows={items.map((item) => ({
          id: item.id,
          title: item.name,
          meta: item.kind === "percent" ? `${item.amount}%` : item.kind === "per_order" ? `${formatIls(item.amount)} / ${t("admin.breakeven.order")}` : formatIls(item.amount),
          active: item.active,
          onToggle: () => saveVariableCost({ ...item, active: !item.active }),
          onDelete: () => deleteVariableCost(item.id),
        }))}
        empty={t("admin.breakeven.noVariable")}
      />
    </AdminCard>
  );
}

function SimulatorCard({
  open,
  onToggle,
  sim,
  onChange,
  result,
  onSave,
  saving,
}: {
  open: boolean;
  onToggle: () => void;
  sim: {
    sellingLift: number;
    foodCostLift: number;
    rent: number;
    salaries: number;
    cardPercent: number;
    operatingDays: number;
    averageOrderValue: number;
  };
  onChange: (next: typeof sim) => void;
  result: BreakEvenResult;
  onSave: () => void;
  saving: boolean;
}) {
  const t = useT();
  return (
    <AdminCard
      title={t("admin.breakeven.simulator")}
      action={
        <Button size="sm" variant="outline" onClick={onToggle}>
          {open ? t("admin.breakeven.simOff") : t("admin.breakeven.simOn")}
        </Button>
      }
    >
      <p className="mb-3 text-xs text-coffee/55">{t("admin.breakeven.simHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumField label={t("admin.breakeven.sim.price")} value={sim.sellingLift * 100} onChange={(value) => onChange({ ...sim, sellingLift: value / 100 })} />
        <NumField label={t("admin.breakeven.sim.food")} value={sim.foodCostLift * 100} onChange={(value) => onChange({ ...sim, foodCostLift: value / 100 })} />
        <NumField label={t("admin.breakeven.sim.rent")} value={sim.rent} onChange={(value) => onChange({ ...sim, rent: value })} />
        <NumField label={t("admin.breakeven.sim.salaries")} value={sim.salaries} onChange={(value) => onChange({ ...sim, salaries: value })} />
        <NumField label={t("admin.breakeven.sim.card")} value={sim.cardPercent} onChange={(value) => onChange({ ...sim, cardPercent: value })} />
        <NumField label={t("admin.breakeven.operatingDays")} value={sim.operatingDays} onChange={(value) => onChange({ ...sim, operatingDays: Math.max(1, value) })} />
        <NumField label={t("admin.breakeven.aov")} value={sim.averageOrderValue} onChange={(value) => onChange({ ...sim, averageOrderValue: value })} />
      </div>
      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label={t("admin.breakeven.title")} value={money(result.breakEvenMonthly)} />
          <Stat label={t("admin.breakeven.dailyTarget")} value={money(result.breakEvenDaily)} />
          <Stat label={t("admin.breakeven.ordersNeeded")} value={result.ordersRequiredDaily == null ? "—" : String(Math.ceil(result.ordersRequiredDaily))} />
        </div>
      )}
      <Button className="mt-4" variant="turquoise" disabled={saving} onClick={onSave}>
        <Save className="h-4 w-4" /> {t("admin.breakeven.saveSim")}
      </Button>
    </AdminCard>
  );
}

function ProductMarginCard({
  rows,
}: {
  rows: NonNullable<ReturnType<typeof productContribution>>[];
}) {
  const t = useT();
  return (
    <AdminCard title={t("admin.breakeven.productCm")}>
      {!rows.length ? (
        <p className="text-sm text-coffee/55">{t("admin.breakeven.noRecipes")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-start text-coffee/55">
                <th className="p-2">{t("admin.breakeven.dish")}</th>
                <th className="p-2">{t("admin.costing.sellingPrice")}</th>
                <th className="p-2">{t("admin.breakeven.foodCost")}</th>
                <th className="p-2">{t("admin.breakeven.extraVariable")}</th>
                <th className="p-2">{t("admin.breakeven.contribution")}</th>
                <th className="p-2">{t("admin.breakeven.cmRatio")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((row) => (
                <tr key={row.productId} className="border-t border-beige-dark/15">
                  <td className="p-2">{row.name}</td>
                  <td className="p-2">{formatIls(row.sellingPrice)}</td>
                  <td className="p-2">{formatIls(row.foodCost)}</td>
                  <td className="p-2">{formatIls(row.extraVariable)}</td>
                  <td className="p-2 font-medium">{formatIls(row.contribution)}</td>
                  <td className="p-2">{formatPercent(row.contributionRatio == null ? null : row.contributionRatio * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

function HistoryCard({
  snapshots,
  previous,
  current,
  onSave,
  saving,
  monthKey,
}: {
  snapshots: BreakEvenSnapshot[];
  previous?: BreakEvenSnapshot;
  current?: BreakEvenSnapshot;
  onSave: () => void;
  saving: boolean;
  monthKey: string;
}) {
  const t = useT();
  const change = snapshotChange(current?.breakEvenRevenue, previous?.breakEvenRevenue);
  return (
    <AdminCard
      title={t("admin.breakeven.history")}
      action={
        <Button size="sm" variant="outline" disabled={saving} onClick={onSave}>
          {t("admin.breakeven.saveSnapshot")} {monthKey}
        </Button>
      }
    >
      {change != null && (
        <p className="mb-3 text-sm">
          {t("admin.breakeven.change")}: {formatPercent(change * 100)}
        </p>
      )}
      {!snapshots.length ? (
        <p className="text-sm text-coffee/55">{t("admin.breakeven.noHistory")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-coffee/55">
                <th className="p-2">{t("admin.breakeven.month")}</th>
                <th className="p-2">{t("admin.breakeven.sold")}</th>
                <th className="p-2">{t("admin.breakeven.title")}</th>
                <th className="p-2">{t("admin.breakeven.contribution")}</th>
                <th className="p-2">{t("admin.breakeven.aov")}</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((item) => (
                <tr key={item.id} className="border-t border-beige-dark/15">
                  <td className="p-2">{item.monthKey}</td>
                  <td className="p-2">{money(item.revenue)}</td>
                  <td className="p-2">{money(item.breakEvenRevenue)}</td>
                  <td className="p-2">{money(item.contributionMargin)}</td>
                  <td className="p-2">{money(item.averageOrderValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

function CostList({
  rows,
  empty,
}: {
  rows: { id: string; title: string; meta: string; active: boolean; onToggle: () => void; onDelete: () => void }[];
  empty: string;
}) {
  if (!rows.length) return <p className="text-sm text-coffee/55">{empty}</p>;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl bg-beige/30 px-3 py-2 text-sm">
          <button type="button" className="min-w-0 text-start" onClick={row.onToggle}>
            <p className={cn("truncate font-medium", !row.active && "opacity-50")}>{row.title}</p>
            <p className="text-xs text-coffee/55">{row.meta}</p>
          </button>
          <Button size="icon-sm" variant="ghost" onClick={row.onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function VatSelect({ value, onChange }: { value: BreakEvenVatMode; onChange: (value: BreakEvenVatMode) => void }) {
  const t = useT();
  return (
    <select className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value as BreakEvenVatMode)}>
      <option value="before">{t("admin.breakeven.vatBefore")}</option>
      <option value="including">{t("admin.breakeven.vatIncluding")}</option>
      <option value="exempt">{t("admin.breakeven.vatExempt")}</option>
    </select>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-beige/40 px-3 py-2">
      <p className="text-xs text-coffee/55">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-coffee/60">{label}</span>
      <Input type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

function Alert({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" }) {
  return (
    <div className={cn("rounded-xl px-3 py-2 text-sm", tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>
      {children}
    </div>
  );
}
