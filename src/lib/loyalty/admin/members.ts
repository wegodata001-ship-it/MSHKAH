import type { Firestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  DEFAULT_LOYALTY_SETTINGS,
  type LoyaltyLedgerEntry,
  type LoyaltyLedgerKind,
  type LoyaltyLedgerSource,
  type LoyaltyMember,
  type LoyaltyMemberStatus,
  type LoyaltySettings,
} from "@/lib/loyalty/types";
import { parseLoyaltySettings } from "@/lib/loyalty/settings";
import { deriveMemberNumber, nextStatusFor } from "@/lib/loyalty/state";
import {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  hashCode,
  hashEmail,
  hashesEqual,
  normaliseEmail,
  tokenState,
} from "@/lib/loyalty/tokens";
import {
  pointsForAmount,
  pointsToReverseForRefund,
  qualifyingAmountMinor,
  toMinor,
} from "@/lib/loyalty/points-math";
import { loyaltyLog } from "@/lib/loyalty/admin/log";

/**
 * Server-side writers for loyalty club. Everything in this file assumes the
 * caller has already verified the user's identity (customer session for
 * self-service endpoints, admin verification for admin endpoints).
 *
 * All writes are IDEMPOTENT by construction:
 *   - members keyed by `emailHash` (one per email, atomic upsert)
 *   - earn/refund entries keyed by `order:<orderId>` (one per order per kind)
 *   - adjustments keyed by a caller-provided `idempotencyKey`
 *   - activation is a single tx that both flips status and writes the
 *     one-and-only "welcome" ledger entry
 */

// ──────────────────────────────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────────────────────────────

export async function readLoyaltySettings(db: Firestore): Promise<LoyaltySettings> {
  const snap = await db.collection(COLLECTIONS.loyaltySettings).doc("app").get();
  return parseLoyaltySettings(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
}

export async function writeLoyaltySettings(
  db: Firestore,
  patch: Partial<LoyaltySettings>,
  actor: string
): Promise<LoyaltySettings> {
  const ref = db.collection(COLLECTIONS.loyaltySettings).doc("app");
  const now = new Date().toISOString();
  const existing = await ref.get();
  const merged = parseLoyaltySettings({
    ...(existing.exists ? (existing.data() as Record<string, unknown>) : DEFAULT_LOYALTY_SETTINGS),
    ...patch,
    updatedAt: now,
    updatedBy: actor,
  });
  await ref.set(merged, { merge: true });
  loyaltyLog("settings.update", { actor });
  return merged;
}

// ──────────────────────────────────────────────────────────────────────
// Enrollment tokens
// ──────────────────────────────────────────────────────────────────────

export async function createEnrollmentToken(
  db: Firestore,
  input: { email: string; codePlain: string }
): Promise<{ tokenId: string; expiresAt: string }> {
  const emailHash = hashEmail(input.email);
  const codeHashValue = hashCode(input.codePlain, emailHash);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();
  const tokenId = randomUUID();
  await db.collection(COLLECTIONS.loyaltyEnrollmentTokens).doc(tokenId).set({
    id: tokenId,
    emailHash,
    codeHash: codeHashValue,
    status: "active",
    attempts: 0,
    expiresAt,
    createdAt: now.toISOString(),
  });
  return { tokenId, expiresAt };
}

/**
 * Verify a submitted code. Side-effects (atomic):
 *   - increments the token's `attempts` counter even on failure (prevents
 *     brute-force).
 *   - marks the token `used` on success so it can't be replayed.
 */
export async function verifyEnrollmentCode(
  db: Firestore,
  input: { email: string; codePlain: string }
): Promise<
  | { ok: true; emailHash: string }
  | { ok: false; reason: "no_token" | "throttled" | "expired" | "used" | "mismatch" }
> {
  const emailHash = hashEmail(input.email);
  const submittedHash = hashCode(input.codePlain, emailHash);
  const query = db
    .collection(COLLECTIONS.loyaltyEnrollmentTokens)
    .where("emailHash", "==", emailHash)
    .where("status", "==", "active")
    .orderBy("createdAt", "desc")
    .limit(1);
  const snap = await query.get();
  const doc = snap.docs[0];
  if (!doc) return { ok: false, reason: "no_token" };
  return db.runTransaction(async (tx) => {
    const live = await tx.get(doc.ref);
    if (!live.exists) return { ok: false as const, reason: "no_token" as const };
    const data = live.data() as {
      status: "active" | "used" | "expired";
      attempts: number;
      expiresAt: string;
      codeHash: string;
    };
    const state = tokenState({
      status: data.status,
      attempts: data.attempts,
      expiresAt: data.expiresAt,
    });
    if (state === "used") return { ok: false as const, reason: "used" as const };
    if (state === "expired") {
      tx.set(doc.ref, { status: "expired", updatedAt: new Date().toISOString() }, { merge: true });
      return { ok: false as const, reason: "expired" as const };
    }
    if (state === "throttled") return { ok: false as const, reason: "throttled" as const };
    const nextAttempts = data.attempts + 1;
    const match = hashesEqual(submittedHash, data.codeHash);
    if (!match) {
      tx.set(
        doc.ref,
        {
          attempts: nextAttempts,
          status: nextAttempts >= MAX_ATTEMPTS ? "expired" : "active",
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return { ok: false as const, reason: "mismatch" as const };
    }
    tx.set(
      doc.ref,
      {
        status: "used",
        attempts: nextAttempts,
        usedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return { ok: true as const, emailHash };
  });
}

// ──────────────────────────────────────────────────────────────────────
// Members
// ──────────────────────────────────────────────────────────────────────

async function readMemberByEmailHash(
  db: Firestore,
  emailHash: string
): Promise<LoyaltyMember | null> {
  const snap = await db
    .collection(COLLECTIONS.loyaltyMembers)
    .where("emailHash", "==", emailHash)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc) return null;
  return { id: doc.id, ...(doc.data() as Omit<LoyaltyMember, "id">) };
}

export async function readMemberByEmail(
  db: Firestore,
  email: string
): Promise<LoyaltyMember | null> {
  return readMemberByEmailHash(db, hashEmail(email));
}

/**
 * Create (or return) a pending member for a freshly verified email. Idempotent
 * — a second call for the same email returns the same member document.
 */
export async function upsertVerifiedMember(
  db: Firestore,
  input: { email: string; displayName?: string; phone?: string }
): Promise<LoyaltyMember> {
  const emailHash = hashEmail(input.email);
  const email = normaliseEmail(input.email);
  const existing = await readMemberByEmailHash(db, emailHash);
  if (existing) {
    const update: Partial<LoyaltyMember> = {};
    if (input.displayName && !existing.displayName) update.displayName = input.displayName;
    if (input.phone && !existing.phone) update.phone = input.phone;
    if (Object.keys(update).length > 0) {
      update.updatedAt = new Date().toISOString();
      await db.collection(COLLECTIONS.loyaltyMembers).doc(existing.id).set(update, { merge: true });
      return { ...existing, ...update } as LoyaltyMember;
    }
    return existing;
  }
  const now = new Date();
  const id = randomUUID();
  const member: LoyaltyMember = {
    id,
    memberNumber: deriveMemberNumber({ id, createdAtMs: now.getTime() }),
    email,
    emailHash,
    displayName: input.displayName,
    phone: input.phone,
    status: "email_verified",
    balancePoints: 0,
    joinFeePaidMinor: 0,
    consentTerms: false,
    consentMarketing: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.collection(COLLECTIONS.loyaltyMembers).doc(id).set(member);
  return member;
}

export async function markAwaitingPayment(
  db: Firestore,
  memberId: string,
  paymentId: string
): Promise<void> {
  const ref = db.collection(COLLECTIONS.loyaltyMembers).doc(memberId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("member_not_found");
    const member = snap.data() as LoyaltyMember;
    const next = nextStatusFor(member.status, "start_payment");
    if (!next) return; // already past this stage; no-op (idempotent)
    tx.set(
      ref,
      {
        status: next satisfies LoyaltyMemberStatus,
        joinFeePaymentId: paymentId,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  });
}

/**
 * Activate a membership after we've verified the payment server-side. The
 * `paymentId` is used both as the audit anchor and as the idempotency key for
 * the welcome ledger entry.
 */
export async function activateMember(
  db: Firestore,
  input: {
    memberId: string;
    source: "card" | "cash";
    paymentId?: string;
    paidAmountMinor: number;
    actor?: string;
    consentTerms: boolean;
    consentMarketing: boolean;
  }
): Promise<LoyaltyMember> {
  const memberRef = db.collection(COLLECTIONS.loyaltyMembers).doc(input.memberId);
  const idempotencyKey = `activation:${input.memberId}:${input.paymentId ?? input.source}`;
  const welcomeRef = db
    .collection(COLLECTIONS.loyaltyPointsLedger)
    .doc(`welcome:${input.memberId}`);
  const now = new Date().toISOString();
  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    if (!snap.exists) throw new Error("member_not_found");
    const member = snap.data() as LoyaltyMember;
    if (member.status === "active") return member;
    const action = input.source === "card" ? "activate_card" : "activate_cash";
    const next = nextStatusFor(member.status, action);
    if (!next) throw new Error("invalid_transition");
    const nextMember: LoyaltyMember = {
      ...member,
      status: next,
      joinFeePaidMinor: input.paidAmountMinor,
      joinFeeSource: input.source,
      joinFeePaymentId: input.paymentId ?? member.joinFeePaymentId,
      joinFeePaidAt: now,
      activatedAt: now,
      consentTerms: input.consentTerms,
      consentMarketing: input.consentMarketing,
      welcomeEmailStatus: "pending",
      welcomeEmailAttemptAt: undefined,
      updatedAt: now,
    };
    tx.set(memberRef, nextMember);
    tx.set(welcomeRef, {
      id: welcomeRef.id,
      memberId: input.memberId,
      kind: "welcome" as LoyaltyLedgerKind,
      points: 0,
      source: "enrollment" as LoyaltyLedgerSource,
      reason: idempotencyKey,
      actor: input.actor ?? "system",
      createdAt: now,
    } satisfies LoyaltyLedgerEntry);
    return nextMember;
  });
  return updated;
}

export async function setWelcomeEmailStatus(
  db: Firestore,
  memberId: string,
  status: "sent" | "failed"
): Promise<void> {
  await db.collection(COLLECTIONS.loyaltyMembers).doc(memberId).set(
    {
      welcomeEmailStatus: status,
      welcomeEmailAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

// ──────────────────────────────────────────────────────────────────────
// Points ledger
// ──────────────────────────────────────────────────────────────────────

export type AwardInput = {
  memberId: string;
  orderId: string;
  qualifyingAmountMinor: number;
};

/**
 * Award points for an order. Idempotent: the ledger doc id is derived from the
 * orderId, so a replay of the paid-pipeline (which can happen per spec:
 * `already_processed` branch calls `runPaidPostPaymentTasks` again) will not
 * double-award.
 *
 * Returns the ledger entry if a NEW award was written, `null` if the entry
 * already existed.
 */
export async function awardOrderPoints(
  db: Firestore,
  input: AwardInput
): Promise<{ entry: LoyaltyLedgerEntry; newBalance: number } | null> {
  const settings = await readLoyaltySettings(db);
  if (!settings.earnEnabled) return null;
  const ledgerRef = db
    .collection(COLLECTIONS.loyaltyPointsLedger)
    .doc(`earn:${input.orderId}`);
  const memberRef = db.collection(COLLECTIONS.loyaltyMembers).doc(input.memberId);
  const now = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ledgerRef);
    if (existing.exists) return null;
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists) return null;
    const member = memberSnap.data() as LoyaltyMember;
    if (member.status !== "active") return null;
    const award = pointsForAmount({
      qualifyingAmountMinor: input.qualifyingAmountMinor,
      earnPointsPer100: settings.earnPointsPer100,
      roundingMode: settings.roundingMode,
    });
    if (award.points <= 0) {
      // Still write a zero-value ledger entry so we have a record that we
      // *considered* this order; prevents future POS import from re-awarding.
      const entry: LoyaltyLedgerEntry = {
        id: ledgerRef.id,
        memberId: input.memberId,
        kind: "earn",
        points: 0,
        source: "order",
        orderId: input.orderId,
        qualifyingAmountMinor: input.qualifyingAmountMinor,
        pointValueMinorAtTime: settings.pointValueMinor,
        createdAt: now,
      };
      tx.set(ledgerRef, entry);
      return { entry, newBalance: member.balancePoints };
    }
    const entry: LoyaltyLedgerEntry = {
      id: ledgerRef.id,
      memberId: input.memberId,
      kind: "earn",
      points: award.points,
      source: "order",
      orderId: input.orderId,
      qualifyingAmountMinor: input.qualifyingAmountMinor,
      pointValueMinorAtTime: settings.pointValueMinor,
      createdAt: now,
    };
    tx.set(ledgerRef, entry);
    const newBalance = member.balancePoints + award.points;
    tx.set(
      memberRef,
      { balancePoints: newBalance, updatedAt: now },
      { merge: true }
    );
    loyaltyLog("member.earn", {
      memberId: input.memberId,
      orderId: input.orderId,
      points: award.points,
    });
    return { entry, newBalance };
  });
}

/**
 * Reverse points for a refunded order. Idempotent via a per-order id.
 */
export async function refundOrderPoints(
  db: Firestore,
  input: { orderId: string; refundedAmountMinor: number }
): Promise<{ reversedPoints: number } | null> {
  const earnRef = db
    .collection(COLLECTIONS.loyaltyPointsLedger)
    .doc(`earn:${input.orderId}`);
  const refundRef = db
    .collection(COLLECTIONS.loyaltyPointsLedger)
    .doc(`refund:${input.orderId}`);
  const settings = await readLoyaltySettings(db);
  const now = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const earn = await tx.get(earnRef);
    if (!earn.exists) return null; // nothing to refund
    const refund = await tx.get(refundRef);
    if (refund.exists) return null; // already refunded
    const earnData = earn.data() as LoyaltyLedgerEntry;
    if (!earnData.memberId) return null;
    const memberRef = db.collection(COLLECTIONS.loyaltyMembers).doc(earnData.memberId);
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists) return null;
    const member = memberSnap.data() as LoyaltyMember;
    const reversed = pointsToReverseForRefund({
      originalPointsEarned: earnData.points,
      refundedAmountMinor: input.refundedAmountMinor,
      qualifyingAmountMinor: earnData.qualifyingAmountMinor ?? 0,
      roundingMode: settings.roundingMode,
    });
    tx.set(refundRef, {
      id: refundRef.id,
      memberId: earnData.memberId,
      kind: "refund" as LoyaltyLedgerKind,
      points: -reversed,
      source: "order" as LoyaltyLedgerSource,
      orderId: input.orderId,
      qualifyingAmountMinor: input.refundedAmountMinor,
      pointValueMinorAtTime: settings.pointValueMinor,
      createdAt: now,
    } satisfies LoyaltyLedgerEntry);
    const nextBalance = Math.max(0, member.balancePoints - reversed);
    tx.set(
      memberRef,
      { balancePoints: nextBalance, updatedAt: now },
      { merge: true }
    );
    loyaltyLog("member.refund", {
      memberId: earnData.memberId,
      orderId: input.orderId,
      reversed,
    });
    return { reversedPoints: reversed };
  });
}

/**
 * Admin adjustment with required reason. The caller supplies an
 * `idempotencyKey` so the UI "save" button can be retried without doubling
 * the adjustment.
 */
export async function adjustMemberPoints(
  db: Firestore,
  input: {
    memberId: string;
    delta: number;
    reason: string;
    actor: string;
    idempotencyKey: string;
  }
): Promise<{ newBalance: number }> {
  if (!input.reason.trim()) throw new Error("reason_required");
  const ledgerRef = db
    .collection(COLLECTIONS.loyaltyPointsLedger)
    .doc(`adjust:${input.idempotencyKey}`);
  const memberRef = db.collection(COLLECTIONS.loyaltyMembers).doc(input.memberId);
  const now = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const ledgerSnap = await tx.get(ledgerRef);
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists) throw new Error("member_not_found");
    const member = memberSnap.data() as LoyaltyMember;
    if (ledgerSnap.exists) return { newBalance: member.balancePoints };
    const nextBalance = Math.max(0, member.balancePoints + input.delta);
    tx.set(ledgerRef, {
      id: ledgerRef.id,
      memberId: input.memberId,
      kind: "adjustment" as LoyaltyLedgerKind,
      points: input.delta,
      source: "admin" as LoyaltyLedgerSource,
      reason: input.reason.trim().slice(0, 500),
      actor: input.actor,
      createdAt: now,
    } satisfies LoyaltyLedgerEntry);
    tx.set(memberRef, { balancePoints: nextBalance, updatedAt: now }, { merge: true });
    loyaltyLog("member.adjust", {
      memberId: input.memberId,
      delta: input.delta,
      actor: input.actor,
    });
    return { newBalance: nextBalance };
  });
}

export async function suspendMember(
  db: Firestore,
  input: { memberId: string; actor: string; reason?: string }
): Promise<void> {
  const ref = db.collection(COLLECTIONS.loyaltyMembers).doc(input.memberId);
  await ref.set(
    {
      status: "suspended" as LoyaltyMemberStatus,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  loyaltyLog("member.suspend", { memberId: input.memberId, actor: input.actor });
}

export async function resumeMember(
  db: Firestore,
  input: { memberId: string; actor: string }
): Promise<void> {
  const ref = db.collection(COLLECTIONS.loyaltyMembers).doc(input.memberId);
  await ref.set(
    {
      status: "active" as LoyaltyMemberStatus,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

// ──────────────────────────────────────────────────────────────────────
// Public read-only shaping
// ──────────────────────────────────────────────────────────────────────

export async function readMemberHistory(
  db: Firestore,
  memberId: string,
  limit = 50
): Promise<LoyaltyLedgerEntry[]> {
  const snap = await db
    .collection(COLLECTIONS.loyaltyPointsLedger)
    .where("memberId", "==", memberId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<LoyaltyLedgerEntry, "id">) }));
}

// Re-export the pure helpers for API routes that need them.
export { qualifyingAmountMinor, toMinor };
