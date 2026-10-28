"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { MeasureUnitDialog } from "@/features/admin/measure-unit-select";
import { useMeasureUnits } from "@/features/admin/measure-units-provider";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { stockInDisplayUnit } from "@/lib/inventory/issue";
import { planInventoryAdjustment, type ShownUnitPrice } from "@/lib/inventory/last-price";
import { queryStockSheet, type StockSheetSort } from "@/lib/inventory/stock-sheet";
import type { Supplier } from "@/lib/inventory/types";

export type InventorySheetRow = {
  item: CostingIngredient;
  sourceText: string;
  supplierName: string;
  opening: number;
  incoming: number;
  consumption: number;
  returns: number;
  current: number;
  discrepancy: boolean;
  duplicate: boolean;
  lastPrice: ShownUnitPrice | null;
  bestText: string;
  paid: number | null;
  invoiceId?: string;
  invoiceNumber?: string;
  stockNames: Array<{ name: string; quantity: number }>;
};

type Editor =
  | { kind: "opening" | "adjust" | "price"; row: InventorySheetRow }
  | null;

const CELL_FIELDS = ["name", "category", "supplier", "notes"] as const;

export function InventorySheet({
  rows,
  suppliers,
  categories,
  onOpenSource,
  onEditInvoice,
  onShowLedger,
  onEditProduct,
  onOpenDetails,
  onToast,
}: {
  rows: InventorySheetRow[];
  suppliers: Supplier[];
  categories: string[];
  onOpenSource: (productId: string) => void;
  onEditInvoice: (invoiceId: string) => void;
  onShowLedger: (productId: string) => void;
  onEditProduct: (product: CostingIngredient) => void;
  onOpenDetails: (productId: string) => void;
  onToast: (message: string) => void;
}) {
  const t = useT();
  const [zero, setZero] = useState(false);
  const [negative, setNegative] = useState(false);
  const [missingPrice, setMissingPrice] = useState(false);
  const [discrepancy, setDiscrepancy] = useState(false);
  const [sort, setSort] = useState<StockSheetSort>("name");
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkSupplier, setBulkSupplier] = useState("");
  const [bulkUnit, setBulkUnit] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkQty, setBulkQty] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [cell, setCell] = useState<{ id: string; field: (typeof CELL_FIELDS)[number] } | null>(null);

  const queried = useMemo(() => {
    const keyed = rows.map((row) => ({
      row,
      id: row.item.id,
      name: row.item.name,
      current: stockInDisplayUnit(row.current, row.item),
      price: row.lastPrice?.excludingVat ?? null,
      date: row.lastPrice?.purchaseDate || row.item.lastReceivedAt || "",
      discrepancy: row.discrepancy || row.duplicate,
    }));
    return queryStockSheet(keyed, { zero, negative, missingPrice, discrepancy, sort }).map((item) => item.row);
  }, [rows, zero, negative, missingPrice, discrepancy, sort]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  function tabFrom(id: string, field: (typeof CELL_FIELDS)[number]) {
    const next = CELL_FIELDS[CELL_FIELDS.indexOf(field) + 1];
    setCell(next ? { id, field: next } : null);
  }

  function toastResult(result: { ok: boolean; code?: string }) {
    if (result.ok) onToast(t("admin.inventory.sheet.saved"));
    else onToast(t(result.code === "CONFLICT" ? "admin.inventory.sheet.conflict" : "admin.inventory.sheet.failed"));
    return result.ok;
  }

  async function patchOne(row: InventorySheetRow, fields: Record<string, unknown>, reason?: string) {
    const result = await clientAdminFetch("/api/admin/inventory/product-patch", {
      items: [{ productId: row.item.id, expectedUpdatedAt: row.item.updatedAt, reason, ...fields }],
    });
    return toastResult(result);
  }

  async function saveName(row: InventorySheetRow, name: string) {
    if (!name || name === row.item.name) return;
    const result = await clientAdminFetch("/api/admin/inventory/invoice/line-name", {
      productId: row.item.id,
      name,
      updateInventory: true,
    });
    toastResult(result);
  }

  async function saveBulk() {
    const ids = queried.filter((row) => selected.includes(row.item.id));
    if (!ids.length) return;
    const fields: Record<string, unknown> = {};
    if (bulkCategory.trim()) fields.category = bulkCategory.trim();
    if (bulkSupplier) fields.lastSupplierId = bulkSupplier;
    if (bulkUnit) fields.purchaseUnit = bulkUnit;
    if (bulkNote.trim()) fields.notes = bulkNote.trim();
    const qty = bulkQty.trim() ? Number(bulkQty) : null;
    if (qty != null) fields.nextQuantity = qty;
    if (!Object.keys(fields).length) {
      onToast(t("admin.inventory.sheet.bulkEmpty"));
      return;
    }
    if (qty != null && !bulkReason.trim()) {
      onToast(t("admin.inventory.sheet.reason"));
      return;
    }
    if (!window.confirm(`${t("admin.inventory.sheet.saveAll")} (${ids.length})`)) return;
    setBusy(true);
    const result = await clientAdminFetch("/api/admin/inventory/product-patch", {
      items: ids.map((row) => ({
        productId: row.item.id,
        expectedUpdatedAt: row.item.updatedAt,
        reason: bulkReason.trim() || undefined,
        ...fields,
      })),
    });
    setBusy(false);
    if (toastResult(result)) {
      setBulkCategory("");
      setBulkSupplier("");
      setBulkUnit("");
      setBulkNote("");
      setBulkQty("");
      setBulkReason("");
      setSelected([]);
    }
  }

  const menuRow = queried.find((row) => row.item.id === menu?.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterButton active={zero} onClick={() => setZero((value) => !value)}>{t("admin.inventory.sheet.zero")}</FilterButton>
        <FilterButton active={negative} onClick={() => setNegative((value) => !value)}>{t("admin.inventory.sheet.negative")}</FilterButton>
        <FilterButton active={missingPrice} onClick={() => setMissingPrice((value) => !value)}>{t("admin.inventory.sheet.noPrice")}</FilterButton>
        <FilterButton active={discrepancy} onClick={() => setDiscrepancy((value) => !value)}>{t("admin.inventory.sheet.gap")}</FilterButton>
        <select className="h-9 rounded-xl border px-2 text-sm" value={sort} onChange={(event) => setSort(event.target.value as StockSheetSort)}>
          <option value="name">{t("admin.inventory.sheet.sortName")}</option>
          <option value="qty">{t("admin.inventory.sheet.sortQty")}</option>
          <option value="price">{t("admin.inventory.sheet.sortPrice")}</option>
          <option value="date">{t("admin.inventory.sheet.sortDate")}</option>
        </select>
        <span className="text-sm text-coffee/60">{t("admin.inventory.sheet.count").replace("{count}", String(queried.length))}</span>
      </div>

      {selected.length > 0 && (
        <div className="grid gap-2 rounded-2xl border border-beige-dark/20 bg-beige/30 p-3 md:grid-cols-6">
          <Input value={bulkCategory} placeholder={t("admin.costing.category")} onChange={(event) => setBulkCategory(event.target.value)} list="inventory-sheet-categories" />
          <select className="h-10 rounded-xl border px-2 text-sm" value={bulkSupplier} onChange={(event) => setBulkSupplier(event.target.value)}>
            <option value="">{t("admin.costing.supplier")}</option>
            {suppliers.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <UnitSelect value={bulkUnit} onChange={setBulkUnit} />
          <Input value={bulkNote} placeholder={t("admin.inventory.sheet.notes")} onChange={(event) => setBulkNote(event.target.value)} />
          <Input inputMode="decimal" value={bulkQty} placeholder={t("admin.inventory.sheet.nextQty")} onChange={(event) => setBulkQty(event.target.value)} />
          <Input value={bulkReason} placeholder={t("admin.inventory.sheet.reason")} onChange={(event) => setBulkReason(event.target.value)} />
          <Button type="button" variant="turquoise" className="md:col-span-2" disabled={busy} onClick={() => void saveBulk()}>{t("admin.inventory.sheet.saveAll")}</Button>
        </div>
      )}
      <datalist id="inventory-sheet-categories">
        {categories.map((item) => <option key={item} value={item} />)}
      </datalist>

      <div className="space-y-2 md:hidden">
        {queried.map((row) => (
          <article key={row.item.id} className="space-y-2 rounded-2xl border border-beige-dark/20 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <NameCell row={row} open={cell?.id === row.item.id && cell.field === "name"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "name" })} onTab={() => tabFrom(row.item.id, "name")} onSave={saveName} />
              <MenuButton row={row} onOpen={setMenu} />
            </div>
            <Field label={t("admin.costing.category")}><CategoryCell row={row} open={cell?.id === row.item.id && cell.field === "category"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "category" })} onTab={() => tabFrom(row.item.id, "category")} onSave={(category) => void patchOne(row, { category })} /></Field>
            <Field label={t("admin.inventory.source")}><button type="button" className="truncate text-start text-turquoise" title={row.sourceText} onClick={() => onOpenSource(row.item.id)}>{row.sourceText}</button></Field>
            <Field label={t("admin.inventory.lastSupplier")}><SupplierCell row={row} suppliers={suppliers} open={cell?.id === row.item.id && cell.field === "supplier"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "supplier" })} onTab={() => tabFrom(row.item.id, "supplier")} onSave={(lastSupplierId) => void patchOne(row, { lastSupplierId })} /></Field>
            <QtyLine label={t("admin.inventory.opening")} value={showQty(row.opening, row.item)} onClick={() => setEditor({ kind: "opening", row })} />
            <QtyLine label={t("admin.inventory.stockIn")} value={showQty(row.incoming, row.item)} onClick={() => onOpenSource(row.item.id)} />
            <QtyLine label={t("admin.inventory.consumption")} value={showQty(row.consumption, row.item)} onClick={() => onShowLedger(row.item.id)} />
            <QtyLine label={t("admin.inventory.current")} value={showQty(row.current, row.item)} onClick={() => setEditor({ kind: "adjust", row })} strong />
            <Field label={t("admin.costing.unit")}><UnitSelect value={row.item.purchaseUnit} onChange={(purchaseUnit) => { if (purchaseUnit) void patchOne(row, { purchaseUnit }); }} /></Field>
            <Field label={t("admin.inventory.lastPrice")}><PriceCell row={row} onEdit={() => setEditor({ kind: "price", row })} /></Field>
            <Field label={t("admin.inventory.bestPrice")}><button type="button" className="truncate" title={row.bestText} onClick={() => onOpenDetails(row.item.id)}>{row.bestText || "—"}</button></Field>
            <Field label={t("admin.inventory.sheet.notes")}><NotesCell row={row} open={cell?.id === row.item.id && cell.field === "notes"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "notes" })} onSave={(notes) => void patchOne(row, { notes })} /></Field>
          </article>
        ))}
      </div>

      <div className="hidden max-h-[70vh] overflow-auto rounded-2xl border border-beige-dark/20 md:block">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="text-coffee/70">
            <tr>
              <Head className="sticky start-0 top-0 z-40 w-10 bg-beige">{""}</Head>
              <Head className="sticky start-10 top-0 z-40 min-w-40 bg-beige">{t("admin.inventory.product")}</Head>
              <Head>{t("admin.costing.category")}</Head>
              <Head>{t("admin.inventory.source")}</Head>
              <Head>{t("admin.inventory.lastSupplier")}</Head>
              <Head align="end">{t("admin.inventory.opening")}</Head>
              <Head align="end">{t("admin.inventory.stockIn")}</Head>
              <Head align="end">{t("admin.inventory.consumption")}</Head>
              <Head align="end">{t("admin.inventory.current")}</Head>
              <Head>{t("admin.costing.unit")}</Head>
              <Head align="end">{t("admin.inventory.priceExVat")}</Head>
              <Head align="end">{t("admin.inventory.priceIncVat")}</Head>
              <Head align="end">{t("admin.inventory.bestPrice")}</Head>
              <Head align="end">{t("admin.inventory.sheet.paid")}</Head>
              <Head>{t("admin.inventory.sheet.conversion")}</Head>
              <Head>{t("admin.inventory.sheet.notes")}</Head>
              <Head>{t("admin.inventory.actions")}</Head>
            </tr>
          </thead>
          <tbody>
            {queried.map((row) => (
              <tr key={row.item.id} className="h-10">
                <Body className="sticky start-0 z-10 bg-white">
                  <input type="checkbox" checked={selected.includes(row.item.id)} onChange={() => setSelected((current) => current.includes(row.item.id) ? current.filter((id) => id !== row.item.id) : [...current, row.item.id])} />
                </Body>
                <Body className="sticky start-10 z-10 max-w-[16rem] bg-white">
                  <NameCell row={row} open={cell?.id === row.item.id && cell.field === "name"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "name" })} onTab={() => tabFrom(row.item.id, "name")} onSave={saveName} />
                  {row.duplicate ? <span className="ms-1 text-[10px] text-amber-800">{t("admin.inventory.sheet.duplicate")}</span> : null}
                </Body>
                <Body><CategoryCell row={row} open={cell?.id === row.item.id && cell.field === "category"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "category" })} onTab={() => tabFrom(row.item.id, "category")} onSave={(category) => void patchOne(row, { category })} /></Body>
                <Body>
                  <button type="button" className="block max-w-[12rem] truncate text-start text-turquoise" title={row.sourceText} onClick={() => onOpenSource(row.item.id)}>{row.sourceText}</button>
                </Body>
                <Body><SupplierCell row={row} suppliers={suppliers} open={cell?.id === row.item.id && cell.field === "supplier"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "supplier" })} onTab={() => tabFrom(row.item.id, "supplier")} onSave={(lastSupplierId) => void patchOne(row, { lastSupplierId })} /></Body>
                <QtyCell value={showQty(row.opening, row.item)} title={t("admin.inventory.sheet.openingTitle")} onClick={() => setEditor({ kind: "opening", row })} />
                <QtyCell value={showQty(row.incoming, row.item)} title={t("admin.inventory.sheet.incomingHint")} onClick={() => onOpenSource(row.item.id)} />
                <QtyCell value={showQty(row.consumption, row.item)} title={t("admin.inventory.sheet.consumptionHint")} onClick={() => onShowLedger(row.item.id)} />
                <QtyCell value={showQty(row.current, row.item)} title={t("admin.inventory.sheet.adjustTitle")} strong={row.discrepancy} onClick={() => setEditor({ kind: "adjust", row })} />
                <Body><UnitSelect value={row.item.purchaseUnit} onChange={(purchaseUnit) => { if (purchaseUnit) void patchOne(row, { purchaseUnit }); }} /></Body>
                <Body align="end"><PriceCell row={row} part="ex" onEdit={() => setEditor({ kind: "price", row })} /></Body>
                <Body align="end"><PriceCell row={row} part="inc" onEdit={() => setEditor({ kind: "price", row })} /></Body>
                <Body align="end"><button type="button" className="max-w-[9rem] truncate" title={row.bestText || t("admin.inventory.sheet.bestHint")} onClick={() => onOpenDetails(row.item.id)}>{row.bestText || "—"}</button></Body>
                <Body align="end"><button type="button" className="tabular-nums" onClick={() => setEditor({ kind: "price", row })}>{row.paid != null ? formatIls(row.paid) : "—"}</button></Body>
                <Body><PackCell row={row} onSave={(packCount, packContentUnit) => void patchOne(row, { packCount, packContentUnit })} /></Body>
                <Body><NotesCell row={row} open={cell?.id === row.item.id && cell.field === "notes"} onClose={() => setCell(null)} onOpen={() => setCell({ id: row.item.id, field: "notes" })} onSave={(notes) => void patchOne(row, { notes })} /></Body>
                <Body><MenuButton row={row} onOpen={setMenu} /></Body>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {menu && menuRow ? (
        <div className="fixed z-50 w-56 rounded-xl border border-beige-dark/20 bg-white p-1 shadow-lg" style={{ top: menu.top, left: menu.left }} onClick={(event) => event.stopPropagation()}>
          <MenuItem label={t("common.edit")} onClick={() => { onEditProduct(menuRow.item); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.editSource")} onClick={() => { onOpenSource(menuRow.item.id); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.adjust")} onClick={() => { setEditor({ kind: "adjust", row: menuRow }); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.editPrice")} onClick={() => { setEditor({ kind: "price", row: menuRow }); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.movements")} onClick={() => { onShowLedger(menuRow.item.id); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.prices")} onClick={() => { onOpenDetails(menuRow.item.id); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.invoices")} onClick={() => { onOpenSource(menuRow.item.id); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.suppliers")} onClick={() => { onOpenDetails(menuRow.item.id); setMenu(null); }} />
          <MenuItem label={t("admin.inventory.sheet.archive")} onClick={() => {
            setMenu(null);
            if (!window.confirm(t("admin.inventory.sheet.archiveConfirm"))) return;
            void patchOne(menuRow, { active: false });
          }} />
        </div>
      ) : null}

      {editor ? (
        <StockEditor
          editor={editor}
          onClose={() => setEditor(null)}
          onToast={onToast}
          onEditInvoice={onEditInvoice}
        />
      ) : null}
    </div>
  );
}

function StockEditor({
  editor,
  onClose,
  onToast,
  onEditInvoice,
}: {
  editor: { kind: "opening" | "adjust" | "price"; row: InventorySheetRow };
  onClose: () => void;
  onToast: (message: string) => void;
  onEditInvoice: (invoiceId: string) => void;
}) {
  const t = useT();
  const row = editor.row;
  const current = stockInDisplayUnit(editor.kind === "opening" ? row.opening : row.current, row.item);
  const [next, setNext] = useState(current.toFixed(2));
  const [reason, setReason] = useState("");
  const [basis, setBasis] = useState<"excluding" | "including" | "exempt">("excluding");
  const [price, setPrice] = useState(row.lastPrice?.excludingVat != null ? String(row.lastPrice.excludingVat) : "");
  const [busy, setBusy] = useState(false);
  const parsed = Number(next);
  let delta = "";
  if (editor.kind !== "price" && Number.isFinite(parsed)) {
    try {
      const plan = planInventoryAdjustment({
        currentBase: editor.kind === "opening" ? row.opening : row.current,
        nextQuantity: parsed,
        unit: row.item.purchaseUnit,
        baseUnit: row.item.baseUnit,
      });
      delta = `${plan.deltaBase > 0 ? "+" : ""}${plan.deltaBase}`;
    } catch {
      delta = t("admin.inventory.adjustRejected");
    }
  }

  async function save() {
    if (!reason.trim()) return;
    setBusy(true);
    const result = editor.kind === "price"
      ? await clientAdminFetch("/api/admin/inventory/price-correction", {
          productId: row.item.id,
          unitPrice: Number(price),
          basis,
          reason: reason.trim(),
          invoiceId: row.invoiceId,
          purchaseUnit: row.item.purchaseUnit,
        })
      : editor.kind === "opening"
        ? await clientAdminFetch("/api/admin/inventory/product-patch", {
            items: [{ productId: row.item.id, expectedUpdatedAt: row.item.updatedAt, openingQuantity: parsed, reason: reason.trim() }],
          })
        : await clientAdminFetch("/api/admin/inventory/stock-adjust", {
            productId: row.item.id,
            nextQuantity: parsed,
            unit: row.item.purchaseUnit,
            reason: reason.trim(),
          });
    setBusy(false);
    if (!result.ok) {
      onToast(t(result.code === "CONFLICT" ? "admin.inventory.sheet.conflict" : "admin.inventory.adjustRejected"));
      return;
    }
    onToast(t("admin.inventory.sheet.saved"));
    onClose();
  }

  const title = editor.kind === "price"
    ? t("admin.inventory.sheet.editPrice")
    : editor.kind === "opening"
      ? t("admin.inventory.sheet.openingTitle")
      : t("admin.inventory.sheet.adjustTitle");

  return (
    <AdminModal open onOpenChange={(open) => !open && onClose()} size="sm">
      <AdminModalHeader onClose={onClose}><AdminModalTitle>{title}</AdminModalTitle></AdminModalHeader>
      <AdminModalBody className="space-y-3">
        {editor.kind === "price" ? (
          <>
            <p className="text-sm">{t("admin.inventory.priceExVat")}: {row.lastPrice?.excludingVat != null ? formatIls(row.lastPrice.excludingVat) : "—"} · {t("admin.inventory.priceIncVat")}: {row.lastPrice?.includingVat != null ? formatIls(row.lastPrice.includingVat) : "—"}</p>
            <p className="text-xs text-coffee/60">{row.supplierName}{row.lastPrice?.purchaseDate ? ` · ${row.lastPrice.purchaseDate.slice(0, 10)}` : ""}</p>
            <select className="h-10 w-full rounded-xl border px-2" value={basis} onChange={(event) => setBasis(event.target.value as typeof basis)}>
              <option value="excluding">{t("admin.inventory.priceBasis.excluding")}</option>
              <option value="including">{t("admin.inventory.priceBasis.including")}</option>
              <option value="exempt">{t("admin.inventory.priceBasis.exempt")}</option>
            </select>
            <Input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            <p className="text-xs text-coffee/55">{t("admin.inventory.sheet.manualPrice")}</p>
            {row.invoiceId ? (
              <button type="button" className="text-sm text-turquoise" onClick={() => { onClose(); onEditInvoice(row.invoiceId!); }}>{t("admin.inventory.sheet.editInvoice")}</button>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm">{t("admin.inventory.sheet.currentQty")}: {current.toFixed(2)}</p>
            <Input inputMode="decimal" value={next} onChange={(event) => setNext(event.target.value)} />
            <p className="text-sm">{t("admin.inventory.sheet.delta")}: {delta || "—"}</p>
            {row.stockNames.length > 1 ? <p className="text-xs text-amber-800">{row.stockNames.map((item) => `${item.name} ${item.quantity}`).join(" · ")}</p> : null}
          </>
        )}
        <Input value={reason} placeholder={t("admin.inventory.sheet.reason")} onChange={(event) => setReason(event.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("admin.inventory.sheet.cancel")}</Button>
          <Button type="button" variant="turquoise" disabled={busy || !reason.trim()} onClick={() => void save()}>{t("admin.inventory.sheet.confirm")}</Button>
        </div>
      </AdminModalBody>
    </AdminModal>
  );
}

function NameCell({ row, open, onOpen, onClose, onTab, onSave }: { row: InventorySheetRow; open: boolean; onOpen: () => void; onClose: () => void; onTab: () => void; onSave: (row: InventorySheetRow, name: string) => Promise<void> }) {
  const [value, setValue] = useState(row.item.name);
  if (!open) {
    return <button type="button" className="block max-w-full truncate text-start font-medium" title={row.item.name} onClick={() => { setValue(row.item.name); onOpen(); }}>{row.item.name}</button>;
  }
  return (
    <Input
      autoFocus
      className={`h-8 ${value.trim() !== row.item.name ? "ring-2 ring-amber-400" : ""}`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Enter") {
          onClose();
          void onSave(row, value.trim());
        }
        if (event.key === "Tab") {
          event.preventDefault();
          void onSave(row, value.trim());
          onTab();
        }
      }}
    />
  );
}

function CategoryCell({ row, open, onOpen, onClose, onTab, onSave }: { row: InventorySheetRow; open: boolean; onOpen: () => void; onClose: () => void; onTab: () => void; onSave: (category: string) => void }) {
  const [value, setValue] = useState(row.item.category || "");
  if (!open) return <button type="button" className="block max-w-[8rem] truncate" title={row.item.category || ""} onClick={() => { setValue(row.item.category || ""); onOpen(); }}>{row.item.category || "—"}</button>;
  return (
    <Input
      autoFocus
      className={`h-8 ${value.trim() !== (row.item.category || "") ? "ring-2 ring-amber-400" : ""}`}
      list="inventory-sheet-categories"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Enter") {
          onClose();
          if (value.trim() !== (row.item.category || "")) onSave(value.trim());
        }
        if (event.key === "Tab") {
          event.preventDefault();
          if (value.trim() !== (row.item.category || "")) onSave(value.trim());
          onTab();
        }
      }}
    />
  );
}

function SupplierCell({ row, suppliers, open, onOpen, onClose, onTab, onSave }: { row: InventorySheetRow; suppliers: Supplier[]; open: boolean; onOpen: () => void; onClose: () => void; onTab: () => void; onSave: (supplierId: string) => void }) {
  const [query, setQuery] = useState("");
  const options = suppliers.filter((item) => item.active !== false && (!query || item.name.includes(query)));
  if (!open) return <button type="button" className="block max-w-[8rem] truncate" title={row.supplierName} onClick={onOpen}>{row.supplierName || "—"}</button>;
  return (
    <div>
      <Input autoFocus className="h-8" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Tab") {
          event.preventDefault();
          onTab();
        }
      }} />
      <select className="mt-1 h-8 max-w-[10rem] rounded-lg border px-1" value={row.item.lastSupplierId || ""} onChange={(event) => { onClose(); onSave(event.target.value); }}>
        <option value="">—</option>
        {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
  );
}

function NotesCell({ row, open, onOpen, onClose, onSave }: { row: InventorySheetRow; open: boolean; onOpen: () => void; onClose: () => void; onSave: (notes: string) => void }) {
  const [value, setValue] = useState(row.item.notes || "");
  if (!open) return <button type="button" className="block max-w-[8rem] truncate text-coffee/70" title={row.item.notes || ""} onClick={() => { setValue(row.item.notes || ""); onOpen(); }}>{row.item.notes || "—"}</button>;
  return (
    <Input
      autoFocus
      className={`h-8 ${value !== (row.item.notes || "") ? "ring-2 ring-amber-400" : ""}`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Enter") {
          onClose();
          if (value !== (row.item.notes || "")) onSave(value);
        }
      }}
    />
  );
}

function PackCell({ row, onSave }: { row: InventorySheetRow; onSave: (count: number | null, unit: string | null) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [count, setCount] = useState(row.item.packCount != null ? String(row.item.packCount) : "");
  const [unit, setUnit] = useState(row.item.packContentUnit || "");
  const label = row.item.packCount ? `${row.item.packCount}${row.item.packContentUnit ? `×${t(unitLabelKey(row.item.packContentUnit))}` : ""}` : "—";
  if (!editing) return <button type="button" className="whitespace-nowrap" onClick={() => setEditing(true)}>{label}</button>;
  return (
    <div className="flex items-center gap-1">
      <Input autoFocus className="h-8 w-16" inputMode="decimal" value={count} onChange={(event) => setCount(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setEditing(false)} />
      <UnitSelect value={unit} onChange={setUnit} />
      <button type="button" className="text-xs text-turquoise" onClick={() => { setEditing(false); onSave(count.trim() ? Number(count) : null, unit || null); }}>{t("admin.inventory.sheet.confirm")}</button>
    </div>
  );
}

function PriceCell({ row, part = "ex", onEdit }: { row: InventorySheetRow; part?: "ex" | "inc"; onEdit: () => void }) {
  const amount = part === "inc" ? row.lastPrice?.includingVat : row.lastPrice?.excludingVat;
  const title = [row.supplierName, row.lastPrice?.purchaseDate?.slice(0, 10)].filter(Boolean).join(" · ");
  return <button type="button" className="whitespace-nowrap tabular-nums" title={title} onClick={onEdit}>{amount != null ? formatIls(amount) : "—"}</button>;
}

function UnitSelect({ value, onChange }: { value: string; onChange: (unit: string) => void }) {
  const t = useT();
  const { units } = useMeasureUnits();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <select className="h-8 max-w-[7rem] rounded-lg border bg-white px-1 text-sm" value={value} title={t("admin.inventory.sheet.unitNoConvert")} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        {units.filter((unit) => unit.active || unit.id === value).map((unit) => (
          <option key={unit.id} value={unit.id}>{unit.abbreviation || unit.nameHe}</option>
        ))}
      </select>
      <button type="button" className="text-xs font-medium text-turquoise" onClick={() => setOpen(true)}>+</button>
      {open ? <MeasureUnitDialog open onClose={() => setOpen(false)} onSaved={(unit) => { onChange(unit.id); setOpen(false); }} /> : null}
    </div>
  );
}

function QtyCell({ value, title, onClick, strong }: { value: string; title: string; onClick: () => void; strong?: boolean }) {
  return (
    <td className="border-t border-beige-dark/10 px-2 text-end">
      <button type="button" className={`tabular-nums whitespace-nowrap ${strong ? "font-semibold text-amber-800" : ""}`} title={title} onClick={onClick}>{value}</button>
    </td>
  );
}

function Head({ children, className = "", align = "start" }: { children: string; className?: string; align?: "start" | "end" }) {
  const corner = className.includes("z-40");
  return <th className={`sticky top-0 whitespace-nowrap border-b border-beige-dark/15 bg-beige px-2 py-2 font-medium ${corner ? "z-40" : "z-30"} ${align === "end" ? "text-end" : "text-start"} ${className.replace("z-40", "")}`}>{children}</th>;
}

function Body({ children, className = "", align = "start" }: { children: ReactNode; className?: string; align?: "start" | "end" }) {
  return <td className={`h-10 whitespace-nowrap border-t border-beige-dark/10 px-2 ${align === "end" ? "text-end" : "text-start"} ${className}`}>{children}</td>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-xs text-coffee/50">{label}</span>{children}</label>;
}

function QtyLine({ label, value, onClick, strong }: { label: string; value: string; onClick: () => void; strong?: boolean }) {
  return (
    <button type="button" className="flex w-full items-center justify-between text-sm" onClick={onClick}>
      <span className="text-coffee/50">{label}</span>
      <span className={strong ? "font-semibold" : "tabular-nums"}>{value}</span>
    </button>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <Button type="button" variant={active ? "turquoise" : "outline"} className="h-9" onClick={onClick}>{children}</Button>;
}

function MenuButton({ row, onOpen }: { row: InventorySheetRow; onOpen: (menu: { id: string; top: number; left: number }) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("admin.inventory.actions")}
      className="rounded-lg p-1 hover:bg-beige"
      onClick={(event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen({ id: row.item.id, top: rect.bottom + 4, left: Math.max(8, rect.left - 180) });
      }}
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-beige/60" onClick={onClick}>{label}</button>;
}

function showQty(base: number, item: CostingIngredient): string {
  return stockInDisplayUnit(base, item).toFixed(2);
}

