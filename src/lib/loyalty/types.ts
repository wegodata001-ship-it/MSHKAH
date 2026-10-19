/**
 * Loyalty-club domain types.
 *
 * The club has three independent capabilities (per spec, section 1):
 *   - enrollment is open or closed
 *   - points earning is on or off
 *   - points redemption is on or off
 *
 * They are three separate booleans so the admin can pause one lane without
 * affecting the others, and so turning the whole club off never deletes
 * any member or balance.
 */

export type LoyaltyRoundingMode = "down" | "nearest";

export interface LoyaltySettings {
  /** New sign-ups accepted. Existing members are unaffected when `false`. */
  enrollmentEnabled: boolean;
  /** Paid orders award points when `true`. Membership keeps balance either way. */
  earnEnabled: boolean;
  /** Members can spend points on new orders when `true`. */
  redemptionEnabled: boolean;
  /** One-time join fee, in minor currency units (agorot/ils cents). */
  joinFeeMinor: number;
  /** Points awarded per 100 ILS (minor units) of qualifying spend. */
  earnPointsPer100: number;
  /** Discount value of 1 point, in minor units. 0 ⇒ redemption not yet configured. */
  pointValueMinor: number;
  /** Minimum points per single redemption; 0 means no minimum. */
  redemptionMinPoints: number;
  /** Maximum points per single redemption; 0 means no maximum. */
  redemptionMaxPoints: number;
  /** Rounding policy applied once per order; defaults to `"down"` so points can only
   *  be awarded, never fabricated. */
  roundingMode: LoyaltyRoundingMode;
  /** Hebrew/Arabic/English terms shown on the join card. */
  termsHe?: string;
  termsAr?: string;
  termsEn?: string;
  /** Admin flag: redemption remains locked until an admin confirms the point value. */
  pointValueApproved: boolean;
  /** ISO timestamp of the last update, for the audit footer. */
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enrollmentEnabled: false,
  earnEnabled: false,
  redemptionEnabled: false,
  joinFeeMinor: 2000, // 20 ILS
  earnPointsPer100: 10,
  pointValueMinor: 0,
  redemptionMinPoints: 0,
  redemptionMaxPoints: 0,
  roundingMode: "down",
  pointValueApproved: false,
  termsHe: "",
  termsAr: "",
  termsEn: "",
};

// ──────────────────────────────────────────────────────────────────────
// Member
// ──────────────────────────────────────────────────────────────────────

/**
 * Membership lifecycle:
 *   none              — no record for this email
 *   email_verified    — code sent + confirmed, but payment pending
 *   awaiting_payment  — HYP attempt created, waiting for VERIFY callback
 *   active            — paid (card or manual cash) and welcome email queued
 *   suspended         — admin suspended; balance frozen, no earn/redeem
 */
export type LoyaltyMemberStatus =
  | "email_verified"
  | "awaiting_payment"
  | "active"
  | "suspended";

export interface LoyaltyMember {
  id: string;
  memberNumber: string;
  email: string;
  emailHash: string;
  displayName?: string;
  phone?: string;
  status: LoyaltyMemberStatus;
  balancePoints: number;
  joinFeePaidMinor: number;
  joinFeeSource?: "card" | "cash";
  joinFeePaymentId?: string;
  joinFeePaidAt?: string;
  activatedAt?: string;
  consentTerms: boolean;
  consentMarketing: boolean;
  welcomeEmailStatus?: "sent" | "failed" | "pending";
  welcomeEmailAttemptAt?: string;
  linkedCustomerId?: string;
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Ledger
// ──────────────────────────────────────────────────────────────────────

export type LoyaltyLedgerKind =
  | "earn"
  | "redeem"
  | "refund"
  | "adjustment"
  | "welcome";

export type LoyaltyLedgerSource =
  | "order"
  | "admin"
  | "enrollment"
  | "import";

export interface LoyaltyLedgerEntry {
  id: string;
  memberId: string;
  kind: LoyaltyLedgerKind;
  points: number;
  source: LoyaltyLedgerSource;
  orderId?: string;
  qualifyingAmountMinor?: number;
  pointValueMinorAtTime?: number;
  reason?: string;
  actor?: string;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Enrollment / verification tokens
// ──────────────────────────────────────────────────────────────────────

export type EnrollmentTokenStatus = "active" | "used" | "expired";

export interface LoyaltyEnrollmentToken {
  id: string;
  emailHash: string;
  codeHash: string;
  status: EnrollmentTokenStatus;
  attempts: number;
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
  usedBy?: string;
}

// ──────────────────────────────────────────────────────────────────────
// API response contracts
// ──────────────────────────────────────────────────────────────────────

/** Response returned to the storefront when it asks "who am I?". */
export interface LoyaltyMeResponse {
  member: {
    id: string;
    memberNumber: string;
    displayName?: string;
    email: string;
    status: LoyaltyMemberStatus;
    balancePoints: number;
    joinedAt?: string;
  } | null;
  // Mirrors the public bits of settings so the member card can render ratio etc.
  settings: {
    enrollmentEnabled: boolean;
    earnEnabled: boolean;
    redemptionEnabled: boolean;
    joinFeeMinor: number;
    earnPointsPer100: number;
    pointValueMinor: number;
    redemptionMinPoints: number;
    redemptionMaxPoints: number;
    pointValueApproved: boolean;
    termsHe?: string;
    termsAr?: string;
    termsEn?: string;
  };
  history: Array<{
    id: string;
    kind: LoyaltyLedgerKind;
    points: number;
    source: LoyaltyLedgerSource;
    reason?: string;
    orderId?: string;
    createdAt: string;
  }>;
}
