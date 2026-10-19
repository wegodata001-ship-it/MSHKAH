import type { LoyaltyMember, LoyaltyMemberStatus } from "@/lib/loyalty/types";

/**
 * Pure helpers that encode the allowed membership transitions.
 *
 * Keeping these pure means the API handlers that mutate Firestore can be
 * covered by tests without a live Firestore. The actual writes still happen
 * in `src/lib/loyalty/admin/members.ts` inside a Firestore transaction.
 */

export type MembershipAction =
  | "verify_email"
  | "start_payment"
  | "activate_card"
  | "activate_cash"
  | "suspend"
  | "resume";

const ALLOWED: Record<LoyaltyMemberStatus, MembershipAction[]> = {
  email_verified: ["start_payment", "activate_cash"],
  awaiting_payment: ["activate_card", "activate_cash"],
  active: ["suspend"],
  suspended: ["resume"],
};

/**
 * Decide whether a member in `status` is allowed to perform `action`.
 *
 * Returning booleans (rather than throwing) lets the API routes answer with a
 * proper HTTP code and lets the UI preview the allowed button.
 */
export function canApplyAction(status: LoyaltyMemberStatus, action: MembershipAction): boolean {
  return ALLOWED[status].includes(action);
}

export function nextStatusFor(
  status: LoyaltyMemberStatus,
  action: MembershipAction
): LoyaltyMemberStatus | null {
  if (!canApplyAction(status, action)) return null;
  switch (action) {
    case "verify_email":
      return "email_verified";
    case "start_payment":
      return "awaiting_payment";
    case "activate_card":
    case "activate_cash":
      return "active";
    case "suspend":
      return "suspended";
    case "resume":
      return "active";
  }
}

/**
 * Point-earning is only allowed while a member is `active` **and** the club's
 * `earnEnabled` flag is on. We factor it out so the pipeline hook and tests
 * agree on the gate.
 */
export function canEarn(
  member: Pick<LoyaltyMember, "status"> | null,
  settings: { earnEnabled: boolean }
): boolean {
  if (!settings.earnEnabled) return false;
  if (!member) return false;
  return member.status === "active";
}

/**
 * Mirror for the redemption gate — the UI reuses it to hide the redeem UI,
 * the API reuses it to refuse a redemption request.
 */
export function canRedeem(
  member: Pick<LoyaltyMember, "status" | "balancePoints"> | null,
  settings: { redemptionEnabled: boolean }
): boolean {
  if (!settings.redemptionEnabled) return false;
  if (!member) return false;
  if (member.status !== "active") return false;
  return member.balancePoints > 0;
}

/**
 * Produce the short, human-readable member number embedded on the card.
 * Deterministic in `createdAt + id` so a retry does not produce a new number.
 */
export function deriveMemberNumber(input: { id: string; createdAtMs: number }): string {
  // 4-digit prefix from createdAt (so numbers roughly monotonically increase)
  // and the last 4 of the id. Zero-padded to keep width stable.
  const prefix = Math.floor(input.createdAtMs / 1000) % 10000;
  const suffix = input.id.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase().padStart(4, "0");
  return `M-${prefix.toString().padStart(4, "0")}-${suffix}`;
}
