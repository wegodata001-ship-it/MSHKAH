import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOYALTY_SETTINGS,
  type LoyaltySettings,
} from "@/lib/loyalty/types";
import {
  isRedemptionConfigured,
  parseLoyaltySettings,
  pausedCapabilities,
} from "@/lib/loyalty/settings";

describe("parseLoyaltySettings", () => {
  it("falls back entirely to defaults for an undefined document", () => {
    const parsed = parseLoyaltySettings(undefined);
    expect(parsed).toEqual(DEFAULT_LOYALTY_SETTINGS);
  });

  it("coerces missing fields to their defaults", () => {
    const parsed = parseLoyaltySettings({ joinFeeMinor: 2500 });
    expect(parsed.joinFeeMinor).toBe(2500);
    expect(parsed.earnPointsPer100).toBe(DEFAULT_LOYALTY_SETTINGS.earnPointsPer100);
    expect(parsed.enrollmentEnabled).toBe(DEFAULT_LOYALTY_SETTINGS.enrollmentEnabled);
  });

  it("rejects negative numbers and NaN by falling back to the default", () => {
    const parsed = parseLoyaltySettings({ joinFeeMinor: -500, earnPointsPer100: Number.NaN });
    expect(parsed.joinFeeMinor).toBe(DEFAULT_LOYALTY_SETTINGS.joinFeeMinor);
    expect(parsed.earnPointsPer100).toBe(DEFAULT_LOYALTY_SETTINGS.earnPointsPer100);
  });

  it("locks redemption OFF until point value is set AND approved", () => {
    const neverApproved = parseLoyaltySettings({
      redemptionEnabled: true,
      pointValueMinor: 100,
      pointValueApproved: false,
    });
    expect(neverApproved.redemptionEnabled).toBe(false);

    const zeroValue = parseLoyaltySettings({
      redemptionEnabled: true,
      pointValueMinor: 0,
      pointValueApproved: true,
    });
    expect(zeroValue.redemptionEnabled).toBe(false);

    const ready = parseLoyaltySettings({
      redemptionEnabled: true,
      pointValueMinor: 100,
      pointValueApproved: true,
    });
    expect(ready.redemptionEnabled).toBe(true);
  });

  it("accepts only the known rounding modes", () => {
    expect(parseLoyaltySettings({ roundingMode: "nearest" as const }).roundingMode).toBe("nearest");
    expect(parseLoyaltySettings({ roundingMode: "down" as const }).roundingMode).toBe("down");
    // Unknown value falls back
    expect(
      parseLoyaltySettings({ roundingMode: "weird" as unknown as "down" }).roundingMode
    ).toBe(DEFAULT_LOYALTY_SETTINGS.roundingMode);
  });
});

describe("pausedCapabilities & isRedemptionConfigured", () => {
  it("lists all three when the club is off", () => {
    expect(pausedCapabilities(DEFAULT_LOYALTY_SETTINGS)).toEqual([
      "enrollment",
      "earn",
      "redemption",
    ]);
  });

  it("lists only the ones currently off", () => {
    const settings: LoyaltySettings = {
      ...DEFAULT_LOYALTY_SETTINGS,
      enrollmentEnabled: true,
      earnEnabled: true,
    };
    expect(pausedCapabilities(settings)).toEqual(["redemption"]);
  });

  it("isRedemptionConfigured requires BOTH value > 0 and approved", () => {
    expect(isRedemptionConfigured({ pointValueMinor: 100, pointValueApproved: false })).toBe(false);
    expect(isRedemptionConfigured({ pointValueMinor: 0, pointValueApproved: true })).toBe(false);
    expect(isRedemptionConfigured({ pointValueMinor: 100, pointValueApproved: true })).toBe(true);
  });
});
