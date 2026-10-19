import type { Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { COLLECTIONS } from "@/lib/firebase/collections";

/**
 * Firestore-backed sliding-window rate limiter.
 *
 * Each bucket doc stores { count, windowStart }. On each hit we read, decide
 * whether to reset the window, then write the new counter. We stay inside a
 * transaction so a double-click can't both get through under the limit.
 */

export type RateLimitDecision =
  | { ok: true; remaining: number; windowResetsAt: string }
  | { ok: false; retryAfterSeconds: number };

export function rateLimitKey(parts: Array<string | undefined>): string {
  const joined = parts.filter(Boolean).join("|");
  // We hash the key so we never store raw PII (e.g. an email) in a doc id.
  return createHash("sha256").update(joined).digest("hex").slice(0, 32);
}

export async function consumeRateLimit(
  db: Firestore,
  input: { key: string; windowSeconds: number; limit: number }
): Promise<RateLimitDecision> {
  const ref = db.collection(COLLECTIONS.loyaltyRateLimit).doc(input.key);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const windowStartMs = snap.exists ? Number(snap.data()?.windowStartMs ?? 0) : 0;
    const count = snap.exists ? Number(snap.data()?.count ?? 0) : 0;
    const windowOpen = windowStartMs > 0 && now - windowStartMs < input.windowSeconds * 1000;
    const nextStart = windowOpen ? windowStartMs : now;
    const nextCount = windowOpen ? count + 1 : 1;
    const windowResetsAtMs = nextStart + input.windowSeconds * 1000;
    if (nextCount > input.limit) {
      return {
        ok: false as const,
        retryAfterSeconds: Math.max(1, Math.ceil((windowResetsAtMs - now) / 1000)),
      };
    }
    tx.set(ref, {
      windowStartMs: nextStart,
      count: nextCount,
      updatedAt: new Date(now).toISOString(),
    });
    return {
      ok: true as const,
      remaining: Math.max(0, input.limit - nextCount),
      windowResetsAt: new Date(windowResetsAtMs).toISOString(),
    };
  });
  return result;
}
