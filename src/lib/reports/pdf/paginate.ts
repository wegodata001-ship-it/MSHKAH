import { reportOrientation } from "@/lib/reports/pdf/filename";
import type {
  BlankCountRow,
  CountConsumptionRow,
  ExceptionReportRow,
  InventoryReportRow,
  PurchaseSupplierGroup,
  ReportPayload,
  SupplierPriceCompare,
} from "@/lib/reports/types";

export type ReportBlock =
  | { kind: "inventory"; rows: InventoryReportRow[] }
  | { kind: "exceptions"; rows: ExceptionReportRow[] }
  | { kind: "blank"; startIndex: number; rows: BlankCountRow[] }
  | { kind: "counts"; rows: CountConsumptionRow[] }
  | { kind: "count-totals" }
  | {
      kind: "purchase-group";
      group: PurchaseSupplierGroup;
      rows: PurchaseReportRowSlice;
      showHeader: boolean;
      showFooter: boolean;
    }
  | { kind: "compare"; items: SupplierPriceCompare[] }
  | { kind: "breakeven" };

export type PurchaseReportRowSlice = PurchaseSupplierGroup["rows"];

export type ReportDocPage = {
  index: number;
  total: number;
  orientation: "portrait" | "landscape";
  showKpis: boolean;
  showFormMeta: boolean;
  showFormFooter: boolean;
  blocks: ReportBlock[];
};

const HEADER_MM = 28;
const FOOTER_MM = 12;
const MARGIN_Y = 28;
const KPI_MM = 30;
const FILTER_MM = 10;
const FORM_META_MM = 22;
const FORM_FOOTER_MM = 28;
const TABLE_HEAD_MM = 9;
const TABLE_ROW_MM = 8;
const WRITE_ROW_MM = 16;
const GROUP_HEAD_MM = 24;
const GROUP_FOOT_MM = 12;
const COMPARE_BASE_MM = 16;
const COMPARE_OFFER_MM = 16;

function pageInner(orientation: "portrait" | "landscape"): number {
  const height = orientation === "landscape" ? 210 : 297;
  return height - MARGIN_Y - HEADER_MM - FOOTER_MM;
}

function firstPageBudget(orientation: "portrait" | "landscape", extras: number): number {
  return pageInner(orientation) - KPI_MM - FILTER_MM - extras;
}

function laterPageBudget(orientation: "portrait" | "landscape", extras = 0): number {
  return pageInner(orientation) - extras;
}

function inventoryCardMm(row: InventoryReportRow): number {
  const extras = Math.max(0, (row.supplierLines?.length ?? 0) - 1);
  return 38 + extras * 5 + (row.supplierLines?.length ? 7 : 0);
}

function compareCardMm(item: SupplierPriceCompare): number {
  return COMPARE_BASE_MM + item.offers.length * COMPARE_OFFER_MM + 10;
}

function packByHeight<T>(items: T[], first: number, later: number, heightOf: (item: T) => number): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = 0;
  let budget = first;
  for (const item of items) {
    const h = heightOf(item);
    if (current.length && used + h > budget) {
      pages.push(current);
      current = [];
      used = 0;
      budget = later;
    }
    current.push(item);
    used += h;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

function packRows<T>(items: T[], first: number, later: number, rowMm: number): T[][] {
  const firstCount = Math.max(1, Math.floor((first - TABLE_HEAD_MM) / rowMm));
  const laterCount = Math.max(1, Math.floor((later - TABLE_HEAD_MM) / rowMm));
  if (!items.length) return [[]];
  const pages: T[][] = [];
  let offset = 0;
  let take = firstCount;
  while (offset < items.length) {
    pages.push(items.slice(offset, offset + take));
    offset += take;
    take = laterCount;
  }
  return pages;
}

export function paginateReport(payload: ReportPayload): ReportDocPage[] {
  const orientation = payload.orientation || reportOrientation(payload.type);
  const first = firstPageBudget(orientation, payload.type === "blank-count" ? FORM_META_MM : 0);
  const later = laterPageBudget(orientation);
  let pages: ReportDocPage[] = [];

  if (payload.type === "inventory") {
    const chunks = packByHeight(payload.inventory ?? [], first, later, inventoryCardMm);
    pages = chunks.map((rows, index) => ({
      index,
      total: chunks.length,
      orientation,
      showKpis: index === 0,
      showFormMeta: false,
      showFormFooter: false,
      blocks: rows.length ? [{ kind: "inventory", rows }] : [],
    }));
  } else if (payload.type === "exceptions") {
    const chunks = packRows(payload.exceptions ?? [], first, later, TABLE_ROW_MM + 2);
    pages = chunks.map((rows, index) => ({
      index,
      total: chunks.length,
      orientation,
      showKpis: index === 0,
      showFormMeta: false,
      showFormFooter: false,
      blocks: rows.length ? [{ kind: "exceptions", rows }] : [],
    }));
  } else if (payload.type === "blank-count") {
    const laterBlank = laterPageBudget(orientation, FORM_FOOTER_MM);
    const chunks = packRows(payload.blank ?? [], first, laterBlank, WRITE_ROW_MM);
    pages = chunks.map((rows, index) => ({
      index,
      total: chunks.length,
      orientation,
      showKpis: false,
      showFormMeta: index === 0,
      showFormFooter: index === chunks.length - 1,
      blocks: [{ kind: "blank", startIndex: chunks.slice(0, index).reduce((sum, list) => sum + list.length, 0), rows }],
    }));
  } else if (payload.type === "count-consumption") {
    const firstCount = first - 16;
    const chunks = packRows(payload.counts ?? [], firstCount, later, TABLE_ROW_MM + 1);
    pages = chunks.map((rows, index) => ({
      index,
      total: chunks.length,
      orientation,
      showKpis: index === 0,
      showFormMeta: false,
      showFormFooter: false,
      blocks: [
        ...(rows.length ? [{ kind: "counts" as const, rows }] : []),
        ...(index === chunks.length - 1 ? [{ kind: "count-totals" as const }] : []),
      ],
    }));
  } else if (payload.type === "purchases") {
    pages = paginatePurchases(payload.purchaseGroups ?? [], first, later, orientation);
  } else if (payload.type === "supplier-compare") {
    const chunks = packByHeight(payload.priceCompare ?? [], first, later, compareCardMm);
    pages = chunks.map((items, index) => ({
      index,
      total: chunks.length,
      orientation,
      showKpis: index === 0,
      showFormMeta: false,
      showFormFooter: false,
      blocks: items.length ? [{ kind: "compare", items }] : [],
    }));
  } else if (payload.type === "breakeven") {
    pages = [{
      index: 0,
      total: 1,
      orientation,
      showKpis: true,
      showFormMeta: false,
      showFormFooter: false,
      blocks: [{ kind: "breakeven" }],
    }];
  }

  if (!pages.length) {
    pages = [{
      index: 0,
      total: 1,
      orientation,
      showKpis: true,
      showFormMeta: payload.type === "blank-count",
      showFormFooter: payload.type === "blank-count",
      blocks: [],
    }];
  }

  return pages.map((page, index) => ({ ...page, index, total: pages.length }));
}

function paginatePurchases(
  groups: PurchaseSupplierGroup[],
  first: number,
  later: number,
  orientation: "portrait" | "landscape"
): ReportDocPage[] {
  if (!groups.length) {
    return [{
      index: 0,
      total: 1,
      orientation,
      showKpis: true,
      showFormMeta: false,
      showFormFooter: false,
      blocks: [],
    }];
  }

  const pages: ReportDocPage[] = [];
  let blocks: ReportBlock[] = [];
  let used = 0;
  let budget = first;
  let showKpis = true;

  const flush = () => {
    if (!blocks.length && pages.length) return;
    pages.push({
      index: pages.length,
      total: 0,
      orientation,
      showKpis,
      showFormMeta: false,
      showFormFooter: false,
      blocks,
    });
    blocks = [];
    used = 0;
    budget = later;
    showKpis = false;
  };

  for (const group of groups) {
    const header = GROUP_HEAD_MM;
    const footer = GROUP_FOOT_MM;
    const rows = group.rows;
    let offset = 0;
    let headerPending = true;
    while (offset < rows.length || headerPending) {
      const remaining = budget - used;
      const need = (headerPending ? header : 0) + TABLE_HEAD_MM + TABLE_ROW_MM + footer;
      if (remaining < need && blocks.length) {
        flush();
        continue;
      }
      const available = budget - used - (headerPending ? header : 0) - TABLE_HEAD_MM - footer;
      const take = Math.max(1, Math.floor(available / TABLE_ROW_MM));
      const slice = rows.slice(offset, offset + take);
      const showFooter = offset + slice.length >= rows.length;
      blocks.push({
        kind: "purchase-group",
        group,
        rows: slice,
        showHeader: headerPending,
        showFooter,
      });
      used += (headerPending ? header : 0) + TABLE_HEAD_MM + slice.length * TABLE_ROW_MM + (showFooter ? footer : 0);
      offset += slice.length;
      headerPending = false;
      if (used >= budget - TABLE_ROW_MM) flush();
    }
  }
  flush();
  return pages.map((page, index) => ({ ...page, index, total: pages.length }));
}
