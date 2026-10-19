import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

function parseEnvLocal(): Record<string, string> {
  const raw = readFileSync(".env.local", "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const PROJECT = ["--project", "mshkah", "--scope", "wegodata001-ship-its-projects"];

function vercelEnvLs(): string {
  const result = spawnSync("npx", ["vercel", "env", "ls", ...PROJECT], {
    encoding: "utf8",
    shell: true,
  });
  return `${result.stdout}\n${result.stderr}`;
}

function addEnv(name: string, value: string, environment: "production" | "preview"): boolean {
  const result = spawnSync(
    "npx",
    ["vercel", "env", "add", name, environment, "--value", value, "--force", "--yes", "--sensitive", ...PROJECT],
    { encoding: "utf8", shell: true }
  );
  const output = `${result.stdout}\n${result.stderr}`.replaceAll(value, "[redacted]");
  if (result.status !== 0) {
    process.stdout.write(`${name} ${environment}: FAIL ${output.trim().slice(0, 240)}\n`);
    return false;
  }
  process.stdout.write(`${name} ${environment}: OK\n`);
  return true;
}

const env = parseEnvLocal();
const listed = vercelEnvLs();
process.stdout.write("VERCEL_ENV_NAMES_PRESENT:\n");
for (const name of NAMES) {
  const present = listed.includes(name);
  process.stdout.write(`  ${name}: ${present ? "PRESENT" : "MISSING"}\n`);
}

let failed = 0;
for (const name of NAMES) {
  const value = env[name]?.trim();
  if (!value) {
    process.stdout.write(`${name}: SKIP_LOCAL_MISSING\n`);
    continue;
  }
  if (!addEnv(name, value, "production")) failed += 1;
  if (!addEnv(name, value, "preview")) failed += 1;
}

process.exit(failed > 0 ? 1 : 0);
