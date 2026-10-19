"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, Pencil, Plus, Search, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { adminKpiCard, adminTableHeader, adminTableRow } from "@/features/admin/components/admin-styles";
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
  type BreakEvenFixedCost,
  type BreakEvenResult,
  type BreakEvenSettings,
  type BreakEvenSnapshot,
  type BreakEvenVariableCost,
  type BreakEvenVatMode,
  type CostFrequency,
  type PaymentSchedule,
} from "@/lib/breakeven/types";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { PosFinanceEntry, PosImport, PosZReport } from "@/lib/inventory/types";
import type { Order, Product } from "@/types";
import { billingDayFromDate, nextOccurrence, paymentScheduleOf } from "@/lib/cashflow/engine";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import { subscribeToOrders } from "@/services/orderService";
import {
  deleteFixedCost,
  saveBreakEvenSettings,
  saveBreakEvenSnapshot,
  saveFixedCost,
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
                {item !== "margin" && item !== "variable" && (
                  <Button
                    size="sm"
                    variant="turquoise"
                    onClick={() =>
                      scrollToId(item === "fixed" ? "be-fixed" : item === "mix" ? "be-dishes" : "be-history")
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

      <div id="be-fixed" className="min-w-0">
        <FixedCostsCard items={fixed} operatingDays={settings.operatingDays} />
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

const MENU_LIMIT = 240;
const SCREEN_GAP = 8;

function anchoredBox(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(rect.width, window.innerWidth - SCREEN_GAP * 2);
  const left = Math.min(Math.max(SCREEN_GAP, rect.left), Math.max(SCREEN_GAP, window.innerWidth - width - SCREEN_GAP));
  const spaceBelow = window.innerHeight - rect.bottom - 4 - SCREEN_GAP;
  const spaceAbove = rect.top - 4 - SCREEN_GAP;
  const below = spaceBelow >= spaceAbove;
  const maxHeight = Math.max(0, Math.min(MENU_LIMIT, below ? spaceBelow : spaceAbove));
  return below
    ? { position: "fixed", top: rect.bottom + 4, left, width, maxHeight, zIndex: 1020 }
    : { position: "fixed", bottom: window.innerHeight - rect.top + 4, left, width, maxHeight, zIndex: 1020 };
}

function useAnchoredStyle(open: boolean, anchorRef: RefObject<HTMLElement | null>, panelRef: RefObject<HTMLElement | null>) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      if (anchor) setStyle(anchoredBox(anchor));
    };
    place();
    const onScroll = (event: Event) => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, anchorRef, panelRef]);
  return open ? style : null;
}

function AnchoredPanel({
  open,
  anchorRef,
  panelRef,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const style = useAnchoredStyle(open, anchorRef, panelRef);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!open || !mounted || !style) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      data-anchored-menu=""
      className="overflow-y-auto overscroll-contain rounded-xl border border-beige-dark/25 bg-white py-1 shadow-soft"
    >
      {children}
    </div>,
    document.body
  );
}

function FieldList<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((item) => item.value === value);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((item) => item.value === value)));
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, options, value]);

  function reveal(index: number) {
    const panel = panelRef.current;
    const option = panel?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!panel || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
  }

  function move(next: number) {
    if (!options.length) return;
    const index = (next + options.length) % options.length;
    setActive(index);
    reveal(index);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      move(event.key === "ArrowDown" ? active + 1 : active - 1);
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(active);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-beige-dark/40 bg-white px-3 text-start text-sm text-dark-brown"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKey}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-coffee/50" />
      </button>
      <AnchoredPanel open={open} anchorRef={triggerRef} panelRef={panelRef}>
        <div id={listId} role="listbox">
          {options.map((item, index) => {
            const isSelected = item.value === value;
            return (
              <button
                key={item.value || "empty"}
                type="button"
                role="option"
                data-index={index}
                aria-selected={isSelected}
                className={`flex min-h-11 w-full items-center px-3 text-start text-sm ${
                  isSelected ? "bg-turquoise/15 font-medium text-dark-brown" : "text-dark-brown hover:bg-beige/50"
                } ${index === active ? "ring-1 ring-inset ring-turquoise/40" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </AnchoredPanel>
    </>
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
  const [active, setActive] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const options = presets.filter((item) => {
    const label = t(`${prefix}.${item}`);
    return !query || label.includes(query) || item.includes(query.toLowerCase());
  });
  const selectedIndex = Math.max(0, options.findIndex((item) => item === value));
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  useEffect(() => {
    if (!open) return;
    setActive(selectedIndexRef.current);
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  function reveal(index: number) {
    const panel = panelRef.current;
    const option = panel?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!panel || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
  }
  function choose(index: number) {
    const item = options[index];
    if (!item) return;
    onChange(item, t(`${prefix}.${item}`));
    setQuery("");
    setOpen(false);
  }
  function onInputKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open || !options.length) {
        setOpen(true);
        return;
      }
      const next = event.key === "ArrowDown" ? active + 1 : active - 1;
      const index = (next + options.length) % options.length;
      setActive(index);
      reveal(index);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(active);
    }
  }
  return (
    <div ref={anchorRef}>
      <Input
        value={query || (value ? t(`${prefix}.${value}`) : "")}
        placeholder={t("admin.breakeven.searchCategory")}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKey}
      />
      <AnchoredPanel open={open} anchorRef={anchorRef} panelRef={panelRef}>
        <div role="listbox">
          {options.map((item, index) => (
            <button
              key={item}
              type="button"
              role="option"
              data-index={index}
              aria-selected={item === value}
              className={`block min-h-11 w-full px-3 text-start text-sm ${
                item === value ? "bg-turquoise/15 font-medium text-dark-brown" : "text-dark-brown hover:bg-beige/50"
              } ${index === active ? "ring-1 ring-inset ring-turquoise/40" : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {t(`${prefix}.${item}`)}
            </button>
          ))}
        </div>
      </AnchoredPanel>
    </div>
  );
}

type FixedDraft = {
  name: string;
  amount: string;
  frequency: CostFrequency;
  category: string;
  vatMode: BreakEvenVatMode;
  paymentFrequency: "" | PaymentSchedule;
  nextPaymentDate: string;
  billingStart: string;
  billingEnd: string;
  billingDay: string;
  paymentAccount: string;
};

function emptyFixedDraft(): FixedDraft {
  return {
    name: "",
    amount: "",
    frequency: "monthly",
    category: "other",
    vatMode: "before",
    paymentFrequency: "",
    nextPaymentDate: "",
    billingStart: "",
    billingEnd: "",
    billingDay: "",
    paymentAccount: "",
  };
}

function draftFromCost(item: BreakEvenFixedCost): FixedDraft {
  return {
    name: item.name,
    amount: String(item.amount),
    frequency: item.frequency,
    category: item.category ?? "other",
    vatMode: item.vatMode,
    paymentFrequency: item.paymentFrequency ?? "",
    nextPaymentDate: item.nextPaymentDate ?? "",
    billingStart: item.billingStart ?? "",
    billingEnd: item.billingEnd ?? "",
    billingDay: item.billingDay ? String(item.billingDay) : "",
    paymentAccount: item.paymentAccount ?? "",
  };
}

function FixedCostsCard({ items, operatingDays }: { items: BreakEvenFixedCost[]; operatingDays: number }) {
  const t = useT();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FixedDraft>(emptyFixedDraft);
  const total = items
    .filter((item) => item.active)
    .reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.frequency, operatingDays), 0);

  async function submit(id?: string) {
    if (!draft.name.trim()) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    const dayFromDate = billingDayFromDate(draft.nextPaymentDate);
    await saveFixedCost({
      id,
      name: draft.name,
      amount,
      frequency: draft.frequency,
      category: draft.category,
      vatMode: draft.vatMode,
      active: true,
      paymentFrequency: draft.paymentFrequency || null,
      billingDay: dayFromDate ?? (draft.billingDay ? Number(draft.billingDay) : null),
      billingStart: draft.billingStart || draft.nextPaymentDate || null,
      billingEnd: draft.billingEnd || null,
      nextPaymentDate: draft.nextPaymentDate || null,
      paymentAccount: draft.paymentAccount.trim() || null,
    });
    setDraft(emptyFixedDraft());
    setAdding(false);
    setEditingId(null);
  }

  return (
    <AdminCard
      title={t("admin.breakeven.fixedTitle")}
      icon={<Target className="h-4 w-4 text-turquoise" />}
      action={
        <Button
          size="sm"
          variant="turquoise"
          type="button"
          onClick={() => {
            setEditingId(null);
            setDraft(emptyFixedDraft());
            setAdding(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("admin.breakeven.addFixed")}
        </Button>
      }
    >
      <p className="mb-3 text-xs text-coffee/60">{t("admin.breakeven.cashNote")}</p>
      {(adding || editingId) && (
        <div data-fixed-form="" className="mb-3 grid grid-cols-1 gap-2 rounded-xl bg-beige/25 p-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span>{t("admin.breakeven.name")}</span>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("admin.breakeven.amount")}</span>
            <Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          </label>
          {!editingId && (
            <label className="space-y-1 text-xs">
              <span>{t("admin.breakeven.category")}</span>
              <CategorySelect
                presets={FIXED_COST_PRESETS}
                prefix="admin.breakeven.fixed"
                value={draft.category}
                onChange={(category, label) => setDraft({ ...draft, category, name: draft.name || label })}
              />
            </label>
          )}
          <label className="space-y-1 text-xs">
            <span>{t("admin.breakeven.periodForBreakEven")}</span>
            <FreqSelect value={draft.frequency} onChange={(frequency) => setDraft({ ...draft, frequency })} />
          </label>
          {editingId && (
            <label className="space-y-1 text-xs">
              <span>{t("admin.breakeven.basis")}</span>
              <VatSelect value={draft.vatMode} onChange={(vatMode) => setDraft({ ...draft, vatMode })} />
            </label>
          )}
          <PaymentFields draft={draft} onChange={setDraft} />
          <div className="flex items-end gap-2">
            <Button type="button" size="sm" variant="turquoise" onClick={() => submit(editingId ?? undefined)}>
              {t("admin.breakeven.add")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding(false);
                setEditingId(null);
              }}
            >
              {t("admin.breakeven.cancel")}
            </Button>
          </div>
        </div>
      )}
      <div className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden">
        <table className="min-w-full text-sm">
          <thead className={adminTableHeader}>
            <tr className="text-start">
              <th className="p-2">{t("admin.breakeven.name")}</th>
              <th className="p-2">{t("admin.breakeven.amount")}</th>
              <th className="p-2">{t("admin.breakeven.basis")}</th>
              <th className="p-2">{t("admin.breakeven.periodForBreakEven")}</th>
              <th className="p-2">{t("admin.breakeven.paymentDate")}</th>
              <th className="p-2">{t("admin.breakeven.paymentFrequency")}</th>
              <th className="p-2">{t("admin.breakeven.paymentAccount")}</th>
              <th className="p-2">{t("admin.breakeven.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
                <tr key={item.id} className={adminTableRow}>
                  <td className="p-2 font-medium">{item.name}</td>
                  <td className="p-2">{formatIls(item.amount)}</td>
                  <td className="p-2 text-xs text-coffee/60">{item.category ? t(`admin.breakeven.fixed.${item.category}`) : "—"}</td>
                  <td className="p-2 text-xs">{t(`admin.breakeven.freq.${item.frequency}`)}</td>
                  <td className="p-2 text-xs">{paymentScheduleOf(item) ? (nextOccurrence(item, today) ?? "—") : t("admin.breakeven.missingPaymentDate")}</td>
                  <td className="p-2 text-xs">{item.paymentFrequency ? t(`admin.breakeven.pay.${item.paymentFrequency}`) : t("admin.breakeven.missingPaymentDate")}</td>
                  <td className="p-2 text-xs">{item.paymentAccount || "—"}</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          setAdding(false);
                          setEditingId(item.id);
                          setDraft(draftFromCost(item));
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
            ))}
            {!items.length && !adding && (
              <tr>
                <td colSpan={8} className="p-3 text-sm text-coffee/55">
                  {t("admin.breakeven.noFixed")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-beige-dark/20 font-medium">
              <td className="p-2">{t("admin.breakeven.total")}</td>
              <td className="p-2">{items.length ? formatIls(total) : "—"}</td>
              <td colSpan={6} />
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

function PaymentFields({ draft, onChange }: { draft: FixedDraft; onChange: (draft: FixedDraft) => void }) {
  const t = useT();
  return (
    <>
      <label className="space-y-1 text-xs">
        <span>{t("admin.breakeven.paymentFrequency")}</span>
        <FieldList
          value={draft.paymentFrequency}
          options={[
            { value: "", label: t("admin.breakeven.missingPaymentDate") },
            { value: "once", label: t("admin.breakeven.pay.once") },
            { value: "monthly", label: t("admin.breakeven.pay.monthly") },
            { value: "bimonthly", label: t("admin.breakeven.pay.bimonthly") },
            { value: "quarterly", label: t("admin.breakeven.pay.quarterly") },
            { value: "yearly", label: t("admin.breakeven.pay.yearly") },
          ]}
          onChange={(paymentFrequency) => onChange({ ...draft, paymentFrequency })}
        />
      </label>
      <label className="space-y-1 text-xs">
        <span>{t("admin.breakeven.paymentDate")}</span>
        <Input
          type="date"
          value={draft.nextPaymentDate}
          onChange={(event) => {
            const nextPaymentDate = event.target.value;
            const day = billingDayFromDate(nextPaymentDate);
            onChange({
              ...draft,
              nextPaymentDate,
              billingDay: day ? String(day) : draft.billingDay,
              billingStart: draft.billingStart || nextPaymentDate,
            });
          }}
        />
      </label>
      <label className="space-y-1 text-xs">
        <span>{t("admin.breakeven.billingStart")}</span>
        <Input type="date" value={draft.billingStart} onChange={(event) => onChange({ ...draft, billingStart: event.target.value })} />
      </label>
      <label className="space-y-1 text-xs">
        <span>{t("admin.breakeven.billingEnd")}</span>
        <Input type="date" value={draft.billingEnd} onChange={(event) => onChange({ ...draft, billingEnd: event.target.value })} />
      </label>
      <label className="space-y-1 text-xs">
        <span>{t("admin.breakeven.paymentAccount")}</span>
        <Input value={draft.paymentAccount} onChange={(event) => onChange({ ...draft, paymentAccount: event.target.value })} />
      </label>
    </>
  );
}

function FreqSelect({ value, onChange }: { value: CostFrequency; onChange: (value: CostFrequency) => void }) {
  const t = useT();
  return (
    <FieldList
      value={value}
      options={[
        { value: "daily", label: t("admin.breakeven.freq.daily") },
        { value: "weekly", label: t("admin.breakeven.freq.weekly") },
        { value: "monthly", label: t("admin.breakeven.freq.monthly") },
        { value: "yearly", label: t("admin.breakeven.freq.yearly") },
      ]}
      onChange={onChange}
    />
  );
}

function VatSelect({ value, onChange }: { value: BreakEvenVatMode; onChange: (value: BreakEvenVatMode) => void }) {
  const t = useT();
  return (
    <FieldList
      value={value}
      options={[
        { value: "before", label: t("admin.breakeven.vatBefore") },
        { value: "including", label: t("admin.breakeven.vatIncluding") },
        { value: "exempt", label: t("admin.breakeven.vatExempt") },
      ]}
      onChange={onChange}
    />
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
