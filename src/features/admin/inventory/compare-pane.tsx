"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { CompareDetailDialog } from "@/features/admin/inventory/compare-detail-dialog";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient } from "@/lib/costing/types";
import { formatCompareMoney, formatComparePercent, sortCompareRows } from "@/lib/inventory/compare-display";
import {
  buildGroupCompareRows,
  compareCoverage,
  listCompareGroups,
  listCompareProductPicks,
  searchCompareProductPicks,
  similarMaterialCandidates,
  type CompareVatMode,
  type IngredientCompareGroup,
  type MaterialCompareRow,
} from "@/lib/inventory/material-group";
import type { PurchaseInvoice, PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { saveIngredientCompareGroup } from "@/services/inventoryService";

function rowKey(row: MaterialCompareRow): string {
  return `${row.ingredientId}-${row.supplierId}-${row.offerId ?? ""}`;
}

const VAT_KEY = "mishkah-compare-vat";
const GROUP_KEY = "mishkah-compare-group";

function loadVat(): CompareVatMode {
  if (typeof window === "undefined") return "net";
  return window.localStorage.getItem(VAT_KEY) === "gross" ? "gross" : "net";
}

function coverageLabel(suppliers: number, products: number, t: (key: string, fallback?: string) => string): string {
  const supplierLabel =
    suppliers === 0
      ? t("admin.compare.supplierNone")
      : suppliers === 1
        ? t("admin.compare.supplierOne")
        : t("admin.compare.supplierMany").replace("{count}", String(suppliers));
  const productLabel = products === 1 ? t("admin.compare.productOne") : t("admin.compare.productMany").replace("{count}", String(products));
  return `${supplierLabel} · ${productLabel}`;
}

export function ComparePane({
  ingredients,
  offers,
  records,
  suppliers,
  itemMaps,
  invoices = [],
  onToast,
}: {
  ingredients: CostingIngredient[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  suppliers: Supplier[];
  itemMaps?: SupplierItemMap[];
  invoices?: PurchaseInvoice[];
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const maps = itemMaps ?? [];
  const liveGroups = useMemo(() => listCompareGroups(ingredients), [ingredients]);
  const [overlay, setOverlay] = useState<IngredientCompareGroup | null>(null);
  const groups = useMemo(() => {
    if (!overlay) return liveGroups;
    const live = liveGroups.find((group) => group.id === overlay.id);
    if (live && overlay.memberIds.every((id) => live.memberIds.includes(id))) return liveGroups;
    return [overlay, ...liveGroups.filter((group) => group.id !== overlay.id)];
  }, [liveGroups, overlay]);
  const [groupId, setGroupId] = useState("");
  const [preferredGroupId, setPreferredGroupId] = useState<string | null>(null);
  const [groupQuery, setGroupQuery] = useState("");
  const [vatMode, setVatMode] = useState<CompareVatMode>("net");
  const [managing, setManaging] = useState<"new" | "edit" | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  useEffect(() => {
    setVatMode(loadVat());
  }, []);

  useEffect(() => {
    if (!overlay) return;
    const live = liveGroups.find((group) => group.id === overlay.id);
    if (live && overlay.memberIds.every((id) => live.memberIds.includes(id))) setOverlay(null);
  }, [liveGroups, overlay]);

  useEffect(() => {
    if (preferredGroupId && groups.some((group) => group.id === preferredGroupId)) {
      setGroupId(preferredGroupId);
      window.localStorage.setItem(GROUP_KEY, preferredGroupId);
      setPreferredGroupId(null);
      return;
    }
    if (preferredGroupId) return;
    if (groupId && groups.some((group) => group.id === groupId)) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(GROUP_KEY) : "";
    if (stored && groups.some((group) => group.id === stored)) setGroupId(stored);
    else if (groups[0]) setGroupId(groups[0].id);
  }, [groupId, groups, preferredGroupId]);

  const visibleGroups = groups.filter((group) => !groupQuery.trim() || group.name.toLowerCase().includes(groupQuery.trim().toLowerCase()));
  const group = groups.find((item) => item.id === groupId) ?? null;
  const rows = useMemo(
    () =>
      group
        ? buildGroupCompareRows({
            ingredientIds: group.memberIds,
            ingredients,
            suppliers,
            offers,
            records,
            maps,
            lineVatBasis: vatMode,
          })
        : [],
    [group, ingredients, suppliers, offers, records, maps, vatMode]
  );
  const sortedRows = useMemo(() => sortCompareRows(rows), [rows]);
  const coverage = compareCoverage(rows);
  const hasPrice = rows.some((row) => row.buyPrice != null);
  const hasCheapest = rows.some((row) => row.cheapest);
  const latestDate = rows
    .map((row) => row.purchaseDate)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const detail = sortedRows.find((row) => rowKey(row) === detailKey) ?? null;

  function persistVat(mode: CompareVatMode) {
    setVatMode(mode);
    window.localStorage.setItem(VAT_KEY, mode);
  }

  function selectGroup(id: string) {
    setGroupId(id);
    window.localStorage.setItem(GROUP_KEY, id);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-sm">
          <span className="mb-1 block text-coffee/60">{t("admin.compare.pickGroup")}</span>
          <select className="h-10 w-full rounded-xl border px-3 text-sm" value={groupId} onChange={(e) => selectGroup(e.target.value)}>
            <option value="">{t("admin.compare.pickGroup")}</option>
            {visibleGroups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <Input className="max-w-xs" value={groupQuery} onChange={(e) => setGroupQuery(e.target.value)} placeholder={t("admin.compare.searchGroups")} />
        <Button type="button" variant="outline" disabled={!group} onClick={() => setManaging("edit")}>
          {t("admin.compare.manageGroup")}
        </Button>
        <Button type="button" variant="turquoise" onClick={() => setManaging("new")}>
          {t("admin.compare.newGroup")}
        </Button>
        <Button type="button" variant={vatMode === "net" ? "turquoise" : "outline"} onClick={() => persistVat("net")}>
          {t("admin.finance.compareNet")}
        </Button>
        <Button type="button" variant={vatMode === "gross" ? "turquoise" : "outline"} onClick={() => persistVat("gross")}>
          {t("admin.finance.compareGross")}
        </Button>
      </div>

      {managing && (
        <GroupEditor
          mode={managing}
          group={managing === "edit" ? group : null}
          ingredients={ingredients}
          suppliers={suppliers}
          maps={maps}
          offers={offers}
          onClose={() => setManaging(null)}
          onSaved={(saved) => {
            setOverlay(saved);
            setPreferredGroupId(saved.id);
            setGroupId(saved.id);
            window.localStorage.setItem(GROUP_KEY, saved.id);
            setManaging(null);
            onToast(t("admin.compare.groupSavedCount").replace("{count}", String(saved.memberIds.length)));
          }}
        />
      )}

      {!groups.length && !managing && (
        <AdminCard title={t("admin.inventory.tab.compare")}>
          <p className="text-sm text-coffee/70">{t("admin.compare.emptyGroups")}</p>
        </AdminCard>
      )}

      {group && (
        <AdminCard title={group.name}>
          <p className="mb-2 text-xs text-coffee/55">{t("admin.materialGroup.compareOnly")}</p>
          <p className="text-sm font-semibold">{vatMode === "net" ? t("admin.compare.pricesNet") : t("admin.compare.pricesGross")}</p>
          <p className="mb-3 text-xs text-coffee/60">
            {t("admin.compare.savedPurchases")}
            {latestDate ? ` · ${latestDate}` : ""}
          </p>
          <p className="mb-2 text-sm text-coffee/80">{coverageLabel(coverage.suppliers, coverage.products, t)}</p>
          {coverage.products === 1 && <p className="mb-2 text-sm text-amber-800">{t("admin.compare.oneProduct")}</p>}
          {!hasPrice && <p className="mb-2 text-sm text-amber-800">{t("admin.compare.noPrices")}</p>}
          {coverage.products >= 2 && hasPrice && !hasCheapest && (
            <p className="mb-2 text-sm text-amber-800">{t("admin.compare.needCompareBasis")}</p>
          )}

          {sortedRows.length > 0 && (
            <CompareTable
              rows={sortedRows}
              highlightCheapest={coverage.products >= 2}
              onOpen={setDetailKey}
            />
          )}
          <CompareDetailDialog
            row={detail}
            rows={sortedRows}
            records={records}
            invoices={invoices}
            suppliers={suppliers}
            vatMode={vatMode}
            groupName={group.name}
            onClose={() => setDetailKey(null)}
            onSaved={() => onToast(t("admin.compare.packSaved"))}
          />
        </AdminCard>
      )}
    </div>
  );
}

function CompareTable({
  rows,
  highlightCheapest,
  onOpen,
}: {
  rows: MaterialCompareRow[];
  highlightCheapest: boolean;
  onOpen: (key: string) => void;
}) {
  const t = useT();
  return (
    <div className="overflow-x-auto text-sm">
      <table className="min-w-full border-separate border-spacing-0">
        <thead>
          <tr className="bg-beige/50 text-xs text-coffee/70">
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.costing.supplier")}</th>
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.materialGroup.supplierProduct")}</th>
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.compare.packContents")}</th>
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.compare.packPrice")}</th>
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.compare.baseUnitPrice")}</th>
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.materialGroup.priceDate")}</th>
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.compare.gap")}</th>
            <th className="border-b border-beige-dark/15 px-2 py-2 text-start font-medium">{t("admin.compare.details")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CompareRow key={rowKey(row)} row={row} highlight={highlightCheapest && row.cheapest} onOpen={() => onOpen(rowKey(row))} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareRow({ row, highlight, onOpen }: { row: MaterialCompareRow; highlight: boolean; onOpen: () => void }) {
  const t = useT();
  const missingBasis = (!row.supplierId && !row.supplierName.trim()) || row.buyPrice == null;
  const needsCompletion = missingBasis || row.reason === "missing-pack" || row.reason === "vat-mismatch" || row.reason === "unit-mismatch";
  return (
    <tr className={highlight ? "bg-emerald-50" : ""}>
      <td className="border-b border-beige-dark/10 px-2 py-2">{row.supplierName || "—"}</td>
      <td className="border-b border-beige-dark/10 px-2 py-2">
        {row.supplierProductName}
        {row.invoiceNumber ? <span className="block text-xs text-coffee/50">{row.invoiceNumber}</span> : null}
      </td>
      <td className="border-b border-beige-dark/10 px-2 py-2 whitespace-nowrap">
        {row.packQuantity != null && row.packUnit ? `${row.packQuantity} ${t(unitLabelKey(row.packUnit))}` : "—"}
      </td>
      <td className="border-b border-beige-dark/10 px-2 py-2 whitespace-nowrap tabular-nums">
        {missingBasis ? <span className="text-amber-800">{t("admin.compare.missingSupplierPrice")}</span> : row.buyPrice != null ? formatCompareMoney(row.buyPrice) : "—"}
      </td>
      <td className={`border-b border-beige-dark/10 px-2 py-2 whitespace-nowrap tabular-nums ${highlight ? "font-semibold text-emerald-800" : ""}`}>
        {row.comparable && row.displayUnitCost != null ? `${formatCompareMoney(row.displayUnitCost)} / ${t(unitLabelKey(row.displayUnit))}` : "—"}
      </td>
      <td className="border-b border-beige-dark/10 px-2 py-2 whitespace-nowrap">{row.purchaseDate || "—"}</td>
      <td className="border-b border-beige-dark/10 px-2 py-2 whitespace-nowrap tabular-nums">
        {highlight
          ? t("admin.inventory.cheapest")
          : row.gapAmount != null
            ? `+${formatCompareMoney(row.gapAmount)}${row.gapPercent != null ? ` · +${formatComparePercent(row.gapPercent)}%` : ""}`
            : "—"}
      </td>
      <td className="border-b border-beige-dark/10 px-2 py-2">
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="outline" className="min-h-9" aria-haspopup="dialog" onClick={onOpen}>
            {t("admin.compare.details")}
          </Button>
          {needsCompletion && (
            <Button type="button" size="sm" variant="outline" className="min-h-9" aria-haspopup="dialog" onClick={onOpen}>
              {t("admin.compare.complete")}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function GroupEditor({
  mode,
  group,
  ingredients,
  suppliers,
  maps,
  offers,
  onClose,
  onSaved,
}: {
  mode: "new" | "edit";
  group: { id: string; name: string; memberIds: string[] } | null;
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  maps: SupplierItemMap[];
  offers: SupplierOffer[];
  onClose: () => void;
  onSaved: (group: IngredientCompareGroup) => void;
}) {
  const t = useT();
  const [name, setName] = useState(group?.name ?? "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(group?.memberIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const picks = listCompareProductPicks({ ingredients, suppliers, maps, offers });
  const visible = searchCompareProductPicks(picks, query);
  const suggestions = query.trim().length >= 2 ? similarMaterialCandidates({ name: query }, ingredients, maps) : [];

  function toggle(ingredientId: string) {
    setSelected((current) => (current.includes(ingredientId) ? current.filter((id) => id !== ingredientId) : [...current, ingredientId]));
  }

  return (
    <AdminCard title={mode === "new" ? t("admin.compare.newGroup") : t("admin.compare.manageGroup")}>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.materialGroup.compareName")} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.compare.searchProducts")} />
        <div className="max-h-72 space-y-1 overflow-auto rounded-xl border border-beige-dark/15 p-2">
          {visible.map((pick) => (
            <label key={pick.key} className="flex items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-beige/40">
              <input type="checkbox" checked={selected.includes(pick.ingredientId)} onChange={() => toggle(pick.ingredientId)} />
              <span>
                <span className="font-medium">{pick.supplierProductName}</span>
                {pick.supplierName ? <span className="text-coffee/55"> · {pick.supplierName}</span> : null}
                {pick.ingredientName !== pick.supplierProductName ? <span className="block text-xs text-coffee/50">{pick.ingredientName}</span> : null}
              </span>
            </label>
          ))}
        </div>
        {suggestions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-coffee/55">{t("admin.compare.suggestions")}</p>
            {suggestions
              .filter((item) => !selected.includes(item.id))
              .map((item) => (
                <Button key={item.id} type="button" variant="outline" size="sm" onClick={() => toggle(item.id)}>
                  {t("admin.compare.addSuggested")}: {item.name}
                </Button>
              ))}
          </div>
        )}
        <p className="text-xs text-coffee/55">{t("admin.materialGroup.compareOnly")}</p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="turquoise"
            disabled={saving || !name.trim() || selected.length === 0}
            onClick={async () => {
              if (savingRef.current) return;
              const memberIds = [...new Set(selected)];
              const trimmed = name.trim();
              if (!trimmed || memberIds.length === 0) return;
              savingRef.current = true;
              setSaving(true);
              setError(null);
              const saved = await saveIngredientCompareGroup({
                groupId: mode === "edit" ? group?.id : undefined,
                name: trimmed,
                memberIds,
              });
              savingRef.current = false;
              setSaving(false);
              if (!saved.success || saved.data.memberIds.length !== memberIds.length) {
                setError(t("admin.compare.saveFailed"));
                return;
              }
              onSaved({ id: saved.data.id, name: saved.data.name, memberIds: saved.data.memberIds });
            }}
          >
            {saving ? t("admin.compare.saving") : t("common.save")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </AdminCard>
  );
}
