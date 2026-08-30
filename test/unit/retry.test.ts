import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../../src/retry.js";

describe("fetchWithRetry", () => {
  it("retries a transient 503 after a backoff delay", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return calls === 1
          ? new Response(null, { status: 503 })
          : new Response("ok", { status: 200 });
      }) as typeof fetch;

      const promise = fetchWithRetry(fetchImpl, "https://example.test/", {}, 3);
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits at least the Retry-After duration before retrying, in preference to backoff", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        if (calls === 1) {
          return new Response(null, { status: 429, headers: { "retry-after": "5" } });
        }
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const promise = fetchWithRetry(fetchImpl, "https://example.test/", {}, 3);
      await vi.runAllTimersAsync();
      await promise;

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-retryable 400 response", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(null, { status: 400 });
    }) as typeof fetch;

    const response = await fetchWithRetry(fetchImpl, "https://example.test/", {}, 3);

    expect(response.status).toBe(400);
    expect(calls).toBe(1);
  });

  it("retries a network failure and eventually succeeds", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        if (calls === 1) throw new Error("network down");
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const promise = fetchWithRetry(fetchImpl, "https://example.test/", {}, 3);
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws the network error once retries are exhausted", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (async () => {
        throw new Error("network down");
      }) as typeof fetch;

      const promise = fetchWithRetry(fetchImpl, "https://example.test/", {}, 1);
      const assertion = expect(promise).rejects.toThrow("network down");
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
