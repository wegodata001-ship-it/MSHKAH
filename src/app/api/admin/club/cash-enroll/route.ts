import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  activateMember,
  readLoyaltySettings,
  readMemberByEmail,
  upsertVerifiedMember,
} from "@/lib/loyalty/admin/members";
import { toMinor } from "@/lib/loyalty/points-math";
import { loyaltyLog } from "@/lib/loyalty/admin/log";

export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin-only: register a cash enrollment. Captures amount, actor, and
 * timestamp — all three are written to the ledger activation record.
 *
 * Idempotent: a second call for the same email just returns the active
 * member (via `activateMember`'s short-circuit).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    displayName?: string;
    phone?: string;
    paidAmountIls?: number;
    consentTerms?: boolean;
    consentMarketing?: boolean;
  } | null;
  const email = body?.email?.trim();
  if (!email || !EMAIL_REGEX.test(email)) {
    return Response.json({ error: "INVALID_EMAIL", code: "INVALID_EMAIL" }, { status: 400 });
  }
  if (!body?.consentTerms) {
    return Response.json({ error: "TERMS_REQUIRED", code: "TERMS_REQUIRED" }, { status: 400 });
  }
  const db = getAdminDb();
  const settings = await readLoyaltySettings(db);
  if (!settings.enrollmentEnabled) {
    return Response.json({ error: "ENROLLMENT_DISABLED", code: "ENROLLMENT_DISABLED" }, { status: 409 });
  }
  const paidMinor = toMinor(body.paidAmountIls ?? 0);
  if (paidMinor < settings.joinFeeMinor) {
    return Response.json({ error: "INSUFFICIENT_PAYMENT", code: "INSUFFICIENT_PAYMENT" }, { status: 400 });
  }
  const existing = await readMemberByEmail(db, email);
  const base = existing ?? (await upsertVerifiedMember(db, {
    email,
    displayName: body.displayName,
    phone: body.phone,
  }));
  const member = await activateMember(db, {
    memberId: base.id,
    source: "cash",
    paidAmountMinor: paidMinor,
    actor: auth.email,
    consentTerms: Boolean(body.consentTerms),
    consentMarketing: Boolean(body.consentMarketing),
  });
  loyaltyLog("enroll.cash.ok", { memberId: member.id, actor: auth.email });
  return Response.json({ ok: true, member });
}
