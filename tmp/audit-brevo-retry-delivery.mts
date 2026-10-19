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

async function brevo(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${env("BREVO_BASE_URL") || "https://api.brevo.com/v3"}${path}`, {
    headers: { accept: "application/json", "api-key": env("BREVO_API_KEY") },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

async function eventsForMessage(messageId: string) {
  const listed = await brevo(`/smtp/emails?messageId=${encodeURIComponent(messageId)}`);
  const emails =
    listed.body && typeof listed.body === "object" && "transactionalEmails" in listed.body
      ? ((listed.body as { transactionalEmails?: Array<{ uuid?: string; email?: string; subject?: string }> })
          .transactionalEmails ?? [])
      : [];
  const first = emails[0];
  if (!first?.uuid) {
    return { messageId, listStatus: listed.status, events: [] as string[], to: first?.email ? maskEmail(first.email) : null };
  }
  const detail = await brevo(`/smtp/emails/${first.uuid}`);
  const names =
    detail.body && typeof detail.body === "object" && "events" in detail.body
      ? ((detail.body as { events?: Array<{ name?: string }> }).events ?? []).map((e) => e.name ?? "")
      : [];
  return {
    messageId,
    listStatus: listed.status,
    to: first.email ? maskEmail(first.email) : null,
    subject: first.subject ?? null,
    events: names,
  };
}

async function main() {
  await new Promise((r) => setTimeout(r, 4000));
  const customer = await eventsForMessage("<202610061836.59161417015@smtp-relay.mailin.fr>");
  const admin = await eventsForMessage("<202610061836.10429831778@smtp-relay.mailin.fr>");
  process.stdout.write(JSON.stringify({ customer, admin }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
