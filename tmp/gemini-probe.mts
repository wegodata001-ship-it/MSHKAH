import { readFileSync } from "fs";

function loadGeminiEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.startsWith("GEMINI_")) continue;
        const i = line.indexOf("=");
        const key = line.slice(0, i);
        if (!process.env[key]) process.env[key] = line.slice(i + 1).replace(/^"|"$/g, "");
      }
    } catch {
      // missing file
    }
  }
}

loadGeminiEnv();
const key = process.env.GEMINI_API_KEY?.trim() || "";
const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
console.log(`KEY_PRESENT=${Boolean(key)}`);
console.log(`KEY_PREFIX=${key.slice(0, 3)}`);
console.log(`KEY_LENGTH=${key.length}`);
console.log(`MODEL=${model}`);

const body = JSON.stringify({
  contents: [{ role: "user", parts: [{ text: "Reply with JSON {\"ok\":true}" }] }],
  generationConfig: { temperature: 0, responseMimeType: "application/json" },
});

async function probe(label: string, url: string, headers: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
  const text = await res.text();
  let reason = "";
  let message = "";
  try {
    const json = JSON.parse(text) as { error?: { status?: string; message?: string; details?: { reason?: string }[] } };
    reason = json.error?.details?.find((d) => d.reason)?.reason || json.error?.status || "";
    message = (json.error?.message || "").replace(key, "[redacted]").slice(0, 180);
  } catch {
    message = text.slice(0, 80);
  }
  console.log(`${label} STATUS=${res.status} REASON=${reason} MSG=${message}`);
  return res.status;
}

const encoded = encodeURIComponent(key);
await probe("GL_QUERY", `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encoded}`, {});
await probe("GL_HEADER", `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": key });
await probe("GL_V1_HEADER", `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, { "x-goog-api-key": key });
await probe("AP_HEADER", `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`, { "x-goog-api-key": key });
await probe("AP_QUERY", `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encoded}`, {});
