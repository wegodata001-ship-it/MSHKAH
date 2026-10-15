"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Check, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import {
  assignLinesToIngredient,
  invoicePriceIncrease,
  packNeedsCompletion,
} from "@/lib/inventory/ingredient-core";
import {
  clearInvoiceMatchPatch,
  confirmInvoiceMatchPatch,
  confirmSafeInvoiceMatches,
  existingProductForInvoiceName,
  invoiceCreateProductDraft,
  invoiceLineMatchesFilter,
  invoiceLineMatchStatus,
  invoiceReviewCounts,
  newInvoiceProductPatch,
  type InvoiceReviewFilter,
} from "@/lib/inventory/invoice-line-review";
import { finalizeInvoiceLine, INVOICE_UNITS } from "@/lib/inventory/invoice-lines";
import { invoiceLineCareStatus, invoiceNeedsAttention } from "@/lib/inventory/invoice-intake";
import { inventoryCategories } from "@/lib/inventory/product-match";
import type { PurchaseInvoiceLine, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { MaterialGroupSuggest } from "@/features/admin/inventory/material-group-suggest";
import { createIngredient } from "@/services/costingService";
import { cn } from "@/lib/utils";

export type InvoiceLinesReviewHandle = {
  flush: () => PurchaseInvoiceLine[];
  dirtyCount: () => number;
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
  locked?: boolean;
  onChangeLine: (key: string, patch: Partial<PurchaseInvoiceLine>) => void;
  onChangeLines: (lines: PurchaseInvoiceLine[]) => void;
  onUpdateLine: (line: PurchaseInvoiceLine) => Promise<void> | void;
}>(function InvoiceLinesReview({
  lines,
  ingredients,
  maps,
  offers,
  suppliers,
  supplierId,
  supplierName,
  vatRate,
  locked,
  onChangeLine,
  onChangeLines,
  onUpdateLine,
}, ref) {
  const t = useT();
  const [filter, setFilter] = useState<InvoiceReviewFilter>("all");
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PurchaseInvoiceLine>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkId, setBulkId] = useState("");

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (!lines.some((line) => line.key === key)) delete next[key];
      }
      return next;
    });
  }, [lines]);

  const counts = useMemo(() => invoiceReviewCounts(lines), [lines]);
  const needsCount = useMemo(() => lines.filter(invoiceNeedsAttention).length, [lines]);
  const visible = useMemo(
    () => lines.filter((line) => invoiceLineMatchesFilter(drafts[line.key] ?? line, filter, query)),
    [lines, drafts, filter, query]
  );

  const current = (key: string) => drafts[key] ?? lines.find((line) => line.key === key);

  const flush = () => {
    const dirty = Object.values(drafts);
    if (!dirty.length) return lines;
    const byKey = new Map(dirty.map((line) => [line.key, line]));
    const next = lines.map((line) => byKey.get(line.key) ?? line);
    onChangeLines(next);
    setDrafts({});
    return next;
  };

  useImperativeHandle(ref, () => ({
    flush,
    dirtyCount: () => Object.keys(drafts).length,
  }));

  const edit = (key: string, patch: Partial<PurchaseInvoiceLine>) => {
    const base = current(key);
    if (!base) return;
    setDrafts((prev) => ({ ...prev, [key]: finalizeInvoiceLine({ ...base, ...patch }, vatRate) }));
    setSavedKey((value) => (value === key ? null : value));
    setErrorKey((value) => (value === key ? null : value));
  };

  const updateRow = async (key: string) => {
    const line = current(key);
    if (!line || locked) return;
    setSavingKey(key);
    setErrorKey(null);
    try {
      onChangeLine(key, line);
      await onUpdateLine(line);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSavedKey(key);
    } catch (error) {
      setErrorKey(key);
      setErrorText(error instanceof Error ? error.message : t("admin.inventory.smart.lineUpdateFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const createInline = async (key: string, name: string, category: string) => {
    const line = current(key);
    if (!line || creating) return;
    setCreating(true);
    try {
      const existing = existingProductForInvoiceName(name, ingredients);
      if (existing) {
        edit(key, confirmInvoiceMatchPatch(existing));
        setOpenCreate(null);
        return;
      }
      const draft = { ...invoiceCreateProductDraft({ ...line, rawName: name, category }, supplierName), category };
      const result = await createIngredient(draft);
      if (!result.success) throw new Error(result.error);
      edit(key, newInvoiceProductPatch(result.data, category || result.data.category));
      setOpenCreate(null);
    } catch (error) {
      setErrorKey(key);
      setErrorText(error instanceof Error ? error.message : t("admin.inventory.smart.lineUpdateFailed"));
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
          {t("admin.inventory.smart.filterNeeds")} · {needsCount}
        </FilterChip>
        <div className="relative">
          <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setMoreOpen((value) => !value)}>
            <MoreHorizontal className="me-1 h-3.5 w-3.5" /> {t("admin.inventory.smart.moreActions")}
          </Button>
          {moreOpen && (
            <div className="absolute end-0 z-20 mt-1 w-56 rounded-xl border bg-white p-1 text-sm shadow-lg">
              <button type="button" className="block w-full rounded-lg px-3 py-2 text-start hover:bg-beige/50" disabled={locked} onClick={() => { onChangeLines(confirmSafeInvoiceMatches(lines)); setMoreOpen(false); }}>
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
                onChangeLines(assignLinesToIngredient(lines.map((line) => drafts[line.key] ?? line), selected, product));
                setDrafts({});
                setSelected([]);
              }}
            >
              {t("admin.inventory.smart.applyBulk")} · {selected.length}
            </Button>
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-beige-dark/15 lg:block">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="bg-beige/50 text-xs text-coffee/60">
            <tr className="h-8">
              <th className="w-8 px-2" />
              <th className="px-2 text-start font-medium">{t("admin.inventory.smart.colInvoice")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.smart.colMatch")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.qty")}</th>
              <th className="px-2 text-start font-medium">{t("admin.costing.unit")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.unitPrice")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.vat")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.lineTotal")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.smart.updateLine")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((base) => {
              const line = current(base.key)!;
              return (
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
                  saving={savingKey === line.key}
                  saved={savedKey === line.key}
                  error={errorKey === line.key ? errorText : null}
                  creating={creating}
                  openCreate={openCreate === line.key}
                  onOpenCreate={setOpenCreate}
                  onEdit={(patch) => edit(line.key, patch)}
                  onUpdate={() => void updateRow(line.key)}
                  onCreate={(name, category) => void createInline(line.key, name, category)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 lg:hidden">
        {visible.map((base) => {
          const line = current(base.key)!;
          return (
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
                saving={savingKey === line.key}
                saved={savedKey === line.key}
                error={errorKey === line.key ? errorText : null}
                creating={creating}
                openCreate={openCreate === line.key}
                onOpenCreate={setOpenCreate}
                onEdit={(patch) => edit(line.key, patch)}
                onUpdate={() => void updateRow(line.key)}
                onCreate={(name, category) => void createInline(line.key, name, category)}
                card
              />
            </div>
          );
        })}
      </div>
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
  saving,
  saved,
  error,
  creating,
  openCreate,
  onOpenCreate,
  onEdit,
  onUpdate,
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
  saving: boolean;
  saved: boolean;
  error: string | null;
  creating: boolean;
  openCreate: boolean;
  onOpenCreate: (key: string | null) => void;
  onEdit: (patch: Partial<PurchaseInvoiceLine>) => void;
  onUpdate: () => void;
  onCreate: (name: string, category: string) => void;
  card?: boolean;
}) {
  const t = useT();
  const [name, setName] = useState(line.rawName);
  const [category, setCategory] = useState(line.category ?? "");
  const [conversion, setConversion] = useState(false);
  const match = ingredients.find((item) => item.id === line.productId);
  const care = invoiceLineCareStatus(line);
  const needsPack = packNeedsCompletion(line, match?.baseUnit);
  const priceUp = invoicePriceIncrease(line);
  const categories = inventoryCategories(ingredients);
  const extras = (openCreate || conversion) && (
    <div className="mt-2 rounded-xl bg-beige/40 p-3">
      {openCreate && (
        <div className="mb-2 grid gap-2 sm:grid-cols-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={line.rawName} />
          <select className="h-10 rounded-xl border px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("admin.inventory.smart.uncategorized")}</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <Button type="button" variant="turquoise" disabled={creating || locked} onClick={() => onCreate(name.trim() || line.rawName, category)}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="me-1 h-4 w-4" /> {t("admin.inventory.smart.createInline")}</>}
          </Button>
        </div>
      )}
      {conversion && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={line.conversionNote ?? ""} disabled={locked} placeholder={t("admin.inventory.smart.packConversion")} onChange={(e) => onEdit({ conversionNote: e.target.value })} />
          <Input type="number" min="0" value={line.conversionFactor ?? ""} disabled={locked} onChange={(e) => onEdit({ conversionFactor: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
      )}
      {match?.category && <p className="mt-2 text-xs text-coffee/55">{t("admin.costing.category")}: {match.category}</p>}
    </div>
  );

  if (card) {
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={Boolean(selected)} onChange={onToggleSelect} />
            <p className="font-medium">{line.originalDescription || line.rawName}</p>
          </label>
          <CareBadge status={care} />
        </div>
        {priceUp && <p className="text-xs text-amber-800">{t("admin.inventory.smart.priceIncrease")}: {Math.round(line.priceChangePercent ?? 0)}%</p>}
        {needsPack && <p className="text-xs text-amber-800">{t("admin.inventory.smart.needPack")}</p>}
        <MatchSelect line={line} ingredients={ingredients} maps={maps} offers={offers} suppliers={suppliers} supplierId={supplierId} locked={locked} onEdit={onEdit} onCreate={() => onOpenCreate(line.key)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.qty")}</span>
            <Input type="number" min="0" className="h-9" value={line.quantity ?? ""} disabled={locked} onChange={(e) => onEdit({ quantity: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.costing.unit")}</span>
            <select className="h-9 w-full rounded-xl border px-2 text-sm" value={line.unit ?? ""} disabled={locked} onChange={(e) => onEdit({ unit: (e.target.value || null) as PurchaseUnit | null })}>
              <option value="">{t("admin.inventory.smart.unitPick")}</option>
              {INVOICE_UNITS.map((unit) => <option key={unit} value={unit}>{t(unitLabelKey(unit))}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.unitPrice")}</span>
            <Input type="number" min="0" className="h-9" value={line.unitPrice ?? ""} disabled={locked} onChange={(e) => onEdit({ unitPrice: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-coffee/50">{t("admin.inventory.vat")}</span>
            <Input type="number" min="0" className="h-9" value={line.vatRate != null ? Math.round((line.vatRate > 1 ? line.vatRate : line.vatRate * 100)) : ""} disabled={locked} onChange={(e) => onEdit({ vatRate: e.target.value === "" ? null : Number(e.target.value) / 100 })} />
          </label>
        </div>
        <p className="text-sm">{t("admin.inventory.lineTotal")}: {line.grossAmount != null ? formatIls(line.grossAmount) : line.netAmount != null ? formatIls(line.netAmount) : "—"}</p>
        <RowActions saving={saving} saved={saved} error={error} locked={locked} onUpdate={onUpdate} onToggleConversion={() => setConversion((value) => !value)} />
        {extras}
      </div>
    );
  }

  return (
    <>
      <tr className="border-t border-beige-dark/10 align-middle">
        <td className="px-2 py-1.5">
          <input type="checkbox" checked={Boolean(selected)} onChange={onToggleSelect} />
        </td>
        <td className="max-w-[12rem] px-2 py-1.5">
          <p className="font-medium leading-5">{line.originalDescription || line.rawName}</p>
          <CareBadge status={care} />
          {priceUp && <p className="text-[11px] text-amber-800">{t("admin.inventory.smart.priceIncrease")}: {Math.round(line.priceChangePercent ?? 0)}%</p>}
          {needsPack && <p className="text-[11px] text-amber-800">{t("admin.inventory.smart.needPack")}</p>}
        </td>
        <td className="px-2 py-1.5">
          <MatchSelect line={line} ingredients={ingredients} maps={maps} offers={offers} suppliers={suppliers} supplierId={supplierId} locked={locked} onEdit={onEdit} onCreate={() => onOpenCreate(line.key)} />
        </td>
        <td className="px-2 py-1.5"><Input type="number" min="0" className="h-8" value={line.quantity ?? ""} disabled={locked} onChange={(e) => onEdit({ quantity: e.target.value === "" ? null : Number(e.target.value) })} /></td>
        <td className="px-2 py-1.5">
          <select className="h-8 w-full rounded-lg border px-2 text-sm" value={line.unit ?? ""} disabled={locked} onChange={(e) => onEdit({ unit: (e.target.value || null) as PurchaseUnit | null })}>
            <option value="">{t("admin.inventory.smart.unitPick")}</option>
            {INVOICE_UNITS.map((unit) => <option key={unit} value={unit}>{t(unitLabelKey(unit))}</option>)}
          </select>
        </td>
        <td className="px-2 py-1.5"><Input type="number" min="0" className="h-8" value={line.unitPrice ?? ""} disabled={locked} onChange={(e) => onEdit({ unitPrice: e.target.value === "" ? null : Number(e.target.value) })} /></td>
        <td className="px-2 py-1.5"><Input type="number" min="0" className="h-8" value={line.vatRate != null ? Math.round((line.vatRate > 1 ? line.vatRate : line.vatRate * 100)) : ""} disabled={locked} onChange={(e) => onEdit({ vatRate: e.target.value === "" ? null : Number(e.target.value) / 100 })} /></td>
        <td className="px-2 py-1.5 tabular-nums leading-8">{line.grossAmount != null ? formatIls(line.grossAmount) : line.netAmount != null ? formatIls(line.netAmount) : "—"}</td>
        <td className="px-2 py-1.5">
          <RowActions saving={saving} saved={saved} error={error} locked={locked} onUpdate={onUpdate} onToggleConversion={() => setConversion((value) => !value)} />
        </td>
      </tr>
      {(openCreate || conversion) && (
        <tr>
          <td colSpan={9} className="px-2 pb-3">{extras}</td>
        </tr>
      )}
    </>
  );
}

function MatchSelect({
  line,
  ingredients,
  maps,
  offers,
  suppliers,
  supplierId,
  locked,
  onEdit,
  onCreate,
}: {
  line: PurchaseInvoiceLine;
  ingredients: CostingIngredient[];
  maps?: SupplierItemMap[];
  offers?: SupplierOffer[];
  suppliers?: Supplier[];
  supplierId?: string;
  locked?: boolean;
  onEdit: (patch: Partial<PurchaseInvoiceLine>) => void;
  onCreate: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const status = invoiceLineMatchStatus(line);
  const filtered = ingredients.filter((item) => !query || item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 40);
  return (
    <div className="min-w-[12rem] space-y-1">
      <Input className="h-8 text-xs" value={query} placeholder={t("admin.inventory.matchExisting")} onChange={(e) => setQuery(e.target.value)} />
      <select
        className="h-9 w-full rounded-xl border px-2 text-sm"
        value={line.productId ?? ""}
        disabled={locked}
        onChange={(e) => {
          const item = ingredients.find((row) => row.id === e.target.value);
          onEdit(item ? confirmInvoiceMatchPatch(item) : clearInvoiceMatchPatch());
        }}
      >
        <option value="">{t("admin.inventory.smart.noMatch")}</option>
        {filtered.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      {status === "possible" && (line.candidates ?? []).slice(0, 2).map((item) => (
        <button key={item.productId} type="button" className="block text-xs text-turquoise" disabled={locked} onClick={() => {
          const product = ingredients.find((row) => row.id === item.productId);
          if (product) onEdit(confirmInvoiceMatchPatch(product, item.score));
        }}>
          {t("admin.inventory.smart.confirmMatch")}: {item.name} · {Math.round(item.score * 100)}%
        </button>
      ))}
      <button type="button" className="text-xs text-turquoise" disabled={locked} onClick={onCreate}>+ {t("admin.inventory.smart.createInline")}</button>
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
        onAssignSame={(item) => onEdit(confirmInvoiceMatchPatch(item))}
        onCreateUnified={(name) => {
          onEdit({ rawName: line.rawName, category: name });
          onCreate();
        }}
        onKeepSeparate={() => onEdit({ matchKind: line.productId ? line.matchKind : "new", matchConfirmed: Boolean(line.productId) })}
      />
    </div>
  );
}

function RowActions({
  saving,
  saved,
  error,
  locked,
  onUpdate,
  onToggleConversion,
}: {
  saving: boolean;
  saved: boolean;
  error: string | null;
  locked?: boolean;
  onUpdate: () => void;
  onToggleConversion: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" className="h-8 text-xs" disabled={locked || saving} onClick={onUpdate}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <><Check className="me-1 h-3.5 w-3.5" /> {t("admin.inventory.smart.lineUpdated")}</> : t("admin.inventory.smart.updateLine")}
      </Button>
      <button type="button" className="block text-[11px] text-coffee/55" onClick={onToggleConversion}>{t("admin.inventory.smart.packConversion")}</button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

function CareBadge({ status }: { status: ReturnType<typeof invoiceLineCareStatus> }) {
  const t = useT();
  const styles = {
    ok: "bg-emerald-50 text-emerald-800",
    "missing-unit": "bg-amber-50 text-amber-800",
    "needs-match": "bg-stone-100 text-stone-700",
  }[status];
  const label = status === "ok" ? t("admin.inventory.smart.rowOk") : status === "missing-unit" ? t("admin.inventory.smart.rowMissingUnit") : t("admin.inventory.smart.rowNeedsMatch");
  return <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", styles)}>{label}</span>;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-8 rounded-full px-3 text-xs font-medium", active ? "bg-turquoise text-white" : "bg-beige/70 text-coffee/70")}>
      {children}
    </button>
  );
}
