/** Parse a fetch body without throwing on empty or non-JSON responses. */
export async function readJsonSafe(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return { ok: false, error: "empty-response", message: "empty-response" };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { ok: false, error: "invalid-json", message: "invalid-json" };
  } catch {
    return { ok: false, error: "invalid-json", message: "invalid-json" };
  }
}
