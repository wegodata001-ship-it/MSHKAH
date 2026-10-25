"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { useMeasureUnits } from "@/features/admin/measure-units-provider";
import { unitsCompatible } from "@/lib/costing/units";
import type { MeasureUnitInput, MeasureUnitRecord, UnitKind } from "@/lib/inventory/measure-units";

export function MeasureUnitDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: MeasureUnitRecord | null;
  onClose: () => void;
  onSaved: (unit: MeasureUnitRecord, reused: boolean) => void;
}) {
  const t = useT();
  const { saveUnit } = useMeasureUnits();
  const [nameHe, setNameHe] = useState(initial?.nameHe ?? "");
  const [abbreviation, setAbbreviation] = useState(initial?.abbreviation ?? "");
  const [kind, setKind] = useState<UnitKind>(initial?.kind ?? "count");
  const [factor, setFactor] = useState(initial?.factorToBase ? String(initial.factorToBase) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const input: MeasureUnitInput = {
      id: initial?.id,
      nameHe,
      abbreviation,
      kind,
      factorToBase: factor.trim() ? Number(factor) : null,
    };
    const result = await saveUnit(input);
    setBusy(false);
    if (!result.ok) {
      setError(t(result.code === "DUPLICATE" ? "admin.measureUnits.duplicate" : "admin.measureUnits.failed"));
      return;
    }
    onSaved(result.unit, result.reused);
    onClose();
  }

  return (
    <AdminModal open={open} onOpenChange={(next) => !next && onClose()} size="sm">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{initial ? t("admin.measureUnits.edit") : t("admin.measureUnits.add")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>{t("admin.measureUnits.name")}</span>
          <Input value={nameHe} onChange={(event) => setNameHe(event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("admin.measureUnits.abbreviation")}</span>
          <Input value={abbreviation} onChange={(event) => setAbbreviation(event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("admin.measureUnits.kind")}</span>
          <select className="h-10 w-full rounded-xl border px-2" value={kind} onChange={(event) => setKind(event.target.value as UnitKind)} disabled={initial?.builtin}>
            {(["weight", "volume", "count", "other"] as UnitKind[]).map((item) => (
              <option key={item} value={item}>{t(`admin.measureUnits.kind.${item}`)}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("admin.measureUnits.factor")}</span>
          <Input inputMode="decimal" value={factor} disabled={initial?.builtin} placeholder={t("admin.measureUnits.factorHint")} onChange={(event) => setFactor(event.target.value)} />
          <span className="block text-xs text-coffee/55">{t("admin.measureUnits.factorHint")}</span>
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button type="button" variant="turquoise" className="min-h-11 w-full" disabled={busy || !nameHe.trim() || !abbreviation.trim()} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.measureUnits.save")}
        </Button>
      </AdminModalBody>
    </AdminModal>
  );
}

export function MeasureUnitSelect({
  value,
  onChange,
  disabled,
  className,
  emptyLabel,
  compatibleWith,
}: {
  value: string | null | undefined;
  onChange: (unit: string) => void;
  disabled?: boolean;
  className?: string;
  emptyLabel?: string;
  compatibleWith?: string | null;
}) {
  const t = useT();
  const { units } = useMeasureUnits();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const options = units.filter((unit) => {
    if (unit.id === value) return true;
    if (!unit.active) return false;
    if (!compatibleWith) return true;
    return unitsCompatible(unit.id, compatibleWith);
  });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <select
          className={className || "h-10 min-w-0 flex-1 rounded-xl border border-beige-dark/40 bg-white px-2 text-sm"}
          disabled={disabled}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {emptyLabel ? <option value="">{emptyLabel}</option> : null}
          {options.map((unit) => (
            <option key={unit.id} value={unit.id}>{unit.builtin ? t(unitLabelKey(unit.id), unit.abbreviation) : unit.abbreviation || unit.nameHe}</option>
          ))}
        </select>
        <button type="button" className="h-10 shrink-0 rounded-xl px-2 text-xs font-medium text-turquoise" disabled={disabled} onClick={() => setOpen(true)}>
          {t("admin.measureUnits.add")}
        </button>
      </div>
      {saved ? <p className="text-xs text-emerald-700">{saved}</p> : null}
      {open ? (
        <MeasureUnitDialog
          open
          onClose={() => setOpen(false)}
          onSaved={(unit, reused) => {
            onChange(unit.id);
            setSaved(t(reused ? "admin.measureUnits.duplicate" : "admin.measureUnits.saved"));
          }}
        />
      ) : null}
    </div>
  );
}
