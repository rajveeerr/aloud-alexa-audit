import { AuditError } from "@aloud/pipeline";
import { ProviderError, QuotaExhaustedError } from "@aloud/providers";

/**
 * What the worker does with an error:
 * - quota: the daily model quota ran out. Not the audit's fault, so wait for the reset.
 * - fail: retrying can't help (unknown listing, bad request, a refused or unrecorded call).
 * - retry: maybe transient (network, 5xx, a bug that depends on timing); fail after the last attempt.
 *
 * `message` is stored on the audit and shown to clients, so it never carries internals.
 */
export type ErrorAction = { kind: "quota" | "fail" | "retry"; code: string; message: string };

export const INTERNAL_MESSAGE = "Something went wrong while running the audit.";

/** CachedLlm in replay mode throws this when a call was never recorded. */
function isReplayMiss(err: ProviderError): boolean {
  return err.provider.startsWith("cached:") && err.message.startsWith("No recorded LLM response");
}

export function classify(err: unknown): ErrorAction {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof QuotaExhaustedError || (err instanceof Error && err.name === "QuotaExhaustedError")) {
    return { kind: "quota", code: "quota_exhausted", message };
  }
  if (err instanceof AuditError) return { kind: "fail", code: err.code, message };
  if (err instanceof ProviderError) {
    if (isReplayMiss(err)) {
      return { kind: "fail", code: "not_recorded", message: "This audit needs model calls that haven't been recorded, and recording is off." };
    }
    return err.retryable ? { kind: "retry", code: "provider_unavailable", message } : { kind: "fail", code: "provider_error", message };
  }
  return { kind: "retry", code: "internal", message: INTERNAL_MESSAGE };
}
