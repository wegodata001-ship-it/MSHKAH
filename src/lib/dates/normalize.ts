/** Shared date normalization. Never assumes Firebase Timestamp. Never invents today. */

function hasToDate(value: object): value is { toDate: () => Date } {
  return typeof (value as { toDate?: unknown }).toDate === "function";
}

function fromEpochSeconds(seconds: number, nanos?: number): Date | null {
  if (!Number.isFinite(seconds)) return null;
  const ms = seconds * 1000 + (nanos != null && Number.isFinite(nanos) ? nanos / 1e6 : 0);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toJsDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value && "value" in value) {
    const keys = Object.keys(value as object);
    if (keys.every((key) => key === "value" || key === "confidence")) {
      return toJsDate((value as { value: unknown }).value);
    }
  }
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const iso = parseDateOnlyParts(trimmed);
    if (iso) {
      const date = new Date(`${iso}T00:00:00.000Z`);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  if (typeof value !== "object") return null;
  if (hasToDate(value)) {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch {
      return null;
    }
  }
  const row = value as {
    seconds?: unknown;
    _seconds?: unknown;
    nanoseconds?: unknown;
    _nanoseconds?: unknown;
    year?: unknown;
    month?: unknown;
    day?: unknown;
  };
  const year = Number(row.year);
  const month = Number(row.month);
  const day = Number(row.day);
  if (Number.isFinite(year) && year > 1900 && Number.isFinite(month) && Number.isFinite(day)) {
    return toJsDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  const seconds = Number(row.seconds ?? row._seconds);
  if (Number.isFinite(seconds)) {
    return fromEpochSeconds(seconds, Number(row.nanoseconds ?? row._nanoseconds));
  }
  return null;
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Israeli invoices print DD/MM/YYYY. ISO dates stay YYYY-MM-DD. */
export function parseDateOnlyParts(value: string): string | null {
  const trimmed = value
    .trim()
    .replace(/^(?:תאריך(?:\s*חשבונית)?|date|invoice\s*date|issued?)\s*[:\-]?\s*/i, "")
    .replace(/\s+[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i, "")
    .trim();
  const iso = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!dmy) return null;
  return ymd(expandYear(Number(dmy[3])), Number(dmy[2]), Number(dmy[1]));
}

function dateOnlyFromObject(value: object): string | null {
  const keys = Object.keys(value);
  if ("value" in value && keys.every((key) => key === "value" || key === "confidence")) {
    return toDateOnly((value as { value: unknown }).value);
  }
  const row = value as { year?: unknown; month?: unknown; day?: unknown };
  const year = Number(row.year);
  const month = Number(row.month);
  const day = Number(row.day);
  if (Number.isFinite(year) && year > 1900 && Number.isFinite(month) && Number.isFinite(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function toDateOnly(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const fromParts = parseDateOnlyParts(trimmed);
    if (fromParts) return fromParts;
    const isoDateTime = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
    if (isoDateTime) return `${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}`;
  }
  if (value && typeof value === "object") {
    const fromObject = dateOnlyFromObject(value);
    if (fromObject) return fromObject;
  }
  const date = toJsDate(value);
  if (!date) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const day = parseDateOnlyParts(trimmed);
    if (day) {
      const date = new Date(`${day}T00:00:00.000Z`);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }
  const date = toJsDate(value);
  return date ? date.toISOString() : null;
}
