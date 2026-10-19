import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Shared helpers for one-time enrollment codes.
 *
 * The database only ever stores HASHES. The plaintext code is e-mailed to the
 * requesting address and then discarded by the server. Expiry is enforced in
 * minutes, re-use is prevented by a `used` flag, and brute-force is capped by
 * a per-token attempt counter.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
/** How many requests per email per hour we accept. */
export const SEND_RATE_LIMIT_PER_HOUR = 5;

/**
 * Cryptographically-random numeric code. We avoid alphanumeric to keep input
 * easy on mobile keyboards (per the spec's "simple" flow).
 */
export function generateCode(): string {
  let value = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    value += randomInt(0, 10).toString();
  }
  return value;
}

/**
 * Normalise an email for stable hashing: trim + lowercase. We don't want
 * `Foo@BAR.com` and `foo@bar.com` to look like different accounts.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function hashEmail(email: string): string {
  const normalised = normaliseEmail(email);
  return createHash("sha256").update(normalised).digest("hex");
}

/**
 * Hash a code tied to an email so a stolen token row can't be replayed for a
 * different account. We also include a server pepper so a dump of just the
 * loyaltyEnrollmentTokens collection is not enough to brute-force codes.
 */
export function hashCode(code: string, emailHash: string): string {
  const pepper = process.env.LOYALTY_TOKEN_PEPPER || "mishkah-dev-pepper";
  return createHash("sha256").update(`${pepper}:${emailHash}:${code}`).digest("hex");
}

/**
 * Constant-time compare of two hex-string hashes.
 */
export function hashesEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** ISO expiry timestamp for a fresh token. */
export function tokenExpiryIso(now: Date = new Date()): string {
  return new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();
}

/**
 * Decide whether a token is still usable. Pure for test coverage.
 */
export function tokenState(input: {
  status: "active" | "used" | "expired";
  attempts: number;
  expiresAt: string;
  now?: Date;
}): "active" | "used" | "expired" | "throttled" {
  if (input.status === "used") return "used";
  if (input.status === "expired") return "expired";
  const now = (input.now ?? new Date()).toISOString();
  if (input.expiresAt < now) return "expired";
  if (input.attempts >= MAX_ATTEMPTS) return "throttled";
  return "active";
}
