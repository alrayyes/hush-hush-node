import { APIError } from "./errors.js";
import type { components, operations } from "./generated/types.js";
import { DEFAULT_MAX_RETRIES, fetchWithRetry } from "./retry.js";

type _ObjectMetadata = components["schemas"]["ObjectMetadata"];
type _UsedBy = components["schemas"]["UsedBy"];
type _Health = components["schemas"]["Health"];
type _AuditLogEntry = components["schemas"]["AuditLogEntry"];
type _ConsumerEntry = components["schemas"]["ConsumerEntry"];
type _ConsumersPage = components["schemas"]["ConsumersPage"];

/** An object's slug and its recorded consumers. */
export interface ObjectMetadata extends _ObjectMetadata {}
/** The consumers (repos or hosts) recorded as depending on an object. */
export interface UsedBy extends _UsedBy {}
/** hush-hush's liveness response. */
export interface Health extends _Health {}
/** One recorded create, read, update, or delete call. */
export interface AuditLogEntry extends _AuditLogEntry {}
/** The kind of call an {@link AuditLogEntry} recorded. */
export type AuditLogAction = AuditLogEntry["action"];
/** A distinct consumer, its secret count, and its registered public key (if any). */
export interface ConsumerEntry extends _ConsumerEntry {}
/** One page of {@link ConsumerEntry} results, plus the total matching count. */
export interface ConsumersPage extends _ConsumersPage {}
/**
 * {@link Client.listConsumers}'s response shape: the plain, unpaginated
 * array of every distinct consumer name when called with no filter, or a
 * {@link ConsumersPage} when called with any of `q`/`page`/`pageSize`.
 */
export type ConsumersResult =
  operations["listConsumers"]["responses"][200]["content"]["application/json"];

const API_KEY_ENV_VAR = "HUSH_HUSH_API_KEY";
const READ_TOKEN_ENV_VAR = "HUSH_HUSH_READ_TOKEN";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Options accepted by the {@link Client} constructor. */
export interface ClientOptions {
  /**
   * Bearer credential for write paths (create/update/delete) and for
   * listing consumers. Falls back to the `HUSH_HUSH_API_KEY` environment
   * variable when not supplied. Also used for {@link Client.getObject}
   * when no `readToken` is set - a write credential already reads any
   * object, unrestricted.
   */
  apiKey?: string;
  /**
   * Bearer credential for {@link Client.getObject}, scoped by hush-hush to
   * whichever consumer the token is bound to. Falls back to the
   * `HUSH_HUSH_READ_TOKEN` environment variable when not supplied, and is
   * only consulted when `apiKey` isn't set - a write credential already
   * grants unrestricted reads, so there's nothing for a narrower read
   * token to add on top of it.
   */
  readToken?: string;
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

/** Optional filters for {@link Client.listConsumers}. Giving any of these switches the response from a plain name array to a {@link ConsumersPage}. */
export interface ListConsumersFilter {
  /** Restrict to consumers whose name contains this substring, case-insensitive. */
  q?: string;
  /** 1-based page number. */
  page?: number;
  /** Maximum consumers per page. Defaults to 20, capped at 100. */
  pageSize?: number;
}

interface RequestOptions {
  authenticated?: boolean;
  /** Sends `apiKey ?? readToken` - see {@link Client.getObject}'s own doc comment. */
  readCredential?: boolean;
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
  private readonly readToken: string | undefined;
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
    this.readToken = options.readToken ?? process.env[READ_TOKEN_ENV_VAR];
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
   * Stores an already-sealed value under a new object slug. Requires a credential.
   *
   * @param slug - The new object's slug. Must match hush-hush's slug pattern (lowercase alphanumeric, `-`/`_`).
   * @param value - The already-sealed (encrypted) value. This SDK never encrypts or decrypts anything.
   * @param options.usedBy - Consumers (repos or hosts) recorded as depending on this object.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 201 (e.g. 409 if the slug exists).
   */
  async createObject(
    slug: string,
    value: Uint8Array,
    options: { usedBy?: string[]; caller?: string } = {},
  ): Promise<ObjectMetadata> {
    const response = await this.request("POST", "/objects", {
      authenticated: true,
      caller: options.caller,
      jsonBody: {
        slug,
        value: base64Encode(value),
        ...(options.usedBy !== undefined ? { used_by: options.usedBy } : {}),
      },
    });
    return (await response.json()) as ObjectMetadata;
  }

  /**
   * Fetches an object's sealed ciphertext exactly as stored — this SDK never
   * decrypts it, the same as the server. Requires a credential: `apiKey` if
   * set, otherwise `readToken` - hush-hush accepts either a write bearer
   * token (unrestricted) or a consumer read token (scoped to whichever
   * consumer it's bound to, via the object's own recorded `usedBy`).
   *
   * @param slug - The object's slug.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 200 (e.g. 401 with no valid credential, or 404).
   */
  async getObject(slug: string, options: { caller?: string } = {}): Promise<Uint8Array> {
    const response = await this.request("GET", `/objects/${encodeURIComponent(slug)}`, {
      readCredential: true,
      caller: options.caller,
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Replaces the stored ciphertext for an existing object. The object's slug
   * and used-by metadata are unchanged. Requires a credential.
   *
   * @param slug - The existing object's slug.
   * @param value - The new already-sealed (encrypted) value.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 200 (e.g. 401 or 404).
   */
  async updateObject(
    slug: string,
    value: Uint8Array,
    options: { caller?: string } = {},
  ): Promise<ObjectMetadata> {
    const response = await this.request("PUT", `/objects/${encodeURIComponent(slug)}`, {
      authenticated: true,
      caller: options.caller,
      jsonBody: { value: base64Encode(value) },
    });
    return (await response.json()) as ObjectMetadata;
  }

  /**
   * Permanently removes an object. A subsequent fetch by this slug returns 404. Requires a credential.
   *
   * @param slug - The object's slug.
   * @param options.caller - Recorded in the audit log as the calling program's self-reported identity.
   * @throws {APIError} If the server responds with anything other than 204 (e.g. 401 or 404).
   */
  async deleteObject(slug: string, options: { caller?: string } = {}): Promise<void> {
    await this.request("DELETE", `/objects/${encodeURIComponent(slug)}`, {
      authenticated: true,
      caller: options.caller,
    });
  }

  /**
   * Returns the recorded list of consumers for an object — the "what
   * depends on this" mapping set at creation. Needs no credential.
   *
   * @param slug - The object's slug.
   * @throws {APIError} If the server responds with anything other than 200 (e.g. 404).
   */
  async getObjectUsedBy(slug: string): Promise<UsedBy> {
    const response = await this.request("GET", `/objects/${encodeURIComponent(slug)}/used-by`);
    return (await response.json()) as UsedBy;
  }

  /**
   * Lists recorded consumer names. Requires a credential — unlike every
   * other read in this client, listing needs no id the caller already
   * holds, so it's gated the same way `GET /objects` is.
   *
   * Called with no filter, resolves with the plain, unpaginated array of
   * every distinct consumer name — hush-hush's own consumer-combobox call
   * site depends on this shape staying unchanged. Given any of `q`,
   * `page`, or `pageSize`, resolves with a {@link ConsumersPage} instead:
   * one page of matching consumers, each with its secret count and
   * registered public key (if any), plus the total matching count.
   *
   * @param filter - Optional name substring and pagination.
   */
  async listConsumers(filter: ListConsumersFilter = {}): Promise<ConsumersResult> {
    const response = await this.request("GET", "/consumers", {
      authenticated: true,
      query: {
        q: filter.q,
        page: filter.page?.toString(),
        page_size: filter.pageSize?.toString(),
      },
    });
    return (await response.json()) as ConsumersResult;
  }

  /**
   * Adds a consumer to the directory with no secret referencing it yet.
   * Requires a credential.
   *
   * @param name - The consumer's name.
   * @throws {APIError} If the server responds with anything other than 201 (e.g. 409 if it already exists).
   */
  async addConsumer(name: string): Promise<ConsumerEntry> {
    const response = await this.request("POST", "/consumers", {
      authenticated: true,
      jsonBody: { name },
    });
    return (await response.json()) as ConsumerEntry;
  }

  /**
   * Renames a consumer and/or registers its age public key. At least one
   * of `options.newName` or `options.publicKey` is required; the one left
   * out leaves that aspect of the consumer unchanged. There's no way to
   * clear a registered key through this call, only to set or replace one.
   * Requires a credential.
   *
   * @param name - The consumer's current recorded name.
   * @param options.newName - The consumer's new name. If it already matches another recorded consumer, the two merge.
   * @param options.publicKey - The age public key to register or replace on the (possibly just-renamed) consumer.
   * @throws {APIError} If the server responds with anything other than 200 (e.g. 404 if `name` is unrecorded).
   */
  async updateConsumer(
    name: string,
    options: { newName?: string; publicKey?: string } = {},
  ): Promise<ConsumerEntry> {
    // `name` is sent unencoded here too — see deleteConsumer's comment.
    const response = await this.request("PATCH", `/consumers/${name}`, {
      authenticated: true,
      jsonBody: {
        ...(options.newName !== undefined ? { name: options.newName } : {}),
        ...(options.publicKey !== undefined ? { public_key: options.publicKey } : {}),
      },
    });
    return (await response.json()) as ConsumerEntry;
  }

  /**
   * Removes a consumer from every object that references it. The objects
   * themselves aren't touched otherwise, and none are deleted even if this
   * empties their `used_by` list. Requires a credential.
   *
   * @param name - The consumer's recorded name.
   * @throws {APIError} If the server responds with anything other than 204 (e.g. 404 if unrecorded).
   */
  async deleteConsumer(name: string): Promise<void> {
    // Unlike every other path segment in this client, `name` is sent
    // unencoded on purpose: the server matches everything after
    // `/consumers/` verbatim, including a literal `/` (names routinely
    // look like `homelab/vps-docker`) — encodeURIComponent here would
    // %2F-escape that and send a name the server no longer recognizes.
    await this.request("DELETE", `/consumers/${name}`, {
      authenticated: true,
    });
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
    } else if (options.readCredential === true) {
      const token = this.apiKey ?? this.readToken;
      if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
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
