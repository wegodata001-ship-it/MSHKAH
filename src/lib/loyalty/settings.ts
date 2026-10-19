import {
  DEFAULT_LOYALTY_SETTINGS,
  type LoyaltyRoundingMode,
  type LoyaltySettings,
} from "@/lib/loyalty/types";

/** Boolean coercion that treats missing values as the safe default. */
function toBool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Non-negative integer coercion (rejects NaN, Infinity, negatives). */
function toNonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function toRoundingMode(value: unknown, fallback: LoyaltyRoundingMode): LoyaltyRoundingMode {
  return value === "nearest" ? "nearest" : value === "down" ? "down" : fallback;
}

/**
 * Merge a Firestore document (or partial admin patch) with the defaults.
 *
 * Guarantees:
 * - If the document is `undefined` we fall back entirely to defaults.
 * - Negative / non-numeric values never persist (they fall back to the default).
 * - Booleans never become `undefined`; the earn/redeem/enroll triplet always resolves.
 */
export function parseLoyaltySettings(
  data: Partial<LoyaltySettings> | Record<string, unknown> | undefined
): LoyaltySettings {
  if (!data) return { ...DEFAULT_LOYALTY_SETTINGS };
  const d = data as Record<string, unknown>;
  const pointValueMinor = toNonNegativeInt(d.pointValueMinor, DEFAULT_LOYALTY_SETTINGS.pointValueMinor);
  const pointValueApproved = toBool(d.pointValueApproved, DEFAULT_LOYALTY_SETTINGS.pointValueApproved);
  const redemptionEnabledRaw = toBool(d.redemptionEnabled, DEFAULT_LOYALTY_SETTINGS.redemptionEnabled);
  // Guardrail: redemption cannot be ON when point value is 0 or not approved
  // (per spec: "אל תפעיל מימוש הנחות עד שהוגדר ואושר שווי הנקודות").
  const redemptionEnabled =
    redemptionEnabledRaw && pointValueMinor > 0 && pointValueApproved;
  return {
    enrollmentEnabled: toBool(d.enrollmentEnabled, DEFAULT_LOYALTY_SETTINGS.enrollmentEnabled),
    earnEnabled: toBool(d.earnEnabled, DEFAULT_LOYALTY_SETTINGS.earnEnabled),
    redemptionEnabled,
    joinFeeMinor: toNonNegativeInt(d.joinFeeMinor, DEFAULT_LOYALTY_SETTINGS.joinFeeMinor),
    earnPointsPer100: toNonNegativeInt(d.earnPointsPer100, DEFAULT_LOYALTY_SETTINGS.earnPointsPer100),
    pointValueMinor,
    redemptionMinPoints: toNonNegativeInt(d.redemptionMinPoints, DEFAULT_LOYALTY_SETTINGS.redemptionMinPoints),
    redemptionMaxPoints: toNonNegativeInt(d.redemptionMaxPoints, DEFAULT_LOYALTY_SETTINGS.redemptionMaxPoints),
    roundingMode: toRoundingMode(d.roundingMode, DEFAULT_LOYALTY_SETTINGS.roundingMode),
    pointValueApproved,
    termsHe: typeof d.termsHe === "string" ? d.termsHe : "",
    termsAr: typeof d.termsAr === "string" ? d.termsAr : "",
    termsEn: typeof d.termsEn === "string" ? d.termsEn : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : undefined,
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : undefined,
  };
}

/**
 * Describe which capabilities are currently paused.
 * Used by the admin UI to render the "which options are stopped" summary.
 */
export function pausedCapabilities(settings: LoyaltySettings): Array<"enrollment" | "earn" | "redemption"> {
  const stopped: Array<"enrollment" | "earn" | "redemption"> = [];
  if (!settings.enrollmentEnabled) stopped.push("enrollment");
  if (!settings.earnEnabled) stopped.push("earn");
  if (!settings.redemptionEnabled) stopped.push("redemption");
  return stopped;
}

/** Returns true when redemption is ready to be enabled (value approved + >0). */
export function isRedemptionConfigured(settings: Pick<LoyaltySettings, "pointValueMinor" | "pointValueApproved">): boolean {
  return settings.pointValueMinor > 0 && settings.pointValueApproved;
}
