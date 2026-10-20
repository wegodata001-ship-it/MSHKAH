"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import type { BaseUnit, PurchaseUnit } from "@/lib/costing/types";
import { LINE_UNITS, MEASURE_UNITS, isPackUnit } from "@/lib/costing/units";
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
  }) => void;
}) {
  const t = useT();
  const [saved, setSaved] = useState<SavedPurchaseUnit[]>([]);
  const [dialog, setDialog] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"measure" | "pack">("pack");
  const [count, setCount] = useState("12");
  const [content, setContent] = useState<PurchaseUnit>("liter");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = customUnitId ? `custom:${customUnitId}` : unit ?? "";
  const showPack = Boolean(unit && isPackUnit(unit) && !customUnitId);

  useEffect(() => {
    void clientAdminFetch<{ units: SavedPurchaseUnit[] }>("/api/admin/inventory/purchase-unit", { list: true }).then((result) => {
      if (!result.ok || !result.data?.units) return;
      setSaved(result.data.units.filter((item) => item.label && item.factor > 0));
    });
  }, []);

  const applyPack = (nextUnit: PurchaseUnit, nextCount: number | null, nextContent: PurchaseUnit | null) => {
    if (nextUnit === "bucket") {
      onChange({ unit: nextUnit, customUnitId: undefined, packCount: null, packContentUnit: null, conversionFactor: null });
      return;
    }
    if (!isPackUnit(nextUnit)) {
      onChange({ unit: nextUnit, customUnitId: undefined, packCount: null, packContentUnit: null, conversionFactor: null });
      return;
    }
    if (nextCount == null || !nextContent) {
      onChange({ unit: nextUnit, customUnitId: undefined, packCount: nextCount, packContentUnit: nextContent, conversionFactor: null });
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
      onChange({ unit: nextUnit, customUnitId: undefined, packCount: nextCount, packContentUnit: nextContent, conversionFactor: null });
      return;
    }
    setError(null);
    onChange({
      unit: nextUnit,
      customUnitId: undefined,
      packCount: nextCount,
      packContentUnit: nextContent,
      conversionFactor: priced.factor,
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

  const saveCustom = async () => {
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    const result = await clientAdminFetch<{ id: string; unit: SavedPurchaseUnit }>("/api/admin/inventory/purchase-unit", {
      label,
      kind,
      contentCount: Number(count),
      contentUnit: content,
      measureQuantity: Number(count),
      measureUnit: content,
    });
    setSaving(false);
    if (!result.ok || !result.data?.id) {
      setError(t("admin.invoice.manual.incompatible"));
      return;
    }
    const created = result.data.unit;
    setSaved((current) => current.some((item) => item.id === result.data!.id) ? current : [...current, created]);
    onChange({
      unit: created.contentUnit && !isPackUnit(created.contentUnit) ? created.contentUnit : "unit",
      customUnitId: result.data.id,
      packCount: created.contentCount ?? null,
      packContentUnit: created.contentUnit ?? null,
      conversionFactor: created.factor,
    });
    setDialog(false);
    setLabel("");
  };

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
            });
            return;
          }
          applyPack(value as PurchaseUnit, packCount ?? null, packContentUnit ?? null);
        }}
      >
        {LINE_UNITS.map((item) => (
          <option key={item} value={item}>{t(unitLabelKey(item))}</option>
        ))}
        {saved.map((item) => (
          <option key={item.id} value={`custom:${item.id}`}>{item.label}</option>
        ))}
        <option value="__new">{t("admin.invoice.manual.newUnit")}</option>
      </select>
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
            {MEASURE_UNITS.map((item) => (
              <option key={item} value={item}>{t(unitLabelKey(item))}</option>
            ))}
          </select>
        </div>
      )}
      {preview && preview.ok && lineTotal > 0 && (
        <p className="text-xs text-coffee/70">{t("admin.invoice.manual.baseCost")}: {formatIls(preview.cost, preview.cost < 1 ? 4 : 2)} / {t(unitLabelKey(preview.base))}</p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      <AdminModal open={dialog} onOpenChange={setDialog} size="sm">
        <AdminModalHeader onClose={() => setDialog(false)}>
          <AdminModalTitle>{t("admin.invoice.manual.newUnit")}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody className="space-y-2">
          <Input className="h-11" value={label} placeholder={t("admin.invoice.manual.unitName")} onChange={(event) => setLabel(event.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-11" type="number" min="0" value={count} onChange={(event) => setCount(event.target.value)} placeholder={t("admin.invoice.manual.contents")} />
            <select className="h-11 rounded-xl border px-2" value={content} onChange={(event) => setContent(event.target.value as PurchaseUnit)}>
              {MEASURE_UNITS.map((item) => <option key={item} value={item}>{t(unitLabelKey(item))}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={kind === "pack"} onChange={(event) => setKind(event.target.checked ? "pack" : "measure")} />
            {t("admin.costing.unit.pack")}
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="button" variant="turquoise" className="min-h-11" disabled={saving || !label.trim()} onClick={() => void saveCustom()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.invoice.manual.saveCategory")}
          </Button>
        </AdminModalBody>
      </AdminModal>
    </div>
  );
}
