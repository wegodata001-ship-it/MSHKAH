import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal signed-cookie session for verified club members.
 *
 * The cookie contains `v1.<emailHashHex>.<expMs>.<hmacHex>` — no PII and no
 * membership status. The server reads `emailHash` and looks up the actual
 * member doc on every request. Keeping the cookie small, signed, and
 * unencrypted (but not revealing) is the lightest footprint that still
 * satisfies the spec's "customer sees only their own card" rule.
 */

const COOKIE_NAME = "mkh_club";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  return process.env.LOYALTY_SESSION_SECRET || process.env.LOYALTY_TOKEN_PEPPER || "mishkah-dev-session";
}

export function signClubSession(input: { emailHash: string; ttlSeconds?: number }): {
  cookieName: string;
  value: string;
  maxAgeSeconds: number;
  expiresAt: string;
} {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const exp = Date.now() + ttl * 1000;
  const payload = `v1.${input.emailHash}.${exp}`;
  const hmac = createHmac("sha256", secret()).update(payload).digest("hex");
  return {
    cookieName: COOKIE_NAME,
    value: `${payload}.${hmac}`,
    maxAgeSeconds: ttl,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function readClubSession(cookieValue: string | undefined | null): { emailHash: string } | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 4) return null;
  const [version, emailHash, expStr, hmac] = parts;
  if (version !== "v1") return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = createHmac("sha256", secret()).update(`${version}.${emailHash}.${exp}`).digest("hex");
  if (expected.length !== hmac.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"))) return null;
  } catch {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(emailHash)) return null;
  return { emailHash };
}

export const CLUB_COOKIE_NAME = COOKIE_NAME;
