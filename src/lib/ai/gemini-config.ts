export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || "";
}

export function isGeminiConfigured(): boolean {
  return Boolean(geminiApiKey());
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}
