import { APIError } from "./errors.js";
import type { components } from "./generated/types.js";
import { DEFAULT_MAX_RETRIES, fetchWithRetry } from "./retry.js";

type _ObjectMetadata = components["schemas"]["ObjectMetadata"];
type _UsedBy = components["schemas"]["UsedBy"];
type _Health = components["schemas"]["Health"];
type _AuditLogEntry = components["schemas"]["AuditLogEntry"];

/** An object's id and its recorded consumers. */
export interface ObjectMetadata extends _ObjectMetadata {}
/** The consumers (repos or hosts) recorded as depending on an object. */
export interface UsedBy extends _UsedBy {}
/** hush-hush's liveness response. */
export interface Health extends _Health {}
/** One recorded create, read, update, or delete call. */
export interface AuditLogEntry extends _AuditLogEntry {}
/** The kind of call an {@link AuditLogEntry} recorded. */
export type AuditLogAction = AuditLogEntry["action"];

const API_KEY_ENV_VAR = "HUSH_HUSH_API_KEY";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Options accepted by the {@link Client} constructor. */
export interface ClientOptions {
  /**
   * Bearer credential for write paths (create/update/delete). Falls back to
   * the `HUSH_HUSH_API_KEY` environment variable when not supplied. Read
   * paths (get, used-by, audit-log query) need no credential at all.
   */
  apiKey?: string;
  /** Per-request timeout, in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Maximum retry attempts for network failures and 5xx/429 responses. Defaults to 3. */
  maxRetries?: number;
  /** Override for the `fetch` implementation, mainly for tests. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

/** Optional filters for {@link Client.queryAuditLog}. Filters combine with AND when more than one is set. */
export interface AuditLogFilter {
  /** Restrict to entries for this object id. */
  objectId?: string;
  /** Restrict to entries recorded with this caller identity. */
  caller?: string;
  /** Restrict to entries at or after this ISO-8601 timestamp. */
  from?: string;
  /** Restrict to entries at or before this ISO-8601 timestamp. */
  to?: string;
}

interface RequestOptions {
  authenticated?: boolean;
  caller?: string | undefined;
  query?: Record<string, string | undefined>;
  body?: RequestInit["body"];
  jsonBody?: unknown;
}

/**
 * A typed client for hush-hush, a standalone secrets object store.
 *
 * @example
 * ```ts
 * const client = new Client("https://hush-hush.example.com");
 * const meta = await client.createObject("my-object", sealedBytes);
 * ```
 */
export class Client {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  /**
   * @param baseUrl - hush-hush's base URL, e.g. `https://hush-hush.example.com`.
   * @param options - Credential, timeout, and retry configuration.
   */
  constructor(baseUrl: string, options: ClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? process.env[API_KEY_ENV_VAR];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Answers whether the server process is up. Needs no credential. */
  async health(): Promise<Health> {
    const response = await this.request("GET", "/healthz");
    return (await response.json()) as Health;
  }

  /**
   * Stores an already-sealed value under a new object id. Requires a credential.
   *
   * @param id - The new object's id. Must match hush-hush's id pattern (lowercase alphanumeric, `-`/`_`).
   * @param value - The already-sealed (encrypted) value. This SDK never encrypts or decrypts anything.
   * @param options.usedBy - Consumers (repos or hosts) recorded as depending on this object.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 201 (e.g. 409 if the id exists).
   */
  async createObject(
    id: string,
    value: Uint8Array,
    options: { usedBy?: string[]; caller?: string } = {},
  ): Promise<ObjectMetadata> {
    const response = await this.request("POST", "/objects", {
      authenticated: true,
      caller: options.caller,
      jsonBody: {
        id,
        value: base64Encode(value),
        ...(options.usedBy !== undefined ? { used_by: options.usedBy } : {}),
      },
    });
    return (await response.json()) as ObjectMetadata;
  }

  /**
   * Fetches an object's sealed ciphertext exactly as stored — this SDK never
   * decrypts it, the same as the server. Needs no credential.
   *
   * @param id - The object's id.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 200 (e.g. 404).
   */
  async getObject(id: string, options: { caller?: string } = {}): Promise<Uint8Array> {
    const response = await this.request("GET", `/objects/${encodeURIComponent(id)}`, {
      caller: options.caller,
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Replaces the stored ciphertext for an existing object. The object's id
   * and used-by metadata are unchanged. Requires a credential.
   *
   * @param id - The existing object's id.
   * @param value - The new already-sealed (encrypted) value.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 200 (e.g. 401 or 404).
   */
  async updateObject(
    id: string,
    value: Uint8Array,
    options: { caller?: string } = {},
  ): Promise<ObjectMetadata> {
    const response = await this.request("PUT", `/objects/${encodeURIComponent(id)}`, {
      authenticated: true,
      caller: options.caller,
      jsonBody: { value: base64Encode(value) },
    });
    return (await response.json()) as ObjectMetadata;
  }

  /**
   * Permanently removes an object. A subsequent fetch by this id returns 404. Requires a credential.
   *
   * @param id - The object's id.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 204 (e.g. 401 or 404).
   */
  async deleteObject(id: string, options: { caller?: string } = {}): Promise<void> {
    await this.request("DELETE", `/objects/${encodeURIComponent(id)}`, {
      authenticated: true,
      caller: options.caller,
    });
  }

  /**
   * Returns the recorded list of consumers for an object — the "what
   * depends on this" mapping set at creation. Needs no credential.
   *
   * @param id - The object's id.
   * @throws {APIError} If the server responds with anything other than 200 (e.g. 404).
   */
  async getObjectUsedBy(id: string): Promise<UsedBy> {
    const response = await this.request("GET", `/objects/${encodeURIComponent(id)}/used-by`);
    return (await response.json()) as UsedBy;
  }

  /**
   * Queries the audit log — every create, read, update, and delete call is
   * recorded here. Needs no credential. Filters combine with AND when more
   * than one is given.
   *
   * hush-hush's `/audit-log` endpoint has no pagination parameters, so this
   * always resolves with the full matching result set as a single array,
   * never a page plus a cursor.
   *
   * @param filter - Optional `objectId`/`caller`/`from`/`to` filters.
   */
  async queryAuditLog(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
    const response = await this.request("GET", "/audit-log", {
      query: {
        object_id: filter.objectId,
        caller: filter.caller,
        from: filter.from,
        to: filter.to,
      },
    });
    return (await response.json()) as AuditLogEntry[];
  }

  private async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const headers = new Headers();
    if (options.caller !== undefined) headers.set("X-Caller", options.caller);
    if (options.authenticated === true && this.apiKey !== undefined) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }

    let body: RequestInit["body"] = options.body;
    if (options.jsonBody !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.jsonBody);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetchWithRetry(
        this.fetchImpl,
        url.toString(),
        { method, headers, signal: controller.signal, ...(body !== undefined ? { body } : {}) },
        this.maxRetries,
      );
      if (!response.ok) {
        const responseBody = new Uint8Array(await response.arrayBuffer());
        throw new APIError(
          response.status,
          responseBody,
          response.headers.get("x-request-id") ?? undefined,
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function base64Encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}
