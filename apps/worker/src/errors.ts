import { AuditError } from "@answerable/pipeline";
import { ProviderError, QuotaExhaustedError } from "@answerable/providers";

/**
 * What the worker does with an error:
 * - quota: the daily model quota ran out. Not the audit's fault, so wait for the reset.
 * - fail: retrying can't help (unknown listing, bad request, a refused or unrecorded call).
 * - retry: maybe transient (network, 5xx, a bug that depends on timing); fail after the last attempt.
 */
export type ErrorAction = { kind: "quota" | "fail" | "retry"; code: string; message: string };

export function classify(err: unknown): ErrorAction {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof QuotaExhaustedError || (err instanceof Error && err.name === "QuotaExhaustedError")) {
    return { kind: "quota", code: "quota_exhausted", message };
  }
  if (err instanceof AuditError) return { kind: "fail", code: err.code, message };
  if (err instanceof ProviderError) {
    return err.retryable ? { kind: "retry", code: "provider_unavailable", message } : { kind: "fail", code: "provider_error", message };
  }
  return { kind: "retry", code: "internal", message };
}
