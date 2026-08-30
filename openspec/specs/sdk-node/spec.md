## Purpose

Defines the observable client behavior third-party integrators depend on when calling hush-hush from Node/TypeScript: how a client is constructed, what typed operations it exposes, and how it surfaces errors, retries, and pagination.

## ADDED Requirements

### Requirement: Client construction
The SDK SHALL provide a constructor that accepts a base URL, an optional bearer credential (falling back to the `HUSH_HUSH_API_KEY` environment variable when not supplied), a request timeout, and a maximum retry count.

#### Scenario: Credential from environment
- **WHEN** a caller constructs a client without an explicit credential and `HUSH_HUSH_API_KEY` is set in the environment
- **THEN** the client uses that environment value as its bearer credential

#### Scenario: Explicit credential overrides environment
- **WHEN** a caller constructs a client with an explicit credential and `HUSH_HUSH_API_KEY` is also set
- **THEN** the client uses the explicit credential

### Requirement: Typed resource operations
The SDK SHALL expose typed, Promise-returning methods for creating, retrieving, updating, and deleting a sealed object, for querying which consumers depend on an object, and for querying the audit log, rather than requiring callers to construct raw HTTP requests.

#### Scenario: Typed create call
- **WHEN** a caller invokes the create method with a valid typed request object
- **THEN** the SDK sends the corresponding HTTP request and resolves with a typed response object on success

#### Scenario: Get returns the raw sealed value
- **WHEN** a caller invokes the get method for an existing object
- **THEN** the SDK resolves with the object's ciphertext exactly as the server sent it (`application/octet-stream`), not a JSON-decoded value

#### Scenario: Unauthenticated read succeeds without a credential
- **WHEN** a caller invokes a read-only method (get, used-by, audit-log query) on a client constructed without a credential
- **THEN** the call succeeds, since hush-hush requires a bearer token only on write paths (create/update/delete)

### Requirement: Audit log query
The SDK SHALL expose a typed method for querying the audit log with optional `objectId`/`caller`/`from`/`to` filters, resolving with the full matching result set as a single typed array. hush-hush's `/audit-log` endpoint has no pagination parameters, so the SDK SHALL NOT invent a cursor or `AsyncIterable` over it.

#### Scenario: Query with filters
- **WHEN** a caller invokes the audit-log query method with one or more filters set
- **THEN** the SDK sends them as query parameters and resolves with the matching entries, oldest first, as returned by the server

### Requirement: Typed error mapping
The SDK SHALL map any non-2xx HTTP response to a typed error carrying the HTTP status code, the parsed error response body, and a request ID when the response provides one — never a bare string or the raw `Response` object.

#### Scenario: Server returns a 4xx validation error
- **WHEN** the server responds with a non-2xx, non-retryable status
- **THEN** the SDK rejects with a typed error containing that status and the parsed error body, without retrying

### Requirement: Retry behavior
The SDK SHALL retry a request only on network failure or an HTTP 5xx/429 response, using exponential backoff with jitter, and SHALL honor a `Retry-After` response header ahead of its own backoff schedule when present. The SDK SHALL NOT retry any other 4xx response.

#### Scenario: Transient server error is retried
- **WHEN** a request receives a 503 response and retries remain
- **THEN** the SDK retries the request after a backoff delay

#### Scenario: Retry-After takes priority
- **WHEN** a 429 response includes a `Retry-After` header
- **THEN** the SDK waits at least that long before retrying, in preference to its own computed backoff delay

#### Scenario: Non-retryable client error is not retried
- **WHEN** a request receives a 400 response
- **THEN** the SDK rejects with the typed error immediately without retrying

### Requirement: Spec-version traceability
The SDK SHALL make the exact hush-hush spec commit it was generated from discoverable from within the repository, so a maintainer can determine which version of the API contract a given release matches.

#### Scenario: Spec commit is recorded in-repo
- **WHEN** a maintainer inspects a released version of the SDK
- **THEN** the exact spec commit it was generated from is discoverable from the repository itself, not only from a commit message
