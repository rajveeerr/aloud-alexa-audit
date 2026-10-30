import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchWithTimeout } from "@aloud/providers";

export type WebhookConfig = { url: string; secret: string; timeoutMs?: number; fetch?: typeof fetch };

export type AuditCompletedEvent = { type: "audit.completed"; auditId: string; asin: string; score: number | null };
export type AuditFailedEvent = { type: "audit.failed"; auditId: string; asin: string; error: { code: string; message: string } };
export type AuditEvent = AuditCompletedEvent | AuditFailedEvent;

export const SIGNATURE_HEADER = "x-aloud-signature";

/** HMAC-SHA256 of the exact body, so the receiver can tell the call came from us and wasn't edited. */
export function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** For receivers (and tests): constant-time, so the comparison doesn't leak how much matched. */
export function verify(body: string, secret: string, signature: string): boolean {
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Posts the event once. A slow or broken receiver must never hold up or fail an audit,
 * so callers don't await this for the job's sake and errors only get logged.
 */
export async function sendWebhook(cfg: WebhookConfig, event: AuditEvent): Promise<void> {
  const body = JSON.stringify(event);
  const res = await fetchWithTimeout(
    cfg.fetch ?? fetch,
    cfg.url,
    { method: "POST", headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: sign(body, cfg.secret) }, body },
    cfg.timeoutMs ?? 5_000,
  );
  if (!res.ok) throw new Error(`Webhook ${cfg.url} returned HTTP ${res.status}`);
}
