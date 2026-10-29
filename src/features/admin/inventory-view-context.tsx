"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  INVENTORY_VIEW_STORAGE_KEY,
  defaultInventoryView,
  densityHeight,
  parseInventoryView,
  type InventoryDensity,
  type InventoryViewMode,
  type InventoryViewPrefs,
} from "@/lib/inventory/inventory-view";

type InventoryViewContextValue = {
  prefs: InventoryViewPrefs;
  setMode: (mode: InventoryViewMode) => void;
  setDensity: (density: InventoryDensity) => void;
  setRowHeight: (height: number) => void;
  toggleColumn: (id: InventoryViewPrefs["hidden"][number]) => void;
  setColumnWidth: (id: keyof InventoryViewPrefs["widths"], width: number) => void;
  resetColumns: () => void;
  active: boolean;
  setActive: (active: boolean) => void;
};

const InventoryViewContext = createContext<InventoryViewContextValue | null>(null);

export function InventoryViewProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<InventoryViewPrefs>(defaultInventoryView);
  const [hydrated, setHydrated] = useState(false);
  const [active, setActiveState] = useState(false);
  const fullscreenArmed = useRef(false);
  const ignoreExit = useRef(false);
  const setActive = useCallback((next: boolean) => setActiveState(next), []);

  useEffect(() => {
    setPrefs(parseInventoryView(window.localStorage.getItem(INVENTORY_VIEW_STORAGE_KEY)));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs, hydrated]);

  useEffect(() => {
    const onChange = () => {
      if (ignoreExit.current) {
        ignoreExit.current = false;
        fullscreenArmed.current = false;
        return;
      }
      if (!document.fullscreenElement && fullscreenArmed.current) {
        fullscreenArmed.current = false;
        setPrefs((current) => current.mode === "full" ? { ...current, mode: "normal" } : current);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (prefs.mode === "full") return;
    if (fullscreenArmed.current && document.fullscreenElement) {
      fullscreenArmed.current = false;
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [prefs.mode]);

  useEffect(() => {
    if (active || !document.fullscreenElement) return;
    ignoreExit.current = true;
    void document.exitFullscreen().catch(() => {
      ignoreExit.current = false;
    });
  }, [active]);

  useEffect(() => {
    if (!active || prefs.mode !== "full") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (document.querySelector("[data-slot='admin-modal-panel']")) return;
      setPrefs((current) => current.mode === "full" ? { ...current, mode: "normal" } : current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.mode]);

  const value = useMemo<InventoryViewContextValue>(() => ({
    prefs,
    setMode: (mode) => {
      setPrefs((current) => ({ ...current, mode }));
      if (mode !== "full") return;
      const root = document.documentElement;
      if (!root.requestFullscreen || document.fullscreenElement) return;
      void root.requestFullscreen().then(() => {
        fullscreenArmed.current = true;
      }).catch(() => {
        fullscreenArmed.current = false;
      });
    },
    setDensity: (density) => setPrefs((current) => ({ ...current, density, rowHeight: densityHeight(density) })),
    setRowHeight: (height) => setPrefs((current) => ({ ...current, rowHeight: height })),
    toggleColumn: (id) => setPrefs((current) => ({
      ...current,
      hidden: current.hidden.includes(id) ? current.hidden.filter((item) => item !== id) : [...current.hidden, id],
    })),
    setColumnWidth: (id, width) => setPrefs((current) => ({ ...current, widths: { ...current.widths, [id]: width } })),
    resetColumns: () => setPrefs((current) => ({ ...defaultInventoryView(), mode: current.mode })),
    active,
    setActive,
  }), [prefs, active, setActive]);

  return <InventoryViewContext.Provider value={value}>{children}</InventoryViewContext.Provider>;
}

export function useInventoryView(): InventoryViewContextValue {
  const value = useContext(InventoryViewContext);
  if (value) return value;
  return {
    prefs: defaultInventoryView(),
    setMode: () => undefined,
    setDensity: () => undefined,
    setRowHeight: () => undefined,
    toggleColumn: () => undefined,
    setColumnWidth: () => undefined,
    resetColumns: () => undefined,
    active: false,
    setActive: () => undefined,
  };
}
