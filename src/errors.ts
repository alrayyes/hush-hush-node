/** Base class for every error this SDK raises. */
export class HushHushError extends Error {}

/**
 * Raised for any non-2xx response from hush-hush.
 *
 * `requestId` is populated only when the response carries a documented
 * request-ID header; hush-hush's spec doesn't currently document one, so
 * this is usually `undefined`. Kept as a property rather than omitted so a
 * future spec addition doesn't change this type's shape.
 */
export class APIError extends HushHushError {
  /** The HTTP status hush-hush responded with. */
  readonly status: number;
  /** The response's request-ID header, when hush-hush's spec documents one for it. */
  readonly requestId: string | undefined;
  /** The parsed `error` field from hush-hush's error body, if present. */
  readonly apiMessage: string | undefined;
  /** The raw, unparsed response body, for a caller that needs more than `apiMessage`. */
  readonly body: Uint8Array;

  constructor(status: number, body: Uint8Array, requestId: string | undefined) {
    const apiMessage = APIError.parseMessage(body);
    super(
      apiMessage !== undefined
        ? `hush-hush: ${status}: ${apiMessage}`
        : `hush-hush: unexpected status ${status}`,
    );
    this.name = "APIError";
    this.status = status;
    this.requestId = requestId;
    this.apiMessage = apiMessage;
    this.body = body;
  }

  private static parseMessage(body: Uint8Array): string | undefined {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
        const value = (parsed as { error?: unknown }).error;
        if (typeof value === "string") return value;
      }
    } catch {
      // Not JSON, or not decodable as UTF-8 — apiMessage stays undefined.
    }
    return undefined;
  }
}
