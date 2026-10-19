import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { completeClubJoinPayment } from "@/lib/loyalty/admin/payments";
import { renderClubWelcomeEmail } from "@/lib/email/loyalty-templates";
import { sendMishkahEmail } from "@/lib/email/send";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { readLoyaltySettings, setWelcomeEmailStatus } from "@/lib/loyalty/admin/members";
import { fromMinor } from "@/lib/loyalty/points-math";
import { getPublicSiteUrl } from "@/lib/email/config";
import type { LoyaltyMember } from "@/lib/loyalty/types";
import { loyaltyLog } from "@/lib/loyalty/admin/log";

export const runtime = "nodejs";

/**
 * HYP returns here. We VERIFY the redirect server-side, activate the
 * membership atomically, then kick off the welcome email (idempotent via
 * the member's `welcomeEmailStatus` flag; a failed email never undoes
 * the paid membership).
 */
async function handle(url: URL): Promise<Response> {
  const rawQuery = url.searchParams.toString();
  const db = getAdminDb();
  const result = await completeClubJoinPayment(db, {
    rawQuery,
    consentTerms: true,
    consentMarketing: false,
  });
  if (!result.ok) {
    return Response.redirect(
      new URL(`/club/activate?status=${encodeURIComponent(result.code.toLowerCase())}`, url),
      302
    );
  }

  if (!result.alreadyActive) {
    void sendWelcomeEmail(db, result.memberId);
  }
  return Response.redirect(new URL(`/club/me?welcome=1`, url), 302);
}

export async function GET(request: NextRequest) {
  return handle(new URL(request.url));
}
export async function POST(request: NextRequest) {
  return handle(new URL(request.url));
}

async function sendWelcomeEmail(
  db: FirebaseFirestore.Firestore,
  memberId: string
): Promise<void> {
  try {
    const memberSnap = await db.collection(COLLECTIONS.loyaltyMembers).doc(memberId).get();
    if (!memberSnap.exists) return;
    const member = { id: memberId, ...(memberSnap.data() as Omit<LoyaltyMember, "id">) };
    if (member.welcomeEmailStatus === "sent") return;
    const settings = await readLoyaltySettings(db);
    const content = renderClubWelcomeEmail({
      memberNumber: member.memberNumber,
      earnPointsPer100: settings.earnPointsPer100,
      joinFeeIls: fromMinor(member.joinFeePaidMinor || settings.joinFeeMinor),
      accountUrl: `${getPublicSiteUrl()}/club/me`,
      showMarketingConsent: !member.consentMarketing,
    });
    const email = await sendMishkahEmail({
      to: member.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      kind: "loyalty_welcome",
    });
    await setWelcomeEmailStatus(db, memberId, email.ok ? "sent" : "failed");
    loyaltyLog(email.ok ? "email.welcome.sent" : "email.welcome.failed", {
      memberId,
    });
  } catch (error) {
    console.error("[loyalty] welcome email dispatch failed", {
      memberId,
      message: error instanceof Error ? error.message : "unknown",
    });
    await setWelcomeEmailStatus(db, memberId, "failed").catch(() => undefined);
  }
}
