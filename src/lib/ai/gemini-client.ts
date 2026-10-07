import { geminiApiKey, geminiModel, isGeminiConfigured } from "@/lib/ai/gemini-config";

type GeminiGateway = "generativelanguage" | "aiplatform";

export type GeminiHealth = {
  configured: boolean;
  provider: "gemini" | null;
  model: string | null;
  reachable: boolean;
  httpStatus: number | null;
  reason: string | null;
  gateway: GeminiGateway | null;
};

export type GeminiGenerateResult = {
  text: string;
  model: string;
  httpStatus: number;
  gateway: GeminiGateway;
};

type CachedHealth = { at: number; value: GeminiHealth };

let healthCache: CachedHealth | null = null;
const HEALTH_TTL_MS = 45_000;

function gateways(model: string): { gateway: GeminiGateway; url: string }[] {
  const encoded = encodeURIComponent(model);
  return [
    {
      gateway: "generativelanguage",
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encoded}:generateContent`,
    },
    {
      gateway: "aiplatform",
      url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${encoded}:generateContent`,
    },
  ];
}

function readReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: { status?: string; message?: string; details?: { reason?: string }[] } }).error;
  if (!error) return null;
  const detail = error.details?.find((item) => item.reason)?.reason;
  if (detail) return detail;
  if (error.status) return error.status;
  if (typeof error.message === "string") {
    if (/denied access/i.test(error.message)) return "PROJECT_DENIED";
    if (/not been used|disabled/i.test(error.message)) return "SERVICE_DISABLED";
    return "GEMINI_ERROR";
  }
  return null;
}

async function postGemini(input: {
  key: string;
  model: string;
  parts: unknown[];
  temperature: number;
  schema?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; gateway: GeminiGateway; text: string; reason: string | null }> {
  let last = { ok: false, status: 0, gateway: "generativelanguage" as GeminiGateway, text: "", reason: "UNREACHABLE" as string | null };
  let preferredFailure: typeof last | null = null;
  for (const target of gateways(input.model)) {
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: input.parts }],
        generationConfig: {
          temperature: input.temperature,
          responseMimeType: "application/json",
          ...(input.schema ? { responseSchema: input.schema } : {}),
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: unknown }
      | null;
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    last = {
      ok: response.ok && Boolean(text),
      status: response.status,
      gateway: target.gateway,
      text,
      reason: response.ok ? null : readReason(payload),
    };
    if (last.ok) return last;
    if (target.gateway === "generativelanguage") preferredFailure = last;
    if (response.status !== 403 && response.status !== 404) return last;
  }
  return preferredFailure ?? last;
}

export async function geminiGenerateJson(input: {
  parts: unknown[];
  temperature?: number;
  schema?: Record<string, unknown>;
}): Promise<GeminiGenerateResult> {
  const key = geminiApiKey();
  if (!key) throw new Error("ai-not-configured");
  const model = geminiModel();
  const result = await postGemini({
    key,
    model,
    parts: input.parts,
    temperature: input.temperature ?? 0.1,
    schema: input.schema,
  });
  if (!result.ok) {
    if (result.status === 429) throw new Error("ai-rate-limited");
    if (result.status === 403 || result.status === 401) throw new Error("ai-unavailable");
    throw new Error(result.status ? `ai-failed-${result.status}` : "ai-unavailable");
  }
  return { text: result.text, model, httpStatus: result.status, gateway: result.gateway };
}

export async function pingGemini(force = false): Promise<GeminiHealth> {
  const configured = isGeminiConfigured();
  const model = configured ? geminiModel() : null;
  const base: GeminiHealth = {
    configured,
    provider: configured ? "gemini" : null,
    model,
    reachable: false,
    httpStatus: null,
    reason: configured ? null : "NOT_CONFIGURED",
    gateway: null,
  };
  if (!configured) return base;
  if (!force && healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.value;
  try {
    const result = await postGemini({
      key: geminiApiKey(),
      model: model!,
      parts: [{ text: 'Reply with JSON {"ok":true} only.' }],
      temperature: 0,
    });
    const value: GeminiHealth = {
      ...base,
      reachable: result.ok,
      httpStatus: result.status || null,
      reason: result.ok ? null : result.reason,
      gateway: result.gateway,
    };
    healthCache = { at: Date.now(), value };
    return value;
  } catch {
    const value = { ...base, reason: "UNREACHABLE" };
    healthCache = { at: Date.now(), value };
    return value;
  }
}
