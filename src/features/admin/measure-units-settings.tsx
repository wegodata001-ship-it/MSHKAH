"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminCard } from "@/features/admin/components/admin-card";
import { MeasureUnitDialog } from "@/features/admin/measure-unit-select";
import { useMeasureUnits } from "@/features/admin/measure-units-provider";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { conversionText, type MeasureUnitRecord } from "@/lib/inventory/measure-units";

export function MeasureUnitsSettings() {
  const t = useT();
  const { refresh, setUnitActive } = useMeasureUnits();
  const [units, setUnits] = useState<MeasureUnitRecord[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MeasureUnitRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const result = await clientAdminFetch<{ units: MeasureUnitRecord[]; usage?: Record<string, number> }>("/api/admin/measure-units", { action: "list", usage: true });
    if (!result.ok || !result.data?.units) {
      setError(t("admin.measureUnits.failed"));
      setLoading(false);
      return;
    }
    setUnits(result.data.units);
    setUsage(result.data.usage ?? {});
    setError("");
    setLoading(false);
    await refresh();
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(unit: MeasureUnitRecord) {
    setError("");
    const result = await setUnitActive(unit.id, !unit.active);
    if (!result.ok) {
      setError(t("admin.measureUnits.failed"));
      return;
    }
    setMessage(unit.active ? t("admin.measureUnits.disabled") : t("admin.measureUnits.enabled"));
    await load();
  }

  return (
    <AdminCard title={t("admin.measureUnits.title")} className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-coffee/60">{t("admin.measureUnits.lead")}</p>
        <Button type="button" variant="outline" onClick={() => setCreating(true)}>{t("admin.measureUnits.add")}</Button>
      </div>
      {message ? <p className="mb-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
      {loading ? <Loader2 className="h-5 w-5 animate-spin text-turquoise" /> : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-xs text-coffee/55">
                <tr>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.name")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.abbreviation")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.kind")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.conversion")}</th>
                  <th className="px-2 py-2 text-end">{t("admin.measureUnits.usage")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.inventory.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id} className="border-t border-beige-dark/10">
                    <td className="px-2 py-2">{unit.nameHe}{unit.active ? "" : ` · ${t("admin.measureUnits.inactive")}`}</td>
                    <td className="px-2 py-2">{unit.abbreviation}</td>
                    <td className="px-2 py-2">{t(`admin.measureUnits.kind.${unit.kind}`)}</td>
                    <td className="px-2 py-2">{conversionText(unit) || t("admin.measureUnits.none")}</td>
                    <td className="px-2 py-2 text-end">{usage[unit.id] ?? 0}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="text-turquoise" onClick={() => setEditing(unit)}>{t("admin.measureUnits.edit")}</button>
                        <button type="button" className="text-coffee/70" onClick={() => void toggle(unit)}>{unit.active ? t("admin.measureUnits.disable") : t("admin.measureUnits.enable")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {units.map((unit) => (
              <div key={unit.id} className="rounded-2xl border border-beige-dark/15 p-3 text-sm">
                <p className="font-semibold">{unit.nameHe} · {unit.abbreviation}</p>
                <p>{t(`admin.measureUnits.kind.${unit.kind}`)} · {conversionText(unit) || t("admin.measureUnits.none")}</p>
                <p>{t("admin.measureUnits.usage")}: {usage[unit.id] ?? 0}{unit.active ? "" : ` · ${t("admin.measureUnits.inactive")}`}</p>
                <div className="mt-2 flex gap-3">
                  <button type="button" className="text-turquoise" onClick={() => setEditing(unit)}>{t("admin.measureUnits.edit")}</button>
                  <button type="button" onClick={() => void toggle(unit)}>{unit.active ? t("admin.measureUnits.disable") : t("admin.measureUnits.enable")}</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {creating ? <MeasureUnitDialog open onClose={() => setCreating(false)} onSaved={(_unit, reused) => { setMessage(t(reused ? "admin.measureUnits.duplicate" : "admin.measureUnits.saved")); void load(); }} /> : null}
      {editing ? <MeasureUnitDialog open initial={editing} onClose={() => setEditing(null)} onSaved={() => { setMessage(t("admin.measureUnits.saved")); void load(); }} /> : null}
    </AdminCard>
  );
}
