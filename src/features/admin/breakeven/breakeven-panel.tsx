"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Pencil, Plus, Search, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { adminKpiCard, adminTableHeader, adminTableRow } from "@/features/admin/components/admin-styles";
import { formatIls, formatPercent } from "@/lib/costing/money";
import {
  computeBreakEven,
  inferredAppliesTo,
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
  type VariableAppliesTo,
  type VariableCostKind,
} from "@/lib/breakeven/types";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { PosFinanceEntry, PosImport, PosZReport } from "@/lib/inventory/types";
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
import { subscribeToProductCostLinks } from "@/services/costingService";
import type { ProductCostLink } from "@/lib/breakeven/types";
import { CostCompletePanel } from "@/features/admin/breakeven/cost-complete-row";
import { cn } from "@/lib/utils";

type Period = "today" | "week" | "month" | "custom";
type DishSort = "name" | "price" | "contribution" | "ratio";

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

function formatFullDate(iso: string, locale: string) {
  const loc = locale === "ar" ? "ar" : locale === "en" ? "en-GB" : "he-IL";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function monthFromKey(key: string) {
  const [year, month] = key.split("-").map(Number);
  const y = year || new Date().getFullYear();
  const m = month || 1;
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${String(m).padStart(2, "0")}-01`,
    to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function BreakEvenPanel({
  recipes,
  ingredients,
  products,
  vatRate,
  costingVatMode,
  zReports = [],
  financeEntries = [],
  posImports = [],
}: {
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  products: Product[];
  vatRate: number;
  costingVatMode: "before" | "including";
  zReports?: PosZReport[];
  financeEntries?: PosFinanceEntry[];
  posImports?: PosImport[];
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
  const [costLinks, setCostLinks] = useState<ProductCostLink[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [monthPick, setMonthPick] = useState(monthBounds().key);
  const [simDraft, setSimDraft] = useState({
    sellingLift: 0,
    foodCostLift: 0,
    rent: 0,
    salaries: 0,
    cardPercent: 0,
    operatingDays: DEFAULT_BREAK_EVEN_SETTINGS.operatingDays,
  });
  const [scenario, setScenario] = useState<BreakEvenResult | null>(null);
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
        setSimDraft((current) => ({ ...current, operatingDays: value.operatingDays }));
      }),
      subscribeToBreakEvenSnapshots(setSnapshots),
      subscribeToProductCostLinks(setCostLinks),
      subscribeToOrders({ status: "all" }, setOrders, () => undefined),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [vatRate, costingVatMode]);

  const bounds = useMemo(() => rangeFor(period, customFrom, customTo), [period, customFrom, customTo]);
  const month = useMemo(() => monthBounds(), []);
  const catalog = useMemo(
    () =>
      products.map((product) => ({
        id: product.id,
        name: getProductDisplayName(product, locale),
        price: product.price,
      })),
    [products, locale]
  );

  const result = useMemo(
    () =>
      computeBreakEven({
        settings: { ...settings, vatRate: settings.vatRate || vatRate },
        fixed,
        variable,
        orders,
        recipes,
        ingredients,
        products: catalog,
        financeEntries,
        zReports,
        posImports,
        costLinks,
        from: bounds.from,
        to: bounds.to,
      }),
    [settings, vatRate, fixed, variable, orders, recipes, ingredients, catalog, financeEntries, zReports, posImports, costLinks, bounds]
  );

  const costContext = useMemo(
    () => ({ products: catalog, links: costLinks, posImports }),
    [catalog, costLinks, posImports]
  );

  const dishRows = useMemo(
    () =>
      catalog.map((product) =>
        productContribution(product.id, product.name, product.price, recipes, ingredients, costContext)
      ),
    [catalog, recipes, ingredients, costContext]
  );

  const previous = snapshots.find((item) => item.kind !== "scenario" && item.monthKey < month.key);
  const currentSnap = snapshots.find((item) => item.kind !== "scenario" && item.monthKey === month.key);

  async function persistSettings(next: BreakEvenSettings) {
    setSettings(next);
    await saveBreakEvenSettings(next);
  }

  async function persistSnapshot(kind: "saved" | "scenario" = "saved") {
    setSaving(true);
    const source = kind === "scenario" ? scenario ?? result : result;
    const saved = await saveBreakEvenSnapshot(month.key, source, kind);
    setSaving(false);
    setMessage(
      saved.success
        ? kind === "scenario"
          ? t("admin.breakeven.scenarioSaved")
          : t("admin.breakeven.snapshotSaved")
        : t("admin.breakeven.saveFailed")
    );
  }

  const missingActions = result.missing.filter((item) => {
    if (item === "fixed" && result.hasApprovedZeroFixed) return false;
    if (item === "variable" && result.hasApprovedZeroVariable) return false;
    return item !== "margin" || result.contributionRatio != null;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-dark-brown md:text-2xl">{t("admin.breakeven.question")}</h2>
          <p className="mt-1 text-xs text-coffee/60">
            {formatFullDate(bounds.from, locale)} – {formatFullDate(bounds.to, locale)}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {(["today", "week", "month", "custom"] as Period[]).map((item) => (
              <Button key={item} size="sm" variant={period === item ? "turquoise" : "outline"} onClick={() => setPeriod(item)}>
                {t(`admin.breakeven.period.${item}`)}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-coffee/65">
            <span>{t("admin.breakeven.month")}</span>
            <Input
              type="month"
              className="h-9 w-40"
              value={monthPick}
              onChange={(e) => {
                const next = e.target.value;
                setMonthPick(next);
                const range = monthFromKey(next);
                setCustomFrom(range.from);
                setCustomTo(range.to);
                setPeriod("custom");
              }}
            />
          </label>
        </div>
      </div>

      {period === "custom" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}

      <KpiRow result={result} />

      {missingActions.length > 0 && (
        <AdminCard title={t("admin.breakeven.needData")}>
          <ul className="space-y-2">
            {missingActions.map((item) => (
              <li key={item} className="flex flex-col gap-2 rounded-xl bg-beige/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-dark-brown">{t(`admin.breakeven.missing.${item}`)}</p>
                {item !== "margin" && (
                  <Button
                    size="sm"
                    variant="turquoise"
                    onClick={() =>
                      scrollToId(
                        item === "fixed" ? "be-fixed" : item === "variable" ? "be-variable" : item === "mix" ? "be-dishes" : "be-history"
                      )
                    }
                  >
                    {t(`admin.breakeven.action.${item === "sales" ? "sales" : item}`)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {result.canCompute && <p className="mt-3 text-xs text-coffee/60">{t("admin.breakeven.partial")}</p>}
          {!result.canCompute && result.breakEvenMonthly == null && (
            <p className="mt-3 text-xs text-coffee/60">{t("admin.breakeven.noComputedZero")}</p>
          )}
        </AdminCard>
      )}

      {result.mixSource === "estimate" && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("admin.breakeven.mixEstimate")}
          {result.mixAssumptions.includes("equalDishWeight") && ` · ${t("admin.breakeven.assumeEqual")}`}
          {result.mixAssumptions.includes("knownCostDishesOnly") && ` · ${t("admin.breakeven.assumeKnownOnly")}`}
        </p>
      )}
      {result.mixSource === "approved" && (
        <p className="text-xs text-coffee/60">{t("admin.breakeven.mixApproved")}</p>
      )}
      {result.mixSource === "actual" && <p className="text-xs text-coffee/60">{t("admin.breakeven.mixActual")}</p>}
      {result.cardFeeSkipped && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("admin.breakeven.cardFeeSkipped")}</p>
      )}
      {result.mixCostIncomplete && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("admin.breakeven.mixPartialCost")}</p>
      )}

      {result.canCompute && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat label={t("admin.breakeven.elapsed")} value={String(result.elapsedDays)} />
          <MiniStat label={t("admin.breakeven.remaining")} value={String(result.remainingDays)} />
          <MiniStat label={t("admin.breakeven.forecast")} value={money(result.forecast)} />
          <MiniStat label={t("admin.breakeven.requiredFromNow")} value={money(result.requiredDailyFromNow)} />
        </div>
      )}

      <div id="be-fixed">
        <FixedCostsCard items={fixed} operatingDays={settings.operatingDays} />
      </div>
      <div id="be-variable">
        <VariableCostsCard items={variable} />
      </div>

      <Collapsible title={t("admin.breakeven.settings")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-coffee/65">{t("admin.breakeven.operatingDays")}</span>
            <Input
              type="number"
              min={1}
              max={31}
              value={settings.operatingDays}
              onChange={(e) => persistSettings({ ...settings, operatingDays: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-coffee/65">{t("admin.breakeven.vatBasis")}</span>
            <select
              className="h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
              value={settings.vatBasis}
              onChange={(e) => persistSettings({ ...settings, vatBasis: e.target.value as "before" | "including" })}
            >
              <option value="before">{t("admin.breakeven.vatBefore")}</option>
              <option value="including">{t("admin.breakeven.vatIncluding")}</option>
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-coffee/55">{t("admin.breakeven.vatHint")}</p>
      </Collapsible>

      <Collapsible title={t("admin.breakeven.whatIf")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumField label={t("admin.breakeven.sim.price")} value={simDraft.sellingLift * 100} onChange={(value) => setSimDraft({ ...simDraft, sellingLift: value / 100 })} />
          <NumField label={t("admin.breakeven.sim.rent")} value={simDraft.rent} onChange={(value) => setSimDraft({ ...simDraft, rent: value })} />
          <NumField label={t("admin.breakeven.sim.food")} value={simDraft.foodCostLift * 100} onChange={(value) => setSimDraft({ ...simDraft, foodCostLift: value / 100 })} />
          <NumField label={t("admin.breakeven.operatingDays")} value={simDraft.operatingDays} onChange={(value) => setSimDraft({ ...simDraft, operatingDays: Math.max(1, value) })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="turquoise"
            onClick={() =>
              setScenario(
                simulateBreakEven(result, {
                  ...simDraft,
                  cardPercent: simDraft.cardPercent || undefined,
                })
              )
            }
          >
            {t("admin.breakeven.computeScenario")}
          </Button>
          <Button
            variant="outline"
            disabled={saving || !scenario}
            onClick={() => persistSnapshot("scenario")}
          >
            {t("admin.breakeven.saveScenario")}
          </Button>
        </div>
        {scenario && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <MiniStat label={t("admin.breakeven.currentState")} value={money(result.breakEvenMonthly)} />
            <MiniStat label={t("admin.breakeven.scenarioState")} value={money(scenario.breakEvenMonthly)} />
            <MiniStat
              label={t("admin.breakeven.targetDelta")}
              value={
                result.breakEvenMonthly == null || scenario.breakEvenMonthly == null
                  ? "—"
                  : money(scenario.breakEvenMonthly - result.breakEvenMonthly)
              }
            />
          </div>
        )}
        <p className="mt-2 text-xs text-coffee/55">{t("admin.breakeven.simHint")}</p>
      </Collapsible>

      <div id="be-dishes">
        <ProductMarginCard
          rows={dishRows}
          products={products}
          recipes={recipes}
          ingredients={ingredients}
          onSaved={setMessage}
        />
      </div>

      <div id="be-history">
        <Collapsible title={t("admin.breakeven.history")} defaultOpen={false}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-coffee/60">
              {t("admin.breakeven.liveCalc")}: {money(result.breakEvenMonthly)}
            </p>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => persistSnapshot("saved")}>
              {t("admin.breakeven.saveSnapshot")} {month.key}
            </Button>
          </div>
          {currentSnap && previous && snapshotChange(currentSnap.breakEvenRevenue, previous.breakEvenRevenue) != null && (
            <p className="mb-2 text-sm">
              {t("admin.breakeven.change")}: {formatPercent(snapshotChange(currentSnap.breakEvenRevenue, previous.breakEvenRevenue)! * 100)}
            </p>
          )}
          {!snapshots.length ? (
            <p className="text-sm text-coffee/55">{t("admin.breakeven.noHistory")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className={adminTableHeader}>
                  <tr className="text-start">
                    <th className="p-2">{t("admin.breakeven.month")}</th>
                    <th className="p-2">{t("admin.breakeven.savedAt")}</th>
                    <th className="p-2">{t("admin.breakeven.sold")}</th>
                    <th className="p-2">{t("admin.breakeven.target")}</th>
                    <th className="p-2">{t("admin.breakeven.contribution")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((item) => (
                    <tr key={item.id} className={adminTableRow}>
                      <td className="p-2">{item.monthKey}</td>
                      <td className="p-2 text-xs text-coffee/60">
                        {item.createdAt ? formatFullDate(item.createdAt.slice(0, 10), locale) : "—"}
                        <span className="ms-2">
                          {item.kind === "scenario" ? t("admin.breakeven.scenarioSnap") : t("admin.breakeven.savedSnap")}
                        </span>
                      </td>
                      <td className="p-2">{money(item.revenue)}</td>
                      <td className="p-2">{money(item.breakEvenRevenue)}</td>
                      <td className="p-2">{money(item.contributionMargin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Collapsible>
      </div>

      {message && <p className="text-sm text-turquoise">{message}</p>}
    </div>
  );
}

function KpiRow({ result }: { result: BreakEvenResult }) {
  const t = useT();
  const pct = result.progress == null ? null : Math.round(result.progress * 100);
  const bar = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label={t("admin.breakeven.target")} value={money(result.breakEvenMonthly)} hint={t(`admin.breakeven.vatNote.${result.vatBasis}`)} />
        <KpiCard label={t("admin.breakeven.sold")} value={money(result.revenue)} hint={t(`admin.breakeven.vatNote.${result.vatBasis}`)} />
        <KpiCard
          label={result.achieved ? t("admin.breakeven.above") : t("admin.breakeven.short")}
          value={money(result.achieved ? result.aboveBreakEven : result.gap)}
          hint={result.achieved ? t("admin.breakeven.notNetProfit") : t(`admin.breakeven.vatNote.${result.vatBasis}`)}
          tone={result.achieved ? "ok" : undefined}
        />
        <KpiCard label={t("admin.breakeven.dailyTarget")} value={money(result.breakEvenDaily)} hint={t("admin.breakeven.perMonth")} />
      </div>
      <div className="rounded-2xl border border-beige-dark/15 bg-warm-white px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className={cn("text-sm font-medium", result.achieved ? "text-emerald-700" : "text-dark-brown")}>
            {pct == null ? t("admin.breakeven.progress") : fill(t("admin.breakeven.achievedPct"), { pct: String(pct) })}
          </p>
          {result.achieved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("admin.breakeven.achieved")}
            </span>
          )}
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-beige">
          <div
            className={cn("h-full rounded-full", result.achieved ? "bg-emerald-600" : "bg-turquoise")}
            style={{ width: `${bar}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok";
}) {
  return (
    <div className={cn(adminKpiCard, "p-3 md:p-4")}>
      <p className="text-[11px] leading-4 text-coffee/60">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums md:text-3xl", tone === "ok" ? "text-emerald-700" : "text-dark-brown")}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] leading-4 text-coffee/50">{hint}</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-beige/35 px-3 py-2">
      <p className="text-[11px] text-coffee/55">{label}</p>
      <p className="text-sm font-semibold text-dark-brown">{value}</p>
    </div>
  );
}

function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="rounded-2xl border border-beige-dark/15 bg-warm-white px-4 py-3 shadow-soft"
      open={defaultOpen || undefined}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-dark-brown">
        <span>{title}</span>
        <ChevronDown className="h-4 w-4 text-coffee/50" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CategorySelect({
  presets,
  prefix,
  value,
  onChange,
}: {
  presets: readonly string[];
  prefix: string;
  value: string;
  onChange: (value: string, label: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const options = presets.filter((item) => {
    const label = t(`${prefix}.${item}`);
    return !query || label.includes(query) || item.includes(query.toLowerCase());
  });
  return (
    <div className="relative">
      <Input
        value={query || (value ? t(`${prefix}.${value}`) : "")}
        placeholder={t("admin.breakeven.searchCategory")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-xl border border-beige-dark/20 bg-warm-white shadow-soft">
          {options.map((item) => (
            <button
              key={item}
              type="button"
              className="block w-full px-3 py-1.5 text-start text-sm hover:bg-beige/40"
              onClick={() => {
                onChange(item, t(`${prefix}.${item}`));
                setQuery("");
                setOpen(false);
              }}
            >
              {t(`${prefix}.${item}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FixedCostsCard({ items, operatingDays }: { items: BreakEvenFixedCost[]; operatingDays: number }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    amount: "",
    frequency: "monthly" as CostFrequency,
    category: "other",
    vatMode: "before" as BreakEvenVatMode,
  });
  const total = items
    .filter((item) => item.active)
    .reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.frequency, operatingDays), 0);

  async function submit(id?: string) {
    if (!draft.name.trim()) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    await saveFixedCost({
      id,
      name: draft.name,
      amount,
      frequency: draft.frequency,
      category: draft.category,
      vatMode: draft.vatMode,
      active: true,
    });
    setDraft({ name: "", amount: "", frequency: "monthly", category: "other", vatMode: "before" });
    setAdding(false);
    setEditingId(null);
  }

  return (
    <AdminCard
      title={t("admin.breakeven.fixedTitle")}
      icon={<Target className="h-4 w-4 text-turquoise" />}
      action={
        <Button size="sm" variant="turquoise" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          {t("admin.breakeven.addFixed")}
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className={adminTableHeader}>
            <tr className="text-start">
              <th className="p-2">{t("admin.breakeven.name")}</th>
              <th className="p-2">{t("admin.breakeven.amount")}</th>
              <th className="p-2">{t("admin.breakeven.basis")}</th>
              <th className="p-2">{t("admin.breakeven.periodCol")}</th>
              <th className="p-2">{t("admin.breakeven.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="bg-beige/25">
                <td className="p-2" colSpan={5}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.name")}</span>
                      <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.amount")}</span>
                      <Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.category")}</span>
                      <CategorySelect
                        presets={FIXED_COST_PRESETS}
                        prefix="admin.breakeven.fixed"
                        value={draft.category}
                        onChange={(category, label) => setDraft({ ...draft, category, name: draft.name || label })}
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.periodCol")}</span>
                      <FreqSelect value={draft.frequency} onChange={(frequency) => setDraft({ ...draft, frequency })} />
                    </label>
                    <div className="flex items-end gap-2">
                      <Button size="sm" variant="turquoise" onClick={() => submit()}>
                        {t("admin.breakeven.add")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                        {t("admin.breakeven.cancel")}
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {items.map((item) =>
              editingId === item.id ? (
                <tr key={item.id} className="bg-beige/25">
                  <td className="p-2" colSpan={5}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                      <Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                      <FreqSelect value={draft.frequency} onChange={(frequency) => setDraft({ ...draft, frequency })} />
                      <VatSelect value={draft.vatMode} onChange={(vatMode) => setDraft({ ...draft, vatMode })} />
                      <div className="flex gap-2">
                        <Button size="sm" variant="turquoise" onClick={() => submit(item.id)}>
                          {t("admin.breakeven.add")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          {t("admin.breakeven.cancel")}
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className={adminTableRow}>
                  <td className="p-2 font-medium">{item.name}</td>
                  <td className="p-2">{formatIls(item.amount)}</td>
                  <td className="p-2 text-xs text-coffee/60">{item.category ? t(`admin.breakeven.fixed.${item.category}`) : "—"}</td>
                  <td className="p-2 text-xs">{t(`admin.breakeven.freq.${item.frequency}`)}</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(item.id);
                          setDraft({
                            name: item.name,
                            amount: String(item.amount),
                            frequency: item.frequency,
                            category: item.category ?? "other",
                            vatMode: item.vatMode,
                          });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => deleteFixedCost(item.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {!items.length && !adding && (
              <tr>
                <td colSpan={5} className="p-3 text-sm text-coffee/55">
                  {t("admin.breakeven.noFixed")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-beige-dark/20 font-medium">
              <td className="p-2">{t("admin.breakeven.total")}</td>
              <td className="p-2">{items.length ? formatIls(total) : "—"}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </AdminCard>
  );
}

function VariableCostsCard({ items }: { items: BreakEvenVariableCost[] }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    amount: "",
    kind: "percent" as VariableCostKind,
    appliesTo: "all" as VariableAppliesTo,
    vatMode: "exempt" as BreakEvenVatMode,
  });

  async function submit(id?: string) {
    if (!draft.name.trim()) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    await saveVariableCost({
      id,
      name: draft.name,
      kind: draft.kind,
      amount,
      appliesTo: draft.kind === "percent" ? draft.appliesTo : "all",
      vatMode: draft.vatMode,
      active: true,
    });
    setDraft({ name: "", amount: "", kind: "percent", appliesTo: "all", vatMode: "exempt" });
    setAdding(false);
    setEditingId(null);
  }

  function basisLabel(item: BreakEvenVariableCost) {
    if (item.kind === "percent") {
      return `${t("admin.breakeven.kind.percent")} · ${
        inferredAppliesTo(item) === "card" ? t("admin.breakeven.appliesCard") : t("admin.breakeven.appliesAll")
      }`;
    }
    if (item.kind === "per_dish") return t("admin.breakeven.kind.perDish");
    if (item.kind === "per_order") return t("admin.breakeven.kind.perOrder");
    return t("admin.breakeven.kind.fixed");
  }

  return (
    <AdminCard
      title={t("admin.breakeven.variableTitle")}
      action={
        <Button size="sm" variant="turquoise" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          {t("admin.breakeven.addVariable")}
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className={adminTableHeader}>
            <tr className="text-start">
              <th className="p-2">{t("admin.breakeven.name")}</th>
              <th className="p-2">{t("admin.breakeven.amount")}</th>
              <th className="p-2">{t("admin.breakeven.basis")}</th>
              <th className="p-2">{t("admin.breakeven.periodCol")}</th>
              <th className="p-2">{t("admin.breakeven.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="bg-beige/25">
                <td className="p-2" colSpan={5}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.name")}</span>
                      <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.amount")}</span>
                      <Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.category")}</span>
                      <CategorySelect
                        presets={VARIABLE_COST_PRESETS}
                        prefix="admin.breakeven.variable"
                        value=""
                        onChange={(_, label) =>
                          setDraft({
                            ...draft,
                            name: draft.name || label,
                            kind: label.includes("%") ? "percent" : draft.kind,
                            appliesTo: /אשראי|card|بطاقة/i.test(label) ? "card" : draft.appliesTo,
                          })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>{t("admin.breakeven.basis")}</span>
                      <select
                        className="h-10 w-full rounded-xl border border-beige-dark/40 px-2 text-sm"
                        value={draft.kind}
                        onChange={(e) => setDraft({ ...draft, kind: e.target.value as VariableCostKind })}
                      >
                        <option value="percent">{t("admin.breakeven.kind.percent")}</option>
                        <option value="per_dish">{t("admin.breakeven.kind.perDish")}</option>
                        <option value="per_order">{t("admin.breakeven.kind.perOrder")}</option>
                        <option value="fixed">{t("admin.breakeven.kind.fixed")}</option>
                      </select>
                    </label>
                    {draft.kind === "percent" && (
                      <label className="space-y-1 text-xs">
                        <span>{t("admin.breakeven.appliesTo")}</span>
                        <select
                          className="h-10 w-full rounded-xl border border-beige-dark/40 px-2 text-sm"
                          value={draft.appliesTo}
                          onChange={(e) => setDraft({ ...draft, appliesTo: e.target.value as VariableAppliesTo })}
                        >
                          <option value="all">{t("admin.breakeven.appliesAll")}</option>
                          <option value="card">{t("admin.breakeven.appliesCard")}</option>
                        </select>
                      </label>
                    )}
                    <div className="flex items-end gap-2">
                      <Button size="sm" variant="turquoise" onClick={() => submit()}>
                        {t("admin.breakeven.add")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                        {t("admin.breakeven.cancel")}
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {items.map((item) =>
              editingId === item.id ? (
                <tr key={item.id} className="bg-beige/25">
                  <td className="p-2" colSpan={5}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                      <Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                      <select
                        className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm"
                        value={draft.kind}
                        onChange={(e) => setDraft({ ...draft, kind: e.target.value as VariableCostKind })}
                      >
                        <option value="percent">{t("admin.breakeven.kind.percent")}</option>
                        <option value="per_dish">{t("admin.breakeven.kind.perDish")}</option>
                        <option value="per_order">{t("admin.breakeven.kind.perOrder")}</option>
                        <option value="fixed">{t("admin.breakeven.kind.fixed")}</option>
                      </select>
                      {draft.kind === "percent" && (
                        <select
                          className="h-10 rounded-xl border border-beige-dark/40 px-2 text-sm"
                          value={draft.appliesTo}
                          onChange={(e) => setDraft({ ...draft, appliesTo: e.target.value as VariableAppliesTo })}
                        >
                          <option value="all">{t("admin.breakeven.appliesAll")}</option>
                          <option value="card">{t("admin.breakeven.appliesCard")}</option>
                        </select>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="turquoise" onClick={() => submit(item.id)}>
                          {t("admin.breakeven.add")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          {t("admin.breakeven.cancel")}
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className={adminTableRow}>
                  <td className="p-2 font-medium">{item.name}</td>
                  <td className="p-2">{item.kind === "percent" ? `${item.amount}%` : formatIls(item.amount)}</td>
                  <td className="p-2 text-xs text-coffee/60">{basisLabel(item)}</td>
                  <td className="p-2 text-xs">{item.frequency ? t(`admin.breakeven.freq.${item.frequency}`) : "—"}</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(item.id);
                          setDraft({
                            name: item.name,
                            amount: String(item.amount),
                            kind: item.kind,
                            appliesTo: inferredAppliesTo(item),
                            vatMode: item.vatMode,
                          });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => deleteVariableCost(item.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {!items.length && !adding && (
              <tr>
                <td colSpan={5} className="p-3 text-sm text-coffee/55">
                  {t("admin.breakeven.noVariable")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-beige-dark/20 text-xs text-coffee/60">
              <td className="p-2" colSpan={5}>
                {t("admin.breakeven.total")}: {items.filter((item) => item.active).length}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </AdminCard>
  );
}

function ProductMarginCard({
  rows,
  products,
  recipes,
  ingredients,
  onSaved,
}: {
  rows: ReturnType<typeof productContribution>[];
  products: Product[];
  recipes: DishRecipe[];
  ingredients: CostingIngredient[];
  onSaved: (message: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DishSort>("ratio");
  const [missingOnly, setMissingOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const done = rows.filter((row) => !row.costMissing).length;
  const filtered = rows
    .filter((row) => !query || row.name.includes(query))
    .filter((row) => !missingOnly || row.costMissing)
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "price") return b.sellingPrice - a.sellingPrice;
      if (sort === "contribution") return (b.contribution ?? -Infinity) - (a.contribution ?? -Infinity);
      return (b.contributionRatio ?? -Infinity) - (a.contributionRatio ?? -Infinity);
    });

  return (
    <AdminCard title={t("admin.breakeven.productCm")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-dark-brown">
          {fill(t("admin.breakeven.costDone"), { done: String(done), total: String(rows.length) })}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          {t("admin.breakeven.filterMissingCost")}
        </label>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="relative">
          <Search className="pointer-events-none absolute top-2.5 start-3 h-4 w-4 text-coffee/40" />
          <Input className="ps-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.breakeven.searchDish")} />
        </label>
        <select
          className="h-10 rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as DishSort)}
        >
          <option value="ratio">{t("admin.breakeven.cmRatio")}</option>
          <option value="contribution">{t("admin.breakeven.contribution")}</option>
          <option value="price">{t("admin.costing.sellingPrice")}</option>
          <option value="name">{t("admin.breakeven.dish")}</option>
        </select>
      </div>
      {!filtered.length ? (
        <p className="text-sm text-coffee/55">{t("admin.breakeven.noRecipes")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={adminTableHeader}>
              <tr className="text-start">
                <th className="p-2">{t("admin.breakeven.dish")}</th>
                <th className="p-2">{t("admin.costing.sellingPrice")}</th>
                <th className="p-2">{t("admin.breakeven.foodCost")}</th>
                <th className="p-2">{t("admin.breakeven.extraVariable")}</th>
                <th className="p-2">{t("admin.breakeven.contribution")}</th>
                <th className="p-2">{t("admin.breakeven.cmRatio")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <Fragment key={row.productId}>
                  <tr className={adminTableRow}>
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{formatIls(row.sellingPrice)}</td>
                    <td className="p-2">
                      {row.costMissing ? (
                        <Button size="sm" variant="turquoise" onClick={() => setOpenId(openId === row.productId ? null : row.productId)}>
                          {t("admin.breakeven.completeCost")}
                        </Button>
                      ) : (
                        <div>
                          <p>{money(row.foodCost)}</p>
                          {row.costBasis && (
                            <p className="text-[11px] text-coffee/55">{t(`admin.breakeven.basis.${row.costBasis}`)}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-2">{row.costMissing ? "—" : money(row.extraVariable)}</td>
                    <td className="p-2 font-medium">{row.costMissing ? "—" : money(row.contribution)}</td>
                    <td className="p-2">
                      {row.costMissing ? "—" : formatPercent(row.contributionRatio == null ? null : row.contributionRatio * 100)}
                    </td>
                  </tr>
                  {openId === row.productId && (
                    <tr key={`${row.productId}-edit`}>
                      <td colSpan={6} className="p-2">
                        <CostCompletePanel
                          row={row}
                          products={products}
                          recipes={recipes}
                          ingredients={ingredients}
                          onSaved={(message) => {
                            setOpenId(null);
                            onSaved(message);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

function FreqSelect({ value, onChange }: { value: CostFrequency; onChange: (value: CostFrequency) => void }) {
  const t = useT();
  return (
    <select
      className="h-10 w-full rounded-xl border border-beige-dark/40 px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as CostFrequency)}
    >
      <option value="daily">{t("admin.breakeven.freq.daily")}</option>
      <option value="weekly">{t("admin.breakeven.freq.weekly")}</option>
      <option value="monthly">{t("admin.breakeven.freq.monthly")}</option>
      <option value="yearly">{t("admin.breakeven.freq.yearly")}</option>
    </select>
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

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-coffee/65">{label}</span>
      <Input type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}
