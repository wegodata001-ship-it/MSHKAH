const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DOMAIN_TYPOS: Record<string, string> = {
  "gmal.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
};

/** Trim + lowercase. Fixes common mailbox typos. Returns null when empty or invalid. */
export function normalizeCustomerEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let email = raw.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 120) return null;
  const at = email.lastIndexOf("@");
  if (at > 0) {
    const domain = email.slice(at + 1);
    const fixed = DOMAIN_TYPOS[domain];
    if (fixed) email = `${email.slice(0, at + 1)}${fixed}`;
  }
  if (!EMAIL_RE.test(email)) return null;
  return email;
}
