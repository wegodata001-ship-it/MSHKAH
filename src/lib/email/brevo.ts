import { assertBrevoReady, getBrevoConfig } from "@/lib/email/config";
import type { SendEmailInput, SendEmailResult } from "@/lib/email/types";

type BrevoErrorBody = {
  message?: string;
  code?: string;
};

function sanitizeBrevoError(status: number, body: BrevoErrorBody | null): string {
  const message = body?.message?.trim() || "Brevo API request failed";
  const code = body?.code?.trim();
  const lower = message.toLowerCase();

  if (status === 401 || lower.includes("unauthorized") || lower.includes("api key")) {
    return "Unauthorized — BREVO_API_KEY is invalid or missing permissions";
  }
  if (
    lower.includes("sender") &&
    (lower.includes("not verified") || lower.includes("invalid") || code === "invalid_parameter")
  ) {
    return `Sender not verified or invalid — check BREVO_SENDER_EMAIL in Brevo (${message})`;
  }
  if (lower.includes("email") && lower.includes("invalid")) {
    return `Invalid email address — ${message}`;
  }
  return code ? `Brevo API error [${status}/${code}]: ${message}` : `Brevo API error [${status}]: ${message}`;
}

/**
 * Low-level Brevo transactional email send. Server-side only.
 * Never logs API keys or full request secrets.
 */
export async function sendViaBrevo(input: SendEmailInput): Promise<SendEmailResult> {
  const ready = assertBrevoReady();
  if (!ready.ok) {
    return { ok: false, error: ready.error, code: "CONFIG" };
  }

  const cfg = getBrevoConfig();
  const toList = (Array.isArray(input.to) ? input.to : [input.to])
    .map((email) => email.trim())
    .filter(Boolean);

  if (toList.length === 0) {
    return { ok: false, error: "No recipients provided", code: "NO_RECIPIENTS" };
  }

  const payload = {
    sender: {
      name: cfg.senderName,
      email: cfg.senderEmail,
    },
    to: toList.map((email) => ({ email })),
    subject: input.subject,
    htmlContent: input.html,
    ...(input.text ? { textContent: input.text } : {}),
    ...(cfg.replyTo
      ? { replyTo: { email: cfg.replyTo, name: cfg.senderName } }
      : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
  };

  try {
    const response = await fetch(`${cfg.baseUrl}/smtp/email`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let body: (BrevoErrorBody & { messageId?: string }) | null = null;
    try {
      body = raw ? (JSON.parse(raw) as BrevoErrorBody & { messageId?: string }) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        error: sanitizeBrevoError(response.status, body),
        code: body?.code ?? `HTTP_${response.status}`,
      };
    }

    return { ok: true, messageId: body?.messageId, statusCode: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error talking to Brevo",
      code: "NETWORK",
    };
  }
}

/** Latest safe Brevo event name for a transactional messageId. Never logs recipients. */
export async function getBrevoDeliveryStatus(messageId?: string): Promise<string | undefined> {
  if (!messageId) return undefined;
  const ready = assertBrevoReady();
  if (!ready.ok) return undefined;
  const cfg = getBrevoConfig();
  try {
    const listed = await fetch(
      `${cfg.baseUrl}/smtp/emails?messageId=${encodeURIComponent(messageId)}`,
      { headers: { accept: "application/json", "api-key": cfg.apiKey } }
    );
    if (!listed.ok) return undefined;
    const list = (await listed.json()) as { transactionalEmails?: Array<{ uuid?: string }> };
    const uuid = list.transactionalEmails?.[0]?.uuid;
    if (!uuid) return "accepted";
    const detail = await fetch(`${cfg.baseUrl}/smtp/emails/${uuid}`, {
      headers: { accept: "application/json", "api-key": cfg.apiKey },
    });
    if (!detail.ok) return "accepted";
    const body = (await detail.json()) as { events?: Array<{ name?: string }> };
    const names = (body.events ?? []).map((event) => event.name).filter(Boolean);
    if (names.includes("hardBounce") || names.includes("softBounce") || names.includes("blocked")) {
      return names.find((name) => name === "hardBounce" || name === "softBounce" || name === "blocked");
    }
    if (names.includes("delivered")) return "delivered";
    if (names.includes("sent")) return "sent";
    return names.at(-1) || "accepted";
  } catch {
    return undefined;
  }
}
