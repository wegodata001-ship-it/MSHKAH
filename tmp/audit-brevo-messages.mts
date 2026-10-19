import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function maskEmail(value: string): string {
  if (!value.includes("@")) return value ? "present" : "missing";
  const [user, domain] = value.split("@");
  return `${user.slice(0, 3)}***@${domain}`;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) => maskEmail(m));
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/key|token|secret|authorization/i.test(k)) out[k] = "redacted";
      else out[k] = sanitize(v);
    }
    return out;
  }
  return value;
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
  return { status: res.status, body: sanitize(body) };
}

async function main() {
  const ids = [
    "<202610061750.23258874820@smtp-relay.mailin.fr>",
    "<202610061750.75012871812@smtp-relay.mailin.fr>",
    "<202610061719.18993529734@smtp-relay.mailin.fr>",
    "<202610061719.31379890467@smtp-relay.mailin.fr>",
  ];

  const byId = [];
  for (const id of ids) {
    const result = await brevo(`/smtp/emails?messageId=${encodeURIComponent(id)}`);
    byId.push({ messageId: id, status: result.status, body: result.body });
  }

  const start = "2026-10-06";
  const end = "2026-10-07";
  const admin = env("MISHKAH_NOTIFICATION_EMAIL");
  const admin2 = env("MISHKAH_ADMIN_EMAIL");
  const customerTypo = "ab***@gmal.com";

  const queries = [
    admin ? { label: "notificationInbox", email: admin } : null,
    admin2 ? { label: "adminInbox", email: admin2 } : null,
    { label: "firstTestCustomer", email: "wegodata001@gmail.com" },
  ].filter(Boolean) as Array<{ label: string; email: string }>;

  const events = [];
  for (const q of queries) {
    const result = await brevo(
      `/smtp/statistics/events?limit=30&startDate=${start}&endDate=${end}&email=${encodeURIComponent(q.email)}&sort=desc`
    );
    events.push({ label: q.label, to: maskEmail(q.email), status: result.status, body: result.body });
  }

  const blocked = await brevo("/smtp/blockedContacts?limit=20");

  process.stdout.write(
    JSON.stringify({ byId, events, blocked: { status: blocked.status, body: blocked.body }, typoHint: customerTypo }, null, 2) +
      "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
