import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { isAutoPrintNewOrdersEnabled, getPrintStoreId } from "@/lib/print-jobs/config";
import { newOrderPrintJobId, parsePrintLocale, printJobUniqueKey } from "@/lib/print-jobs/ids";
import { toIso, toMillis } from "@/lib/print-jobs/time";
import {
  MAX_PRINT_ATTEMPTS,
  PRINT_RETRY_DELAYS_MS,
  PRINT_STORE_ID,
  STALE_PRINTING_MS,
  type PrintJob,
  type PrintJobStatus,
  type PrintJobType,
  type PrintLocale,
} from "@/lib/print-jobs/types";
import type { FirestoreOrder } from "@/types/firestore";

export type EnqueueResult =
  | { status: "created"; jobId: string }
  | { status: "already_exists"; jobId: string }
  | { status: "skipped"; reason: string };

export type ClaimResult =
  | { status: "claimed"; job: PrintJob }
  | { status: "empty" }
  | { status: "conflict"; reason: string };

type FirestorePrintJob = {
  storeId: string;
  orderId: string | null;
  type: PrintJobType;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  printedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  claimedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  claimedBy?: string | null;
  nextRetryAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  uniqueKey?: string | null;
  locale?: PrintLocale;
  printerIp?: string | null;
  printerPort?: number | null;
};

function jobsCol() {
  return getAdminDb().collection(COLLECTIONS.printJobs);
}

function alreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: number | string }).code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

export function mapPrintJob(id: string, data: FirebaseFirestore.DocumentData): PrintJob {
  return {
    id,
    storeId: typeof data.storeId === "string" ? data.storeId : PRINT_STORE_ID,
    orderId: typeof data.orderId === "string" ? data.orderId : null,
    type: (data.type as PrintJobType) || "NEW_ORDER",
    status: (data.status as PrintJobStatus) || "PENDING",
    attempts: typeof data.attempts === "number" ? data.attempts : 0,
    lastError: typeof data.lastError === "string" ? data.lastError : null,
    createdAt: toIso(data.createdAt),
    printedAt: toIso(data.printedAt),
    claimedAt: toIso(data.claimedAt),
    claimedBy: typeof data.claimedBy === "string" ? data.claimedBy : null,
    nextRetryAt: toIso(data.nextRetryAt),
    uniqueKey: typeof data.uniqueKey === "string" ? data.uniqueKey : null,
    locale: parsePrintLocale(data.locale),
    printerIp: typeof data.printerIp === "string" ? data.printerIp : null,
    printerPort: typeof data.printerPort === "number" ? data.printerPort : null,
  };
}

function delayAfterFailedAttempt(attempts: number): number {
  if (attempts <= 1) return PRINT_RETRY_DELAYS_MS[1];
  return PRINT_RETRY_DELAYS_MS[2];
}

function isReadyToClaim(data: FirebaseFirestore.DocumentData, now: number): boolean {
  const status = data.status as PrintJobStatus;
  if (status === "PENDING") {
    const retryAt = toMillis(data.nextRetryAt);
    return retryAt == null || retryAt <= now;
  }
  if (status === "PRINTING") {
    const claimedAt = toMillis(data.claimedAt) ?? 0;
    return now - claimedAt > STALE_PRINTING_MS;
  }
  return false;
}

export async function enqueueNewOrderPrintJob(
  orderId: string,
  options?: { ignoreAutoPrintGate?: boolean }
): Promise<EnqueueResult> {
  if (!orderId.trim()) return { status: "skipped", reason: "missing_orderId" };
  if (!options?.ignoreAutoPrintGate && !isAutoPrintNewOrdersEnabled()) {
    return { status: "skipped", reason: "auto_print_disabled" };
  }

  const db = getAdminDb();
  const orderSnap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
  if (!orderSnap.exists) return { status: "skipped", reason: "order_not_found" };

  const order = orderSnap.data() as FirestoreOrder;
  const jobId = newOrderPrintJobId(orderId);
  const payload: FirestorePrintJob = {
    storeId: getPrintStoreId(),
    orderId,
    type: "NEW_ORDER",
    status: "PENDING",
    attempts: 0,
    lastError: null,
    createdAt: FieldValue.serverTimestamp(),
    printedAt: null,
    claimedAt: null,
    claimedBy: null,
    nextRetryAt: null,
    uniqueKey: printJobUniqueKey(orderId, "NEW_ORDER"),
    locale: parsePrintLocale(order.locale),
  };

  try {
    await jobsCol().doc(jobId).create(payload);
    return { status: "created", jobId };
  } catch (error) {
    if (alreadyExists(error)) return { status: "already_exists", jobId };
    throw error;
  }
}

export async function enqueueReprintJob(
  orderId: string,
  locale?: PrintLocale
): Promise<EnqueueResult> {
  if (!orderId.trim()) return { status: "skipped", reason: "missing_orderId" };

  const db = getAdminDb();
  const orderSnap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
  if (!orderSnap.exists) return { status: "skipped", reason: "order_not_found" };
  const order = orderSnap.data() as FirestoreOrder;

  const ref = jobsCol().doc();
  await ref.set({
    storeId: getPrintStoreId(),
    orderId,
    type: "REPRINT",
    status: "PENDING",
    attempts: 0,
    lastError: null,
    createdAt: FieldValue.serverTimestamp(),
    printedAt: null,
    claimedAt: null,
    claimedBy: null,
    nextRetryAt: null,
    uniqueKey: null,
    locale: locale ?? parsePrintLocale(order.locale),
  } satisfies FirestorePrintJob);

  return { status: "created", jobId: ref.id };
}

export async function enqueueTestPrintJob(locale: PrintLocale = "ar"): Promise<EnqueueResult> {
  const ref = jobsCol().doc();
  await ref.set({
    storeId: getPrintStoreId(),
    orderId: null,
    type: "TEST",
    status: "PENDING",
    attempts: 0,
    lastError: null,
    createdAt: FieldValue.serverTimestamp(),
    printedAt: null,
    claimedAt: null,
    claimedBy: null,
    nextRetryAt: null,
    uniqueKey: null,
    locale,
  } satisfies FirestorePrintJob);
  return { status: "created", jobId: ref.id };
}

export async function listClaimableJobs(limit = 20): Promise<PrintJob[]> {
  const now = Date.now();
  const [pending, printing] = await Promise.all([
    jobsCol().where("status", "==", "PENDING").limit(limit).get(),
    jobsCol().where("status", "==", "PRINTING").limit(limit).get(),
  ]);

  return [...pending.docs, ...printing.docs]
    .filter((doc) => isReadyToClaim(doc.data(), now))
    .map((doc) => mapPrintJob(doc.id, doc.data()))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export async function claimPrintJob(jobId: string, agentId: string): Promise<ClaimResult> {
  const ref = jobsCol().doc(jobId);
  const db = getAdminDb();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: "empty" as const };
    const data = snap.data() as FirebaseFirestore.DocumentData;
    const now = Date.now();

    if (data.status === "PRINTED") {
      return { status: "conflict" as const, reason: "already_printed" };
    }
    if (!isReadyToClaim(data, now)) {
      return { status: "conflict" as const, reason: "not_claimable" };
    }

    const attempts = (typeof data.attempts === "number" ? data.attempts : 0) + 1;
    tx.update(ref, {
      status: "PRINTING",
      claimedAt: FieldValue.serverTimestamp(),
      claimedBy: agentId,
      attempts,
      lastError: null,
    });

    return {
      status: "claimed" as const,
      job: mapPrintJob(jobId, {
        ...data,
        status: "PRINTING",
        claimedBy: agentId,
        attempts,
      }),
    };
  });
}

export async function claimNextPrintJob(agentId: string): Promise<ClaimResult> {
  const candidates = await listClaimableJobs(10);
  for (const job of candidates) {
    const result = await claimPrintJob(job.id, agentId);
    if (result.status === "claimed") return result;
  }
  return { status: "empty" };
}

export async function markPrintJobPrinted(
  jobId: string,
  meta?: { printerIp?: string; printerPort?: number; cutterError?: string; beepError?: string }
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: "PRINTED",
    printedAt: FieldValue.serverTimestamp(),
    lastError: null,
    nextRetryAt: null,
  };
  if (meta?.printerIp) patch.printerIp = meta.printerIp;
  if (meta?.printerPort) patch.printerPort = meta.printerPort;
  if (meta?.cutterError) patch.cutterError = meta.cutterError.slice(0, 300);
  if (meta?.beepError) patch.beepError = meta.beepError.slice(0, 300);
  await jobsCol().doc(jobId).update(patch);
}

export async function markPrintJobFailed(jobId: string, error: string): Promise<PrintJobStatus> {
  const ref = jobsCol().doc(jobId);
  const db = getAdminDb();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("print_job_not_found");
    const data = snap.data() as FirebaseFirestore.DocumentData;
    const attempts = typeof data.attempts === "number" ? data.attempts : 1;
    const message = error.slice(0, 300);

    if (attempts >= MAX_PRINT_ATTEMPTS) {
      tx.update(ref, {
        status: "FAILED",
        lastError: message,
        nextRetryAt: null,
      });
      return "FAILED" as const;
    }

    const delay = delayAfterFailedAttempt(attempts);
    tx.update(ref, {
      status: "PENDING",
      lastError: message,
      nextRetryAt: Timestamp.fromMillis(Date.now() + delay),
      claimedAt: null,
      claimedBy: null,
    });
    return "PENDING" as const;
  });
}

export async function retryFailedPrintJob(jobId: string): Promise<EnqueueResult> {
  const ref = jobsCol().doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return { status: "skipped", reason: "job_not_found" };
  const data = snap.data() as FirebaseFirestore.DocumentData;
  if (data.status !== "FAILED") {
    return { status: "skipped", reason: "not_failed" };
  }
  await ref.update({
    status: "PENDING",
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
    claimedAt: null,
    claimedBy: null,
  });
  return { status: "created", jobId };
}

export async function getPrintJob(jobId: string): Promise<PrintJob | null> {
  const snap = await jobsCol().doc(jobId).get();
  if (!snap.exists) return null;
  return mapPrintJob(snap.id, snap.data() as FirebaseFirestore.DocumentData);
}

export async function listRecentPrintJobs(limit = 40): Promise<PrintJob[]> {
  try {
    const snap = await jobsCol().orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((doc) => mapPrintJob(doc.id, doc.data()));
  } catch {
    const snap = await jobsCol().limit(limit).get();
    return snap.docs
      .map((doc) => mapPrintJob(doc.id, doc.data()))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }
}

export async function countJobsByStatus(): Promise<{
  pending: number;
  printing: number;
  printed: number;
  failed: number;
}> {
  const [pending, printing, printed, failed] = await Promise.all([
    jobsCol().where("status", "==", "PENDING").limit(100).get(),
    jobsCol().where("status", "==", "PRINTING").limit(100).get(),
    jobsCol().where("status", "==", "PRINTED").limit(100).get(),
    jobsCol().where("status", "==", "FAILED").limit(100).get(),
  ]);
  return {
    pending: pending.size,
    printing: printing.size,
    printed: printed.size,
    failed: failed.size,
  };
}

export async function lastSuccessfulPrintAt(): Promise<string | null> {
  try {
    const snap = await jobsCol()
      .where("status", "==", "PRINTED")
      .orderBy("printedAt", "desc")
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    return toIso(doc.data().printedAt);
  } catch {
    const snap = await jobsCol().orderBy("createdAt", "desc").limit(40).get();
    const printed = snap.docs
      .map((doc) => mapPrintJob(doc.id, doc.data()))
      .find((job) => job.status === "PRINTED");
    return printed?.printedAt ?? null;
  }
}

export async function retryAllFailedJobs(): Promise<number> {
  const snap = await jobsCol().where("status", "==", "FAILED").limit(50).get();
  let count = 0;
  for (const doc of snap.docs) {
    await retryFailedPrintJob(doc.id);
    count += 1;
  }
  return count;
}
