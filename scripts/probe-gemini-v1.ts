import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const MODELS = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-flash-image", "gemini-3.1-flash-lite"];

async function main() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: 'Reply with JSON {"ok":true} only.' }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: { status?: string; message?: string };
      candidates?: unknown[];
    } | null;
    console.log(
      JSON.stringify({
        model,
        status: response.status,
        reason: payload?.error?.status ?? null,
        hasText: Boolean(payload?.candidates?.length),
      })
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
