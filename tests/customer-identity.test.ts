import { describe, expect, it } from "vitest";
import { groupOrderIdentities, isPlaceholderName, matchExistingCustomer, phoneKey } from "@/lib/customers/identity";

describe("customer identity from orders", () => {
  it("normalizes Israeli country codes", () => {
    expect(phoneKey("+972-52-123-4567")).toBe("0521234567");
  });

  it("keeps people apart when they share one phone number", () => {
    const shared = "0500000000";
    const orders = Array.from({ length: 14 }, (_, index) => ({
      id: `o${index}`,
      name: `לקוח ${index}`,
      phone: shared,
      total: 10,
    }));
    const groups = groupOrderIdentities(orders);
    expect(groups).toHaveLength(14);
    expect(groups.every((group) => group.phoneKey === "0500000000")).toBe(true);
  });

  it("merges the same person when the phone belongs to one name", () => {
    const groups = groupOrderIdentities([
      { id: "a", name: "נועה כהן", phone: "0521111111", total: 20, productNames: ["קפה"] },
      { id: "b", name: "נועה כהן", phone: "052-111-1111", total: 15.5, productNames: ["קפה"] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ordersCount).toBe(2);
    expect(groups[0]?.totalSpending).toBe(35.5);
    expect(groups[0]?.orderIds).toEqual(["a", "b"]);
  });

  it("does not turn Guest Customer into a customer row", () => {
    expect(isPlaceholderName("Guest Customer")).toBe(true);
    const groups = groupOrderIdentities([
      { id: "g", name: "Guest Customer", phone: "0500000000", total: 99 },
      { id: "r", name: "طحين", phone: "", total: 12 },
    ]);
    expect(groups.map((group) => group.name)).toEqual(["طحين"]);
  });

  it("reuses an existing real customer and ignores the guest profile", () => {
    const [group] = groupOrderIdentities([{ id: "a", name: "מיכל", phone: "0541234567", total: 8 }]);
    const used = new Set<string>();
    const id = matchExistingCustomer(group!, [
      { id: "guest-checkout", name: "Guest Customer", phone: "0541234567" },
      { id: "real", name: "מיכל", phone: "054-1234567" },
    ], used);
    expect(id).toBe("real");
  });
});
