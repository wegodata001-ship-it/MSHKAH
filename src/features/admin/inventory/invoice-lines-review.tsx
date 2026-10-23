"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { IngredientCategoryField } from "@/features/admin/costing/ingredient-category-field";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { formatIls, roundMoney } from "@/lib/costing/money";
import { applyInvoiceLineMoney, linePriceBasis, shownLinePrices, type LinePriceBasis } from "@/lib/inventory/unit-price";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import {
  assignLinesToIngredient,
  invoicePriceIncrease,
} from "@/lib/inventory/ingredient-core";
import {
  confirmInvoiceMatchPatch,
  editInvoiceLineName,
  confirmSafeInvoiceMatches,
  isExistingIngredientAssignment,
  planNewIngredientPatch,
  plannedIngredientName,
  existingProductForInvoiceName,
  invoiceCreateProductDraft,
  invoiceLineMatchesFilter,
  invoiceReviewCounts,
  newInvoiceProductPatch,
  type InvoiceReviewFilter,
} from "@/lib/inventory/invoice-line-review";
import { finalizeInvoiceLine, INVOICE_UNITS, invoiceTableTotals } from "@/lib/inventory/invoice-lines";
import {
  applyInvoiceUnitChange,
  invoiceLineEditStamp,
  InvoiceLineSaveError,
  shouldClearInvoiceDraft,
  invoiceLineReviewStatus,
  invoiceUnitGap,
  invoiceUnitTargets,
  workingInvoiceLines,
  type InvoiceUnitScope,
} from "@/lib/inventory/invoice-line-status";
import { invoiceNeedsAttention } from "@/lib/inventory/invoice-intake";
import { filterIngredientsByQuery } from "@/lib/costing/names";
import { inventoryCategories } from "@/lib/inventory/product-match";
import type { PurchaseInvoiceLine, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { MaterialGroupSuggest } from "@/features/admin/inventory/material-group-suggest";
import { createIngredient, setIngredientCategory } from "@/services/costingService";
import { cn } from "@/lib/utils";

export type InvoiceLinesReviewHandle = {
  flush: () => PurchaseInvoiceLine[];
  dirtyCount: () => number;
  preview: () => PurchaseInvoiceLine[];
  saveAll: () => Promise<PurchaseInvoiceLine[]>;
};

export const InvoiceLinesReview = forwardRef<InvoiceLinesReviewHandle, {
  lines: PurchaseInvoiceLine[];
  ingredients: CostingIngredient[];
  maps?: SupplierItemMap[];
  offers?: SupplierOffer[];
  suppliers?: Supplier[];
  supplierId?: string;
  supplierName?: string;
  vatRate: number;
  sourcePayable?: number | null;
  sourceNet?: number | null;
  locked?: boolean;
  invoiceId?: string;
  highlightKey?: string | null;
  highlightField?: string | null;
  onChangeLines: (lines: PurchaseInvoiceLine[]) => void;
  onUpdateLine: (line: PurchaseInvoiceLine) => Promise<void> | void;
  onWorkingChange?: (lines: PurchaseInvoiceLine[], dirtyKeys: string[]) => void;
}>(function InvoiceLinesReview({
  lines,
  ingredients,
  maps,
  offers,
  suppliers,
  supplierId,
  supplierName,
  vatRate,
  sourcePayable,
  sourceNet,
  locked,
  invoiceId,
  highlightKey,
  highlightField,
  onChangeLines,
  onUpdateLine,
  onWorkingChange,
}, ref) {
  const t = useT();
  const [filter, setFilter] = useState<InvoiceReviewFilter>("all");
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PurchaseInvoiceLine>>({});
  const draftsRef = useRef(drafts);
  const replaceDrafts = (next: Record<string, PurchaseInvoiceLine> | ((current: Record<string, PurchaseInvoiceLine>) => Record<string, PurchaseInvoiceLine>)) => {
    const resolved = typeof next === "function" ? next(draftsRef.current) : next;
    draftsRef.current = resolved;
    setDrafts(resolved);
  };
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string | null>>({});
  const [unitOpen, setUnitOpen] = useState(false);
  const [unitChoice, setUnitChoice] = useState<PurchaseUnit | "">("");
  const [unitScope, setUnitScope] = useState<InvoiceUnitScope>("all");
  const [unitBusy, setUnitBusy] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);
  const timers = useRef<Record<string, number>>({});
  const revisions = useRef<Record<string, number>>({});
  const inflight = useRef<Record<string, Promise<void>>>({});
  const SAVE_DELAY = 450;
  const [openCreate, setOpenCreate] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkId, setBulkId] = useState("");

  const working = useMemo(() => workingInvoiceLines(lines, drafts), [lines, drafts]);
  const onWorkingChangeRef = useRef(onWorkingChange);
  onWorkingChangeRef.current = onWorkingChange;

  useEffect(() => {
    const next = { ...draftsRef.current };
    let changed = false;
    for (const key of Object.keys(next)) {
      if (!lines.some((line) => line.key === key)) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) replaceDrafts(next);
  }, [lines]);

  useEffect(() => {
    onWorkingChangeRef.current?.(working, Object.keys(drafts));
  }, [working, drafts]);

  const counts = useMemo(() => invoiceReviewCounts(working), [working]);
  const needsCount = useMemo(
    () => working.filter((line) => invoiceNeedsAttention(line, { dirty: Boolean(drafts[line.key]) })).length,
    [working, drafts]
  );
  const visible = useMemo(
    () => working.filter((line) => invoiceLineMatchesFilter(line, filter, query) || (filter === "needs" && drafts[line.key])),
    [working, filter, query, drafts]
  );
  const highlightedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightKey || highlightedRef.current === highlightKey) return;
    if (!lines.some((line) => line.key === highlightKey)) return;
    highlightedRef.current = highlightKey;
    setFilter("all");
    setQuery("");
  }, [highlightKey, lines]);
  useEffect(() => {
    if (!highlightKey) return;
    const nodes = document.querySelectorAll<HTMLElement>(`[data-invoice-line="${CSS.escape(highlightKey)}"]`);
    const target = [...nodes].find((node) => node.getClientRects().length > 0) ?? nodes[0];
    target?.scrollIntoView?.({ block: "center" });
  }, [highlightKey, visible]);

  const current = (key: string) => draftsRef.current[key] ?? lines.find((line) => line.key === key);

  const flush = () => {
    const dirty = Object.values(draftsRef.current);
    if (!dirty.length) return lines;
    const byKey = new Map(dirty.map((line) => [line.key, line]));
    const next = lines.map((line) => byKey.get(line.key) ?? line);
    onChangeLines(next);
    replaceDrafts({});
    return next;
  };

  const failLine = (key: string, line: PurchaseInvoiceLine, reason: string) => {
    const rows = workingInvoiceLines(lines, draftsRef.current);
    const index = Math.max(1, rows.findIndex((row) => row.key === key) + 1);
    const name = line.originalDescription || line.rawName || "";
    setSaveState((state) => ({ ...state, [key]: "error" }));
    setSaveErrors((state) => ({ ...state, [key]: reason }));
    return new InvoiceLineSaveError(key, index, name, reason);
  };

  const persistLine = async (key: string) => {
    const revision = revisions.current[key] ?? 0;
    const line = current(key);
    if (!line || locked) return;
    const stamp = invoiceLineEditStamp(line);
    setSaveState((state) => ({ ...state, [key]: "saving" }));
    setSaveErrors((state) => ({ ...state, [key]: null }));
    const task = (async () => {
      try {
        await onUpdateLine(line);
        if (!shouldClearInvoiceDraft(true, revisions.current[key] ?? 0, revision)) return;
        let cleared = false;
        replaceDrafts((prev) => {
          const next = { ...prev };
          const pending = next[key];
          if (pending && invoiceLineEditStamp(pending) === stamp) {
            delete next[key];
            cleared = true;
          }
          return next;
        });
        if (cleared) setSaveState((state) => ({ ...state, [key]: "saved" }));
      } catch (error) {
        if ((revisions.current[key] ?? 0) !== revision) return;
        const reason = error instanceof Error && error.message
          ? error.message
          : t("admin.inventory.smart.saveFailedRetry");
        throw failLine(key, line, reason);
      }
    })();
    const tracked = task.then(() => undefined, () => undefined);
    inflight.current[key] = tracked;
    try {
      await task;
    } finally {
      if (inflight.current[key] === tracked) delete inflight.current[key];
    }
  };

  const saveAll = async () => {
    for (const key of Object.keys(timers.current)) window.clearTimeout(timers.current[key]);
    timers.current = {};
    const keys = Object.keys(draftsRef.current);
    for (const key of keys) await persistLine(key);
    await Promise.all(Object.values(inflight.current));
    return workingInvoiceLines(lines, draftsRef.current);
  };

  useImperativeHandle(ref, () => ({
    flush,
    dirtyCount: () => Object.keys(draftsRef.current).length,
    preview: () => workingInvoiceLines(lines, draftsRef.current),
    saveAll,
  }));

  const edit = (key: string, patch: Partial<PurchaseInvoiceLine>, when: "type" | "now" = "type") => {
    const base = current(key);
    if (!base) return;
    const nextUnit = patch.unit;
    const unitOnly = Object.keys(patch).length === 1 && nextUnit != null;
    if (locked) {
      if (!unitOnly || !nextUnit || !invoiceId) return;
      replaceDrafts((prev) => ({ ...prev, [key]: { ...base, unit: nextUnit } }));
      void clientAdminFetch("/api/admin/inventory/invoice/line-unit", {
        invoiceId,
        lineKey: key,
        unit: nextUnit,
      });
      return;
    }
    revisions.current[key] = (revisions.current[key] ?? 0) + 1;
    replaceDrafts((prev) => ({ ...prev, [key]: finalizeInvoiceLine({ ...base, ...patch }, vatRate) }));
    setSaveState((state) => ({ ...state, [key]: state[key] === "error" ? "error" : state[key] }));
    window.clearTimeout(timers.current[key]);
    if (when === "now") return persistLine(key);
    timers.current[key] = window.setTimeout(() => {
      void persistLine(key);
    }, SAVE_DELAY);
    return Promise.resolve();
  };

  const flushKey = (key: string) => {
    if (!draftsRef.current[key] || locked) return Promise.resolve();
    window.clearTimeout(timers.current[key]);
    return persistLine(key);
  };

  const commit = (key: string, patch: Partial<PurchaseInvoiceLine>) => edit(key, patch, "now");

  const applyUnits = async () => {
    const targets = invoiceUnitTargets(working, unitScope, selected);
    if (!unitChoice || !targets.length || locked) return;
    setUnitBusy(true);
    setUnitError(null);
    try {
      for (const line of targets) {
        const base = current(line.key);
        if (!base) continue;
        revisions.current[line.key] = (revisions.current[line.key] ?? 0) + 1;
        replaceDrafts((prev) => ({
          ...prev,
          [line.key]: finalizeInvoiceLine({ ...base, ...applyInvoiceUnitChange(base, unitChoice) }, vatRate),
        }));
      }
      await saveAll();
      setUnitOpen(false);
    } catch (error) {
      setUnitError(error instanceof Error ? error.message : t("admin.inventory.smart.saveFailedRetry"));
    } finally {
      setUnitBusy(false);
    }
  };

  const createInline = async (key: string, name: string, category: string) => {
    const line = current(key);
    if (!line || creating) return;
    setCreating(true);
    try {
      const existing = existingProductForInvoiceName(name, ingredients);
      if (existing) {
        setOpenCreate(null);
        await commit(key, confirmInvoiceMatchPatch(existing));
        return;
      }
      const draft = { ...invoiceCreateProductDraft({ ...line, rawName: name, category }, supplierName), category };
      const result = await createIngredient(draft);
      if (!result.success) throw new Error(result.error);
      setOpenCreate(null);
      await commit(key, newInvoiceProductPatch(result.data, category || result.data.category));
    } catch (error) {
      const reason = error instanceof Error ? error.message : t("admin.inventory.smart.saveFailedRetry");
      const lineNow = current(key);
      if (lineNow) failLine(key, lineNow, reason);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.inventory.smart.searchLines")}
          className="h-8 min-w-[12rem] flex-1 text-sm"
        />
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          {t("admin.inventory.smart.filterAll")} · {counts.total}
        </FilterChip>
        <FilterChip active={filter === "needs"} onClick={() => setFilter("needs")}>
          {t("admin.inventory.smart.filterNeedsCare")} · {needsCount}
        </FilterChip>
        <Button type="button" variant="outline" className="h-8 text-xs" disabled={locked} onClick={() => { setUnitOpen(true); setUnitError(null); }}>
          {t("admin.inventory.smart.setUnitAll")}
        </Button>
        <div className="relative">
          <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setMoreOpen((value) => !value)}>
            <MoreHorizontal className="me-1 h-3.5 w-3.5" /> {t("admin.inventory.smart.moreActions")}
          </Button>
          {moreOpen && (
            <div className="absolute end-0 z-20 mt-1 w-56 rounded-xl border bg-white p-1 text-sm shadow-lg">
              <button type="button" className="block w-full rounded-lg px-3 py-2 text-start hover:bg-beige/50" disabled={locked} onClick={() => { onChangeLines(confirmSafeInvoiceMatches(working)); setMoreOpen(false); }}>
                {t("admin.inventory.smart.confirmSafe")}
              </button>
            </div>
          )}
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select className="h-8 min-w-[10rem] rounded-lg border px-2 text-xs" value={bulkId} onChange={(e) => setBulkId(e.target.value)}>
              <option value="">{t("admin.inventory.smart.bulkAssign")}</option>
              {ingredients.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs"
              disabled={locked || !bulkId}
              onClick={() => {
                const product = ingredients.find((item) => item.id === bulkId);
                if (!product) return;
                onChangeLines(assignLinesToIngredient(working, selected, product));
                setDrafts({});
                setSelected([]);
              }}
            >
              {t("admin.inventory.smart.applyBulk")} · {selected.length}
            </Button>
          </div>
        )}
      </div>
      <UnitDialog
        open={unitOpen}
        unit={unitChoice}
        scope={unitScope}
        count={invoiceUnitTargets(working, unitScope, selected).length}
        busy={unitBusy}
        error={unitError}
        onClose={() => setUnitOpen(false)}
        onUnit={setUnitChoice}
        onScope={setUnitScope}
        onApply={() => void applyUnits()}
      />

      <div className="hidden rounded-2xl border border-beige-dark/15 lg:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="bg-beige/50 text-xs text-coffee/60">
            <tr className="h-8">
              <th className="w-[16%] px-2 text-start font-medium">{t("admin.inventory.smart.colInvoice")}</th>
              <th className="w-[14%] px-2 text-start font-medium">{t("admin.inventory.smart.unifiedMaterial")}</th>
              <th className="w-[12%] px-2 text-start font-medium">{t("admin.costing.category")}</th>
              <th className="w-[8%] px-2 text-start font-medium">{t("admin.inventory.qty")}</th>
              <th className="w-[10%] px-2 text-start font-medium">{t("admin.costing.unit")}</th>
              <th className="w-[10%] px-2 text-start font-medium">{t("admin.inventory.unitPrice")}</th>
              <th className="w-[11%] px-2 text-start font-medium">{t("admin.inventory.lineTotal")}</th>
              <th className="w-[12%] px-2 text-start font-medium">{t("admin.inventory.vat")}</th>
              <th className="w-[7%] px-2 text-start font-medium">{t("admin.inventory.smart.saveColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => (
              <LineEditor
                key={line.key}
                line={line}
                selected={selected.includes(line.key)}
                onToggleSelect={() => setSelected((current) => current.includes(line.key) ? current.filter((key) => key !== line.key) : [...current, line.key])}
                ingredients={ingredients}
                maps={maps}
                offers={offers}
                suppliers={suppliers}
                supplierId={supplierId}
                locked={locked}
                invoiceId={invoiceId}
                vatRate={vatRate}
                saveState={saveState[line.key]}
                saveError={saveErrors[line.key]}
                creating={creating}
                openCreate={openCreate === line.key}
                highlight={highlightKey === line.key}
                highlightField={highlightKey === line.key ? highlightField : null}
                onOpenCreate={setOpenCreate}
                onEdit={(patch, when) => void edit(line.key, patch, when)}
                onFlush={() => void flushKey(line.key)}
                onCommit={(patch) => void commit(line.key, patch)}
                onCreate={(name, category) => void createInline(line.key, name, category)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 lg:hidden">
        {visible.map((line) => (
          <div key={line.key} className="rounded-xl border border-beige-dark/15 p-2.5">
            <LineEditor
              line={line}
              selected={selected.includes(line.key)}
              onToggleSelect={() => setSelected((current) => current.includes(line.key) ? current.filter((key) => key !== line.key) : [...current, line.key])}
              ingredients={ingredients}
              maps={maps}
              offers={offers}
              suppliers={suppliers}
              supplierId={supplierId}
              locked={locked}
              invoiceId={invoiceId}
              vatRate={vatRate}
              saveState={saveState[line.key]}
              saveError={saveErrors[line.key]}
              creating={creating}
              openCreate={openCreate === line.key}
              highlight={highlightKey === line.key}
              highlightField={highlightKey === line.key ? highlightField : null}
              onOpenCreate={setOpenCreate}
              onEdit={(patch, when) => void edit(line.key, patch, when)}
              onFlush={() => void flushKey(line.key)}
              onCommit={(patch) => void commit(line.key, patch)}
              onCreate={(name, category) => void createInline(line.key, name, category)}
              card
            />
          </div>
        ))}
      </div>
      <LineMoneySummary lines={working} sourcePayable={sourcePayable} sourceNet={sourceNet} />
    </div>
  );
});

function LineEditor({
  line,
  selected,
  onToggleSelect,
  ingredients,
  maps,
  offers,
  suppliers,
  supplierId,
  locked,
  invoiceId,
  vatRate,
  saveState,
  saveError,
  creating,
  openCreate,
  highlight,
  highlightField,
  onOpenCreate,
  onEdit,
  onFlush,
  onCommit,
  onCreate,
  card,
}: {
  line: PurchaseInvoiceLine;
  selected?: boolean;
  onToggleSelect?: () => void;
  ingredients: CostingIngredient[];
  maps?: SupplierItemMap[];
  offers?: SupplierOffer[];
  suppliers?: Supplier[];
  supplierId?: string;
  locked?: boolean;
  invoiceId?: string;
  vatRate: number;
  saveState?: "saving" | "saved" | "error";
  saveError?: string | null;
  creating: boolean;
  openCreate: boolean;
  highlight?: boolean;
  highlightField?: string | null;
  onOpenCreate: (key: string | null) => void;
  onEdit: (patch: Partial<PurchaseInvoiceLine>, when?: "type" | "now") => void;
  onFlush: () => void;
  onCommit: (patch: Partial<PurchaseInvoiceLine>) => void;
  onCreate: (name: string, category: string) => void;
  card?: boolean;
}) {
  const t = useT();
  const [name, setName] = useState(line.rawName);
  const [category, setCategory] = useState(line.category ?? "");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(line.correctedInvoiceName || line.rawName);
  const [updatingCategory, setUpdatingCategory] = useState(false);
  const match = ingredients.find((item) => item.id === line.productId);
  const status = invoiceLineReviewStatus(line, { product: match });
  const unitGap = invoiceUnitGap(line, match);
  const priceUp = invoicePriceIncrease(line);
  const categories = inventoryCategories(ingredients, [line.category, match?.category]);
  const displayCategory = match?.category || line.category || "";
  const shown = shownLinePrices(line);
  const basis = linePriceBasis(line);
  const commitName = () => {
    onEdit(editInvoiceLineName(line, nameDraft), "now");
    setRenaming(false);
  };
  const nameEditor = renaming ? (
    <Input
      value={nameDraft}
      autoFocus
      className="h-8"
      aria-label={t("admin.inventory.editLineName")}
      onChange={(event) => setNameDraft(event.target.value)}
      onBlur={commitName}
      onKeyDown={(event) => {
        if (event.key === "Enter") commitName();
        if (event.key === "Escape") setRenaming(false);
      }}
    />
  ) : (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="inline-flex items-center gap-1 text-start font-medium" onClick={() => { setNameDraft(line.correctedInvoiceName || line.rawName); setRenaming(true); }}>
        <span>{line.correctedInvoiceName || line.originalDescription || line.rawName}</span>
        <Pencil className="h-3.5 w-3.5 text-coffee/50" />
      </button>
      {match ? (
        <button
          type="button"
          className="text-[11px] text-turquoise"
          onClick={() => {
            const next = (line.correctedInvoiceName || line.rawName).trim();
            if (!next || !window.confirm(t("admin.inventory.renameInventoryConfirm").replace("{name}", next))) return;
            void clientAdminFetch("/api/admin/inventory/invoice/line-name", {
              invoiceId: invoiceId || undefined,
              lineKey: invoiceId ? line.key : undefined,
              name: next,
              productId: match.id,
              updateInventory: true,
            }).then((result) => {
              if (!result.ok) return;
              onEdit({ inventoryProductName: next }, "now");
            });
          }}
        >
          {t("admin.inventory.renameInventory")}
        </button>
      ) : null}
    </span>
  );
  const priceBreakdown = (
    <p className="text-[11px] leading-4 text-coffee/60">
      {shown.unitExcludingVat != null ? `${t("admin.inventory.priceExVat")}: ${formatIls(shown.unitExcludingVat)}` : ""}
      {shown.unitIncludingVat != null ? ` · ${t("admin.inventory.priceIncVat")}: ${formatIls(shown.unitIncludingVat)}` : ""}
      {shown.vatAmount != null ? ` · ${t("admin.inventory.vat")}: ${formatIls(shown.vatAmount)}` : ""}
      {basis === "unknown" ? t("admin.inventory.vatChoose") : ""}
    </p>
  );

  const extras = (
    <div className="mt-2 rounded-xl bg-beige/40 p-3">
      <p className="mb-2 text-[11px] text-coffee/55">{t("admin.inventory.smart.compareHint")}</p>
      {openCreate && (
        <div className="mb-2 grid gap-2 sm:grid-cols-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={line.rawName} />
          <IngredientCategoryField value={category} extras={categories} disabled={locked || creating} onChange={setCategory} />
          <Button type="button" variant="turquoise" disabled={creating || locked} onClick={() => onCreate(name.trim() || line.rawName, category)}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="me-1 h-4 w-4" /> {t("admin.inventory.smart.createInline")}</>}
          </Button>
        </div>
      )}
      {status.kind === "missing-pack" && (
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <p className="sm:col-span-2 text-[11px] text-amber-800">{t(status.labelKey)}</p>
          <Input
            id={`invoice-line-${line.key}-pack`}
            className={cn(highlightField === "pack" && "ring-2 ring-amber-500")}
            value={line.conversionNote === "pack-conflict" ? "" : (line.conversionNote ?? "")}
            disabled={locked}
            placeholder={t("admin.inventory.smart.packConversion")}
            onChange={(e) => onEdit({ conversionNote: e.target.value })}
            onBlur={onFlush}
          />
          <Input type="number" min="0" value={line.conversionFactor ?? ""} disabled={locked} onChange={(e) => onEdit({ conversionFactor: e.target.value === "" ? null : Number(e.target.value) })} onBlur={onFlush} />
        </div>
      )}
      <MaterialGroupSuggest
        line={{
          name: line.rawName,
          sku: line.sku,
          barcode: line.barcode,
          productId: line.productId,
          matchKind: line.matchKind,
          matchConfirmed: line.matchConfirmed,
          quantity: line.quantity,
          unit: line.unit,
          conversionFactor: line.conversionFactor,
          lineNet: line.lineNet ?? line.netAmount,
          lineGross: line.lineGross ?? line.grossAmount,
          unitPrice: line.unitPrice,
          vatType: line.vatType,
        }}
        ingredients={ingredients}
        maps={maps}
        offers={offers}
        suppliers={suppliers}
        supplierId={supplierId}
        locked={locked}
        onAssignSame={(item) => onCommit(confirmInvoiceMatchPatch(item))}
        onCreateUnified={(label) => {
          onEdit({ rawName: line.rawName, category: label });
          onOpenCreate(line.key);
        }}
        onKeepSeparate={() => onEdit({ matchKind: line.productId ? line.matchKind : "new", matchConfirmed: Boolean(line.productId) }, "now")}
      />
    </div>
  );

  const matchField = (
    <MatchSelect
      line={line}
      ingredients={ingredients}
      locked={locked}
      highlight={highlightField === "product"}
      onEdit={onEdit}
      onFlush={onFlush}
      onCommit={onCommit}
    />
  );
  const categoryField = (
    <div id={`invoice-line-${line.key}-category`}>
      <IngredientCategoryField
        value={displayCategory}
        extras={categories}
        disabled={locked}
        highlight={highlightField === "category"}
        onChange={(next) => onEdit({ category: next }, "now")}
      />
      {match && displayCategory && displayCategory !== match.category && (
        <button
          type="button"
          className="mt-1 text-[11px] text-turquoise"
          disabled={locked || updatingCategory}
          onClick={async () => {
            setUpdatingCategory(true);
            const result = await setIngredientCategory(match.id, displayCategory);
            setUpdatingCategory(false);
            if (!result.success) onEdit({ category: match.category });
          }}
        >
          {t("admin.inventory.smart.updateIngredientCategory")}
        </button>
      )}
    </div>
  );
  const quantityInput = (
    <Input
      id={`invoice-line-${line.key}-quantity`}
      type="number"
      min="0"
      step="0.01"
      dir="ltr"
      className={cn("h-8 text-end tabular-nums", highlightField === "quantity" && "ring-2 ring-amber-500")}
      value={line.quantity ?? ""}
      disabled={locked}
      onChange={(e) => onEdit(applyInvoiceLineMoney(line, { field: "quantity", quantity: e.target.value === "" ? null : Number(e.target.value) }, vatRate))}
      onBlur={onFlush}
    />
  );
  const unitSelect = (
    <div>
      <select
        id={`invoice-line-${line.key}-unit`}
        className={cn("h-8 w-full rounded-lg border px-2 text-sm", highlightField === "unit" && "ring-2 ring-amber-500")}
        value={line.unit ?? ""}
        disabled={Boolean(locked && !invoiceId)}
        onChange={(e) => onEdit(applyInvoiceUnitChange(line, (e.target.value || null) as PurchaseUnit | null), "now")}
      >
        <option value="">{t("admin.inventory.smart.unitPick")}</option>
        {INVOICE_UNITS.map((unit) => <option key={unit} value={unit}>{t(unitLabelKey(unit))}</option>)}
      </select>
      {status.kind === "missing-unit" && <p className="mt-1 text-[11px] text-amber-800">{t(status.labelKey)}</p>}
      {unitGap === "mismatch" && <p className="mt-1 text-[11px] text-amber-800">{t("admin.inventory.smart.unitMismatch")}</p>}
    </div>
  );
  const priceInput = (
    <Input
      id={`invoice-line-${line.key}-price`}
      type="number"
      min="0"
      step="0.01"
      dir="ltr"
      className={cn("h-8 text-end tabular-nums", highlightField === "price" && "ring-2 ring-amber-500")}
      value={shown.unit ?? ""}
      disabled={locked}
      onChange={(e) => onEdit(applyInvoiceLineMoney(line, { field: "unitPrice", unitPrice: e.target.value === "" ? null : Number(e.target.value) }, vatRate))}
      onBlur={onFlush}
    />
  );
  const lineTotalInput = (
    <Input
      id={`invoice-line-${line.key}-total`}
      type="number"
      min="0"
      dir="ltr"
      className={cn("h-8 text-end font-semibold tabular-nums", highlightField === "total" && "ring-2 ring-amber-500")}
      value={shown.line ?? ""}
      disabled={locked}
      aria-label={t("admin.inventory.lineTotal")}
      onChange={(e) => onEdit(applyInvoiceLineMoney(line, { field: "lineTotal", lineTotal: e.target.value === "" ? null : Number(e.target.value) }, vatRate))}
      onBlur={onFlush}
    />
  );
  const basisSelect = (
    <select
      className="h-8 w-full rounded-lg border px-1 text-xs"
      value={basis}
      disabled={locked}
      aria-label={t("admin.inventory.priceBasis")}
      onChange={(e) => onEdit(applyInvoiceLineMoney(line, { field: "basis", basis: e.target.value as LinePriceBasis }, vatRate), "now")}
    >
      <option value="unknown">{t("admin.inventory.vatChoose")}</option>
      <option value="including">{t("admin.inventory.priceBasis.including")}</option>
      <option value="excluding">{t("admin.inventory.priceBasis.excluding")}</option>
      <option value="exempt">{t("admin.inventory.priceBasis.exempt")}</option>
    </select>
  );
  const vatInput = (
    <Input
      id={`invoice-line-${line.key}-vat`}
      type="number"
      min="0"
      dir="ltr"
      className={cn("h-8 text-end tabular-nums", highlightField === "vat" && "ring-2 ring-amber-500")}
      value={line.vatRate != null ? Math.round((line.vatRate > 1 ? line.vatRate : line.vatRate * 100)) : ""}
      disabled={locked || basis === "exempt"}
      onChange={(e) => onEdit(applyInvoiceLineMoney(line, { field: "vatRate", vatRate: e.target.value === "" ? null : Number(e.target.value) / 100 }, vatRate))}
      onBlur={onFlush}
    />
  );

  if (card) {
    return (
      <div id={`invoice-line-${line.key}`} data-invoice-line={line.key} className={cn("space-y-2", highlight && "rounded-xl ring-2 ring-amber-500")}>
        <div className="flex items-start justify-between gap-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={Boolean(selected)} onChange={onToggleSelect} />
            {nameEditor}
          </label>
          <CareBadge status={status} />
        </div>
        {priceUp && <p className="text-xs text-amber-800">{t("admin.inventory.smart.priceIncrease")}: {Math.round(line.priceChangePercent ?? 0)}%</p>}
        <p className="text-[11px] text-coffee/50">{t("admin.inventory.smart.materialHint")}</p>
        {matchField}
        {categoryField}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.qty")}</span>
            {quantityInput}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.costing.unit")}</span>
            {unitSelect}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.unitPrice")}</span>
            {priceInput}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.lineTotal")}</span>
            {lineTotalInput}
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.priceBasis")}</span>
            {basisSelect}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.vat")}</span>
            {vatInput}
          </label>
        </div>
        {priceBreakdown}
        <SaveState state={saveState} error={saveError} highlight={highlightField === "update"} />
        <button type="button" className="text-[11px] text-coffee/55" onClick={() => setExtrasOpen((value) => !value)}>
          {t("admin.inventory.smart.moreOptions")}
        </button>
        {(extrasOpen || openCreate || status.kind === "missing-pack") && extras}
      </div>
    );
  }

  return (
    <>
      <tr id={`invoice-line-${line.key}`} data-invoice-line={line.key} className={cn("border-t border-beige-dark/10 align-top", highlight && "bg-amber-50")}>
        <td className="px-2 py-1.5">
          <label className="flex items-start gap-1">
            <input type="checkbox" className="mt-1" checked={Boolean(selected)} onChange={onToggleSelect} />
            <span className="min-w-0">
              {nameEditor}
              <CareBadge status={status} />
              {priceUp && <p className="text-[11px] text-amber-800">{t("admin.inventory.smart.priceIncrease")}: {Math.round(line.priceChangePercent ?? 0)}%</p>}
            </span>
          </label>
        </td>
        <td className="px-2 py-1.5">{matchField}</td>
        <td className="px-2 py-1.5">{categoryField}</td>
        <td className="px-2 py-1.5">{quantityInput}</td>
        <td className="px-2 py-1.5">{unitSelect}</td>
        <td className="px-2 py-1.5">{priceInput}</td>
        <td className="px-2 py-1.5">
          {lineTotalInput}
          {priceBreakdown}
        </td>
        <td className="px-2 py-1.5 space-y-1">
          {basisSelect}
          {vatInput}
        </td>
        <td className="px-2 py-1.5">
          <SaveState state={saveState} error={saveError} highlight={highlightField === "update"} />
          <button type="button" className="mt-1 block text-[11px] text-coffee/55" onClick={() => setExtrasOpen((value) => !value)}>
            {t("admin.inventory.smart.moreOptions")}
          </button>
        </td>
      </tr>
      {(extrasOpen || openCreate || status.kind === "missing-pack") && (
        <tr>
          <td colSpan={9} className="px-2 pb-3">{extras}</td>
        </tr>
      )}
    </>
  );
}

function LineMoneySummary({
  lines,
  sourcePayable,
  sourceNet,
}: {
  lines: PurchaseInvoiceLine[];
  sourcePayable?: number | null;
  sourceNet?: number | null;
}) {
  const t = useT();
  const totals = invoiceTableTotals(lines);
  const linesDiffer = Math.abs(totals.gross - totals.net) > 0.05;
  const compared = linesDiffer ? sourcePayable : sourceNet ?? sourcePayable;
  const comparedAmount = linesDiffer ? totals.gross : totals.net;
  const difference = compared == null ? null : roundMoney(comparedAmount - compared);
  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-coffee/70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="rounded-2xl border border-beige-dark/15 bg-beige/30 p-3 text-sm">
      {row(t("admin.inventory.table.beforeVat"), formatIls(totals.net))}
      {row(t("admin.inventory.table.discounts"), formatIls(totals.discounts))}
      {row(t("admin.inventory.table.adjustments"), formatIls(totals.adjustments))}
      {row(t("admin.inventory.vat"), formatIls(totals.vat))}
      {row(t("admin.inventory.table.includingVat"), formatIls(totals.gross))}
      {row(t("admin.inventory.table.source"), compared == null ? "—" : formatIls(compared))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-beige-dark/20 pt-1 font-semibold">
        <span>{t("admin.inventory.table.difference")}</span>
        <span className="tabular-nums">{difference == null ? "—" : formatIls(difference)}</span>
      </div>
    </div>
  );
}

function MatchSelect({
  line,
  ingredients,
  locked,
  highlight,
  onEdit,
  onFlush,
  onCommit,
}: {
  line: PurchaseInvoiceLine;
  ingredients: CostingIngredient[];
  locked?: boolean;
  highlight?: boolean;
  onEdit: (patch: Partial<PurchaseInvoiceLine>, when?: "type" | "now") => void;
  onFlush: () => void;
  onCommit: (patch: Partial<PurchaseInvoiceLine>) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const assigned = isExistingIngredientAssignment(line);
  const selected = assigned ? ingredients.find((item) => item.id === line.productId) : undefined;
  const filtered = query.trim() ? filterIngredientsByQuery(ingredients, query).slice(0, 8) : [];
  const suggestions = (line.candidates ?? []).slice(0, 3);
  const chooseExisting = (product: CostingIngredient, score?: number) => {
    onCommit(confirmInvoiceMatchPatch(product, score));
    setOpen(false);
    setQuery("");
  };
  return (
    <div id={`invoice-line-${line.key}-product`} className={cn("min-w-0 space-y-1", highlight && "rounded-xl ring-2 ring-amber-500")}>
      <p className="text-[11px] text-coffee/50">{t("admin.inventory.scannedName")}: {line.originalScannedName || line.originalDescription || line.rawName}</p>
      {assigned ? (
        <p className="text-sm font-medium">{t("admin.inventory.assignedProduct")}: {selected?.name || plannedIngredientName(line)}</p>
      ) : (
        <>
          <p className="text-xs font-medium text-coffee">{t("admin.inventory.smart.newProductPending")}</p>
          <Input
            className="h-8 text-sm"
            value={line.plannedProductName ?? line.originalDescription ?? line.rawName}
            disabled={locked}
            aria-label={t("admin.inventory.smart.plannedName")}
            onChange={(e) => onEdit({
              ...planNewIngredientPatch(line),
              plannedProductName: e.target.value,
              rawName: e.target.value,
            })}
            onBlur={onFlush}
          />
        </>
      )}
      {line.conversionNote === "pack-conflict" && assigned && (
        <p className="text-[11px] text-amber-800">{t("admin.inventory.smart.packReview")}</p>
      )}
      {!assigned && suggestions[0] && (
        <div className="rounded-lg bg-amber-50 p-1 text-[11px] text-amber-900">
          <p>{t("admin.inventory.similarConfirm")}</p>
          <button type="button" className="text-turquoise" disabled={locked} onClick={() => {
            const product = ingredients.find((item) => item.id === suggestions[0].productId);
            if (product) chooseExisting(product, suggestions[0].score);
          }}>{suggestions[0].name}</button>
        </div>
      )}
      <button type="button" className="text-xs text-turquoise" disabled={locked} onClick={() => onEdit(planNewIngredientPatch(line), "now")}>
        {t("admin.inventory.createSeparate")}
      </button>
      <button type="button" className="text-xs text-turquoise" disabled={locked} onClick={() => setOpen((value) => !value)}>
        {t("admin.inventory.smart.changeAssignment")}
      </button>
      {open && (
        <div className="space-y-1 rounded-xl border bg-white p-2">
          <Input
            className="h-8 text-xs"
            value={query}
            placeholder={t("admin.inventory.smart.searchIngredient")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.map((item) => (
            <button key={item.id} type="button" className="block w-full rounded-lg px-2 py-1 text-start text-sm hover:bg-beige/60" onClick={() => chooseExisting(item)}>
              {item.name}
            </button>
          ))}
          {suggestions.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] text-coffee/50">{t("admin.inventory.smart.similarNames")}</p>
              {suggestions.map((item) => (
                <button
                  key={item.productId}
                  type="button"
                  className="block w-full rounded-lg px-2 py-1 text-start text-xs text-turquoise hover:bg-beige/60"
                  onClick={() => {
                    const product = ingredients.find((row) => row.id === item.productId);
                    if (product) chooseExisting(product, item.score);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="block w-full rounded-lg px-2 py-1 text-start text-xs text-turquoise hover:bg-beige/60"
            onClick={() => {
              onEdit(planNewIngredientPatch({ ...line, plannedProductName: line.originalDescription || line.rawName }), "now");
              setOpen(false);
              setQuery("");
            }}
          >
            {t("admin.inventory.smart.createNewChoice")}
          </button>
        </div>
      )}
    </div>
  );
}

function SaveState({ state, error, highlight }: { state?: "saving" | "saved" | "error"; error?: string | null; highlight?: boolean }) {
  const t = useT();
  return (
    <div className={cn("min-h-8 text-xs", highlight && "rounded-xl ring-2 ring-amber-500")}>
      {state === "saving" && <p className="text-coffee/70">{t("admin.inventory.smart.saving")}</p>}
      {state === "saved" && <p className="text-emerald-700">{t("admin.inventory.smart.saved")}</p>}
      {state === "error" && (
        <div className="space-y-0.5">
          <p className="text-red-700">{t("admin.inventory.smart.saveFailedRetry")}</p>
          {error && error !== t("admin.inventory.smart.saveFailedRetry") && <p className="text-[11px] text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

function UnitDialog({
  open,
  unit,
  scope,
  count,
  busy,
  error,
  onClose,
  onUnit,
  onScope,
  onApply,
}: {
  open: boolean;
  unit: PurchaseUnit | "";
  scope: InvoiceUnitScope;
  count: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onUnit: (unit: PurchaseUnit | "") => void;
  onScope: (scope: InvoiceUnitScope) => void;
  onApply: () => void;
}) {
  const t = useT();
  return (
    <AdminModal open={open} onOpenChange={(next) => !next && onClose()} size="sm">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.inventory.smart.setUnitAll")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>{t("admin.costing.unit")}</span>
          <select className="h-10 w-full rounded-xl border px-2 text-base" value={unit} onChange={(event) => onUnit(event.target.value as PurchaseUnit | "")}>
            <option value="">{t("admin.inventory.smart.unitPick")}</option>
            {INVOICE_UNITS.map((item) => <option key={item} value={item}>{t(unitLabelKey(item))}</option>)}
          </select>
        </label>
        <div className="space-y-1 text-sm">
          {(["all", "selected", "missing"] as InvoiceUnitScope[]).map((item) => (
            <label key={item} className="flex items-center gap-2">
              <input type="radio" name="invoice-unit-scope" checked={scope === item} onChange={() => onScope(item)} />
              {t(item === "all" ? "admin.inventory.smart.unitScopeAll" : item === "selected" ? "admin.inventory.smart.unitScopeSelected" : "admin.inventory.smart.unitScopeMissing")}
            </label>
          ))}
        </div>
        <p className="text-sm font-medium">{t("admin.inventory.smart.unitApplyCount").replace("{count}", String(count))}</p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <Button type="button" variant="turquoise" className="w-full sm:w-auto" disabled={busy || !unit || count === 0} onClick={onApply}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.inventory.smart.unitApplySave")}
        </Button>
      </AdminModalBody>
    </AdminModal>
  );
}

function CareBadge({ status }: { status: ReturnType<typeof invoiceLineReviewStatus> }) {
  const t = useT();
  const styles = {
    ready: "bg-emerald-50 text-emerald-800",
    posted: "bg-emerald-50 text-emerald-800",
    ancillary: "bg-stone-100 text-stone-700",
    packaging: "bg-amber-50 text-amber-900",
    excluded: "bg-stone-100 text-stone-700",
    unsaved: "bg-amber-50 text-amber-900",
    "missing-material": "bg-stone-100 text-stone-700",
    "missing-pack": "bg-amber-50 text-amber-800",
    "missing-unit": "bg-amber-50 text-amber-800",
    "missing-qty": "bg-amber-50 text-amber-800",
    "missing-price": "bg-amber-50 text-amber-800",
    field: "bg-red-50 text-red-700",
  }[status.kind];
  return <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", styles)}>{t(status.labelKey)}</span>;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-8 rounded-full px-3 text-xs font-medium", active ? "bg-turquoise text-white" : "bg-beige/70 text-coffee/70")}>
      {children}
    </button>
  );
}
