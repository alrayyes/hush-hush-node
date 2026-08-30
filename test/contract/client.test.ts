// Runs the client against a Prism mock server generated from hush-hush's
// own pinned spec (see ci.yml's `contract` job) — never a hand-rolled stub.
// This proves the client's requests/responses conform to the spec; it says
// nothing about whether the real server still matches that spec, which is
// what test/pact is for. Prism's responses are the spec's own examples, not
// an echo of what was sent, so these tests only assert on shape, not values.
// Run locally with:
//   docker run -d -p 4010:4010 -v "$(pwd)/hush-hush/api:/spec:ro" \
//     stoplight/prism:5 mock -h 0.0.0.0 -m false /spec/openapi.yaml
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "../../src/index.js";

const baseUrl = process.env["HUSH_HUSH_BASE_URL"];

describe.skipIf(!baseUrl)("contract", () => {
  let client: Client;

  beforeAll(() => {
    client = new Client(baseUrl ?? "", { apiKey: "prism-does-not-check-this" });
  });

  it("reports the mock server as healthy", async () => {
    expect(await client.health()).toEqual({ status: "ok" });
  });

  it("creates, fetches, updates, and deletes an object", async () => {
    const created = await client.createObject("contract-test-object", new Uint8Array([1, 2, 3]), {
      usedBy: ["contract-test"],
      caller: "hush-hush-node-contract-test",
    });
    expect(typeof created.id).toBe("string");

    const fetched = await client.getObject("contract-test-object");
    expect(fetched).toBeInstanceOf(Uint8Array);

    const updated = await client.updateObject("contract-test-object", new Uint8Array([4, 5, 6]));
    expect(typeof updated.id).toBe("string");

    await client.deleteObject("contract-test-object");
  });

  it("queries what depends on an object", async () => {
    const usedBy = await client.getObjectUsedBy("contract-test-object");
    expect(usedBy.used_by).toBeInstanceOf(Array);
  });

  it("queries the audit log", async () => {
    const entries = await client.queryAuditLog({ objectId: "contract-test-object" });
    expect(entries).toBeInstanceOf(Array);
  });
});
