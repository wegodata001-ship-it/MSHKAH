"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { AdminModal, AdminModalBody, AdminModalFooter, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
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
import { INVOICE_UNITS } from "@/lib/inventory/invoice-lines";
import { inventoryCategories } from "@/lib/inventory/product-match";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";
import { createIngredient, setIngredientCategory } from "@/services/costingService";
import { cn } from "@/lib/utils";

const NEW_CATEGORY = "__new__";

export function InvoiceLinesReview({
  lines,
  ingredients,
  supplierName,
  vatRate,
  locked,
  onChangeLine,
  onChangeLines,
  onCreateProduct,
}: {
  lines: PurchaseInvoiceLine[];
  ingredients: CostingIngredient[];
  supplierName?: string;
  vatRate: number;
  locked?: boolean;
  onChangeLine: (key: string, patch: Partial<PurchaseInvoiceLine>) => void;
  onChangeLines: (lines: PurchaseInvoiceLine[]) => void;
  onCreateProduct: (key: string) => void;
}) {
  const t = useT();
  const { dir } = useLocale();
  const [filter, setFilter] = useState<InvoiceReviewFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [newCategoryFor, setNewCategoryFor] = useState<string | "bulk" | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const categories = useMemo(() => {
    return [...new Set([...inventoryCategories(ingredients), ...extraCategories])].sort((a, b) => a.localeCompare(b, "he"));
  }, [ingredients, extraCategories]);

  const counts = useMemo(() => invoiceReviewCounts(lines), [lines]);
  const visible = useMemo(
    () => lines.filter((line) => invoiceLineMatchesFilter(line, filter, query)),
    [lines, filter, query]
  );
  const allVisibleSelected = visible.length > 0 && visible.every((line) => selected.includes(line.key));

  const toggleAll = () => {
    setSelected(allVisibleSelected ? selected.filter((key) => !visible.some((line) => line.key === key)) : [...new Set([...selected, ...visible.map((line) => line.key)])]);
  };

  const toggleRow = (key: string) => {
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const assignCategory = async (keys: string[], category: string | undefined) => {
    const next = category?.trim() || undefined;
    onChangeLines(
      lines.map((line) => (keys.includes(line.key) ? { ...line, category: next } : line))
    );
    await Promise.all(
      keys
        .map((key) => lines.find((line) => line.key === key)?.productId)
        .filter((id): id is string => Boolean(id))
        .map((id) => setIngredientCategory(id, next ?? null))
    );
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setExtraCategories((current) => (current.includes(name) ? current : [...current, name]));
    if (newCategoryFor === "bulk") await assignCategory(selected, name);
    else if (newCategoryFor) await assignCategory([newCategoryFor], name);
    setNewCategoryName("");
    setNewCategoryFor(null);
  };

  const confirmSafe = () => {
    const confirmed = confirmSafeInvoiceMatches(lines.filter((line) => selected.includes(line.key)));
    const byKey = new Map(confirmed.map((line) => [line.key, line]));
    onChangeLines(lines.map((line) => byKey.get(line.key) ?? line));
  };

  const bulkCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      let working = [...ingredients];
      const nextLines = [...lines];
      for (const key of selected) {
        const index = nextLines.findIndex((line) => line.key === key);
        if (index < 0) continue;
        const line = nextLines[index];
        if (invoiceLineMatchStatus(line) !== "none") continue;
        const existing = existingProductForInvoiceName(line.rawName, working);
        if (existing) {
          nextLines[index] = { ...line, ...confirmInvoiceMatchPatch(existing) };
          continue;
        }
        const draft = invoiceCreateProductDraft(line, supplierName);
        const result = await createIngredient(draft);
        if (!result.success) continue;
        working = [...working, result.data];
        nextLines[index] = { ...line, ...newInvoiceProductPatch(result.data, draft.category) };
      }
      onChangeLines(nextLines);
    } finally {
      setCreating(false);
    }
  };

  const filters: { id: InvoiceReviewFilter; label: string }[] = [
    { id: "all", label: t("admin.inventory.smart.filterAll") },
    { id: "review", label: t("admin.inventory.smart.filterReview") },
    { id: "unmapped", label: t("admin.inventory.smart.filterUnmapped") },
    { id: "new", label: t("admin.inventory.smart.filterNew") },
    { id: "confirmed", label: t("admin.inventory.smart.filterConfirmed") },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-coffee/70">
        <span>{t("admin.inventory.smart.countTotal")}: {counts.total}</span>
        <span>{t("admin.inventory.smart.countConfirmed")}: {counts.confirmed}</span>
        <span>{t("admin.inventory.smart.countReview")}: {counts.review}</span>
        <span>{t("admin.inventory.smart.countNone")}: {counts.none}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium",
              filter === item.id ? "bg-turquoise text-white" : "bg-beige/70 text-coffee/70"
            )}
          >
            {item.label}
          </button>
        ))}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.inventory.smart.searchLines")}
          className="h-8 min-w-[12rem] flex-1 text-sm"
        />
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-8 text-xs" disabled={locked} onClick={confirmSafe}>
            {t("admin.inventory.smart.confirmSafe")}
          </Button>
          <Button type="button" variant="outline" className="h-8 text-xs" disabled={locked} onClick={() => setBulkCategoryOpen(true)}>
            {t("admin.inventory.smart.assignCategory")}
          </Button>
          <Button type="button" variant="outline" className="h-8 text-xs" disabled={locked || creating} onClick={() => void bulkCreate()}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("admin.inventory.smart.createProducts")}
          </Button>
          <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setSelected([])}>
            {t("admin.inventory.smart.clearSelection")}
          </Button>
        </div>
      )}

      <div className="hidden overflow-x-auto rounded-2xl border border-beige-dark/15 lg:block">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="bg-beige/50 text-xs text-coffee/60">
            <tr className="h-10">
              <th className="px-2 text-start font-medium">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label={t("admin.inventory.smart.selectAll")} />
              </th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.smart.colStatus")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.smart.colInvoice")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.smart.colMatch")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.smart.colCategory")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.qty")}</th>
              <th className="px-2 text-start font-medium">{t("admin.costing.unit")}</th>
              <th className="px-2 text-start font-medium">{t("admin.finance.compareNet")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.vat")}</th>
              <th className="px-2 text-start font-medium">{t("admin.finance.compareGross")}</th>
              <th className="px-2 text-start font-medium">{t("admin.inventory.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => {
              const status = invoiceLineMatchStatus(line);
              const match = ingredients.find((item) => item.id === line.productId);
              return (
                <tr key={line.key} className="h-16 border-t border-beige-dark/10">
                  <td className="px-2">
                    <input type="checkbox" checked={selected.includes(line.key)} onChange={() => toggleRow(line.key)} />
                  </td>
                  <td className="px-2"><MatchStatusBadge status={status} score={line.matchConfidence} t={t} /></td>
                  <td className="max-w-[11rem] truncate px-2 font-medium">{line.rawName}</td>
                  <td className="max-w-[12rem] px-2">
                    {match ? (
                      <span className="block truncate">{match.name}</span>
                    ) : status === "none" ? (
                      <button type="button" className="text-turquoise" disabled={locked} onClick={() => onCreateProduct(line.key)}>
                        + {t("admin.inventory.createProduct")}
                      </button>
                    ) : (
                      t("admin.inventory.smart.noMatch")
                    )}
                  </td>
                  <td className="px-2">
                    <CategorySelect
                      value={line.category}
                      categories={categories}
                      disabled={locked}
                      uncategorized={t("admin.inventory.smart.uncategorized")}
                      newLabel={t("admin.inventory.smart.newCategory")}
                      onChange={(value) => {
                        if (value === NEW_CATEGORY) setNewCategoryFor(line.key);
                        else void assignCategory([line.key], value || undefined);
                      }}
                    />
                  </td>
                  <td className="px-2 tabular-nums">{line.quantity ?? "—"}</td>
                  <td className="px-2">{line.unit ? t(unitLabelKey(line.unit)) : "—"}</td>
                  <td className="px-2 tabular-nums">{line.netAmount != null ? formatIls(line.netAmount) : "—"}</td>
                  <td className="px-2 tabular-nums">{line.vatRate != null ? `${Math.round(line.vatRate * 100)}%` : "—"}</td>
                  <td className="px-2 tabular-nums">{line.grossAmount != null ? formatIls(line.grossAmount) : "—"}</td>
                  <td className="px-2">
                    <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-coffee/60 hover:bg-beige" onClick={() => setEditKey(line.key)} aria-label={t("admin.inventory.smart.editRow")}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 lg:hidden">
        {visible.map((line) => {
          const status = invoiceLineMatchStatus(line);
          const match = ingredients.find((item) => item.id === line.productId);
          return (
            <button
              key={line.key}
              type="button"
              onClick={() => setEditKey(line.key)}
              className="flex w-full items-center gap-3 rounded-2xl border border-beige-dark/15 px-3 py-2.5 text-start"
            >
              <input
                type="checkbox"
                checked={selected.includes(line.key)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleRow(line.key)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{line.rawName}</p>
                  <MatchStatusBadge status={status} score={line.matchConfidence} t={t} compact />
                </div>
                <p className="truncate text-xs text-coffee/60">
                  {t("admin.inventory.match")}: {match?.name || t("admin.inventory.smart.noMatch")}
                </p>
                <div className="mt-0.5 flex items-center justify-between text-xs text-coffee/70">
                  <span>{line.quantity ?? "—"} × {line.grossAmount != null ? formatIls(line.grossAmount) : "—"}</span>
                  <span>{t("admin.costing.category")}: {line.category || t("admin.inventory.smart.uncategorized")}</span>
                </div>
              </div>
              {dir === "rtl" ? <ChevronLeft className="h-4 w-4 text-coffee/40" /> : <ChevronRight className="h-4 w-4 text-coffee/40" />}
            </button>
          );
        })}
      </div>

      <LineEditModal
        line={lines.find((line) => line.key === editKey) ?? null}
        ingredients={ingredients}
        categories={categories}
        supplierName={supplierName}
        vatRate={vatRate}
        locked={locked}
        onClose={() => setEditKey(null)}
        onChange={(patch) => editKey && onChangeLine(editKey, patch)}
        onCreate={() => {
          if (!editKey) return;
          onCreateProduct(editKey);
          setEditKey(null);
        }}
        onNewCategory={() => editKey && setNewCategoryFor(editKey)}
      />

      <AdminModal open={newCategoryFor != null} onOpenChange={(open) => !open && setNewCategoryFor(null)} size="sm">
        <AdminModalHeader onClose={() => setNewCategoryFor(null)}>
          <AdminModalTitle>{t("admin.inventory.smart.newCategory")}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody>
          <Label>{t("admin.inventory.smart.newCategoryName")}</Label>
          <Input className="mt-1" value={newCategoryName} autoFocus onChange={(e) => setNewCategoryName(e.target.value)} />
        </AdminModalBody>
        <AdminModalFooter>
          <Button type="button" variant="outline" onClick={() => setNewCategoryFor(null)}>{t("common.cancel")}</Button>
          <Button type="button" variant="turquoise" onClick={() => void createCategory()}>{t("common.save")}</Button>
        </AdminModalFooter>
      </AdminModal>

      <AdminModal open={bulkCategoryOpen} onOpenChange={setBulkCategoryOpen} size="sm">
        <AdminModalHeader onClose={() => setBulkCategoryOpen(false)}>
          <AdminModalTitle>{t("admin.inventory.smart.assignCategory")}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody>
          <CategorySelect
            value=""
            categories={categories}
            uncategorized={t("admin.inventory.smart.uncategorized")}
            newLabel={t("admin.inventory.smart.newCategory")}
            onChange={(value) => {
              if (value === NEW_CATEGORY) {
                setBulkCategoryOpen(false);
                setNewCategoryFor("bulk");
                return;
              }
              void assignCategory(selected, value || undefined);
              setBulkCategoryOpen(false);
            }}
          />
        </AdminModalBody>
      </AdminModal>
    </div>
  );
}

function MatchStatusBadge({
  status,
  score,
  t,
  compact,
}: {
  status: ReturnType<typeof invoiceLineMatchStatus>;
  score?: number | null;
  t: (key: string) => string;
  compact?: boolean;
}) {
  const pct = score != null ? `${Math.round(score * 100)}%` : "";
  const styles = {
    confirmed: "bg-emerald-50 text-emerald-800",
    possible: "bg-amber-50 text-amber-800",
    none: "bg-stone-100 text-stone-600",
    new: "bg-sky-50 text-sky-800",
  }[status];
  const label =
    status === "confirmed"
      ? compact
        ? pct || t("admin.inventory.smart.statusConfirmed")
        : `✓ ${pct || t("admin.inventory.smart.statusConfirmed")}`
      : status === "possible"
        ? compact
          ? pct || t("admin.inventory.smart.statusPossible")
          : `⚠ ${pct || t("admin.inventory.smart.statusPossible")}`
        : status === "new"
          ? t("admin.inventory.smart.statusCreated")
          : t("admin.inventory.smart.statusNone");
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", styles)}>{label}</span>;
}

function CategorySelect({
  value,
  categories,
  disabled,
  uncategorized,
  newLabel,
  onChange,
}: {
  value?: string;
  categories: string[];
  disabled?: boolean;
  uncategorized: string;
  newLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-8 max-w-[9rem] rounded-lg border border-beige-dark/20 bg-white px-2 text-xs"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{uncategorized}</option>
      {categories.map((item) => (
        <option key={item} value={item}>{item}</option>
      ))}
      <option value={NEW_CATEGORY}>{newLabel}</option>
    </select>
  );
}

function LineEditModal({
  line,
  ingredients,
  categories,
  supplierName,
  vatRate,
  locked,
  onClose,
  onChange,
  onCreate,
  onNewCategory,
}: {
  line: PurchaseInvoiceLine | null;
  ingredients: CostingIngredient[];
  categories: string[];
  supplierName?: string;
  vatRate: number;
  locked?: boolean;
  onClose: () => void;
  onChange: (patch: Partial<PurchaseInvoiceLine>) => void;
  onCreate: () => void;
  onNewCategory: () => void;
}) {
  const t = useT();
  if (!line) return null;
  const match = ingredients.find((item) => item.id === line.productId);
  const status = invoiceLineMatchStatus(line);
  const candidates = (line.candidates ?? []).slice(0, 3);

  return (
    <AdminModal open={Boolean(line)} onOpenChange={(open) => !open && onClose()} size="md">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.inventory.smart.editTitle")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-3">
        <MatchStatusBadge status={status} score={line.matchConfidence} t={t} />
        <Field label={t("admin.inventory.smart.colInvoice")}>
          <Input value={line.rawName} disabled={locked} onChange={(e) => onChange({ rawName: e.target.value })} />
        </Field>
        <Field label={t("admin.inventory.smart.colMatch")}>
          <select
            className="h-10 w-full rounded-xl border px-2 text-sm"
            value={line.productId ?? ""}
            disabled={locked}
            onChange={(e) => {
              const item = ingredients.find((row) => row.id === e.target.value);
              onChange(item ? confirmInvoiceMatchPatch(item) : clearInvoiceMatchPatch());
            }}
          >
            <option value="">{t("admin.inventory.matchExisting")}</option>
            {ingredients.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </Field>
        {status === "possible" && (
          <div className="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">{t("admin.inventory.smart.possibleMatch")}</p>
            <div className="mt-2 space-y-2">
              {candidates.map((item) => (
                <div key={item.productId} className="flex items-center justify-between gap-2">
                  <span>{item.name} · {Math.round(item.score * 100)}%</span>
                  <button
                    type="button"
                    className="text-turquoise"
                    disabled={locked}
                    onClick={() => {
                      const product = ingredients.find((row) => row.id === item.productId);
                      if (product) onChange(confirmInvoiceMatchPatch(product, item.score));
                    }}
                  >
                    {t("admin.inventory.smart.confirmMatch")}
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <button type="button" className="text-turquoise" onClick={() => onChange(clearInvoiceMatchPatch())}>
                {t("admin.inventory.smart.chooseOther")}
              </button>
              <button type="button" className="text-turquoise" onClick={onCreate}>
                {t("admin.inventory.createProduct")}
              </button>
            </div>
          </div>
        )}
        {status === "none" && (
          <div className="rounded-2xl bg-stone-50 px-3 py-2 text-sm">
            <p>{t("admin.inventory.smart.noMatch")}</p>
            <Button type="button" variant="outline" className="mt-2 h-9" onClick={onCreate}>
              <Plus className="me-1 h-4 w-4" /> {t("admin.inventory.createProduct")}
            </Button>
          </div>
        )}
        <Field label={t("admin.costing.category")}>
          <CategorySelect
            value={line.category}
            categories={categories}
            disabled={locked}
            uncategorized={t("admin.inventory.smart.uncategorized")}
            newLabel={t("admin.inventory.smart.newCategory")}
            onChange={(value) => {
              if (value === NEW_CATEGORY) onNewCategory();
              else {
                onChange({ category: value || undefined });
                if (line.productId) void setIngredientCategory(line.productId, value || null);
              }
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("admin.inventory.qty")}>
            <Input type="number" min="0" value={line.quantity ?? ""} disabled={locked} onChange={(e) => onChange({ quantity: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label={t("admin.costing.purchaseUnit")}>
            <select className="h-10 w-full rounded-xl border px-2 text-sm" value={line.unit ?? "kg"} disabled={locked} onChange={(e) => onChange({ unit: e.target.value as PurchaseUnit })}>
              {INVOICE_UNITS.map((unit) => (
                <option key={unit} value={unit}>{t(unitLabelKey(unit))}</option>
              ))}
            </select>
          </Field>
          <Field label={t("admin.finance.compareNet")}>
            <Input type="number" min="0" value={line.unitPrice ?? ""} disabled={locked} onChange={(e) => onChange({ unitPrice: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label={t("admin.inventory.vatRate")}>
            <Input type="number" min="0" value={Math.round((line.vatRate ?? vatRate) * 100)} disabled={locked} onChange={(e) => onChange({ vatRate: Number(e.target.value) / 100 })} />
          </Field>
          <Field label={t("admin.inventory.smart.vatAmount")}>
            <p className="h-10 rounded-xl bg-beige/40 px-3 leading-10">{line.vatAmount != null ? formatIls(line.vatAmount) : "—"}</p>
          </Field>
          <Field label={t("admin.finance.compareGross")}>
            <p className="h-10 rounded-xl bg-beige/40 px-3 leading-10">{line.grossAmount != null ? formatIls(line.grossAmount) : "—"}</p>
          </Field>
          <Field label={t("admin.inventory.unitCost")}>
            <p className="h-10 rounded-xl bg-beige/40 px-3 leading-10">{line.unitPriceNet != null ? formatIls(line.unitPriceNet, 4) : "—"}</p>
          </Field>
          <Field label={t("admin.costing.supplier")}>
            <p className="h-10 rounded-xl bg-beige/40 px-3 leading-10">{supplierName || "—"}</p>
          </Field>
        </div>
        <Field label={t("admin.costing.notes")}>
          <Input value={line.note ?? ""} disabled={locked} onChange={(e) => onChange({ note: e.target.value })} />
        </Field>
        {line.cheaperSupplierName && (
          <p className="text-xs text-amber-700">
            {t("admin.inventory.smart.cheaper")}: {line.cheaperSupplierName} {formatIls(line.cheaperSupplierPrice ?? 0, 4)}
          </p>
        )}
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("admin.inventory.smart.saveRow")}</Button>
        {match && status === "possible" && (
          <Button type="button" variant="turquoise" disabled={locked} onClick={() => { onChange(confirmInvoiceMatchPatch(match, line.matchConfidence)); onClose(); }}>
            <Check className="me-1 h-4 w-4" /> {t("admin.inventory.smart.confirmMatch")}
          </Button>
        )}
      </AdminModalFooter>
    </AdminModal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
