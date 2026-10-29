export const INVENTORY_VIEW_STORAGE_KEY = "mishkat-inventory-view";

export const INVENTORY_COLUMNS = [
  "product",
  "category",
  "source",
  "supplier",
  "opening",
  "incoming",
  "consumption",
  "current",
  "unit",
  "lastPrice",
  "best",
  "status",
  "priceInc",
  "paid",
  "conversion",
  "notes",
  "actions",
] as const;

export type InventoryColumnId = (typeof INVENTORY_COLUMNS)[number];
export type InventoryViewMode = "normal" | "wide" | "full";
export type InventoryDensity = "compact" | "regular" | "comfortable";

export const DEFAULT_VISIBLE_COLUMNS: InventoryColumnId[] = [
  "product",
  "category",
  "source",
  "supplier",
  "opening",
  "incoming",
  "consumption",
  "current",
  "unit",
  "lastPrice",
  "best",
  "status",
  "actions",
];

export const DEFAULT_COLUMN_WIDTH: Record<InventoryColumnId, number> = {
  product: 220,
  category: 130,
  source: 180,
  supplier: 140,
  opening: 96,
  incoming: 96,
  consumption: 96,
  current: 110,
  unit: 128,
  lastPrice: 120,
  best: 150,
  status: 120,
  actions: 64,
  priceInc: 120,
  paid: 120,
  conversion: 140,
  notes: 160,
};

const DENSITY_HEIGHT: Record<InventoryDensity, number> = {
  compact: 32,
  regular: 40,
  comfortable: 56,
};

export type InventoryViewPrefs = {
  mode: InventoryViewMode;
  density: InventoryDensity;
  rowHeight: number;
  hidden: InventoryColumnId[];
  widths: Partial<Record<InventoryColumnId, number>>;
};

export function defaultInventoryView(): InventoryViewPrefs {
  return { mode: "normal", density: "regular", rowHeight: DENSITY_HEIGHT.regular, hidden: ["priceInc", "paid", "conversion", "notes"], widths: {} };
}

export function columnWidth(prefs: InventoryViewPrefs, id: InventoryColumnId): number {
  const width = prefs.widths[id];
  return clampColumnWidth(width ?? DEFAULT_COLUMN_WIDTH[id]);
}

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return 96;
  return Math.min(480, Math.max(64, Math.round(width)));
}

export function clampRowHeight(height: number): number {
  if (!Number.isFinite(height)) return DENSITY_HEIGHT.regular;
  return Math.min(72, Math.max(28, Math.round(height)));
}

export function densityHeight(density: InventoryDensity): number {
  return DENSITY_HEIGHT[density];
}

export function visibleInventoryColumns(prefs: InventoryViewPrefs): InventoryColumnId[] {
  const hidden = new Set(prefs.hidden);
  return INVENTORY_COLUMNS.filter((id) => id === "product" || id === "actions" || !hidden.has(id));
}

export function resizeInventoryColumn(prefs: InventoryViewPrefs, id: InventoryColumnId, width: number): InventoryViewPrefs {
  return { ...prefs, widths: { ...prefs.widths, [id]: clampColumnWidth(width) } };
}

export function parseInventoryView(raw: string | null): InventoryViewPrefs {
  const base = defaultInventoryView();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<InventoryViewPrefs>;
    const mode = parsed.mode === "wide" || parsed.mode === "full" ? parsed.mode : "normal";
    const density = parsed.density === "compact" || parsed.density === "comfortable" ? parsed.density : "regular";
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((id): id is InventoryColumnId => INVENTORY_COLUMNS.includes(id as InventoryColumnId) && id !== "product" && id !== "actions")
      : base.hidden;
    const widths: InventoryViewPrefs["widths"] = {};
    if (parsed.widths && typeof parsed.widths === "object") {
      for (const id of INVENTORY_COLUMNS) {
        const value = parsed.widths[id];
        if (typeof value === "number") widths[id] = clampColumnWidth(value);
      }
    }
    return {
      mode,
      density,
      rowHeight: clampRowHeight(typeof parsed.rowHeight === "number" ? parsed.rowHeight : DENSITY_HEIGHT[density]),
      hidden,
      widths,
    };
  } catch {
    return base;
  }
}
