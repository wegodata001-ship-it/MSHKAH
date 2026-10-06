const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim + lowercase. Returns null when empty or invalid. */
export function normalizeCustomerEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 120) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}
