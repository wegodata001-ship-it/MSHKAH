import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  readLoyaltySettings,
  readMemberByEmail,
  upsertVerifiedMember,
  verifyEnrollmentCode,
} from "@/lib/loyalty/admin/members";
import { signClubSession } from "@/lib/loyalty/session";
import { loyaltyLog } from "@/lib/loyalty/admin/log";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { hashEmail } from "@/lib/loyalty/tokens";

export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_REGEX = /^\d{6}$/;

/**
 * Verify the one-time code and open a signed session cookie.
 *
 * Error shape:
 *   { ok: false, reason: "mismatch" | "expired" | "throttled" | "used" | "no_token" }
 * We never reveal whether an email is registered; "no_token" is returned the
 * same way as "mismatch" to the UI.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    code?: string;
    displayName?: string;
    phone?: string;
  } | null;
  const email = body?.email?.trim();
  const code = body?.code?.trim();
  if (!email || !EMAIL_REGEX.test(email) || !code || !CODE_REGEX.test(code)) {
    return Response.json({ ok: false, reason: "mismatch" }, { status: 400 });
  }
  const db = getAdminDb();
  const settings = await readLoyaltySettings(db);
  if (!settings.enrollmentEnabled) {
    return Response.json({ ok: false, reason: "enrollment_disabled" }, { status: 409 });
  }
  const emailHash = hashEmail(email);
  const bucket = await consumeRateLimit(db, {
    key: rateLimitKey(["enroll-verify", emailHash]),
    windowSeconds: 600,
    limit: 10,
  });
  if (!bucket.ok) {
    return Response.json({ ok: false, reason: "throttled" }, { status: 429 });
  }

  const result = await verifyEnrollmentCode(db, { email, codePlain: code });
  if (!result.ok) {
    loyaltyLog("enroll.verify.fail", { email, reason: result.reason });
    return Response.json({ ok: false, reason: result.reason }, { status: 400 });
  }

  const existing = await readMemberByEmail(db, email);
  const member = existing
    ? existing
    : await upsertVerifiedMember(db, {
        email,
        displayName: body?.displayName?.slice(0, 80),
        phone: body?.phone?.slice(0, 40),
      });

  const session = signClubSession({ emailHash: result.emailHash });
  const jar = await cookies();
  jar.set({
    name: session.cookieName,
    value: session.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAgeSeconds,
  });
  loyaltyLog("enroll.verify.ok", { email, memberId: member.id });
  return Response.json({
    ok: true,
    member: {
      id: member.id,
      memberNumber: member.memberNumber,
      status: member.status,
      balancePoints: member.balancePoints,
    },
    joinFeeMinor: settings.joinFeeMinor,
    expiresAt: session.expiresAt,
  });
}
