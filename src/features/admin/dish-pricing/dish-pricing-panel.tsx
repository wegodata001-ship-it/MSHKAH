"use client";

/**
 * ADMIN → מלאי ותמחור → תמחור מנות ורווחיות
 *
 * This panel is the user-facing surface for the dish-pricing module.
 * Everything you see here is a **view** over the data already loaded by
 * `CostingAdmin` — we do not open new Firestore subscriptions, we do not
 * duplicate the products admin, and we do not maintain a parallel
 * ingredient list. Writes are routed through dedicated admin API routes
 * so the authorisation + audit trail live on the server.
 *
 * The three tabs match section 3 of the brief:
 *   • "תמחור מנות"          — table of every product with price, cost,
 *                              profit, Food Cost %, status, visibility,
 *                              inline edit of the sale price.
 *   • "מרכיבים ומתכונים"   — delegates straight to the existing
 *                              `RecipeEditorModal`. No duplicate storage.
 *   • "רווחיות ובקרה"       — KPIs computed from the dish rows + a chip
 *                              filter row for the diagnostics defined in
 *                              `dishDiagnosticsCount`.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Search,
  ShieldAlert,
  Tag,
} from "lucide-react";
import { AdminCard } from "@/features/admin/components/admin-card";
import { AdminKpiCard } from "@/features/admin/components/admin-kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { cn } from "@/lib/utils";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Category, Product } from "@/types";
import type { Locale } from "@/lib/i18n/types";
import type { DishCostRow } from "@/lib/costing/model";
import type { CostingSettings } from "@/lib/costing/types";
import {
  type DishCostState,
  type DishDiagnostic,
  type DishPricingRow,
  diagnoseRow,
  dishDiagnosticsCount,
  dishPricingSummary,
  toPricingRow,
} from "@/lib/costing/dish-pricing";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";

export type DishPricingPanelProps = {
  rows: DishCostRow[];
  settings: CostingSettings;
  categories: Category[];
  locale: Locale;
  loading: boolean;
  onEditRecipe: (productId: string) => void;
  onToast: (message: string, variant?: "success" | "error") => void;
  canEditPrice: boolean;
  canApproveCost: boolean;
};

type InnerTab = "pricing" | "recipes" | "control";

const COST_STATE_LABEL_KEY: Record<DishCostState, string> = {
  computed_recipe: "admin.dishPricing.state.recipe",
  verified_manual: "admin.dishPricing.state.verified",
  imported_unverified: "admin.dishPricing.state.unverified",
  missing: "admin.dishPricing.state.missing",
};

const COST_STATE_TONE: Record<DishCostState, string> = {
  computed_recipe: "bg-emerald-100 text-emerald-800 border-emerald-200",
  verified_manual: "bg-sky-100 text-sky-800 border-sky-200",
  imported_unverified: "bg-amber-100 text-amber-800 border-amber-300",
  missing: "bg-rose-100 text-rose-800 border-rose-200",
};

const DIAGNOSTIC_KEYS: DishDiagnostic[] = [
  "loss",
  "zero_profit",
  "missing_cost",
  "imported_unverified",
  "positive",
  "no_category",
  "no_image",
  "hidden",
  "unusual_price",
];

function statusColor(status: DishPricingRow["foodCostStatus"]): string {
  if (status === "good") return "text-emerald-700";
  if (status === "watch") return "text-amber-700";
  if (status === "loss") return "text-rose-700";
  return "text-coffee/60";
}

function foodCostLabel(row: DishPricingRow): string {
  if (row.foodCostPercent == null) return "—";
  return `${row.foodCostPercent.toFixed(1)}%`;
}

function moneyOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatIls(value);
}

export function DishPricingPanel({
  rows,
  settings,
  categories,
  locale,
  loading,
  onEditRecipe,
  onToast,
  canEditPrice,
  canApproveCost,
}: DishPricingPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<InnerTab>("pricing");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState<"all" | DishCostState>("all");
  const [diagnosticFilter, setDiagnosticFilter] = useState<DishDiagnostic | null>(null);
  const [quickFilter, setQuickFilter] = useState<"all" | "profit" | "low" | "loss" | "missing" | "norecipe" | "nocat" | "hidden">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const pricingRows: DishPricingRow[] = useMemo(
    () => rows.map((row) => toPricingRow(row, settings)),
    [rows, settings]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pricingRows.filter((row) => {
      if (q) {
        const name = getProductDisplayName(row.product, locale).toLowerCase();
        if (!name.includes(q)) return false;
      }
      if (categoryFilter !== "all" && row.product.categoryId !== categoryFilter) return false;
      if (stateFilter !== "all" && row.costState !== stateFilter) return false;
      if (diagnosticFilter && !diagnoseRow(row).includes(diagnosticFilter)) return false;
      if (quickFilter === "profit" && !(row.grossProfit != null && row.grossProfit > 0.001)) return false;
      if (quickFilter === "low" && !(row.grossMarginPercent != null && row.grossMarginPercent > 0 && row.grossMarginPercent < 25)) return false;
      if (quickFilter === "loss" && !(row.grossProfit != null && row.grossProfit < -0.001)) return false;
      if (quickFilter === "missing" && row.costState !== "missing") return false;
      if (quickFilter === "norecipe" && row.recipeLineCount > 0) return false;
      if (quickFilter === "nocat" && Boolean(row.product.categoryId?.trim())) return false;
      if (quickFilter === "hidden" && !(row.product.hidden || row.product.active === false)) return false;
      return true;
    });
  }, [pricingRows, search, categoryFilter, stateFilter, diagnosticFilter, quickFilter, locale]);

  const summary = useMemo(() => dishPricingSummary(pricingRows), [pricingRows]);
  const diagnosticsCount = useMemo(() => dishDiagnosticsCount(pricingRows), [pricingRows]);

  const startEdit = (row: DishPricingRow) => {
    if (!canEditPrice) {
      onToast(t("admin.dishPricing.toast.noPermission"), "error");
      return;
    }
    setEditingId(row.productId);
    setEditDraft(String(row.product.price.toFixed(2)));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const commitEdit = async (row: DishPricingRow) => {
    const parsed = Number(editDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      onToast(t("admin.dishPricing.toast.invalidPrice"), "error");
      return;
    }
    if (Math.abs(parsed - row.product.price) <= 0.001) {
      cancelEdit();
      return;
    }
    setSavingId(row.productId);
    try {
      const result = await clientAdminFetch<{
        ok: boolean;
        price: number;
        previousPrice: number;
        code?: string;
        message?: string;
      }>("/api/admin/dish-pricing/price", {
        productId: row.productId,
        nextPrice: parsed,
        expectedCurrentPrice: row.product.price,
      });
      if (!result.ok) {
        onToast(
          `${t("admin.dishPricing.toast.saveFailed")} (${result.code ?? result.error ?? ""})`,
          "error"
        );
        return;
      }
      onToast(t("admin.dishPricing.toast.saved"), "success");
      cancelEdit();
    } finally {
      setSavingId(null);
    }
  };

  const approveCost = async (row: DishPricingRow) => {
    if (!canApproveCost) {
      onToast(t("admin.dishPricing.toast.noPermission"), "error");
      return;
    }
    const confirmed = window.confirm(t("admin.dishPricing.cost.confirmApprove"));
    if (!confirmed) return;
    setSavingId(row.productId);
    try {
      const result = await clientAdminFetch<{ ok: boolean }>(
        "/api/admin/dish-pricing/cost",
        {
          productId: row.productId,
          verified: true,
          cost: row.product.cost,
        }
      );
      if (!result.ok) {
        onToast(t("admin.dishPricing.toast.saveFailed"), "error");
        return;
      }
      onToast(t("admin.dishPricing.toast.costApproved"), "success");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-beige-dark/20">
        {([
          ["pricing", "admin.dishPricing.tab.pricing"],
          ["recipes", "admin.dishPricing.tab.recipes"],
          ["control", "admin.dishPricing.tab.control"],
        ] as [InnerTab, string][]).map(([id, labelKey]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === id
                ? "border-turquoise text-coffee"
                : "border-transparent text-coffee/55 hover:text-coffee"
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          ["all", pricingRows.length],
          ["profit", pricingRows.filter((row) => row.grossProfit != null && row.grossProfit > 0.001).length],
          ["low", pricingRows.filter((row) => row.grossMarginPercent != null && row.grossMarginPercent > 0 && row.grossMarginPercent < 25).length],
          ["loss", pricingRows.filter((row) => row.grossProfit != null && row.grossProfit < -0.001).length],
          ["missing", pricingRows.filter((row) => row.costState === "missing").length],
          ["norecipe", pricingRows.filter((row) => row.recipeLineCount === 0).length],
          ["nocat", pricingRows.filter((row) => !row.product.categoryId?.trim()).length],
          ["hidden", pricingRows.filter((row) => row.product.hidden || row.product.active === false).length],
        ] as const).map(([id, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setQuickFilter(id)}
            className={cn(
              "shrink-0 rounded-full px-3 py-2 text-sm font-semibold",
              quickFilter === id ? "bg-turquoise text-warm-white" : "bg-warm-white text-coffee"
            )}
          >
            {t(`admin.dishPricing.quick.${id}`)} · {count}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="ps-9"
            placeholder={t("admin.dishPricing.search")}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="h-10 rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
        >
          <option value="all">{t("admin.dishPricing.filter.allCategories")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {locale === "ar"
                ? category.name_ar || category.name_he
                : locale === "en"
                  ? category.name_en || category.name_he
                  : category.name_he}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value as "all" | DishCostState)}
          className="h-10 rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
        >
          <option value="all">{t("admin.dishPricing.filter.allStates")}</option>
          <option value="computed_recipe">{t("admin.dishPricing.state.recipe")}</option>
          <option value="verified_manual">{t("admin.dishPricing.state.verified")}</option>
          <option value="imported_unverified">{t("admin.dishPricing.state.unverified")}</option>
          <option value="missing">{t("admin.dishPricing.state.missing")}</option>
        </select>
        {diagnosticFilter && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDiagnosticFilter(null)}
            className="text-sm"
          >
            {t("admin.dishPricing.filter.clear")}
          </Button>
        )}
      </div>

      {tab === "pricing" && (
        <PricingTabBody
          rows={filteredRows}
          loading={loading}
          locale={locale}
          editingId={editingId}
          savingId={savingId}
          editDraft={editDraft}
          onEditDraft={setEditDraft}
          onStartEdit={startEdit}
          onCancelEdit={cancelEdit}
          onCommitEdit={commitEdit}
          onEditRecipe={onEditRecipe}
          onApproveCost={approveCost}
          canApproveCost={canApproveCost}
        />
      )}

      {tab === "recipes" && (
        <RecipesTabBody
          rows={filteredRows}
          locale={locale}
          onEditRecipe={onEditRecipe}
        />
      )}

      {tab === "control" && (
        <ControlTabBody
          summary={summary}
          diagnosticsCount={diagnosticsCount}
          activeDiagnostic={diagnosticFilter}
          onDiagnosticClick={(diagnostic) => {
            setTab("pricing");
            setDiagnosticFilter(diagnostic);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------- Tab A: Pricing table -------------------------------- */

function PricingTabBody(props: {
  rows: DishPricingRow[];
  loading: boolean;
  locale: Locale;
  editingId: string | null;
  savingId: string | null;
  editDraft: string;
  onEditDraft: (value: string) => void;
  onStartEdit: (row: DishPricingRow) => void;
  onCancelEdit: () => void;
  onCommitEdit: (row: DishPricingRow) => void;
  onEditRecipe: (productId: string) => void;
  onApproveCost: (row: DishPricingRow) => void;
  canApproveCost: boolean;
}) {
  const t = useT();
  if (props.loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
      </div>
    );
  }
  if (props.rows.length === 0) {
    return (
      <AdminCard>
        <p className="text-sm text-coffee/55">{t("admin.dishPricing.empty")}</p>
      </AdminCard>
    );
  }

  return (
    <>
      {/* Mobile */}
      <div className="space-y-2 lg:hidden">
        {props.rows.map((row) => (
          <PricingMobileCard key={row.productId} row={row} {...props} />
        ))}
      </div>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-2xl border border-beige-dark/20 lg:block">
        <table className="min-w-[940px] w-full text-base">
          <thead className="bg-beige/50 text-sm font-bold text-dark-brown">
            <tr>
              <th className="px-4 py-3 text-start">{t("admin.dishPricing.col.name")}</th>
              <th className="px-4 py-3 text-end">{t("admin.dishPricing.col.price")}</th>
              <th className="px-3 py-2 text-end">{t("admin.dishPricing.col.cost")}</th>
              <th className="px-3 py-2 text-end">{t("admin.dishPricing.col.profit")}</th>
              <th className="px-3 py-2 text-end">{t("admin.dishPricing.col.margin")}</th>
              <th className="px-3 py-2 text-end">{t("admin.dishPricing.col.foodCost")}</th>
              <th className="px-3 py-2 text-start">{t("admin.dishPricing.col.state")}</th>
              <th className="px-3 py-2 text-start">{t("admin.dishPricing.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <PricingRow key={row.productId} row={row} {...props} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PricingRow(props: {
  row: DishPricingRow;
  locale: Locale;
  editingId: string | null;
  savingId: string | null;
  editDraft: string;
  onEditDraft: (value: string) => void;
  onStartEdit: (row: DishPricingRow) => void;
  onCancelEdit: () => void;
  onCommitEdit: (row: DishPricingRow) => void;
  onEditRecipe: (productId: string) => void;
  onApproveCost: (row: DishPricingRow) => void;
  canApproveCost: boolean;
}) {
  const { row } = props;
  const t = useT();
  const isEditing = props.editingId === row.productId;
  const isSaving = props.savingId === row.productId;
  const hidden = row.product.hidden || row.product.active === false;

  return (
    <tr className={cn("border-t border-beige-dark/10", hidden && "opacity-70")}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {hidden && <EyeOff className="h-3.5 w-3.5 text-coffee/55" aria-label={t("admin.dishPricing.hidden")} />}
          <span className="text-[18px] font-semibold text-dark-brown">{getProductDisplayName(row.product, props.locale)}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-end">
        {isEditing ? (
          <div className="flex items-center justify-end gap-1">
            <Input
              value={props.editDraft}
              onChange={(event) => props.onEditDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") props.onCommitEdit(row);
                if (event.key === "Escape") props.onCancelEdit();
              }}
              className="h-8 w-24 text-end"
              inputMode="decimal"
              autoFocus
            />
            <Button
              type="button"
              variant="turquoise"
              onClick={() => props.onCommitEdit(row)}
              disabled={isSaving}
              className="h-8 px-2"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("common.save")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => props.onStartEdit(row)}
            className="group inline-flex min-h-11 items-center gap-1 rounded-md px-2 py-1 hover:bg-beige/50"
          >
            <span className="text-xl font-bold tabular-nums">{formatIls(row.product.price)}</span>
            <Edit3 className="h-4 w-4 text-coffee/40 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-end">{moneyOrDash(row.effectiveCostNet)}</td>
      <td className={cn("px-3 py-3 text-end text-xl font-bold tabular-nums", statusColor(row.foodCostStatus))}>
        {moneyOrDash(row.grossProfit)}
      </td>
      <td className="px-3 py-2 text-end">
        {row.grossMarginPercent == null ? "—" : `${row.grossMarginPercent.toFixed(1)}%`}
      </td>
      <td className={cn("px-3 py-2 text-end font-medium", statusColor(row.foodCostStatus))}>
        {foodCostLabel(row)}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
            COST_STATE_TONE[row.costState]
          )}
        >
          {t(COST_STATE_LABEL_KEY[row.costState])}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => props.onEditRecipe(row.productId)}
            className="text-turquoise"
          >
            {t("admin.dishPricing.action.recipe")}
          </button>
          {row.costState === "imported_unverified" && (
            <button
              type="button"
              onClick={() => props.onApproveCost(row)}
              disabled={!props.canApproveCost}
              className={cn(
                "text-amber-700",
                !props.canApproveCost && "cursor-not-allowed opacity-50"
              )}
            >
              {t("admin.dishPricing.action.approveCost")}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function PricingMobileCard(props: {
  row: DishPricingRow;
  locale: Locale;
  editingId: string | null;
  savingId: string | null;
  editDraft: string;
  onEditDraft: (value: string) => void;
  onStartEdit: (row: DishPricingRow) => void;
  onCancelEdit: () => void;
  onCommitEdit: (row: DishPricingRow) => void;
  onEditRecipe: (productId: string) => void;
  onApproveCost: (row: DishPricingRow) => void;
  canApproveCost: boolean;
}) {
  const { row } = props;
  const t = useT();
  const isEditing = props.editingId === row.productId;
  const isSaving = props.savingId === row.productId;
  const hidden = row.product.hidden || row.product.active === false;

  return (
    <div
      className={cn(
        "rounded-2xl border border-beige-dark/15 p-3",
        hidden && "opacity-70"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {getProductDisplayName(row.product, props.locale)}
          </p>
          <span
            className={cn(
              "mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
              COST_STATE_TONE[row.costState]
            )}
          >
            {t(COST_STATE_LABEL_KEY[row.costState])}
          </span>
        </div>
        <div className="text-end">
          {isEditing ? (
            <Input
              value={props.editDraft}
              onChange={(event) => props.onEditDraft(event.target.value)}
              onBlur={() => props.onCommitEdit(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter") props.onCommitEdit(row);
                if (event.key === "Escape") props.onCancelEdit();
              }}
              className="h-9 w-24 text-end"
              inputMode="decimal"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => props.onStartEdit(row)}
              className="min-h-11 rounded-lg bg-beige/50 px-3 py-2 text-xl font-bold tabular-nums"
            >
              {formatIls(row.product.price)}
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm text-coffee/80">
        <MobileStat label={t("admin.dishPricing.col.cost")} value={moneyOrDash(row.effectiveCostNet)} />
        <MobileStat
          label={t("admin.dishPricing.col.profit")}
          value={moneyOrDash(row.grossProfit)}
          toneClass={statusColor(row.foodCostStatus)}
        />
        <MobileStat
          label={t("admin.dishPricing.col.foodCost")}
          value={foodCostLabel(row)}
          toneClass={statusColor(row.foodCostStatus)}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => props.onEditRecipe(row.productId)}>
          {t("admin.dishPricing.action.recipe")}
        </Button>
        {row.costState === "imported_unverified" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => props.onApproveCost(row)}
            disabled={!props.canApproveCost || isSaving}
          >
            {t("admin.dishPricing.action.approveCost")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MobileStat({ label, value, toneClass }: { label: string; value: string; toneClass?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-coffee/50">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold", toneClass)}>{value}</p>
    </div>
  );
}

/* -------------------------------- Tab B: Recipes bridge -------------------------------- */

function RecipesTabBody(props: {
  rows: DishPricingRow[];
  locale: Locale;
  onEditRecipe: (productId: string) => void;
}) {
  const t = useT();
  const missing = props.rows.filter((row) => row.costState === "missing" || row.recipeLineCount === 0);
  const withRecipe = props.rows.filter((row) => row.recipeLineCount > 0);

  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.dishPricing.recipes.missingTitle")}>
        <p className="mb-3 text-xs text-coffee/55">{t("admin.dishPricing.recipes.missingDescription")}</p>
        {missing.length === 0 ? (
          <p className="text-sm text-coffee/55">{t("admin.dishPricing.recipes.allLinked")}</p>
        ) : (
          <ul className="divide-y divide-beige-dark/10">
            {missing.map((row) => (
              <li key={row.productId} className="flex items-center justify-between py-2">
                <span>{getProductDisplayName(row.product, props.locale)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => props.onEditRecipe(row.productId)}
                >
                  {t("admin.dishPricing.action.buildRecipe")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title={t("admin.dishPricing.recipes.linkedTitle")}>
        <p className="mb-3 text-xs text-coffee/55">{t("admin.dishPricing.recipes.linkedDescription")}</p>
        {withRecipe.length === 0 ? (
          <p className="text-sm text-coffee/55">{t("admin.dishPricing.recipes.noneLinked")}</p>
        ) : (
          <ul className="divide-y divide-beige-dark/10">
            {withRecipe.slice(0, 50).map((row) => (
              <li key={row.productId} className="flex items-center justify-between py-2">
                <div>
                  <p>{getProductDisplayName(row.product, props.locale)}</p>
                  <p className="text-xs text-coffee/55">
                    {t("admin.dishPricing.recipes.lineCount")}: {row.recipeLineCount}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => props.onEditRecipe(row.productId)}
                >
                  {t("admin.dishPricing.action.editRecipe")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}

/* -------------------------------- Tab C: Control & diagnostics -------------------------------- */

function ControlTabBody(props: {
  summary: ReturnType<typeof dishPricingSummary>;
  diagnosticsCount: ReturnType<typeof dishDiagnosticsCount>;
  activeDiagnostic: DishDiagnostic | null;
  onDiagnosticClick: (diagnostic: DishDiagnostic) => void;
}) {
  const t = useT();
  const { summary, diagnosticsCount } = props;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminKpiCard label={t("admin.dishPricing.kpi.total")} value={summary.total} icon={Tag} index={0} />
        <AdminKpiCard label={t("admin.dishPricing.kpi.priced")} value={summary.priced} icon={CheckCircle2} index={1} />
        <AdminKpiCard
          label={t("admin.dishPricing.kpi.missingCost")}
          value={summary.missingCost}
          icon={ShieldAlert}
          colorClass="text-rose-600"
          index={2}
        />
        <AdminKpiCard
          label={t("admin.dishPricing.kpi.importedUnverified")}
          value={summary.importedUnverified}
          icon={AlertTriangle}
          colorClass="text-amber-600"
          index={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminKpiCard
          label={t("admin.dishPricing.kpi.averagePrice")}
          value={summary.averagePriceIls == null ? "—" : formatIls(summary.averagePriceIls)}
          icon={Tag}
          index={0}
        />
        <AdminKpiCard
          label={t("admin.dishPricing.kpi.averageCost")}
          value={summary.averageCostIls == null ? "—" : formatIls(summary.averageCostIls)}
          icon={Tag}
          index={1}
        />
        <AdminKpiCard
          label={t("admin.dishPricing.kpi.averageFoodCost")}
          value={
            summary.averageFoodCostPercent == null
              ? "—"
              : `${summary.averageFoodCostPercent.toFixed(1)}%`
          }
          icon={Tag}
          index={2}
        />
        <AdminKpiCard
          label={t("admin.dishPricing.kpi.hidden")}
          value={summary.hidden}
          icon={EyeOff}
          index={3}
        />
      </div>

      <AdminCard title={t("admin.dishPricing.control.title")}>
        <p className="mb-3 text-xs text-coffee/55">{t("admin.dishPricing.control.description")}</p>
        <div className="flex flex-wrap gap-2">
          {DIAGNOSTIC_KEYS.map((key) => {
            const count = diagnosticsCount[key];
            const active = props.activeDiagnostic === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => props.onDiagnosticClick(key)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                  active
                    ? "border-turquoise bg-turquoise text-warm-white"
                    : "border-beige-dark/30 bg-warm-white text-coffee hover:border-turquoise/40"
                )}
              >
                <DiagnosticIcon diagnostic={key} />
                <span>{t(`admin.dishPricing.diag.${key}`)}</span>
                <span className="rounded-full bg-beige/60 px-1.5 text-xs text-coffee/70">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </AdminCard>
    </div>
  );
}

function DiagnosticIcon({ diagnostic }: { diagnostic: DishDiagnostic }) {
  const className = "h-3.5 w-3.5";
  switch (diagnostic) {
    case "loss":
      return <AlertTriangle className={cn(className, "text-rose-600")} />;
    case "zero_profit":
      return <AlertTriangle className={cn(className, "text-amber-600")} />;
    case "missing_cost":
      return <ShieldAlert className={cn(className, "text-rose-600")} />;
    case "imported_unverified":
      return <AlertTriangle className={cn(className, "text-amber-600")} />;
    case "no_image":
      return <ImageIcon className={cn(className, "text-coffee/50")} />;
    case "no_category":
      return <Tag className={cn(className, "text-coffee/50")} />;
    case "hidden":
      return <EyeOff className={cn(className, "text-coffee/60")} />;
    default:
      return <CheckCircle2 className={cn(className, "text-emerald-600")} />;
  }
}

export type { Product };
