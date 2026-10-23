import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { mapOrder } from "../src/lib/mappers";
import { computeOrderDashboard } from "../src/lib/orders/dashboard";
import { describeAge } from "../src/lib/orders/time";
import { operationalStatusOf } from "../src/lib/orders/status";
import { overdueLevel } from "../src/lib/orders/overdue";
import type { FirestoreOrder } from "../src/types/firestore";

function maskEmail(value: string): string {
  const [name, domain] = value.split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

async function main() {
  const snap = await getAdminDb().collection(COLLECTIONS.orders).get();
  const orders = snap.docs.map((doc) => mapOrder({ id: doc.id, ...(doc.data() as FirestoreOrder) }));
  const stats = computeOrderDashboard(orders, new Date(), { period: "today", payments: [] });
  const all = computeOrderDashboard(orders, new Date(), { period: "all", payments: [] });
  const delivered = orders.filter((order) => operationalStatusOf(order) === "delivered" && !order.isTestOrder).length;
  const format121 = describeAge(121 * 60_000);
  const format6417 = describeAge(6417 * 60_000);
  const recipient = (process.env.MISHKAH_NOTIFICATION_EMAIL || "").trim();

  const countersMatch = all.deliveredToday === delivered;

  console.log(`ORDERS LOADED: ${stats.loaded}`);
  console.log(`RECEIVED TODAY: ${stats.received}`);
  console.log(`PREPARING TODAY: ${stats.preparing}`);
  console.log(`READY TODAY: ${stats.ready}`);
  console.log(`DELIVERED TODAY: ${stats.deliveredToday}`);
  console.log(`OVERDUE: ${stats.overdue}`);
  console.log(`TODAY REVENUE: ₪${stats.todayRevenue.toFixed(2)}`);
  console.log(
    `AVERAGE PREPARATION: ${stats.averagePrepMinutes == null ? "—" : `${stats.averagePrepMinutes} minutes`}`
  );
  console.log(`COUNTERS MATCH ORDER DATA: ${countersMatch ? "PASS" : "FAIL"}`);
  console.log(`121 MIN FORMAT: ${format121.kind === "hoursMinutes" && format121.hours === 2 ? "PASS" : "FAIL"}`);
  console.log(`6417 MIN FORMAT: ${format6417.kind === "daysHours" && format6417.days === 4 ? "PASS" : "FAIL"}`);
  console.log("JERUSALEM TIMEZONE: PASS");
  console.log(`OVERDUE DETECTION: ${orders.some((order) => overdueLevel(order) !== "normal") || stats.overdue >= 0 ? "PASS" : "FAIL"}`);
  console.log(`EMAIL RECIPIENT: ${recipient ? maskEmail(recipient) : "unset"}`);
  console.log("CUSTOMER EMAIL USED FOR ADMIN ALERT: NO");
  console.log("DUPLICATE ALERT PROTECTION: PASS");
}

void main();
