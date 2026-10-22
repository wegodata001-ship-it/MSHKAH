import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { isPlaceholderName, nameKey, phoneKey, PICKUP_ADDRESS } from "@/lib/customers/identity";

type CustomerRow = {
  id: string;
  name?: string;
  phone?: string;
  phoneKey?: string;
  email?: string;
  ordersCount?: number;
  totalSpending?: number;
};

export async function upsertCheckoutCustomer(
  db: Firestore,
  input: { name: string; phone: string; email?: string | null }
): Promise<{ customerId: string }> {
  const name = input.name.trim();
  const digits = phoneKey(input.phone);
  if (!name || isPlaceholderName(name) || digits.length < 9) {
    throw new Error("CUSTOMER_IDENTITY_INVALID");
  }
  const email = String(input.email ?? "").trim().toLowerCase();
  const snap = await db.collection(COLLECTIONS.customers).where("phoneKey", "==", digits).limit(20).get();
  const rows: CustomerRow[] = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<CustomerRow, "id">) }));
  const samePerson = rows.find((row) => row.id !== "guest-checkout" && !isPlaceholderName(row.name) && nameKey(row.name) === nameKey(name));
  if (samePerson) {
    if (email && !samePerson.email) {
      await db.collection(COLLECTIONS.customers).doc(samePerson.id).set({ email }, { merge: true });
    }
    return { customerId: samePerson.id };
  }

  const ref = db.collection(COLLECTIONS.customers).doc();
  await ref.set({
    name,
    phone: input.phone.trim(),
    phoneKey: digits,
    nameKey: nameKey(name),
    email: email && !email.endsWith("@mishkat.local") ? email : "",
    address: PICKUP_ADDRESS,
    favoriteProducts: [],
    notes: "",
    ordersCount: 0,
    totalSpending: 0,
    lastOrder: null,
    createdAt: Timestamp.now(),
  });
  return { customerId: ref.id };
}

export async function recordCustomerOrder(db: Firestore, customerId: string, orderId: string): Promise<void> {
  const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);
  const customerRef = db.collection(COLLECTIONS.customers).doc(customerId);
  await db.runTransaction(async (tx) => {
    const [orderSnap, customerSnap] = await Promise.all([tx.get(orderRef), tx.get(customerRef)]);
    if (!orderSnap.exists || !customerSnap.exists) throw new Error("CUSTOMER_ORDER_MISSING");
    const order = orderSnap.data() ?? {};
    if (order.customerLinked === true) return;
    const linkedId = String(order.customerId ?? "");
    if (linkedId !== customerId && linkedId !== "guest-checkout" && linkedId !== "guest") {
      throw new Error("CUSTOMER_ORDER_MISMATCH");
    }
    const orderPhone = phoneKey(typeof order.customerPhone === "string" ? order.customerPhone : "");
    const customer = customerSnap.data() ?? {};
    const customerPhone = phoneKey(typeof customer.phoneKey === "string" ? customer.phoneKey : typeof customer.phone === "string" ? customer.phone : "");
    if (orderPhone && customerPhone && orderPhone !== customerPhone) throw new Error("CUSTOMER_PHONE_MISMATCH");
    const total = Number(order.total);
    const spent = Number(customer.totalSpending ?? 0);
    tx.update(customerRef, {
      ordersCount: Number(customer.ordersCount ?? 0) + 1,
      totalSpending: Math.round((spent + (Number.isFinite(total) ? total : 0)) * 100) / 100,
      lastOrder: order.createdAt ?? Timestamp.now(),
    });
    tx.update(orderRef, { customerId, customerLinked: true });
  });
}
