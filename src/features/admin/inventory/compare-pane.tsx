"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { PURCHASE_UNITS } from "@/lib/costing/units";
import {
  buildGroupCompareRows,
  listCompareGroups,
  listCompareProductPicks,
  partitionCompareRows,
  searchCompareProductPicks,
  similarMaterialCandidates,
  type CompareVatMode,
  type MaterialCompareRow,
} from "@/lib/inventory/material-group";
import type { PurchasePriceRecord, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { saveComparePack, saveIngredientCompareGroup } from "@/services/inventoryService";

const VAT_KEY = "mishkah-compare-vat";
const GROUP_KEY = "mishkah-compare-group";

function loadVat(): CompareVatMode {
  if (typeof window === "undefined") return "net";
  return window.localStorage.getItem(VAT_KEY) === "gross" ? "gross" : "net";
}

export function ComparePane({
  ingredients,
  offers,
  records,
  suppliers,
  itemMaps,
  onToast,
}: {
  ingredients: CostingIngredient[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  suppliers: Supplier[];
  itemMaps?: SupplierItemMap[];
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const maps = itemMaps ?? [];
  const groups = useMemo(() => listCompareGroups(ingredients), [ingredients]);
  const [groupId, setGroupId] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [vatMode, setVatMode] = useState<CompareVatMode>("net");
  const [managing, setManaging] = useState<"new" | "edit" | null>(null);
  const [history, setHistory] = useState<{ productId: string; supplierId: string } | null>(null);

  useEffect(() => {
    setVatMode(loadVat());
  }, []);

  useEffect(() => {
    if (groupId && groups.some((group) => group.id === groupId)) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(GROUP_KEY) : "";
    if (stored && groups.some((group) => group.id === stored)) setGroupId(stored);
    else if (groups[0]) setGroupId(groups[0].id);
  }, [groupId, groups]);

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
  const { comparable, other } = partitionCompareRows(rows);
  const displayUnit = comparable[0]?.displayUnit ?? other[0]?.displayUnit;
  const supplierCount = new Set(rows.map((row) => row.supplierId).filter(Boolean)).size;
  const hasPrice = rows.some((row) => row.buyPrice != null);

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
          onSaved={(id) => {
            selectGroup(id);
            setManaging(null);
            onToast(t("admin.compare.groupSaved"));
          }}
          onError={(message) => onToast(message, "error")}
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
          <p className="mb-3 text-xs text-coffee/55">{t("admin.compare.cheapestAmongSaved")}</p>
          {displayUnit && (
            <p className="mb-3 text-sm font-medium">
              {t("admin.compare.unit")}: {vatMode === "net" ? t("admin.finance.compareNet") : t("admin.finance.compareGross")} · ₪ / {t(unitLabelKey(displayUnit))}
            </p>
          )}
          {supplierCount < 2 && <p className="mb-2 text-sm text-amber-800">{t("admin.compare.oneSupplier")}</p>}
          {!hasPrice && <p className="mb-2 text-sm text-amber-800">{t("admin.compare.noPrices")}</p>}

          {rows.length > 0 && (
            <CompareTable
              rows={comparable.length ? comparable : []}
              extra={other}
              records={records}
              history={history}
              onHistory={setHistory}
              onPackSaved={() => onToast(t("admin.compare.packSaved"))}
              onPackError={(message) => onToast(message, "error")}
            />
          )}
        </AdminCard>
      )}
    </div>
  );
}

function CompareTable({
  rows,
  extra,
  records,
  history,
  onHistory,
  onPackSaved,
  onPackError,
}: {
  rows: MaterialCompareRow[];
  extra: MaterialCompareRow[];
  records: PurchasePriceRecord[];
  history: { productId: string; supplierId: string } | null;
  onHistory: (value: { productId: string; supplierId: string } | null) => void;
  onPackSaved: () => void;
  onPackError: (message: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto text-sm">
        <table className="min-w-full">
          <thead>
            <tr className="text-coffee/55">
              <th className="p-1 text-start">{t("admin.costing.supplier")}</th>
              <th className="p-1 text-start">{t("admin.materialGroup.supplierProduct")}</th>
              <th className="p-1 text-start">{t("admin.compare.packContents")}</th>
              <th className="p-1 text-start">{t("admin.compare.lastPackPrice")}</th>
              <th className="p-1 text-start">{t("admin.materialGroup.basePrice")}</th>
              <th className="p-1 text-start">{t("admin.materialGroup.priceDate")}</th>
              <th className="p-1 text-start">{t("admin.compare.gap")}</th>
              <th className="p-1 text-start" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <CompareRow
                key={`${row.ingredientId}-${row.supplierId}`}
                row={row}
                onHistory={() => onHistory({ productId: row.ingredientId, supplierId: row.supplierId })}
                onPackSaved={onPackSaved}
                onPackError={onPackError}
              />
            ))}
          </tbody>
        </table>
      </div>
      {extra.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">{t("admin.compare.incomparable")}</p>
          <div className="overflow-x-auto text-sm">
            <table className="min-w-full">
              <tbody>
                {extra.map((row) => (
                  <CompareRow
                    key={`other-${row.ingredientId}-${row.supplierId}`}
                    row={row}
                    onHistory={() => onHistory({ productId: row.ingredientId, supplierId: row.supplierId })}
                    onPackSaved={onPackSaved}
                    onPackError={onPackError}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {history && (
        <div className="rounded-xl bg-beige/40 p-3 text-sm">
          <p className="mb-2 font-medium">{t("admin.inventory.priceHistory")}</p>
          {records
            .filter((row) => row.productId === history.productId && row.supplierId === history.supplierId)
            .slice()
            .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))
            .map((row) => (
              <p key={row.id}>
                {row.purchaseDate} · {formatIls(row.priceIncludingVat || row.unitCost)} ·{" "}
                {row.source === "PURCHASE_INVOICE" ? t("admin.inventory.sourceInvoice") : t("admin.inventory.sourceManual")}
              </p>
            ))}
          {!records.some((row) => row.productId === history.productId && row.supplierId === history.supplierId) && (
            <p className="text-coffee/55">{t("admin.compare.noHistory")}</p>
          )}
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => onHistory(null)}>
            {t("common.close")}
          </Button>
        </div>
      )}
    </div>
  );
}

function CompareRow({
  row,
  onHistory,
  onPackSaved,
  onPackError,
}: {
  row: MaterialCompareRow;
  onHistory: () => void;
  onPackSaved: () => void;
  onPackError: (message: string) => void;
}) {
  const t = useT();
  const [packQty, setPackQty] = useState(row.packQuantity != null ? String(row.packQuantity) : "");
  const [packUnit, setPackUnit] = useState<PurchaseUnit>(row.packUnit ?? "kg");
  const missingPack = row.reason === "missing-pack";
  return (
    <tr className={row.cheapest ? "bg-emerald-50" : ""}>
      <td className="p-1">{row.supplierName}</td>
      <td className="p-1">
        {row.supplierProductName}
        {row.invoiceNumber ? <span className="block text-xs text-coffee/50">{row.invoiceNumber}</span> : null}
      </td>
      <td className="p-1">
        {missingPack ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-amber-800">{t("admin.compare.needPackInline")}</span>
            <Input className="h-8 w-16" value={packQty} inputMode="decimal" onChange={(e) => setPackQty(e.target.value)} />
            <select className="h-8 rounded-lg border px-1 text-xs" value={packUnit} onChange={(e) => setPackUnit(e.target.value as PurchaseUnit)}>
              {PURCHASE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {t(unitLabelKey(unit))}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                const qty = Number(packQty.replace(",", "."));
                if (!Number.isFinite(qty) || qty <= 0) return;
                const saved = await saveComparePack({
                  productId: row.ingredientId,
                  supplierId: row.supplierId,
                  packageQuantity: qty,
                  purchaseUnit: packUnit,
                });
                if (saved.success) onPackSaved();
                else onPackError(saved.error);
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        ) : (
          `${row.packQuantity} ${row.packUnit ? t(unitLabelKey(row.packUnit)) : ""}`
        )}
      </td>
      <td className="p-1">{row.buyPrice != null ? formatIls(row.buyPrice) : "—"}</td>
      <td className={`p-1 ${row.cheapest ? "font-semibold text-emerald-800" : ""}`}>
        {row.comparable && row.displayUnitCost != null
          ? `${formatIls(row.displayUnitCost, 4)} / ${t(unitLabelKey(row.displayUnit))}`
          : "—"}
        {row.cheapest ? ` · ${t("admin.inventory.cheapest")}` : ""}
      </td>
      <td className="p-1">{row.purchaseDate || "—"}</td>
      <td className="p-1">
        {row.cheapest
          ? t("admin.inventory.cheapest")
          : row.gapAmount != null
            ? `+${formatIls(row.gapAmount, 4)} · +${Math.round(row.gapPercent ?? 0)}%`
            : "—"}
      </td>
      <td className="p-1">
        <button type="button" className="text-turquoise" onClick={onHistory}>
          {t("admin.inventory.priceHistory")}
        </button>
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
  onError,
}: {
  mode: "new" | "edit";
  group: { id: string; name: string; memberIds: string[] } | null;
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  maps: SupplierItemMap[];
  offers: SupplierOffer[];
  onClose: () => void;
  onSaved: (id: string) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(group?.name ?? "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(group?.memberIds ?? []);
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="turquoise"
            disabled={!name.trim() || selected.length === 0}
            onClick={async () => {
              const saved = await saveIngredientCompareGroup({
                groupId: group?.id,
                name: name.trim(),
                memberIds: selected,
              });
              if (saved.success) onSaved(saved.data.id);
              else onError(saved.error);
            }}
          >
            {t("common.save")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </AdminCard>
  );
}
