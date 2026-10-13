import {
  GeminiRequestError,
  geminiApiKey,
  geminiModel,
  geminiModelsToTry,
  isGeminiConfigured,
} from "@/lib/ai/gemini-config";

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
  requestId: string;
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
      gateway: "generativelanguage",
      url: `https://generativelanguage.googleapis.com/v1/models/${encoded}:generateContent`,
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
    return error.message.slice(0, 180);
  }
  return null;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

type ProviderAttempt = {
  ok: boolean;
  status: number;
  gateway: GeminiGateway;
  text: string;
  reason: string | null;
  model: string;
};

async function postGemini(input: {
  key: string;
  model: string;
  parts: unknown[];
  temperature: number;
  schema?: Record<string, unknown>;
}): Promise<ProviderAttempt> {
  let last: ProviderAttempt = {
    ok: false,
    status: 0,
    gateway: "generativelanguage",
    text: "",
    reason: "UNREACHABLE",
    model: input.model,
  };
  let preferredFailure: ProviderAttempt | null = null;
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
      | {
          candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
          promptFeedback?: { blockReason?: string };
          error?: unknown;
        }
      | null;
    const candidate = payload?.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const emptyReason = payload?.promptFeedback?.blockReason || candidate?.finishReason || "EMPTY_CANDIDATE";
    last = {
      ok: response.ok && Boolean(text),
      status: response.status,
      gateway: target.gateway,
      text,
      reason: response.ok ? (text ? null : emptyReason) : readReason(payload),
      model: input.model,
    };
    if (last.ok) return last;
    if (target.gateway === "generativelanguage") preferredFailure = last;
    if (response.status === 503 || response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }
    if (response.status !== 403 && response.status !== 404) return last;
  }
  return preferredFailure ?? last;
}

function throwFromAttempt(attempt: ProviderAttempt, requestId: string): never {
  const auth = attempt.status === 401 || attempt.status === 403;
  const emptyOk = attempt.status === 200 && !attempt.text;
  throw new GeminiRequestError({
    code: !attempt.status
      ? "SCAN_FAILED"
      : attempt.status === 429
        ? "QUOTA_EXCEEDED"
        : attempt.status === 401
          ? "INVALID_API_KEY"
          : attempt.status === 403
            ? "PROVIDER_FORBIDDEN"
            : emptyOk
              ? "EXTRACTION_FAILED"
              : "SCAN_FAILED",
    message: auth
      ? "Invoice scanning could not authenticate with the AI provider"
      : attempt.status === 429
        ? "Invoice scanning is rate limited"
        : "Invoice scanning failed",
    providerStatus: attempt.status || null,
    providerError: attempt.reason,
    model: attempt.model,
    requestId,
  });
}

export async function geminiGenerateJson(input: {
  parts: unknown[];
  temperature?: number;
  schema?: Record<string, unknown>;
  requestId?: string;
}): Promise<GeminiGenerateResult> {
  const requestId = input.requestId ?? newRequestId();
  const key = geminiApiKey();
  if (!key) {
    throw new GeminiRequestError({
      code: "AI_NOT_CONFIGURED",
      message: "Invoice scanning is not configured",
      requestId,
    });
  }
  const models = geminiModelsToTry();
  let last: ProviderAttempt | null = null;
  for (const model of models) {
    last = await postGemini({
      key,
      model,
      parts: input.parts,
      temperature: input.temperature ?? 0.1,
      schema: input.schema,
    });
    if (!last.ok && input.schema && last.status === 200 && !last.text) {
      last = await postGemini({
        key,
        model,
        parts: input.parts,
        temperature: input.temperature ?? 0,
      });
    }
    if (last.ok) {
      return {
        text: last.text,
        model,
        httpStatus: last.status,
        gateway: last.gateway,
        requestId,
      };
    }
    if (last.status && last.status !== 403 && last.status !== 404 && last.status !== 503) {
      throwFromAttempt(last, requestId);
    }
  }
  throwFromAttempt(last ?? {
    ok: false,
    status: 0,
    gateway: "generativelanguage",
    text: "",
    reason: "UNREACHABLE",
    model: geminiModel(),
  }, requestId);
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
    const result = await geminiGenerateJson({
      parts: [{ text: 'Reply with JSON {"ok":true} only.' }],
      temperature: 0,
    });
    const value: GeminiHealth = {
      ...base,
      model: result.model,
      reachable: true,
      httpStatus: result.httpStatus,
      reason: null,
      gateway: result.gateway,
    };
    healthCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    const failed = error instanceof GeminiRequestError ? error : null;
    const value: GeminiHealth = {
      ...base,
      model: failed?.model ?? model,
      reachable: false,
      httpStatus: failed?.providerStatus ?? null,
      reason: failed?.providerError ?? failed?.code ?? "UNREACHABLE",
      gateway: null,
    };
    healthCache = { at: Date.now(), value };
    return value;
  }
}
