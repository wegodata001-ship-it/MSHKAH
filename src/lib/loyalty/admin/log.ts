/**
 * Thin logger that NEVER prints codes, token hashes, or verification links.
 * The spec explicitly forbids leaking them.
 *
 * This is intentionally minimal — we re-use console.* so we can grep output
 * in Vercel logs without hooking up a separate pipeline.
 */

export type LoyaltyLogEvent =
  | "enroll.start"
  | "enroll.verify.ok"
  | "enroll.verify.fail"
  | "enroll.verify.throttled"
  | "enroll.pay.start"
  | "enroll.pay.verified"
  | "enroll.cash.ok"
  | "member.earn"
  | "member.redeem"
  | "member.refund"
  | "member.adjust"
  | "member.suspend"
  | "settings.update"
  | "email.welcome.sent"
  | "email.welcome.failed";

export function loyaltyLog(event: LoyaltyLogEvent, extra?: Record<string, unknown>): void {
  const safe = extra ? redact(extra) : undefined;
  // Keeping to a single "[loyalty]" prefix makes grep easy and matches
  // the convention used by payments/invoice audit logs in this repo.
  console.log(`[loyalty] ${event}`, safe ?? "");
}

const REDACT_KEYS = new Set([
  "code",
  "token",
  "tokenPlain",
  "pin",
  "secret",
  "codeHash",
  "verifyLink",
  "pepper",
]);

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.has(key)) {
      out[key] = "[REDACTED]";
    } else if (key === "email" && typeof value === "string") {
      // Keep the domain for debugging but mask the local part.
      const at = value.indexOf("@");
      out[key] = at > 1 ? `${value[0]}…@${value.slice(at + 1)}` : "[REDACTED]";
    } else {
      out[key] = value;
    }
  }
  return out;
}
