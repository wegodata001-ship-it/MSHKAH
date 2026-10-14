import type { InvoiceAiCode } from "@/lib/ai/gemini-config";

export function parseRetryAfterSeconds(input: {
  header?: string | null;
  payload?: unknown;
}): number | null {
  const header = input.header?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      const wait = Math.ceil((date - Date.now()) / 1000);
      if (wait > 0) return wait;
    }
  }
  const details = (input.payload as { error?: { details?: { retryDelay?: string }[] } } | null)?.error?.details;
  const delay = details?.find((item) => item.retryDelay)?.retryDelay;
  const match = delay?.match(/^(\d+(?:\.\d+)?)s$/);
  if (match) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  }
  return null;
}

export function formatRetryAfterWhen(seconds: number, now = Date.now()): string {
  const wait = Math.max(1, Math.ceil(seconds));
  const at = new Date(now + wait * 1000);
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (wait < 90) return clock;
  if (wait < 3600) return `${clock} (~${Math.ceil(wait / 60)}m)`;
  const hours = Math.floor(wait / 3600);
  const minutes = Math.ceil((wait % 3600) / 60);
  return minutes && minutes < 60 ? `${clock} (~${hours}h ${minutes}m)` : `${clock} (~${hours}h)`;
}

export function classifyProviderLimit(input: {
  status: number;
  reason?: string | null;
  retryAfterSeconds?: number | null;
}): InvoiceAiCode {
  if (input.status !== 429) return "SCAN_FAILED";
  const text = `${input.reason ?? ""}`.toLowerCase();
  if (/quota|generaterequestsperday|free_tier|exceeded your current quota|limit:\s*0\b/.test(text)) {
    return "QUOTA_EXCEEDED";
  }
  return "PROVIDER_RATE_LIMIT";
}
