"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";
import { isPackUnit, resolveUnitFactor } from "@/lib/costing/units";
import { MeasureUnitDialog } from "@/features/admin/measure-unit-select";
import { useMeasureUnits } from "@/features/admin/measure-units-provider";
import { formatIls } from "@/lib/costing/money";
import { costPerBaseFromPack } from "@/lib/inventory/pack-cost";

export type SavedPurchaseUnit = {
  id: string;
  label: string;
  factor: number;
  baseUnit: BaseUnit;
  kind: "measure" | "pack";
  contentCount?: number;
  contentUnit?: PurchaseUnit;
};

export function InvoiceUnitField({
  unit,
  customUnitId,
  packCount,
  packContentUnit,
  quantity,
  lineTotal,
  expectedBase,
  disabled,
  onChange,
}: {
  unit: PurchaseUnit | null;
  customUnitId?: string;
  packCount?: number | null;
  packContentUnit?: PurchaseUnit | null;
  quantity: number | null;
  lineTotal: number;
  expectedBase?: BaseUnit | null;
  disabled?: boolean;
  onChange: (patch: {
    unit: PurchaseUnit | null;
    customUnitId?: string;
    packCount: number | null;
    packContentUnit: PurchaseUnit | null;
    conversionFactor: number | null;
    conversionConfirmed?: boolean;
  }) => void;
}) {
  const t = useT();
  const { units: catalog } = useMeasureUnits();
  const [saved, setSaved] = useState<SavedPurchaseUnit[]>([]);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = customUnitId ? `custom:${customUnitId}` : unit ?? "";
  const showPack = Boolean(unit && !customUnitId && !resolveUnitFactor(unit));

  useEffect(() => {
    void clientAdminFetch<{ units: SavedPurchaseUnit[] }>("/api/admin/inventory/purchase-unit", { list: true }).then((result) => {
      if (!result.ok || !result.data?.units) return;
      setSaved(result.data.units.filter((item) => item.label && item.factor > 0));
    });
  }, []);

  const applyPack = (nextUnit: PurchaseUnit, nextCount: number | null, nextContent: PurchaseUnit | null) => {
    const universal = resolveUnitFactor(nextUnit);
    if (universal) {
      onChange({ unit: nextUnit, customUnitId: undefined, packCount: null, packContentUnit: null, conversionFactor: null, conversionConfirmed: false });
      return;
    }
    if (nextCount == null || !nextContent) {
      onChange({ unit: nextUnit, customUnitId: undefined, packCount: nextCount, packContentUnit: nextContent, conversionFactor: null, conversionConfirmed: false });
      return;
    }
    const priced = costPerBaseFromPack({
      lineTotal: lineTotal > 0 ? lineTotal : 1,
      quantity: 1,
      contentCount: nextCount,
      contentUnit: nextContent,
      expectedBase,
    });
    if (!priced.ok) {
      setError(t("admin.invoice.manual.incompatible"));
      onChange({ unit: nextUnit, customUnitId: undefined, packCount: nextCount, packContentUnit: nextContent, conversionFactor: null, conversionConfirmed: false });
      return;
    }
    setError(null);
    onChange({
      unit: nextUnit,
      customUnitId: undefined,
      packCount: nextCount,
      packContentUnit: nextContent,
      conversionFactor: priced.factor,
      conversionConfirmed: true,
    });
  };

  const preview = showPack && packCount && packContentUnit
    ? costPerBaseFromPack({
        lineTotal,
        quantity: quantity && quantity > 0 ? quantity : 1,
        contentCount: packCount,
        contentUnit: packContentUnit,
        expectedBase,
      })
    : null;

  return (
    <div className="space-y-1">
      <select
        className="h-11 w-full rounded-xl border border-beige-dark/40 bg-white px-2 text-base"
        disabled={disabled}
        value={selected}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "__new") {
            setDialog(true);
            return;
          }
          if (value.startsWith("custom:")) {
            const item = saved.find((row) => row.id === value.slice(7));
            if (!item) return;
            onChange({
              unit: item.contentUnit && !isPackUnit(item.contentUnit) ? item.contentUnit : "unit",
              customUnitId: item.id,
              packCount: item.contentCount ?? null,
              packContentUnit: item.contentUnit ?? null,
              conversionFactor: item.factor,
              conversionConfirmed: true,
            });
            return;
          }
          applyPack(value as PurchaseUnit, packCount ?? null, packContentUnit ?? null);
        }}
      >
        {catalog.filter((item) => item.active || item.id === unit).map((item) => (
          <option key={item.id} value={item.id}>{item.builtin ? t(unitLabelKey(item.id), item.abbreviation) : item.abbreviation || item.nameHe}</option>
        ))}
        {saved.map((item) => (
          <option key={item.id} value={`custom:${item.id}`}>{item.label}</option>
        ))}
      </select>
      <button type="button" className="text-xs font-medium text-turquoise" disabled={disabled} onClick={() => setDialog(true)}>
        {t("admin.measureUnits.add")}
      </button>
      {showPack && (
        <div className="grid grid-cols-2 gap-1">
          <Input
            className="h-11"
            type="number"
            min="0"
            disabled={disabled}
            value={packCount ?? ""}
            placeholder={t("admin.invoice.manual.contents")}
            onChange={(event) => applyPack(unit!, event.target.value ? Number(event.target.value) : null, packContentUnit ?? null)}
          />
          <select
            className="h-11 rounded-xl border border-beige-dark/40 bg-white px-2 text-base"
            disabled={disabled}
            value={packContentUnit ?? ""}
            onChange={(event) => applyPack(unit!, packCount ?? null, (event.target.value || null) as PurchaseUnit | null)}
          >
            <option value="">{t("admin.invoice.manual.contentUnit")}</option>
            {catalog.filter((item) => item.active && resolveUnitFactor(item.id)).map((item) => (
              <option key={item.id} value={item.id}>{item.builtin ? t(unitLabelKey(item.id), item.abbreviation) : item.abbreviation || item.nameHe}</option>
            ))}
          </select>
        </div>
      )}
      {preview && preview.ok && lineTotal > 0 && (
        <p className="text-xs text-coffee/70">{t("admin.invoice.manual.baseCost")}: {formatIls(preview.cost, preview.cost < 1 ? 4 : 2)} / {t(unitLabelKey(preview.base))}</p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      {dialog ? (
        <MeasureUnitDialog
          open
          onClose={() => setDialog(false)}
          onSaved={(created) => {
            applyPack(created.id as PurchaseUnit, null, null);
            setDialog(false);
          }}
        />
      ) : null}
    </div>
  );
}
