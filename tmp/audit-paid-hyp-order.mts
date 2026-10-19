import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

function maskEmail(value: unknown): string {
  if (typeof value !== "string" || !value.includes("@")) return value ? "present" : "missing";
  const [user, domain] = value.split("@");
  const keep = user.slice(0, 3);
  return `${keep}***@${domain}`;
}

function maskPhone(value: unknown): string {
  if (typeof value !== "string" || value.length < 4) return value ? "present" : "missing";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

async function main() {
  const db = getAdminDb();
  const orders = await db.collection(COLLECTIONS.orders).where("orderNumber", "==", "MC-2026-45D1NCQM").get();
  if (orders.empty) {
    process.stdout.write("ORDER_NOT_FOUND\n");
    return;
  }
  const orderDoc = orders.docs[0]!;
  const order = orderDoc.data();
  const payments = await db.collection(COLLECTIONS.payments).where("orderId", "==", orderDoc.id).get();
  const jobs = await db.collection(COLLECTIONS.printJobs).where("orderId", "==", orderDoc.id).get();

  process.stdout.write(
    JSON.stringify(
      {
        orderId: orderDoc.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        paymentProvider: order.paymentProvider,
        paymentTransactionId: order.paymentTransactionId ?? null,
        total: order.total,
        customerName: order.customerName ?? null,
        customerFullName: order.customerFullName ?? null,
        customerEmail: maskEmail(order.customerEmail),
        customerEmailRawLen: typeof order.customerEmail === "string" ? order.customerEmail.length : 0,
        customerPhone: maskPhone(order.customerPhone),
        locale: order.locale ?? null,
        isTestOrder: order.isTestOrder === true,
        notesPreview: typeof order.notes === "string" ? order.notes.slice(0, 80) : null,
        notifications: order.notifications ?? null,
        payments: payments.docs.map((doc) => {
          const p = doc.data();
          return {
            id: doc.id,
            status: p.status,
            provider: p.provider,
            amount: p.amount,
            customerEmail: maskEmail(p.customerEmail),
            transactionId: p.transactionId ?? p.providerReference ?? null,
            paidAt: p.paidAt ?? null,
            verifiedAt: p.verifiedAt ?? null,
            postPayment: p.postPayment ?? null,
          };
        }),
        printJobs: jobs.docs.map((doc) => ({
          id: doc.id,
          type: doc.data().type,
          status: doc.data().status,
          uniqueKey: doc.data().uniqueKey ?? null,
        })),
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
