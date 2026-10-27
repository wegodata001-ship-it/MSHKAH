"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvoiceCategorySelect } from "@/features/admin/inventory/invoice-category-select";
import { InvoiceNewProductDialog } from "@/features/admin/inventory/invoice-new-product-dialog";
import { InvoiceUnitField } from "@/features/admin/inventory/invoice-unit-field";
import { useT } from "@/components/providers/locale-provider";
import type { BaseUnit, CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { lineNetAmount } from "@/lib/inventory/invoice-lines";
import { applyInvoiceLineMoney, shownLinePrices } from "@/lib/inventory/unit-price";
import { packFactor } from "@/lib/inventory/pack-cost";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";
import { setIngredientCategory } from "@/services/costingService";

function factorFor(count?: number | null, unit?: PurchaseUnit | null): number | null {
  if (!count || !unit) return null;
  const packed = packFactor({ contentCount: count, contentUnit: unit });
  return packed.ok ? packed.factor : null;
}

export function InvoiceManualLines({
  lines,
  ingredients,
  supplierName,
  vatRate,
  locked,
  unitLocked,
  focusLineKey,
  onChange,
  onAdd,
  onRemove,
}: {
  lines: PurchaseInvoiceLine[];
  ingredients: CostingIngredient[];
  supplierName: string;
  vatRate: number;
  locked?: boolean;
  unitLocked?: boolean;
  focusLineKey?: string | null;
  onChange: (key: string, patch: Partial<PurchaseInvoiceLine>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState<Record<string, string>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const activeIngredients = useMemo(() => ingredients.filter((item) => item.active !== false), [ingredients]);

  const chooseProduct = (key: string, product: CostingIngredient) => {
    onChange(key, {
      productId: product.id,
      rawName: product.name,
      category: product.category,
      categoryId: product.categoryId,
      unit: product.purchaseUnit,
      packCount: product.packCount ?? null,
      packContentUnit: product.packContentUnit ?? null,
      conversionFactor: factorFor(product.packCount, product.packContentUnit),
    });
    setOpenKey(null);
  };

  return (
    <div className="mt-5 space-y-3">
      <div className="hidden lg:block">
        <table className="w-full table-fixed border-separate border-spacing-y-2 text-base">
          <thead>
            <tr className="text-start text-sm text-coffee/70">
              <th className="w-[24%] px-1 text-start font-semibold">{t("admin.inventory.product")}</th>
              <th className="w-[18%] px-1 text-start font-semibold">{t("admin.costing.category")}</th>
              <th className="w-[10%] px-1 text-start font-semibold">{t("admin.inventory.qty")}</th>
              <th className="w-[16%] px-1 text-start font-semibold">{t("admin.costing.unit")}</th>
              <th className="w-[12%] px-1 text-start font-semibold">{t("admin.inventory.unitPrice")}</th>
              <th className="w-[10%] px-1 text-start font-semibold">{t("admin.inventory.discount")}</th>
              <th className="w-[10%] px-1 text-start font-semibold">{t("admin.inventory.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <LineCells
                key={line.key}
                line={line}
                locked={locked}
                unitLocked={unitLocked}
                highlight={focusLineKey === line.key}
                ingredients={activeIngredients}
                query={query[line.key] ?? ""}
                open={openKey === line.key}
                vatRate={vatRate}
                onQuery={(value) => setQuery((current) => ({ ...current, [line.key]: value }))}
                onOpen={() => setOpenKey(line.key)}
                onClose={() => setOpenKey(null)}
                onChoose={(product) => chooseProduct(line.key, product)}
                onCreate={() => setCreateKey(line.key)}
                onChange={(patch) => onChange(line.key, patch)}
                onRemove={() => onRemove(line.key)}
                canRemove={lines.length > 1}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {lines.map((line) => (
          <LineCard
            key={line.key}
            line={line}
            locked={locked}
            unitLocked={unitLocked}
            highlight={focusLineKey === line.key}
            ingredients={activeIngredients}
            query={query[line.key] ?? ""}
            open={openKey === line.key}
            vatRate={vatRate}
            onQuery={(value) => setQuery((current) => ({ ...current, [line.key]: value }))}
            onOpen={() => setOpenKey(line.key)}
            onClose={() => setOpenKey(null)}
            onChoose={(product) => chooseProduct(line.key, product)}
            onCreate={() => setCreateKey(line.key)}
            onChange={(patch) => onChange(line.key, patch)}
            onRemove={() => onRemove(line.key)}
            canRemove={lines.length > 1}
          />
        ))}
      </div>
      {!locked && (
        <Button type="button" variant="turquoise" className="min-h-11" onClick={onAdd}>
          <Plus className="h-4 w-4" /> {t("admin.inventory.addLine")}
        </Button>
      )}
      <InvoiceNewProductDialog
        open={createKey != null}
        supplierName={supplierName}
        existing={ingredients}
        onClose={() => setCreateKey(null)}
        onCreated={(item) => {
          if (createKey) {
            onChange(createKey, {
              productId: item.id,
              rawName: item.name,
              category: item.category,
              categoryId: item.categoryId,
              unit: item.purchaseUnit,
              unitPrice: item.purchasePrice || null,
              quantity: item.purchaseQuantity || null,
              packCount: item.packCount ?? null,
              packContentUnit: item.packContentUnit ?? null,
              conversionFactor: factorFor(item.packCount, item.packContentUnit),
              barcode: item.barcode,
              note: item.notes,
            });
          }
        }}
      />
    </div>
  );
}

function ProductPicker(props: {
  line: PurchaseInvoiceLine;
  ingredients: CostingIngredient[];
  query: string;
  open: boolean;
  locked?: boolean;
  onQuery: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onChoose: (product: CostingIngredient) => void;
  onCreate: () => void;
}) {
  const t = useT();
  const selected = props.ingredients.find((item) => item.id === props.line.productId);
  const q = props.query.trim().toLowerCase();
  const matches = (q ? props.ingredients.filter((item) => item.name.toLowerCase().includes(q)) : props.ingredients).slice(0, 8);
  return (
    <div className="relative">
      <Input
        className="h-11 text-base"
        disabled={props.locked}
        value={props.open ? props.query : selected?.name || props.line.rawName}
        placeholder={t("admin.inventory.product")}
        onFocus={props.onOpen}
        onChange={(event) => {
          props.onOpen();
          props.onQuery(event.target.value);
        }}
      />
      {props.open && !props.locked && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border bg-white p-1 shadow-lg">
          {matches.map((item) => (
            <button key={item.id} type="button" className="block min-h-11 w-full rounded-lg px-2 text-start hover:bg-beige/60" onClick={() => props.onChoose(item)}>
              <span className="font-medium">{item.name}</span>
              {item.category ? <span className="ms-2 text-sm text-coffee/50">{item.category}</span> : null}
            </button>
          ))}
          <button type="button" className="min-h-11 w-full rounded-lg px-2 text-start text-turquoise" onClick={props.onCreate}>
            {t("admin.invoice.manual.newProduct")}
          </button>
        </div>
      )}
      {!props.locked && (
        <button type="button" className="mt-1 min-h-11 text-sm text-turquoise" onClick={props.onCreate}>
          {t("admin.invoice.manual.newProduct")}
        </button>
      )}
    </div>
  );
}

function sharedEditors(line: PurchaseInvoiceLine, locked: boolean | undefined, unitLocked: boolean | undefined, ingredients: CostingIngredient[], vatRate: number, onChange: (patch: Partial<PurchaseInvoiceLine>) => void) {
  const product = ingredients.find((item) => item.id === line.productId);
  const expectedBase = product?.baseUnit as BaseUnit | undefined;
  const net = lineNetAmount(line);
  return {
    product,
    expectedBase,
    category: (
      <InvoiceCategorySelect
        value={line.category ?? ""}
        disabled={locked}
        onChange={(next) => {
          onChange({ category: next.name, categoryId: next.id });
          if (line.productId) void setIngredientCategory(line.productId, next.name, next.id);
        }}
      />
    ),
    qty: (
      <Input className="h-11 text-base" type="number" min="0" step="0.01" disabled={locked} value={line.quantity ?? ""} onChange={(event) => onChange(applyInvoiceLineMoney(line, { field: "quantity", quantity: event.target.value ? Number(event.target.value) : null }, vatRate))} />
    ),
    unit: (
      <InvoiceUnitField
        unit={line.unit}
        customUnitId={line.customUnitId}
        packCount={line.packCount}
        packContentUnit={line.packContentUnit}
        quantity={line.quantity}
        lineTotal={net}
        expectedBase={expectedBase}
        disabled={unitLocked}
        onChange={(patch) => onChange(patch)}
      />
    ),
    price: (
      <Input className="h-11 text-base" type="number" min="0" step="0.01" disabled={locked} value={shownLinePrices(line).unit ?? ""} onChange={(event) => onChange(applyInvoiceLineMoney(line, { field: "unitPrice", unitPrice: event.target.value ? Number(event.target.value) : null }, vatRate))} />
    ),
    discount: (
      <Input className="h-11 text-base" type="number" min="0" step="0.01" disabled={locked} value={line.discount ?? ""} onChange={(event) => onChange(applyInvoiceLineMoney(line, { field: "discount", discount: event.target.value ? Number(event.target.value) : null }, vatRate))} />
    ),
    totalInput: (
      <Input className="h-11 text-base font-semibold" type="number" min="0" step="0.01" disabled={locked} value={shownLinePrices(line).line ?? ""} aria-label="line total" onChange={(event) => onChange(applyInvoiceLineMoney(line, { field: "lineTotal", lineTotal: event.target.value ? Number(event.target.value) : null }, vatRate))} />
    ),
  };
}

function LineCells(props: {
  line: PurchaseInvoiceLine;
  locked?: boolean;
  unitLocked?: boolean;
  highlight: boolean;
  ingredients: CostingIngredient[];
  query: string;
  open: boolean;
  vatRate: number;
  canRemove: boolean;
  onQuery: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onChoose: (product: CostingIngredient) => void;
  onCreate: () => void;
  onChange: (patch: Partial<PurchaseInvoiceLine>) => void;
  onRemove: () => void;
}) {
  const editors = sharedEditors(props.line, props.locked, props.unitLocked, props.ingredients, props.vatRate, props.onChange);
  return (
    <tr id={`invoice-line-${props.line.key}`} data-invoice-line={props.line.key} className={props.highlight ? "bg-amber-50" : undefined}>
      <td className="px-1 align-top">
        <ProductPicker line={props.line} ingredients={props.ingredients} query={props.query} open={props.open} locked={props.locked} onQuery={props.onQuery} onOpen={props.onOpen} onClose={props.onClose} onChoose={props.onChoose} onCreate={props.onCreate} />
      </td>
      <td className="px-1 align-top">{editors.category}</td>
      <td className="px-1 align-top">{editors.qty}</td>
      <td className="px-1 align-top">{editors.unit}</td>
      <td className="px-1 align-top">{editors.price}</td>
      <td className="px-1 align-top">{editors.discount}</td>
      <td className="px-1 align-top">
        {editors.totalInput}
        {props.canRemove && !props.locked && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={props.onRemove}><Trash2 className="h-4 w-4" /></Button>
        )}
      </td>
    </tr>
  );
}

function LineCard(props: {
  line: PurchaseInvoiceLine;
  locked?: boolean;
  unitLocked?: boolean;
  highlight: boolean;
  ingredients: CostingIngredient[];
  query: string;
  open: boolean;
  vatRate: number;
  canRemove: boolean;
  onQuery: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onChoose: (product: CostingIngredient) => void;
  onCreate: () => void;
  onChange: (patch: Partial<PurchaseInvoiceLine>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const editors = sharedEditors(props.line, props.locked, props.unitLocked, props.ingredients, props.vatRate, props.onChange);
  return (
    <div id={`invoice-line-${props.line.key}`} data-invoice-line={props.line.key} className={`space-y-2 rounded-2xl border p-3 ${props.highlight ? "border-amber-500 ring-2 ring-amber-500" : "border-beige-dark/20"}`}>
      <ProductPicker line={props.line} ingredients={props.ingredients} query={props.query} open={props.open} locked={props.locked} onQuery={props.onQuery} onOpen={props.onOpen} onClose={props.onClose} onChoose={props.onChoose} onCreate={props.onCreate} />
      {editors.category}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-coffee/70">{t("admin.inventory.qty")}{editors.qty}</label>
        <label className="block text-sm text-coffee/70">{t("admin.costing.unit")}{editors.unit}</label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-coffee/70">{t("admin.inventory.unitPrice")}{editors.price}</label>
        <label className="block text-sm text-coffee/70">{t("admin.inventory.discount")}{editors.discount}</label>
      </div>
      <div className="flex items-center justify-between">
        <label className="block text-sm text-coffee/70">{t("admin.inventory.lineTotal")}{editors.totalInput}</label>
        {props.canRemove && !props.locked && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={props.onRemove}><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>
    </div>
  );
}
