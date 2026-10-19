import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { sendMishkahEmail } from "@/lib/email/send";
import { renderClubWelcomeEmail } from "@/lib/email/loyalty-templates";
import { readLoyaltySettings } from "@/lib/loyalty/admin/members";
import { fromMinor } from "@/lib/loyalty/points-math";
import { getPublicSiteUrl } from "@/lib/email/config";

export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Preview the welcome email by sending a copy to an admin-provided address.
 * The spec is explicit: a template test MUST NOT create a membership, charge,
 * or ledger entry. We only call `sendMishkahEmail` here.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { to?: string } | null;
  const to = body?.to?.trim();
  if (!to || !EMAIL_REGEX.test(to)) {
    return Response.json({ error: "INVALID_EMAIL", code: "INVALID_EMAIL" }, { status: 400 });
  }
  const settings = await readLoyaltySettings(getAdminDb());
  const content = renderClubWelcomeEmail({
    memberNumber: "M-0000-TEST",
    earnPointsPer100: settings.earnPointsPer100,
    joinFeeIls: fromMinor(settings.joinFeeMinor),
    accountUrl: `${getPublicSiteUrl()}/club/me`,
    showMarketingConsent: true,
  });
  const result = await sendMishkahEmail({
    to,
    subject: `[בדיקה] ${content.subject}`,
    html: content.html,
    text: content.text,
    kind: "test",
  });
  if (!result.ok) {
    return Response.json({ error: result.error ?? "EMAIL_FAILED", code: "EMAIL_FAILED" }, { status: 502 });
  }
  return Response.json({ ok: true, messageId: result.messageId });
}
