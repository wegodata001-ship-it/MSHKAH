import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAdminDb } from "@/lib/firebase/admin";
import { readClubSession, CLUB_COOKIE_NAME } from "@/lib/loyalty/session";
import { readLoyaltySettings } from "@/lib/loyalty/admin/members";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  ClubPaymentError,
  startClubJoinPayment,
} from "@/lib/loyalty/admin/payments";

export const runtime = "nodejs";

/**
 * Start the HYP payment page for the join fee. Requires a verified-email
 * session (set by `/api/club/enroll/verify`).
 */
export async function POST(request: NextRequest) {
  const jar = await cookies();
  const session = readClubSession(jar.get(CLUB_COOKIE_NAME)?.value);
  if (!session) {
    return Response.json({ error: "SESSION_REQUIRED", code: "SESSION_REQUIRED" }, { status: 401 });
  }
  const db = getAdminDb();
  const settings = await readLoyaltySettings(db);
  if (!settings.enrollmentEnabled) {
    return Response.json({ error: "ENROLLMENT_DISABLED", code: "ENROLLMENT_DISABLED" }, { status: 409 });
  }
  const memberSnap = await db
    .collection(COLLECTIONS.loyaltyMembers)
    .where("emailHash", "==", session.emailHash)
    .limit(1)
    .get();
  const doc = memberSnap.docs[0];
  if (!doc) {
    return Response.json({ error: "MEMBER_NOT_FOUND", code: "MEMBER_NOT_FOUND" }, { status: 404 });
  }
  const member = doc.data() as {
    id: string;
    status: string;
    email: string;
    memberNumber: string;
    displayName?: string;
    phone?: string;
  };
  if (member.status === "active") {
    return Response.json({ error: "ALREADY_ACTIVE", code: "ALREADY_ACTIVE" }, { status: 409 });
  }
  try {
    const result = await startClubJoinPayment(db, {
      memberId: doc.id,
      email: member.email,
      memberNumber: member.memberNumber,
      name: member.displayName,
      phone: member.phone,
    });
    return Response.json({ ok: true, paymentUrl: result.paymentUrl });
  } catch (error) {
    if (error instanceof ClubPaymentError) {
      return Response.json({ error: error.code, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "PAY_FAILED";
    return Response.json({ error: message, code: "PAY_FAILED" }, { status: 500 });
  }
}
