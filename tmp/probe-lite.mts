import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

async function tryModel(model: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with ok" }] }] }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ model, status: res.status, reason: body.error?.status || body.error?.message?.slice(0, 140) || "ok" }));
  return res.ok;
}

async function main() {
  for (const model of ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-latest"]) {
    if (await tryModel(model)) break;
  }
}

void main();
