/**
 * Runs a fetch with a deadline. Uses a plain timer and AbortController rather than
 * AbortSignal.timeout, which didn't fire in Bun 1.1 when nothing else kept the event loop busy.
 */
export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetchFn(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
