import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME, readClubSession } from "@/lib/loyalty/session";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { readLoyaltySettings, readMemberHistory } from "@/lib/loyalty/admin/members";
import type {
  LoyaltyMeResponse,
  LoyaltyMember,
} from "@/lib/loyalty/types";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const jar = await cookies();
  const session = readClubSession(jar.get(CLUB_COOKIE_NAME)?.value);
  const db = getAdminDb();
  const settings = await readLoyaltySettings(db);
  const publicSettings = {
    enrollmentEnabled: settings.enrollmentEnabled,
    earnEnabled: settings.earnEnabled,
    redemptionEnabled: settings.redemptionEnabled,
    joinFeeMinor: settings.joinFeeMinor,
    earnPointsPer100: settings.earnPointsPer100,
    pointValueMinor: settings.pointValueMinor,
    redemptionMinPoints: settings.redemptionMinPoints,
    redemptionMaxPoints: settings.redemptionMaxPoints,
    pointValueApproved: settings.pointValueApproved,
    termsHe: settings.termsHe,
    termsAr: settings.termsAr,
    termsEn: settings.termsEn,
  };
  if (!session) {
    const response: LoyaltyMeResponse = { member: null, settings: publicSettings, history: [] };
    return Response.json(response);
  }
  const snap = await db
    .collection(COLLECTIONS.loyaltyMembers)
    .where("emailHash", "==", session.emailHash)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc) {
    const response: LoyaltyMeResponse = { member: null, settings: publicSettings, history: [] };
    return Response.json(response);
  }
  const member = { id: doc.id, ...(doc.data() as Omit<LoyaltyMember, "id">) };
  const history = await readMemberHistory(db, member.id, 30);
  const response: LoyaltyMeResponse = {
    member: {
      id: member.id,
      memberNumber: member.memberNumber,
      displayName: member.displayName,
      email: member.email,
      status: member.status,
      balancePoints: member.balancePoints,
      joinedAt: member.activatedAt,
    },
    settings: publicSettings,
    history: history.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      points: entry.points,
      source: entry.source,
      reason: entry.reason,
      orderId: entry.orderId,
      createdAt: entry.createdAt,
    })),
  };
  return Response.json(response);
}
