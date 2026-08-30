import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APIError, Client } from "../../src/index.js";
import { createFakeFetch } from "./fake-fetch.js";

const ENV_VAR = "HUSH_HUSH_API_KEY";

describe("Client construction", () => {
  const original = process.env[ENV_VAR];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = original;
  });

  it("uses HUSH_HUSH_API_KEY from the environment when no credential is given", async () => {
    process.env[ENV_VAR] = "env-token";
    const { fetch, requests } = createFakeFetch([
      { status: 201, body: JSON.stringify({ id: "x" }) },
    ]);
    const client = new Client("https://hush-hush.test", { fetch });

    await client.createObject("x", new Uint8Array([1]));

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer env-token");
  });

  it("uses an explicit credential over the environment variable", async () => {
    process.env[ENV_VAR] = "env-token";
    const { fetch, requests } = createFakeFetch([
      { status: 201, body: JSON.stringify({ id: "x" }) },
    ]);
    const client = new Client("https://hush-hush.test", { apiKey: "explicit-token", fetch });

    await client.createObject("x", new Uint8Array([1]));

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer explicit-token");
  });
});

describe("Typed resource operations", () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  it("sends a typed create request and returns a typed response", async () => {
    const { fetch, requests } = createFakeFetch([
      { status: 201, body: JSON.stringify({ id: "my-object", used_by: ["repo/a"] }) },
    ]);
    const client = new Client("https://hush-hush.test", { apiKey: "token", fetch });

    const result = await client.createObject("my-object", new Uint8Array([1, 2, 3]), {
      usedBy: ["repo/a"],
    });

    expect(result).toEqual({ id: "my-object", used_by: ["repo/a"] });
    expect(requests[0]?.method).toBe("POST");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      id: "my-object",
      value: Buffer.from([1, 2, 3]).toString("base64"),
      used_by: ["repo/a"],
    });
  });

  it("returns the raw sealed bytes from get, not a JSON-decoded value", async () => {
    const sealed = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const { fetch } = createFakeFetch([{ status: 200, body: sealed }]);
    const client = new Client("https://hush-hush.test", { fetch });

    const result = await client.getObject("my-object");

    expect(result).toEqual(sealed);
  });

  it("succeeds on a read-only call without any credential set", async () => {
    delete process.env[ENV_VAR];
    const { fetch, requests } = createFakeFetch([{ status: 200, body: new Uint8Array([1]) }]);
    const client = new Client("https://hush-hush.test", { fetch });

    await client.getObject("my-object");

    expect(requests[0]?.headers.has("authorization")).toBe(false);
  });

  it("attaches X-Caller per call, not client-wide", async () => {
    const { fetch, requests } = createFakeFetch([
      { status: 200, body: new Uint8Array([1]) },
      { status: 200, body: new Uint8Array([1]) },
    ]);
    const client = new Client("https://hush-hush.test", { fetch });

    await client.getObject("my-object", { caller: "repo/a" });
    await client.getObject("my-object");

    expect(requests[0]?.headers.get("x-caller")).toBe("repo/a");
    expect(requests[1]?.headers.has("x-caller")).toBe(false);
  });

  it("queries the used-by endpoint", async () => {
    const { fetch, requests } = createFakeFetch([
      { status: 200, body: JSON.stringify({ used_by: ["repo/a"] }) },
    ]);
    const client = new Client("https://hush-hush.test", { fetch });

    const result = await client.getObjectUsedBy("my-object");

    expect(result).toEqual({ used_by: ["repo/a"] });
    expect(requests[0]?.url).toBe("https://hush-hush.test/objects/my-object/used-by");
  });
});

describe("Health, update, and delete", () => {
  it("reports the server as up", async () => {
    const { fetch } = createFakeFetch([{ status: 200, body: JSON.stringify({ status: "ok" }) }]);
    const client = new Client("https://hush-hush.test", { fetch });

    expect(await client.health()).toEqual({ status: "ok" });
  });

  it("replaces an object's value", async () => {
    const { fetch, requests } = createFakeFetch([
      { status: 200, body: JSON.stringify({ id: "my-object" }) },
    ]);
    const client = new Client("https://hush-hush.test", { apiKey: "token", fetch });

    const result = await client.updateObject("my-object", new Uint8Array([9]));

    expect(result).toEqual({ id: "my-object" });
    expect(requests[0]?.method).toBe("PUT");
  });

  it("deletes an object", async () => {
    const { fetch, requests } = createFakeFetch([{ status: 204 }]);
    const client = new Client("https://hush-hush.test", { apiKey: "token", fetch });

    await client.deleteObject("my-object");

    expect(requests[0]?.method).toBe("DELETE");
  });
});

describe("Audit log query", () => {
  it("sends filters as query parameters and returns the matching entries", async () => {
    const entries = [{ object_id: "my-object", action: "read", timestamp: "2026-01-01T00:00:00Z" }];
    const { fetch, requests } = createFakeFetch([{ status: 200, body: JSON.stringify(entries) }]);
    const client = new Client("https://hush-hush.test", { fetch });

    const result = await client.queryAuditLog({ objectId: "my-object", caller: "repo/a" });

    expect(result).toEqual(entries);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.searchParams.get("object_id")).toBe("my-object");
    expect(url.searchParams.get("caller")).toBe("repo/a");
  });
});

describe("Typed error mapping", () => {
  it("raises a typed error with status and parsed body for a non-retryable 4xx", async () => {
    const { fetch } = createFakeFetch([
      { status: 404, body: JSON.stringify({ error: "unknown object" }) },
    ]);
    const client = new Client("https://hush-hush.test", { fetch });

    const error: unknown = await client.getObject("missing").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ status: 404, apiMessage: "unknown object" });
  });
});
