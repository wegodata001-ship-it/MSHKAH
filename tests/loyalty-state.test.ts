import { describe, it, expect } from "vitest";
import {
  canApplyAction,
  canEarn,
  canRedeem,
  deriveMemberNumber,
  nextStatusFor,
} from "@/lib/loyalty/state";
import {
  hashCode,
  hashEmail,
  hashesEqual,
  normaliseEmail,
  tokenState,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
} from "@/lib/loyalty/tokens";

describe("membership state machine", () => {
  it("email_verified → awaiting_payment via start_payment", () => {
    expect(canApplyAction("email_verified", "start_payment")).toBe(true);
    expect(nextStatusFor("email_verified", "start_payment")).toBe("awaiting_payment");
  });

  it("awaiting_payment → active via activate_card or activate_cash", () => {
    expect(nextStatusFor("awaiting_payment", "activate_card")).toBe("active");
    expect(nextStatusFor("awaiting_payment", "activate_cash")).toBe("active");
  });

  it("email_verified can short-circuit to active via activate_cash (admin flow)", () => {
    expect(canApplyAction("email_verified", "activate_cash")).toBe(true);
  });

  it("suspended members cannot earn or redeem", () => {
    expect(canApplyAction("suspended", "suspend")).toBe(false);
    expect(canApplyAction("suspended", "resume")).toBe(true);
    expect(canEarn({ status: "suspended" }, { earnEnabled: true })).toBe(false);
  });

  it("earn gate requires BOTH an active member AND the global flag on", () => {
    expect(canEarn({ status: "active" }, { earnEnabled: true })).toBe(true);
    expect(canEarn({ status: "active" }, { earnEnabled: false })).toBe(false);
    expect(canEarn(null, { earnEnabled: true })).toBe(false);
  });

  it("redeem gate requires active + flag + balance > 0", () => {
    expect(
      canRedeem({ status: "active", balancePoints: 5 }, { redemptionEnabled: true })
    ).toBe(true);
    expect(
      canRedeem({ status: "active", balancePoints: 0 }, { redemptionEnabled: true })
    ).toBe(false);
    expect(
      canRedeem({ status: "active", balancePoints: 5 }, { redemptionEnabled: false })
    ).toBe(false);
  });

  it("deriveMemberNumber is deterministic and stable in length", () => {
    const n1 = deriveMemberNumber({ id: "abcd1234", createdAtMs: 1_700_000_000_000 });
    const n2 = deriveMemberNumber({ id: "abcd1234", createdAtMs: 1_700_000_000_000 });
    expect(n1).toBe(n2);
    expect(n1).toMatch(/^M-\d{4}-[A-Z0-9]{4}$/);
  });
});

describe("verification tokens", () => {
  it("normaliseEmail is case- and whitespace-insensitive", () => {
    expect(normaliseEmail("  FOO@BAR.com  ")).toBe("foo@bar.com");
  });

  it("hashEmail returns a 64-hex sha256 digest", () => {
    const h = hashEmail("Foo@Bar.com");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // Case-insensitive: same hash for different casings
    expect(hashEmail("foo@bar.com")).toBe(h);
  });

  it("hashCode binds the code to an email so a stolen row can't be replayed", () => {
    const eA = hashEmail("a@b.com");
    const eB = hashEmail("b@b.com");
    expect(hashCode("123456", eA)).not.toBe(hashCode("123456", eB));
  });

  it("hashesEqual is constant-time friendly and rejects empty inputs", () => {
    expect(hashesEqual("abc", "abc")).toBe(true);
    expect(hashesEqual("abc", "xyz")).toBe(false);
    expect(hashesEqual("", "abc")).toBe(false);
    expect(hashesEqual("ab", "abc")).toBe(false);
  });

  it("tokenState: active while fresh, expired past TTL, throttled past attempt cap", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const future = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();
    const past = new Date(now.getTime() - 60_000).toISOString();

    expect(
      tokenState({ status: "active", attempts: 0, expiresAt: future, now })
    ).toBe("active");

    expect(
      tokenState({ status: "active", attempts: MAX_ATTEMPTS, expiresAt: future, now })
    ).toBe("throttled");

    expect(
      tokenState({ status: "active", attempts: 0, expiresAt: past, now })
    ).toBe("expired");

    expect(
      tokenState({ status: "used", attempts: 0, expiresAt: future, now })
    ).toBe("used");
  });
});
