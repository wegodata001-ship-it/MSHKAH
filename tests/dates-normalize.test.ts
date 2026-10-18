import { describe, expect, it } from "vitest";
import { firstBusinessDate, parseDateOnlyParts, toBusinessDate, toDateOnly, toIsoTimestamp, toJsDate } from "@/lib/dates/normalize";
import { orderBusinessDate } from "@/lib/breakeven/compute";
import { timestampToIso } from "@/types/firestore";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";

describe("date normalization", () => {
  it("reads Israeli invoice dates without inventing today", () => {
    expect(parseDateOnlyParts("05/10/2026")).toBe("2026-10-05");
    expect(toDateOnly("05/10/2026")).toBe("2026-10-05");
    expect(toDateOnly("05.10.2026")).toBe("2026-10-05");
    expect(toDateOnly("2026-10-05")).toBe("2026-10-05");
    expect(toDateOnly("2026-10-05T14:30:00.000Z")).toBe("2026-10-05");
    expect(toDateOnly({ value: "05/10/2026", confidence: 0.9 })).toBe("2026-10-05");
    expect(toDateOnly({ year: 2026, month: 10, day: 5 })).toBe("2026-10-05");
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly("")).toBeNull();
    expect(toDateOnly("not-a-date")).toBeNull();
    expect(toDateOnly("32/13/2026")).toBeNull();
    expect(toDateOnly("2026/10/05")).toBe("2026-10-05");
    expect(toDateOnly("05/10/26")).toBe("2026-10-05");
    expect(toDateOnly("תאריך: 05/10/2026")).toBe("2026-10-05");
  });

  it("calls toDate only when it is a function and never crashes on ISO strings", () => {
    expect(toJsDate("2026-10-05T12:00:00.000Z")?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(timestampToIso("2026-10-12T08:00:00.000Z")).toBe("2026-10-12T08:00:00.000Z");
    expect(timestampToIso({ toDate: 12 })).toBe(new Date(0).toISOString());
    expect(
      timestampToIso({
        toDate: () => new Date("2026-10-05T00:00:00.000Z"),
      })
    ).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoTimestamp(undefined)).toBeNull();
    expect(toIsoTimestamp("")).toBeNull();
  });
});

describe("business dates for orders and Z overlap", () => {
  const firestoreTimestamp = {
    toDate: () => new Date("2026-10-17T21:30:00.000Z"),
    seconds: Math.floor(Date.parse("2026-10-17T21:30:00.000Z") / 1000),
    nanoseconds: 0,
  };

  it("does not treat Firestore Timestamp as a string and never invents today or 1970", () => {
    expect(String(firestoreTimestamp).slice(0, 10)).toBe("[object Ob");
    expect(toBusinessDate(firestoreTimestamp)).toBe("2026-10-18");
    expect(orderBusinessDate({ paidAt: firestoreTimestamp, createdAt: "2026-10-01" })).toBe("2026-10-18");
    expect(orderBusinessDate({ createdAt: { _seconds: firestoreTimestamp.seconds, _nanoseconds: 0 } })).toBe("2026-10-18");
    expect(orderBusinessDate({ createdAt: new Date("2026-10-17T20:30:00.000Z") })).toBe("2026-10-17");
    expect(orderBusinessDate({ paidAt: "not-a-date", completedAt: "2026-10-05", createdAt: firestoreTimestamp })).toBe("2026-10-05");
    expect(orderBusinessDate({ paidAt: null, completedAt: undefined, createdAt: "" })).toBeNull();
    expect(orderBusinessDate({ createdAt: { seconds: 0, nanoseconds: 0 } })).toBeNull();
    expect(orderBusinessDate({ createdAt: new Date(0) })).toBeNull();
    expect(firstBusinessDate([undefined, null, {}, "bad"])).toBeNull();
    expect(toBusinessDate("2026-10-17")).toBe("2026-10-17");
    expect(toBusinessDate("17/10/2026")).toBe("2026-10-17");
  });
});

describe("firestore sanitize", () => {
  it("drops undefined and NaN but keeps zero and null", () => {
    const cleaned = sanitizeFirestoreData({
      net: 0,
      vat: null,
      missing: undefined,
      bad: Number.NaN,
      lines: [{ qty: 0, price: undefined, total: Number.NaN, name: "x" }],
    });
    expect(cleaned).toEqual({
      net: 0,
      vat: null,
      lines: [{ qty: 0, name: "x" }],
    });
  });
});
