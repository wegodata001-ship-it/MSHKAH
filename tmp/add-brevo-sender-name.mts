import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function readLocal(name: string): string {
  const raw = readFileSync(".env.local", "utf8");
  const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) throw new Error(`${name} missing locally`);
  let value = match[1]!.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!value) throw new Error(`${name} empty`);
  return value;
}

const value = readLocal("BREVO_SENDER_NAME");
let failed = 0;
for (const environment of ["production", "preview"] as const) {
  const result = spawnSync(
    "npx",
    [
      "vercel",
      "env",
      "add",
      "BREVO_SENDER_NAME",
      environment,
      "--yes",
      "--force",
      "--sensitive",
      "--project",
      "mshkah",
      "--scope",
      "wegodata001-ship-its-projects",
    ],
    { encoding: "utf8", shell: true, input: value }
  );
  const output = `${result.stdout}\n${result.stderr}`.replaceAll(value, "[redacted]");
  if (result.status !== 0) {
    process.stdout.write(`${environment}: FAIL ${output.trim().slice(0, 240)}\n`);
    failed += 1;
  } else {
    process.stdout.write(`${environment}: OK\n`);
  }
}
process.exit(failed > 0 ? 1 : 0);
