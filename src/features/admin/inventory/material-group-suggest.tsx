"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import type { CostingIngredient } from "@/lib/costing/types";
import {
  cheapestGroupRow,
  lineUnitCostForCompare,
  suggestMaterialGroup,
} from "@/lib/inventory/material-group";
import type { PurchaseInvoiceLine, Supplier, SupplierItemMap, SupplierOffer } from "@/lib/inventory/types";
import { saveIngredientCompareGroup } from "@/services/inventoryService";

export function MaterialGroupSuggest(props: {
  line: {
    name: string;
    sku?: string | null;
    barcode?: string | null;
    productId?: string;
    matchKind?: string;
    matchConfirmed?: boolean;
    quantity?: number | null;
    unit?: PurchaseInvoiceLine["unit"];
    conversionFactor?: number | null;
    lineNet?: number | null;
    lineGross?: number | null;
    unitPrice?: number | null;
    vatType?: PurchaseInvoiceLine["vatType"];
  };
  ingredients: CostingIngredient[];
  maps?: SupplierItemMap[];
  suppliers?: Supplier[];
  offers?: SupplierOffer[];
  supplierId?: string;
  locked?: boolean;
  onAssignSame: (ingredient: CostingIngredient) => void;
  onCreateUnified?: (name: string) => void;
  onKeepSeparate: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [unifiedName, setUnifiedName] = useState("");
  const [compareName, setCompareName] = useState("");
  const money = lineUnitCostForCompare({
    quantity: props.line.quantity ?? null,
    unit: props.line.unit ?? null,
    conversionFactor: props.line.conversionFactor,
    lineNet: props.line.lineNet,
    lineGross: props.line.lineGross,
    unitPrice: props.line.unitPrice,
    vatType: props.line.vatType,
  });
  const suggestion = useMemo(
    () =>
      suggestMaterialGroup({
        line: props.line,
        ingredients: props.ingredients,
        maps: props.maps,
        suppliers: props.suppliers,
        offers: props.offers,
        supplierId: props.supplierId,
        pack: { unit: props.line.unit, packageQuantity: props.line.quantity, conversion: props.line.conversionFactor },
        lineUnitCost: money.unitCost,
        lineVatBasis: money.vatBasis,
      }),
    [props.line, props.ingredients, props.maps, props.offers, props.supplierId, props.suppliers, money.unitCost, money.vatBasis]
  );
  if (!suggestion.show || dismissed) return null;
  const cheap = cheapestGroupRow(suggestion.compareRows);

  return (
    <div className="mt-1 space-y-2">
      <button type="button" className="text-xs text-turquoise" disabled={props.locked} onClick={() => setOpen((value) => !value)}>
        {t("admin.materialGroup.foundSimilar")}
      </button>
      {suggestion.packConflict && <p className="text-[11px] text-amber-800">{t("admin.materialGroup.packChanged")}</p>}
      {open && (
        <div className="rounded-xl border border-beige-dark/20 bg-beige/30 p-2 text-xs">
          {suggestion.groups.map((group) => (
            <p key={group.id} className="mb-1 font-medium">
              {t("admin.materialGroup.group")}: {group.name}
            </p>
          ))}
          <div className="mb-2 overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="text-coffee/55">
                  <th className="p-1 text-start">{t("admin.costing.supplier")}</th>
                  <th className="p-1 text-start">{t("admin.materialGroup.supplierProduct")}</th>
                  <th className="p-1 text-start">{t("admin.inventory.pack")}</th>
                  <th className="p-1 text-start">{t("admin.purchaseList.buyPrice")}</th>
                  <th className="p-1 text-start">{t("admin.materialGroup.basePrice")}</th>
                  <th className="p-1 text-start">{t("admin.materialGroup.priceDate")}</th>
                </tr>
              </thead>
              <tbody>
                {suggestion.compareRows.map((row) => (
                  <tr key={`${row.ingredientId}-${row.supplierId}`}>
                    <td className="p-1">{row.supplierName}</td>
                    <td className="p-1">{row.supplierProductName}</td>
                    <td className="p-1">
                      {row.complete ? `${row.packQuantity} ${row.packUnit}` : t("admin.materialGroup.needPack")}
                    </td>
                    <td className="p-1">{row.buyPrice != null ? formatIls(row.buyPrice) : "—"}</td>
                    <td className="p-1">
                      {row.comparable && row.unitCost != null ? formatIls(row.unitCost, 4) : t("admin.materialGroup.needPack")}
                      {row.cheapest && row.comparable ? ` · ${t("admin.inventory.cheapest")}` : ""}
                    </td>
                    <td className="p-1">{row.purchaseDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cheap && money.unitCost != null && cheap.unitCost != null && money.unitCost > cheap.unitCost && (
            <p className="mb-2 text-emerald-800">
              {t("admin.materialGroup.savings")}: {formatIls(money.unitCost - cheap.unitCost, 4)} · {t("admin.materialGroup.noPriceChange")}
            </p>
          )}
          <div className="space-y-1">
            {suggestion.candidates.map((item) => {
              const ingredient = props.ingredients.find((row) => row.id === item.id);
              if (!ingredient) return null;
              return (
                <Button key={item.id} type="button" variant="outline" className="h-8 w-full justify-start text-xs" disabled={props.locked} onClick={() => props.onAssignSame(ingredient)}>
                  {t("admin.materialGroup.assignSame")}: {item.name}
                </Button>
              );
            })}
            {suggestion.groups.map((group) => (
              <Button
                key={group.id}
                type="button"
                variant="outline"
                className="h-8 w-full justify-start text-xs"
                disabled={props.locked || !props.line.productId}
                onClick={() => {
                  if (!props.line.productId) return;
                  void saveIngredientCompareGroup({ groupId: group.id, name: group.name, memberIds: [...group.memberIds, props.line.productId] });
                  props.onKeepSeparate();
                }}
              >
                {t("admin.materialGroup.joinCompare")}: {group.name}
              </Button>
            ))}
            <div className="flex gap-1">
              <Input value={unifiedName} onChange={(e) => setUnifiedName(e.target.value)} placeholder={t("admin.materialGroup.unifiedName")} className="h-8" />
              <Button
                type="button"
                variant="outline"
                className="h-8 text-xs"
                disabled={props.locked || !unifiedName.trim()}
                onClick={() => {
                  const existing = props.ingredients.find((item) => item.name.trim() === unifiedName.trim());
                  if (existing) props.onAssignSame(existing);
                  else props.onCreateUnified?.(unifiedName.trim());
                }}
              >
                {t("admin.materialGroup.createSame")}
              </Button>
            </div>
            <div className="flex gap-1">
              <Input value={compareName} onChange={(e) => setCompareName(e.target.value)} placeholder={t("admin.materialGroup.compareName")} className="h-8" />
              <Button
                type="button"
                variant="outline"
                className="h-8 text-xs"
                disabled={props.locked || !compareName.trim() || !props.line.productId}
                onClick={() => {
                  if (!props.line.productId) return;
                  const existing = suggestion.groups.find((group) => group.name === compareName.trim());
                  void saveIngredientCompareGroup({
                    groupId: existing?.id,
                    name: compareName.trim(),
                    memberIds: [props.line.productId],
                  });
                  props.onKeepSeparate();
                }}
              >
                {t("admin.materialGroup.createCompare")}
              </Button>
            </div>
            <button
              type="button"
              className="text-[11px] text-coffee/60"
              disabled={props.locked}
              onClick={() => {
                setDismissed(true);
                props.onKeepSeparate();
              }}
            >
              {t("admin.materialGroup.keepSeparate")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
