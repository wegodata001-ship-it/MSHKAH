import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"];

async function main() {
  const key = process.env.GEMINI_API_KEY!;
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: '{"ok":true}' }] }] }),
    });
    const body = await res.json().catch(() => ({}));
    console.log(
      JSON.stringify({
        model,
        status: res.status,
        retryAfter: res.headers.get("retry-after"),
        reason: body.error?.status || body.error?.message?.slice(0, 120) || "ok",
      })
    );
  }
}

void main();
