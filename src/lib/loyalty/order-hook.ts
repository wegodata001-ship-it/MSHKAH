import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { awardOrderPoints, readLoyaltySettings } from "@/lib/loyalty/admin/members";
import { hashEmail } from "@/lib/loyalty/tokens";
import { qualifyingAmountMinor, toMinor } from "@/lib/loyalty/points-math";
import type { FirestoreOrder } from "@/types/firestore";

/**
 * Called from the post-paid pipeline. The function:
 *   1. Opens the paid order
 *   2. Looks up the member by email
 *   3. Writes an idempotent `earn:<orderId>` ledger entry
 *   4. Updates the member balance in the same transaction (see members.ts)
 *
 * Any failure is logged and swallowed so a Brevo / email outage never
 * rolls back the payment (same contract as print and admin-email tasks).
 */
export async function awardLoyaltyPointsForOrder(
  orderId: string,
  db: Firestore = getAdminDb()
): Promise<{ ok: boolean; status: "awarded" | "skipped" | "no_member" | "disabled" | "error" }> {
  try {
    const settings = await readLoyaltySettings(db);
    if (!settings.earnEnabled) return { ok: true, status: "disabled" };

    const orderSnap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
    if (!orderSnap.exists) return { ok: true, status: "skipped" };
    const order = orderSnap.data() as FirestoreOrder & {
      customerEmail?: string | null;
      loyalty?: {
        memberId?: string | null;
        joinFeePortionMinor?: number;
        redeemedValueMinor?: number;
      } | null;
    };
    const email = order.customerEmail?.trim();
    if (!email) return { ok: true, status: "no_member" };

    const emailHash = hashEmail(email);
    const memberSnap = await db
      .collection(COLLECTIONS.loyaltyMembers)
      .where("emailHash", "==", emailHash)
      .limit(1)
      .get();
    const memberDoc = memberSnap.docs[0];
    if (!memberDoc) return { ok: true, status: "no_member" };

    const paidTotal = Number(order.total) || 0;
    const qualifying = qualifyingAmountMinor({
      paidAmountMinor: toMinor(paidTotal),
      joinFeePortionMinor: order.loyalty?.joinFeePortionMinor ?? 0,
      redeemedValueMinor: order.loyalty?.redeemedValueMinor ?? 0,
    });
    if (qualifying <= 0) return { ok: true, status: "skipped" };

    const result = await awardOrderPoints(db, {
      memberId: memberDoc.id,
      orderId,
      qualifyingAmountMinor: qualifying,
    });
    return { ok: true, status: result ? "awarded" : "skipped" };
  } catch (error) {
    console.error("[loyalty] award failed", {
      orderId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, status: "error" };
  }
}
