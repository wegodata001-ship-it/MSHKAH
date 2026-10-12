export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
export const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.8-flash"];

export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || "";
}

export function isGeminiConfigured(): boolean {
  return Boolean(geminiApiKey());
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
}

export function geminiModelsToTry(): string[] {
  const preferred = geminiModel();
  return [preferred, ...GEMINI_FALLBACK_MODELS.filter((model) => model !== preferred)];
}

export type InvoiceAiCode =
  | "AI_NOT_CONFIGURED"
  | "PROVIDER_NOT_CONFIGURED"
  | "INVALID_API_KEY"
  | "PROVIDER_FORBIDDEN"
  | "QUOTA_EXCEEDED"
  | "UNSUPPORTED_FILE"
  | "FILE_TOO_LARGE"
  | "PDF_PARSE_FAILED"
  | "SCAN_FAILED"
  | "INVALID_RESPONSE"
  | "STORAGE_FAILED"
  | "INVALID_FILE"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "EXTRACTION_FAILED";

export class GeminiRequestError extends Error {
  readonly code: InvoiceAiCode;
  readonly providerStatus: number | null;
  readonly providerError: string | null;
  readonly model: string | null;
  readonly requestId: string;

  constructor(input: {
    code: InvoiceAiCode;
    message: string;
    providerStatus?: number | null;
    providerError?: string | null;
    model?: string | null;
    requestId: string;
  }) {
    super(input.message);
    this.name = "GeminiRequestError";
    this.code = input.code;
    this.providerStatus = input.providerStatus ?? null;
    this.providerError = input.providerError ?? null;
    this.model = input.model ?? null;
    this.requestId = input.requestId;
  }
}

export function httpStatusForAiCode(code: InvoiceAiCode, providerStatus?: number | null): number {
  if (code === "AI_NOT_CONFIGURED" || code === "PROVIDER_NOT_CONFIGURED") return 503;
  if (code === "INVALID_FILE" || code === "UNSUPPORTED_FILE") return 400;
  if (code === "FILE_TOO_LARGE") return 413;
  if (code === "INVALID_API_KEY" || code === "PROVIDER_FORBIDDEN" || code === "PROVIDER_AUTH_ERROR") return 502;
  if (code === "QUOTA_EXCEEDED" || code === "PROVIDER_RATE_LIMIT") return 429;
  if (code === "STORAGE_FAILED") return providerStatus && providerStatus >= 400 ? providerStatus : 502;
  if (providerStatus && providerStatus >= 500) return 502;
  return 422;
}
