import { BUSINESS_TIMEZONE } from "@/lib/orders/status";

export type AgeFormat =
  | { kind: "justNow" }
  | { kind: "minutes"; count: number }
  | { kind: "hourMinutes"; hours: 1; minutes: number }
  | { kind: "hoursMinutes"; hours: number; minutes: number }
  | { kind: "dayHours"; days: 1; hours: number }
  | { kind: "daysHours"; days: number; hours: number }
  | { kind: "days"; days: number };

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

function zonedOffsetMs(date: Date, timeZone: string): number {
  const zoned = zonedParts(date, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return asUtc - date.getTime();
}

export function jerusalemDayBounds(now = new Date()): { start: Date; end: Date; day: string } {
  const parts = zonedParts(now, BUSINESS_TIMEZONE);
  const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const start = new Date(guess.getTime() - zonedOffsetMs(guess, BUSINESS_TIMEZONE));
  const nextGuess = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const nextParts = zonedParts(nextGuess, BUSINESS_TIMEZONE);
  const nextMidnightGuess = new Date(Date.UTC(nextParts.year, nextParts.month - 1, nextParts.day, 0, 0, 0));
  const end = new Date(nextMidnightGuess.getTime() - zonedOffsetMs(nextMidnightGuess, BUSINESS_TIMEZONE));
  return { start, end, day };
}

export function isJerusalemToday(value: string | Date | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = jerusalemDayBounds(now);
  return date.getTime() >= today.start.getTime() && date.getTime() < today.end.getTime();
}

export function parseTimestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function describeAge(ms: number): AgeFormat {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 1) return { kind: "justNow" };
  if (totalMin < 60) return { kind: "minutes", count: totalMin };
  if (totalMin < 120) return { kind: "hourMinutes", hours: 1, minutes: totalMin - 60 };
  if (totalMin < 24 * 60) {
    return { kind: "hoursMinutes", hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
  }
  const rawDays = Math.floor(totalMin / 1440);
  const remainderMin = totalMin % 1440;
  let hours = Math.round(remainderMin / 60);
  let days = rawDays;
  if (hours === 24) {
    days += 1;
    hours = 0;
  }
  if (days === 1) return { kind: "dayHours", days: 1, hours };
  if (days < 7 && hours > 0) return { kind: "daysHours", days, hours };
  return { kind: "days", days };
}

export function ageIsAtLeastOneDay(ms: number): boolean {
  return ms >= 24 * 60 * 60 * 1000;
}

export function formatJerusalemDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return formatted.replace(",", " •");
}

export function minutesBetween(start: string | Date | null | undefined, end: string | Date | null | undefined): number | null {
  const from = parseTimestamp(start);
  const to = parseTimestamp(end);
  if (from == null || to == null) return null;
  const minutes = (to - from) / 60_000;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}
