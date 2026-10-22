import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { PICKUP_ADDRESS, groupOrderIdentities, matchExistingCustomer } from "../src/lib/customers/identity.ts";

let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";
if (privateKey.startsWith("\"")) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, "\n");
initializeApp({
  credential: cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey,
  }),
});

const db = getFirestore();
const [customerSnap, orderSnap] = await Promise.all([
  db.collection("customers").get(),
  db.collection("orders").get(),
]);

function toMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

const identities = orderSnap.docs.map((doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    name: String(data.customerFullName || data.customerName || ""),
    phone: data.customerPhone || "",
    email: data.customerEmail || "",
    address: data.deliveryAddress || "",
    total: Number(data.total),
    createdAtMs: toMs(data.createdAt),
    productNames: Array.isArray(data.items) ? data.items.map((item) => String(item?.productName || "")) : [],
  };
});

const groups = groupOrderIdentities(identities);
if (process.argv.includes("--dry")) {
  console.log(JSON.stringify({ groups: groups.length, orders: identities.length, customersBefore: customerSnap.size }));
  process.exit(0);
}
const existing = customerSnap.docs.map((doc) => {
  const data = doc.data();
  return { id: doc.id, name: data.name, phone: data.phone, identityKey: data.identityKey };
});
const used = new Set();
let created = 0;
let updated = 0;
let linked = 0;
const batchSize = 400;
let batch = db.batch();
let writes = 0;

async function commitIfNeeded(force = false) {
  if (writes === 0) return;
  if (!force && writes < batchSize) return;
  await batch.commit();
  batch = db.batch();
  writes = 0;
}

for (const group of groups) {
  const byIdentity = existing.find((customer) => customer.identityKey === group.key && !used.has(customer.id));
  const customerId = byIdentity?.id || matchExistingCustomer(group, existing, used);
  const ref = customerId ? db.collection("customers").doc(customerId) : db.collection("customers").doc();
  if (customerId) {
    used.add(customerId);
    updated += 1;
  } else {
    created += 1;
  }
  const payload = {
    name: group.name,
    phone: group.phone || "—",
    phoneKey: group.phoneKey,
    nameKey: group.name.trim().toLowerCase(),
    email: group.email,
    address: group.address,
    favoriteProducts: group.favoriteProducts,
    ordersCount: group.ordersCount,
    totalSpending: group.totalSpending,
    lastOrder: group.lastOrderMs == null ? null : Timestamp.fromMillis(group.lastOrderMs),
    identityKey: group.key,
  };
  if (customerId && group.address === PICKUP_ADDRESS) delete payload.address;
  if (customerId && !group.email) delete payload.email;
  if (customerId && !group.phone) delete payload.phone;
  if (customerId) batch.set(ref, payload, { merge: true });
  else {
    batch.set(ref, { ...payload, notes: "", createdAt: Timestamp.now() });
  }
  writes += 1;
  await commitIfNeeded();
  for (const orderId of group.orderIds) {
    batch.update(db.collection("orders").doc(orderId), { customerId: ref.id, customerLinked: true });
    linked += 1;
    writes += 1;
    await commitIfNeeded();
  }
}

await commitIfNeeded(true);
console.log(JSON.stringify({ groups: groups.length, created, updated, linked, orders: orderSnap.size, customersBefore: customerSnap.size }));
