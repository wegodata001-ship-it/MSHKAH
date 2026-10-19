import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const NAMES = [
  "MAIL_PROVIDER",
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
  "BREVO_REPLY_TO",
  "BREVO_BASE_URL",
  "MISHKAH_NOTIFICATION_EMAIL",
  "MISHKAH_ADMIN_EMAIL",
] as const;

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
    return value
      .replace(/xkeysib-[a-zA-Z0-9-]+/g, "[redacted-key]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) => maskEmail(m));
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
  const apiKey = env("BREVO_API_KEY");
  const base = env("BREVO_BASE_URL") || "https://api.brevo.com/v3";
  if (!apiKey) return { status: 0, body: { error: "BREVO_API_KEY missing locally" } };
  const res = await fetch(`${base}${path}`, {
    headers: { accept: "application/json", "api-key": apiKey },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: sanitize(body) };
}

async function main() {
  const local = Object.fromEntries(
    NAMES.map((name) => {
      const value = env(name);
      if (name.includes("KEY")) return [name, value ? "SET" : "MISSING"];
      if (name.includes("EMAIL") || name === "BREVO_REPLY_TO") return [name, value ? maskEmail(value) : "MISSING"];
      return [name, value ? "SET" : "MISSING"];
    })
  );

  const senders = await brevo("/senders");
  const account = await brevo("/account");
  const days = 2;
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const events = await brevo(`/smtp/statistics/events?limit=50&startDate=${start}&sort=desc`);
  const emails = await brevo(`/smtp/emails?limit=20&sort=desc&startDate=${start}`);

  const customer = env("BREVO_API_KEY") ? "wegodata001@gmail.com" : "";
  const customerEvents = customer
    ? await brevo(
        `/smtp/statistics/events?limit=20&email=${encodeURIComponent(customer)}&startDate=${start}&sort=desc`
      )
    : { status: 0, body: null };

  process.stdout.write(
    JSON.stringify(
      {
        localEnvNames: local,
        sendersStatus: senders.status,
        senders: senders.body,
        accountStatus: account.status,
        account: account.body,
        recentEmailsStatus: emails.status,
        recentEmails: emails.body,
        recentEventsStatus: events.status,
        recentEvents: events.body,
        customerEventsStatus: customerEvents.status,
        customerEvents: customerEvents.body,
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
