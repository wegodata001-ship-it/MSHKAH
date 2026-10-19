const fs = require("fs");
const path = require("path");

const src = path.resolve(__dirname, "..", "..", "printer-agent", ".env");
const dest = path.resolve(__dirname, "..", "release", "MISHKAH-PRINTER", ".env");
if (!fs.existsSync(src)) {
  console.log("printer-agent/.env missing — skip copy");
  process.exit(0);
}
const allowed = new Set([
  "PRINT_AGENT_ENABLED",
  "PRINT_AGENT_API_URL",
  "PRINT_AGENT_TOKEN",
  "PRINT_AGENT_ID",
  "PRINTER_IP",
  "PRINTER_PORT",
  "PRINTER_TIMEOUT_MS",
  "PRINT_POLL_MS",
  "PRINT_HEARTBEAT_MS",
  "PRINTER_AUTO_CUT",
  "PRINTER_BEEP_ON_NEW_ORDER",
]);
const lines = ["# Café agent only. No Firebase Admin keys."];
for (const raw of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
  const eq = raw.indexOf("=");
  if (eq <= 0) continue;
  const key = raw.slice(0, eq).trim();
  if (allowed.has(key)) lines.push(raw);
}
fs.writeFileSync(dest, lines.join("\n") + "\n");
console.log("Wrote café .env (token not printed)");
