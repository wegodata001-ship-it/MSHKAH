import { HYP_API_BASE, type HypConfig } from "@/lib/payments/hyp/types";

export class HypConfigError extends Error {
  readonly code = "HYP_NOT_CONFIGURED";

  constructor(message = "HYP payment is not configured") {
    super(message);
    this.name = "HypConfigError";
  }
}

function readTrimmed(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** Terminal ID. Prefer HYP_MASOF; accept HYP_TERMINAL_ID only as a compatibility alias. */
export function readHypMasof(): string {
  const masof = readTrimmed("HYP_MASOF");
  if (masof) return masof;
  const alias = readTrimmed("HYP_TERMINAL_ID");
  if (alias) {
    console.warn("[hyp] HYP_MASOF is missing; using HYP_TERMINAL_ID alias. Standardize on HYP_MASOF.");
  }
  return alias;
}

export function hasRequiredHypCredentials(input: {
  masof?: string;
  apiKey?: string;
  passP?: string;
}): boolean {
  return (
    /^\d{10}$/.test((input.masof ?? "").trim()) &&
    Boolean(input.apiKey?.trim()) &&
    Boolean(input.passP?.trim())
  );
}

const REQUIRED_CREDENTIAL_NAMES = ["HYP_MASOF", "HYP_API_KEY", "HYP_PASSP"] as const;
const RECOMMENDED_ENV_NAMES = ["HYP_ENVIRONMENT", "NEXT_PUBLIC_SITE_URL"] as const;

/** Env names only — never values. */
export function getHypMissingEnvNames(): string[] {
  const missing: string[] = [];
  const masof = readHypMasof();
  if (!masof) missing.push("HYP_MASOF");
  if (!readTrimmed("HYP_API_KEY")) missing.push("HYP_API_KEY");
  if (!readTrimmed("HYP_PASSP")) missing.push("HYP_PASSP");
  if (!readTrimmed("HYP_ENVIRONMENT")) missing.push("HYP_ENVIRONMENT");
  if (!readTrimmed("NEXT_PUBLIC_SITE_URL")) missing.push("NEXT_PUBLIC_SITE_URL");
  return missing;
}

export function logHypEnvStatus(): void {
  const missing = getHypMissingEnvNames();
  const credentialMissing = missing.filter((name) =>
    (REQUIRED_CREDENTIAL_NAMES as readonly string[]).includes(name)
  );
  if (credentialMissing.length > 0) {
    console.error("[hyp] missing env names:", credentialMissing.join(", "));
  }
  const recommendedMissing = missing.filter((name) =>
    (RECOMMENDED_ENV_NAMES as readonly string[]).includes(name)
  );
  if (recommendedMissing.length > 0) {
    console.warn("[hyp] recommended env names missing:", recommendedMissing.join(", "));
  }
}

/** True only when all required server-side HYP credentials are present. */
export function isHypConfigured(): boolean {
  return hasRequiredHypCredentials({
    masof: readHypMasof(),
    apiKey: readTrimmed("HYP_API_KEY"),
    passP: readTrimmed("HYP_PASSP"),
  });
}

export function getHypConfig(): HypConfig {
  const masof = readHypMasof();
  const apiKey = readTrimmed("HYP_API_KEY");
  const passP = readTrimmed("HYP_PASSP");
  const environment = readTrimmed("HYP_ENVIRONMENT") || "production";

  if (!/^\d{10}$/.test(masof) || !apiKey || !passP) {
    logHypEnvStatus();
    throw new HypConfigError(
      "HYP is not configured. Set HYP_MASOF, HYP_API_KEY, and HYP_PASSP on the server."
    );
  }

  return { masof, apiKey, passP, environment };
}

/** Official Hyp Pay host. Test vs live is a property of the terminal, not a guessed URL. */
export function getHypApiBase(): string {
  return HYP_API_BASE;
}
