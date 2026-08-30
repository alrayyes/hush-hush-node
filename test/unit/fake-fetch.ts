export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

export interface FakeResponse {
  status: number;
  headers?: Record<string, string>;
  body?: NonNullable<ConstructorParameters<typeof Response>[0]>;
}

/**
 * A fake `fetch` that returns queued responses in order and records every
 * request it received. `hush-hush`'s Client accepts an injectable `fetch`
 * for exactly this — no real network calls in unit tests.
 */
export function createFakeFetch(responses: FakeResponse[]): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: init?.body !== undefined && init.body !== null ? String(init.body) : undefined,
    });

    const next = queue.shift();
    if (next === undefined) {
      throw new Error("createFakeFetch: no queued response left");
    }
    return new Response(next.body ?? null, {
      status: next.status,
      headers: next.headers ?? {},
    });
  }) as typeof fetch;

  return { fetch: fetchImpl, requests };
}
