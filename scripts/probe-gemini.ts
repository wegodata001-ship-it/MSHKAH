import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { geminiApiKey, geminiModel, isGeminiConfigured } from "../src/lib/ai/gemini-config";

const MODELS = Array.from(
  new Set(
    [
      process.env.GEMINI_MODEL?.trim(),
      "gemini-2.5-flash",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3-flash",
      "gemini-3.0-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-flash-latest",
    ].filter((value): value is string => Boolean(value))
  )
);

const ENDPOINTS = (model: string) => [
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,
];

async function main() {
  const configured = isGeminiConfigured();
  const keyLen = geminiApiKey().length;
  console.log("configured", configured);
  console.log("keyLength", keyLen);
  console.log("defaultModel", geminiModel());
  if (!configured) return;
  const key = geminiApiKey();
  for (const version of ["v1beta", "v1"] as const) {
    const res = await fetch(`https://generativelanguage.googleapis.com/${version}/models`, {
      headers: { "x-goog-api-key": key },
    });
    const data = (await res.json().catch(() => null)) as {
      models?: { name?: string }[];
      error?: { status?: string };
    } | null;
    console.log(
      JSON.stringify({
        list: version,
        status: res.status,
        reason: data?.error?.status ?? null,
        count: data?.models?.length ?? 0,
        names: (data?.models ?? []).slice(0, 12).map((model) => model.name),
      })
    );
  }

  for (const model of MODELS) {
    for (const url of ENDPOINTS(model)) {
      const started = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: 'Reply with JSON {"ok":true} only.' }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { status?: string; message?: string; details?: { reason?: string }[] };
        candidates?: unknown[];
      } | null;
      const reason = payload?.error?.details?.find((item) => item.reason)?.reason
        || payload?.error?.status
        || null;
      const message = payload?.error?.message
        ? payload.error.message.replace(/key[s]?\s*[:=]\s*\S+/gi, "key=REDACTED").slice(0, 180)
        : null;
      console.log(
        JSON.stringify({
          model,
          gateway: url.includes("/v1/") ? "v1" : "v1beta",
          status: response.status,
          reason,
          message,
          hasText: Boolean(payload?.candidates?.length),
          ms: Date.now() - started,
        })
      );
      if (response.ok) return;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
