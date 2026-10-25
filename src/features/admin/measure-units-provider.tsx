"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import {
  BUILTIN_MEASURE_UNITS,
  setMeasureUnitCatalog,
  type MeasureUnitInput,
  type MeasureUnitRecord,
} from "@/lib/inventory/measure-units";

type SaveResult = { ok: true; unit: MeasureUnitRecord; reused: boolean } | { ok: false; code: string };

type MeasureUnitsContextValue = {
  units: MeasureUnitRecord[];
  loading: boolean;
  refresh: () => Promise<void>;
  saveUnit: (input: MeasureUnitInput) => Promise<SaveResult>;
  setUnitActive: (id: string, active: boolean) => Promise<SaveResult>;
};

const MeasureUnitsContext = createContext<MeasureUnitsContextValue | null>(null);

export function MeasureUnitsProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<MeasureUnitRecord[]>(BUILTIN_MEASURE_UNITS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const result = await clientAdminFetch<{ units: MeasureUnitRecord[] }>("/api/admin/measure-units", { action: "list" });
    if (!result.ok || !result.data?.units) return;
    setMeasureUnitCatalog(result.data.units);
    setUnits(result.data.units);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const saveUnit = useCallback(async (input: MeasureUnitInput): Promise<SaveResult> => {
    const result = await clientAdminFetch<{ unit: MeasureUnitRecord; reused?: boolean }>("/api/admin/measure-units", { action: "save", ...input });
    if (!result.ok || !result.data?.unit) return { ok: false, code: result.code || "FAILED" };
    await refresh();
    return { ok: true, unit: result.data.unit, reused: Boolean(result.data.reused) };
  }, [refresh]);

  const setUnitActive = useCallback(async (id: string, active: boolean): Promise<SaveResult> => {
    const result = await clientAdminFetch<{ unit: MeasureUnitRecord }>("/api/admin/measure-units", { action: active ? "enable" : "disable", id });
    if (!result.ok || !result.data?.unit) return { ok: false, code: result.code || "FAILED" };
    await refresh();
    return { ok: true, unit: result.data.unit, reused: false };
  }, [refresh]);

  const value = useMemo(() => ({ units, loading, refresh, saveUnit, setUnitActive }), [units, loading, refresh, saveUnit, setUnitActive]);
  return <MeasureUnitsContext.Provider value={value}>{children}</MeasureUnitsContext.Provider>;
}

export function useMeasureUnits(): MeasureUnitsContextValue {
  return useContext(MeasureUnitsContext) ?? {
    units: BUILTIN_MEASURE_UNITS,
    loading: false,
    refresh: async () => {},
    saveUnit: async () => ({ ok: false, code: "FAILED" }),
    setUnitActive: async () => ({ ok: false, code: "FAILED" }),
  };
}
