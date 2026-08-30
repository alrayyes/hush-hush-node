// A handful of real-network smoke tests against a real hush-hush instance.
// Deliberately excluded from the default PR pipeline — see design.md's
// testing layers: this is the thin, deliberately sparse layer, not a
// substitute for the unit/contract tests that run on every PR. Skips
// itself when the staging secrets aren't set, rather than failing —
// see hush-hush-go's CLAUDE.md for why a workflow-level `if:` on secrets
// is the wrong place to gate this instead.
import { describe, expect, it } from "vitest";
import { Client } from "../../src/index.js";

const baseUrl = process.env["HUSH_HUSH_BASE_URL"];
const apiKey = process.env["HUSH_HUSH_API_KEY"];

describe.skipIf(!baseUrl || !apiKey)("e2e smoke", () => {
  it("reaches a real hush-hush instance and round-trips an object", async () => {
    const client = new Client(baseUrl ?? "", apiKey !== undefined ? { apiKey } : {});
    expect(await client.health()).toEqual({ status: "ok" });

    const id = `hush-hush-node-e2e-${Date.now()}`;
    await client.createObject(id, new Uint8Array([1, 2, 3]));
    const fetched = await client.getObject(id);
    expect(fetched).toEqual(new Uint8Array([1, 2, 3]));
    await client.deleteObject(id);
  });
});
