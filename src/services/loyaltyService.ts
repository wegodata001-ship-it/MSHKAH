"use client";

import { onSnapshot, doc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { parseLoyaltySettings } from "@/lib/loyalty/settings";
import { DEFAULT_LOYALTY_SETTINGS, type LoyaltySettings } from "@/lib/loyalty/types";
import { failure, success, type ServiceResult } from "@/lib/errors";
import type { LoyaltyMember } from "@/lib/loyalty/types";

/**
 * Client-side service for the admin UI only. The customer flows use fetch()
 * against `/api/club/*` directly because they do not require a signed-in
 * admin and should not include an admin token in the request header.
 */

export function subscribeToLoyaltySettings(
  onData: (settings: LoyaltySettings) => void
): () => void {
  const ref = doc(getDb(), COLLECTIONS.loyaltySettings, "app");
  return onSnapshot(
    ref,
    (snap) => {
      onData(parseLoyaltySettings(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined));
    },
    () => onData(DEFAULT_LOYALTY_SETTINGS)
  );
}

export async function saveLoyaltySettings(
  patch: Partial<LoyaltySettings>
): Promise<ServiceResult<LoyaltySettings>> {
  const result = await clientAdminFetch<{ settings: LoyaltySettings }>(
    "/api/admin/club/settings",
    { patch }
  );
  if (!result.ok || !result.data?.settings) {
    return failure(new Error(result.code || result.error || "LOYALTY_SETTINGS_FAILED"), result.code || "LOYALTY_SETTINGS_FAILED");
  }
  return success(parseLoyaltySettings(result.data.settings));
}

export async function sendLoyaltyTestEmail(input: {
  to: string;
}): Promise<ServiceResult<{ messageId?: string }>> {
  const result = await clientAdminFetch<{ messageId?: string }>(
    "/api/admin/club/test-email",
    input
  );
  if (!result.ok) {
    return failure(new Error(result.code || result.error || "TEST_EMAIL_FAILED"), result.code || "TEST_EMAIL_FAILED");
  }
  return success({ messageId: result.data?.messageId });
}

export async function adjustLoyaltyPoints(input: {
  memberId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
}): Promise<ServiceResult<{ newBalance: number }>> {
  const result = await clientAdminFetch<{ newBalance: number }>(
    "/api/admin/club/adjust",
    input
  );
  if (!result.ok || result.data?.newBalance == null) {
    return failure(new Error(result.code || result.error || "ADJUST_FAILED"), result.code || "ADJUST_FAILED");
  }
  return success({ newBalance: result.data.newBalance });
}

export async function registerCashEnrollment(input: {
  email: string;
  displayName?: string;
  phone?: string;
  paidAmountIls: number;
  consentTerms: boolean;
  consentMarketing: boolean;
}): Promise<ServiceResult<{ member: LoyaltyMember }>> {
  const result = await clientAdminFetch<{ member: LoyaltyMember }>(
    "/api/admin/club/cash-enroll",
    input
  );
  if (!result.ok || !result.data?.member) {
    return failure(new Error(result.code || result.error || "CASH_ENROLL_FAILED"), result.code || "CASH_ENROLL_FAILED");
  }
  return success({ member: result.data.member });
}

export async function suspendClubMember(memberId: string): Promise<ServiceResult<void>> {
  const result = await clientAdminFetch("/api/admin/club/suspend", { memberId });
  if (!result.ok) {
    return failure(new Error(result.code || result.error || "SUSPEND_FAILED"), result.code || "SUSPEND_FAILED");
  }
  return success(undefined);
}

export async function resumeClubMember(memberId: string): Promise<ServiceResult<void>> {
  const result = await clientAdminFetch("/api/admin/club/resume", { memberId });
  if (!result.ok) {
    return failure(new Error(result.code || result.error || "RESUME_FAILED"), result.code || "RESUME_FAILED");
  }
  return success(undefined);
}
