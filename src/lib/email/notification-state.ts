/**
 * Shared Firestore notification claim/send state machine.
 * status: SENDING → SENT | FAILED
 * SENT only after Brevo success.
 */

import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import type { NewOrderEmailStatus } from "@/lib/email/types";

export type NotificationRecord = {
  status: NewOrderEmailStatus;
  provider?: "BREVO";
  claimedAt?: unknown;
  sentAt?: unknown;
  failedAt?: unknown;
  lastAttemptAt?: unknown;
  messageId?: string;
  lastError?: string;
  attempts?: number;
  fingerprint?: string;
};

const STALE_SENDING_MS = 2 * 60 * 1000;

function toMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

export type ClaimResult =
  | { ok: true; previous?: NotificationRecord }
  | { ok: false; reason: "already_sent" | "in_progress" };

/**
 * Atomically claim a notification slot under notifications.{field}.
 * Optional fingerprint: for updates, same fingerprint + SENT → already_sent.
 */
export async function claimNotification(
  ref: DocumentReference,
  field: string,
  options?: { fingerprint?: string; allowRetryFailed?: boolean; forceResend?: boolean }
): Promise<ClaimResult> {
  const db = ref.firestore;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error("document_not_found");
    }
    const data = snap.data() as {
      notifications?: Record<string, NotificationRecord | boolean | undefined>;
    };
    const current = data.notifications?.[field];
    const record =
      current && typeof current === "object" ? (current as NotificationRecord) : undefined;

    // Legacy boolean true treated as SENT for newOrderEmailSent-style fields
    if (current === true) {
      return { ok: false as const, reason: "already_sent" as const };
    }

    if (record?.status === "SENT" && !options?.forceResend) {
      if (
        options?.fingerprint &&
        record.fingerprint &&
        record.fingerprint !== options.fingerprint
      ) {
        // New fingerprint → allow another update email
      } else {
        return { ok: false as const, reason: "already_sent" as const };
      }
    }

    if (record?.status === "SENDING") {
      const claimedAt = toMillis(record.claimedAt) ?? 0;
      if (Date.now() - claimedAt <= STALE_SENDING_MS) {
        return { ok: false as const, reason: "in_progress" as const };
      }
    }

    if (record?.status === "FAILED" && options?.allowRetryFailed === false) {
      return { ok: false as const, reason: "already_sent" as const };
    }

    const attempts = (record?.attempts ?? 0) + 1;
    const next: NotificationRecord = {
      status: "SENDING",
      provider: "BREVO",
      claimedAt: FieldValue.serverTimestamp() as unknown,
      lastAttemptAt: FieldValue.serverTimestamp() as unknown,
      attempts,
      ...(options?.fingerprint ? { fingerprint: options.fingerprint } : {}),
    };

    tx.update(ref, {
      [`notifications.${field}`]: next,
    });

    return { ok: true as const, previous: record };
  });
}

export async function markNotificationSent(
  ref: DocumentReference,
  field: string,
  opts: { messageId?: string; fingerprint?: string; attempts?: number; deliveryStatus?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {
    status: "SENT",
    provider: "BREVO",
    sentAt: FieldValue.serverTimestamp(),
    lastAttemptAt: FieldValue.serverTimestamp(),
  };
  if (opts.messageId) payload.messageId = opts.messageId;
  if (opts.fingerprint) payload.fingerprint = opts.fingerprint;
  if (opts.attempts != null) payload.attempts = opts.attempts;
  if (opts.deliveryStatus) payload.deliveryStatus = opts.deliveryStatus;

  await ref.update({
    [`notifications.${field}`]: payload,
  });
}

export async function markNotificationFailed(
  ref: DocumentReference,
  field: string,
  opts: { error: string; fingerprint?: string; attempts?: number }
): Promise<void> {
  const payload: Record<string, unknown> = {
    status: "FAILED",
    provider: "BREVO",
    failedAt: FieldValue.serverTimestamp(),
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastError: opts.error.slice(0, 300),
  };
  if (opts.fingerprint) payload.fingerprint = opts.fingerprint;
  if (opts.attempts != null) payload.attempts = opts.attempts;

  await ref.update({
    [`notifications.${field}`]: payload,
  });
}
