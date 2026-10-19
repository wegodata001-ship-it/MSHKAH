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

async function eventsFor(email: string) {
  const res = await fetch(
    `${env("BREVO_BASE_URL") || "https://api.brevo.com/v3"}/smtp/statistics/events?limit=15&startDate=2026-10-06&endDate=2026-10-06&email=${encodeURIComponent(email)}&sort=desc`,
    { headers: { accept: "application/json", "api-key": env("BREVO_API_KEY") } }
  );
  const body = (await res.json()) as {
    events?: Array<{ event?: string; date?: string; subject?: string }>;
  };
  return {
    status: res.status,
    to: maskEmail(email),
    events: (body.events ?? [])
      .filter((e) => (e.subject ?? "").includes("439TFVAY") || (e.subject ?? "").includes("שולמה באשראי"))
      .map((e) => ({ event: e.event, date: e.date, subject: e.subject })),
  };
}

async function main() {
  await new Promise((r) => setTimeout(r, 3000));
  const notification = await eventsFor(env("MISHKAH_NOTIFICATION_EMAIL"));
  const admin = await eventsFor(env("MISHKAH_ADMIN_EMAIL"));
  process.stdout.write(JSON.stringify({ notification, admin }, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
