import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function maskEmail(value: string): string {
  if (!value.includes("@")) return value ? "present" : "missing";
  const [user, domain] = value.split("@");
  return `${user.slice(0, 3)}***@${domain}`;
}

async function brevo(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${env("BREVO_BASE_URL") || "https://api.brevo.com/v3"}${path}`, {
    headers: { accept: "application/json", "api-key": env("BREVO_API_KEY") },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 240) };
  }
  return { status: res.status, body };
}

async function isBlocked(email: string): Promise<boolean> {
  const result = await brevo(`/smtp/blockedContacts?limit=50`);
  const contacts =
    result.body && typeof result.body === "object" && "contacts" in result.body
      ? ((result.body as { contacts?: Array<{ email?: string }> }).contacts ?? [])
      : [];
  return contacts.some((c) => (c.email ?? "").toLowerCase() === email.toLowerCase());
}

async function eventsFor(email: string) {
  return brevo(
    `/smtp/statistics/events?limit=20&startDate=2026-10-06&endDate=2026-10-06&email=${encodeURIComponent(email)}&sort=desc`
  );
}

async function main() {
  const db = getAdminDb();
  const latest = await db.collection(COLLECTIONS.orders).doc("DtdOqphgULBE9FIEVnHp").get();
  const first = await db.collection(COLLECTIONS.orders).doc("HiCYn6nL5SvRYizZc2GH").get();
  const latestEmail = String(latest.data()?.customerEmail ?? "");
  const firstEmail = String(first.data()?.customerEmail ?? "");
  const notification = env("MISHKAH_NOTIFICATION_EMAIL");
  const admin = env("MISHKAH_ADMIN_EMAIL");

  const uuids = [
    "f1f94ab5-eb57-45c9-9750-aae182d836cd",
    "1ba7ee29-9070-4599-a5e4-144b7087bd24",
  ];
  const uuidDetails = [];
  for (const uuid of uuids) {
    uuidDetails.push({ uuid, ...(await brevo(`/smtp/emails/${uuid}`)) });
  }

  const checks = [
    { label: "latestCustomer", email: latestEmail },
    { label: "firstCustomer", email: firstEmail },
    { label: "notificationInbox", email: notification },
    { label: "adminInbox", email: admin },
  ].filter((c) => c.email.includes("@"));

  const blocked = [];
  const events = [];
  for (const check of checks) {
    blocked.push({ label: check.label, email: maskEmail(check.email), blocked: await isBlocked(check.email) });
    const ev = await eventsFor(check.email);
    const safeEvents =
      ev.body && typeof ev.body === "object" && "events" in ev.body
        ? ((ev.body as { events?: Array<Record<string, unknown>> }).events ?? []).map((item) => ({
            event: item.event,
            date: item.date,
            subject: item.subject,
            tag: item.tag,
            to: typeof item.email === "string" ? maskEmail(item.email) : undefined,
          }))
        : ev.body;
    events.push({ label: check.label, to: maskEmail(check.email), status: ev.status, events: safeEvents });
  }

  process.stdout.write(
    JSON.stringify(
      {
        latestCustomerDomain: latestEmail.split("@")[1] ?? null,
        firstCustomerDomain: firstEmail.split("@")[1] ?? null,
        uuidDetails: uuidDetails.map((item) => ({
          uuid: item.uuid,
          status: item.status,
          keys: item.body && typeof item.body === "object" ? Object.keys(item.body) : [],
          events:
            item.body && typeof item.body === "object" && "events" in item.body
              ? (item.body as { events?: unknown }).events
              : undefined,
          event:
            item.body && typeof item.body === "object" && "event" in item.body
              ? (item.body as { event?: unknown }).event
              : undefined,
        })),
        blocked,
        events,
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
