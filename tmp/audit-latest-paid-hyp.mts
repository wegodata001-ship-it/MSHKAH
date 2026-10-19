import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

function maskEmail(value: unknown): string {
  if (typeof value !== "string" || !value.includes("@")) return value ? "present" : "missing";
  const [user, domain] = value.split("@");
  return `${user.slice(0, 3)}***@${domain}`;
}

async function main() {
  const db = getAdminDb();
  const payments = await db
    .collection(COLLECTIONS.payments)
    .where("provider", "==", "HYP")
    .where("status", "==", "paid")
    .limit(20)
    .get();

  const rows = [];
  for (const doc of payments.docs) {
    const p = doc.data();
    const orderSnap = p.orderId ? await db.collection(COLLECTIONS.orders).doc(p.orderId).get() : null;
    const order = orderSnap?.data();
    const jobs = p.orderId
      ? await db.collection(COLLECTIONS.printJobs).where("orderId", "==", p.orderId).get()
      : { docs: [] };
    rows.push({
      paymentId: doc.id,
      paymentStatus: p.status,
      amount: p.amount,
      paidAt: p.paidAt ?? null,
      verifiedAt: p.verifiedAt ?? null,
      postPayment: p.postPayment ?? null,
      orderId: p.orderId ?? null,
      orderNumber: order?.orderNumber ?? p.orderNumber ?? null,
      orderPaymentStatus: order?.paymentStatus ?? null,
      paymentProvider: order?.paymentProvider ?? p.provider ?? null,
      customerEmail: maskEmail(order?.customerEmail ?? p.customerEmail),
      customerEmailLen:
        typeof (order?.customerEmail ?? p.customerEmail) === "string"
          ? String(order?.customerEmail ?? p.customerEmail).length
          : 0,
      customerName: order?.customerName ?? null,
      notifications: {
        customerConfirmationEmail: order?.notifications?.customerConfirmationEmail ?? null,
        customerFailureEmail: order?.notifications?.customerFailureEmail ?? null,
        newOrderEmail: order?.notifications?.newOrderEmail ?? null,
        newOrderEmailSent: order?.notifications?.newOrderEmailSent ?? null,
      },
      printJobs: jobs.docs.map((j) => ({ id: j.id, type: j.data().type, status: j.data().status })),
    });
  }

  rows.sort((a, b) => {
    const am = a.paidAt && typeof a.paidAt.toMillis === "function" ? a.paidAt.toMillis() : 0;
    const bm = b.paidAt && typeof b.paidAt.toMillis === "function" ? b.paidAt.toMillis() : 0;
    return bm - am;
  });

  process.stdout.write(JSON.stringify({ paidHypCount: rows.length, orders: rows }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
