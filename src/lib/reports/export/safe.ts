import type { ReportValue } from "@/lib/reports/export/types";

const FORMULA_START = /^[=+\-@\t\r]/;

export function blankNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function safeCellText(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!text) return "";
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function cellValue(value: ReportValue, kind?: string): string | number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (kind === "money" || kind === "number" || kind === "percent") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : safeCellText(value);
  }
  return safeCellText(value);
}

export function fileSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 40);
}

export function stamp(date = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function dayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function reportFilename(input: {
  kind: string;
  ext: "pdf" | "xlsx" | "zip";
  supplier?: string;
  number?: string;
  at?: Date;
}): string {
  const at = input.at ?? new Date();
  const day = dayStamp(at);
  const time = stamp(at);
  if (input.kind === "invoice") {
    const supplier = fileSlug(input.supplier || "Supplier") || "Supplier";
    const number = fileSlug(input.number || "invoice") || "invoice";
    return `MISHKAT_Invoice_${supplier}-${number}_${time}.${input.ext}`;
  }
  if (input.kind === "invoices") return `MISHKAT_Invoices_${day.slice(0, 7)}_${time}.${input.ext}`;
  if (input.kind === "inventory") return `MISHKAT_Inventory_${day}_${time}.${input.ext}`;
  if (input.kind === "alerts") return `MISHKAT_Alerts_${day}_${time}.${input.ext}`;
  if (input.kind === "cashflow") return `MISHKAT_Cashflow_${day.slice(0, 7)}_${time}.${input.ext}`;
  if (input.kind === "zip") return `MISHKAT_Reports_${day}_${time}.zip`;
  const name = fileSlug(input.kind) || "Report";
  return `MISHKAT_${name}_${day}_${time}.${input.ext}`;
}
