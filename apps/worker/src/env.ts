import type { WebhookConfig } from "./webhook";

/** The audit.completed webhook is optional; it needs both a URL and a secret to sign with. */
export function webhookFromEnv(env: Record<string, string | undefined> = process.env): WebhookConfig | null {
  if (!env.AUDIT_WEBHOOK_URL) return null;
  if (!env.AUDIT_WEBHOOK_SECRET) throw new Error("AUDIT_WEBHOOK_URL is set but AUDIT_WEBHOOK_SECRET is not");
  return { url: env.AUDIT_WEBHOOK_URL, secret: env.AUDIT_WEBHOOK_SECRET };
}
