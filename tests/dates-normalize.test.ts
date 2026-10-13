import { describe, expect, it } from "vitest";
import { parseDateOnlyParts, toDateOnly, toIsoTimestamp, toJsDate } from "@/lib/dates/normalize";
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
