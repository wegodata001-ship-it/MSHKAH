import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { createHypPaymentPage, verifyHypRedirect } from "@/lib/payments/hyp/client";
import { HypConfigError, isHypConfigured } from "@/lib/payments/hyp/config";
import { HYP_CURRENCY, HYP_PROVIDER } from "@/lib/payments/hyp/types";
import { formatHypAmount } from "@/lib/payments/hyp/amounts";
import { parseHypRedirect } from "@/lib/payments/hyp/query";
import {
  activateMember,
  markAwaitingPayment,
  readLoyaltySettings,
} from "@/lib/loyalty/admin/members";
import { fromMinor, toMinor } from "@/lib/loyalty/points-math";
import { loyaltyLog } from "@/lib/loyalty/admin/log";

/**
 * HYP wrapper for the club join fee.
 *
 * The order-based HYP helper assumes it has an `orders/{id}` doc to charge
 * against; club join doesn't. We write to the same `payments` collection
 * so the existing audit UI continues to work, but with `kind: "club_join"`
 * and an explicit `memberId` back-ref instead of `orderId`.
 */

type ClubPaymentDoc = {
  kind: "club_join";
  memberId: string;
  memberEmail: string;
  memberNumber: string;
  amount: number;
  expectedAmount: number;
  currency: string;
  provider: string;
  status: "pending" | "paid" | "failed" | "cancelled";
  hypTransactionId?: string;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
};

export class ClubPaymentError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "ClubPaymentError";
  }
}

export async function startClubJoinPayment(
  db: Firestore,
  input: {
    memberId: string;
    email: string;
    memberNumber: string;
    name?: string;
    phone?: string;
    locale?: string;
  }
): Promise<{ paymentId: string; paymentUrl: string }> {
  if (!isHypConfigured()) throw new HypConfigError();
  const settings = await readLoyaltySettings(db);
  if (!settings.enrollmentEnabled) {
    throw new ClubPaymentError("ENROLLMENT_DISABLED", 409);
  }
  if (settings.joinFeeMinor <= 0) {
    throw new ClubPaymentError("JOIN_FEE_UNSET", 409);
  }
  const amount = fromMinor(settings.joinFeeMinor);
  const paymentRef = db.collection(COLLECTIONS.payments).doc();
  await paymentRef.set({
    kind: "club_join",
    memberId: input.memberId,
    memberEmail: input.email,
    memberNumber: input.memberNumber,
    amount,
    expectedAmount: amount,
    currency: HYP_CURRENCY,
    provider: HYP_PROVIDER,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  } satisfies ClubPaymentDoc);

  await markAwaitingPayment(db, input.memberId, paymentRef.id);
  loyaltyLog("enroll.pay.start", { memberId: input.memberId, amount });
  try {
    const paymentUrl = await createHypPaymentPage({
      amount: formatHypAmount(amount),
      orderRef: paymentRef.id,
      info: `Mishkah club ${input.memberNumber}`,
      clientName: input.name,
      cell: input.phone,
      email: input.email,
      pageLang: input.locale === "en" ? "ENG" : "HEB",
    });
    return { paymentId: paymentRef.id, paymentUrl };
  } catch (error) {
    await paymentRef.update({
      status: "failed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    const message = error instanceof Error ? error.message : "HYP_UNAVAILABLE";
    throw new ClubPaymentError(message || "HYP_UNAVAILABLE", 502);
  }
}

export type ClubPaymentReturn =
  | { ok: true; memberId: string; alreadyActive: boolean }
  | { ok: false; code: "VERIFY_FAILED" | "AMOUNT_MISMATCH" | "ALREADY_FAILED" | "UNKNOWN_PAYMENT" | "NOT_CLUB" };

/**
 * Handle the HYP browser return for a club-join payment. VERIFYs the redirect
 * server-side (per spec: "חזרה לדף הצלחה בלבד אינה הוכחת תשלום").
 */
export async function completeClubJoinPayment(
  db: Firestore,
  input: { rawQuery: string; actor?: string; consentTerms: boolean; consentMarketing: boolean }
): Promise<ClubPaymentReturn> {
  const parsed = parseHypRedirect(input.rawQuery);
  const paymentId = parsed.order.trim();
  if (!paymentId) return { ok: false, code: "UNKNOWN_PAYMENT" };
  const paymentRef = db.collection(COLLECTIONS.payments).doc(paymentId);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) return { ok: false, code: "UNKNOWN_PAYMENT" };
  const payment = paymentSnap.data() as ClubPaymentDoc;
  if (payment.kind !== "club_join") return { ok: false, code: "NOT_CLUB" };
  if (payment.status === "paid") {
    return { ok: true, memberId: payment.memberId, alreadyActive: true };
  }
  if (payment.status === "failed" || payment.status === "cancelled") {
    return { ok: false, code: "ALREADY_FAILED" };
  }

  let verified = false;
  try {
    const result = await verifyHypRedirect(input.rawQuery);
    verified = result.ok;
  } catch {
    verified = false;
  }
  if (!verified) {
    await paymentRef.update({ status: "failed", updatedAt: FieldValue.serverTimestamp() });
    return { ok: false, code: "VERIFY_FAILED" };
  }

  const returnedAmount = Number(parsed.amount);
  if (!Number.isFinite(returnedAmount) || Math.abs(returnedAmount - payment.expectedAmount) > 0.01) {
    await paymentRef.update({ status: "failed", updatedAt: FieldValue.serverTimestamp() });
    return { ok: false, code: "AMOUNT_MISMATCH" };
  }

  await paymentRef.update({
    status: "paid",
    hypTransactionId: parsed.id || payment.hypTransactionId || null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await activateMember(db, {
    memberId: payment.memberId,
    source: "card",
    paymentId,
    paidAmountMinor: toMinor(returnedAmount),
    actor: input.actor,
    consentTerms: input.consentTerms,
    consentMarketing: input.consentMarketing,
  });

  loyaltyLog("enroll.pay.verified", { memberId: payment.memberId });
  return { ok: true, memberId: payment.memberId, alreadyActive: false };
}
