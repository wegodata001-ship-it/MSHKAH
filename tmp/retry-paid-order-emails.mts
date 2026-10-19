import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const ORDER_ID = "DtdOqphgULBE9FIEVnHp";
const BASE = "https://mishkatcafe.dev";

function maskEmail(value: unknown): string {
  if (typeof value !== "string" || !value.includes("@")) return value ? "present" : "missing";
  const [user, domain] = value.split("@");
  return `${user.slice(0, 3)}***@${domain}`;
}

async function adminToken(): Promise<string> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!email || !password || !key) throw new Error("admin auth env missing");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = (await res.json()) as { idToken?: string; error?: { message?: string } };
  if (!res.ok || !data.idToken) throw new Error(data.error?.message || "admin sign-in failed");
  return data.idToken;
}

async function postRetry(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: string;
    error?: string;
    reason?: string;
  };
  return {
    http: res.status,
    ok: json.ok === true,
    status: json.status ?? null,
    error: json.error ?? json.reason ?? null,
  };
}

async function snapshot() {
  const db = getAdminDb();
  const order = await db.collection(COLLECTIONS.orders).doc(ORDER_ID).get();
  const data = order.data() ?? {};
  const payments = await db.collection(COLLECTIONS.payments).where("orderId", "==", ORDER_ID).get();
  const jobs = await db.collection(COLLECTIONS.printJobs).where("orderId", "==", ORDER_ID).get();
  return {
    paymentStatus: data.paymentStatus ?? null,
    customerEmail: maskEmail(data.customerEmail),
    customerName: data.customerName ?? null,
    customerConfirmation: data.notifications?.customerConfirmationEmail ?? null,
    adminEmail: data.notifications?.newOrderEmail ?? null,
    payments: payments.docs.map((doc) => ({
      id: doc.id,
      status: doc.data().status,
      amount: doc.data().amount,
      postPayment: doc.data().postPayment ?? null,
    })),
    printJobs: jobs.docs.map((doc) => ({
      id: doc.id,
      type: doc.data().type,
      status: doc.data().status,
    })),
  };
}

async function main() {
  const before = await snapshot();
  const token = await adminToken();
  const customer = await postRetry(`/api/admin/orders/${ORDER_ID}/retry-customer-email`, token);
  const admin = await postRetry(`/api/admin/orders/${ORDER_ID}/retry-admin-email`, token);
  const after = await snapshot();
  process.stdout.write(
    JSON.stringify(
      {
        customerRetry: customer,
        adminRetry: admin,
        before,
        after,
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
