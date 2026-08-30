/**
 * Retries a request only on network failure or an HTTP 5xx/429 response,
 * using exponential backoff with jitter, and honors a `Retry-After` response
 * header ahead of the computed backoff delay when present. Any other 4xx is
 * never retried — it won't succeed on a second attempt, and retrying only
 * delays the real error reaching the caller.
 */

export const DEFAULT_MAX_RETRIES = 3;

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? seconds * 1000 : undefined;
  }

  const when = Date.parse(value);
  if (Number.isNaN(when)) return undefined;
  return Math.max(when - Date.now(), 0);
}

function backoffMs(attempt: number, retryAfterOverrideMs: number | undefined): number {
  if (retryAfterOverrideMs !== undefined) return retryAfterOverrideMs;
  const base = 100 * 2 ** (attempt - 1);
  return base + Math.random() * base;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  maxRetries: number,
): Promise<Response> {
  let nextDelayOverrideMs: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await delay(backoffMs(attempt, nextDelayOverrideMs));
      nextDelayOverrideMs = undefined;
    }

    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      continue;
    }

    if (!isRetryableStatus(response.status) || attempt === maxRetries) {
      return response;
    }
    nextDelayOverrideMs = retryAfterMs(response);
    await response.body?.cancel();
  }

  throw new Error("fetchWithRetry: unreachable — maxRetries must be >= 0");
}
