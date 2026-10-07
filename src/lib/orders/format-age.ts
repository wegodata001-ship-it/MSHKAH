import { describeAge, type AgeFormat } from "@/lib/orders/time";

type Translate = (key: string, fallback?: string) => string;

function apply(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function message(t: Translate, format: AgeFormat, prefix: "ago" | "duration"): string {
  const ns = `admin.orders.${prefix}`;
  switch (format.kind) {
    case "justNow":
      return t(prefix === "ago" ? "admin.orders.justNow" : `${ns}.minutes`).replace("{count}", "0");
    case "minutes":
      return apply(t(`${ns}.minutes`), { count: format.count });
    case "hourMinutes":
      return apply(t(`${ns}.hourMinutes`), { minutes: format.minutes });
    case "hoursMinutes":
      return apply(t(`${ns}.hoursMinutes`), { hours: format.hours, minutes: format.minutes });
    case "dayHours":
      return apply(t(`${ns}.dayHours`), { hours: format.hours });
    case "daysHours":
      return apply(t(`${ns}.daysHours`), { days: format.days, hours: format.hours });
    case "days":
      return apply(t(`${ns}.days`), { days: format.days });
  }
}

export function formatOrderAge(t: Translate, ms: number): string {
  return message(t, describeAge(ms), "ago");
}

export function formatDuration(t: Translate, ms: number): string {
  return message(t, describeAge(ms), "duration");
}
