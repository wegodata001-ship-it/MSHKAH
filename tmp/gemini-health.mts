import { readFileSync } from "fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.startsWith("GEMINI_")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i);
      if (!process.env[key]) process.env[key] = line.slice(i + 1).replace(/^"|"$/g, "");
    }
  } catch {
    // missing
  }
}

const { pingGemini } = await import("../src/lib/ai/gemini-client.ts");
const health = await pingGemini(true);
console.log(
  JSON.stringify({
    configured: health.configured,
    reachable: health.reachable,
    httpStatus: health.httpStatus,
    reason: health.reason,
    provider: health.provider,
    model: health.model,
    gateway: health.gateway,
  })
);
