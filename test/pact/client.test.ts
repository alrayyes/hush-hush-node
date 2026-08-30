// Records this SDK's real interactions as a Pact consumer contract.
// Provider verification against hush-hush's actual server has to run in
// hush-hush's own CI (see design.md's Risks — an external dependency this
// repo can't wire up unilaterally); this module's job is only to keep
// producing an up-to-date pact file for that to consume.

import path from "node:path";
import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import { describe, it } from "vitest";
import { Client } from "../../src/index.js";

const pact = new PactV3({
  consumer: "hush-hush-node",
  provider: "hush-hush",
  dir: path.resolve(__dirname, "../../pact/pacts"),
});

describe("pact", () => {
  it("gets an object", async () => {
    pact
      .given("an object exists with id my-object")
      .uponReceiving("a request to get an object")
      .withRequest({ method: "GET", path: "/objects/my-object" })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
        body: "sealed-bytes",
      });

    await pact.executeTest(async (mockServer) => {
      const client = new Client(mockServer.url);
      const got = await client.getObject("my-object");
      const decoded = new TextDecoder().decode(got);
      if (decoded !== "sealed-bytes") {
        throw new Error(`expected sealed-bytes, got ${decoded}`);
      }
    });
  });

  it("queries the audit log", async () => {
    const { eachLike, like, regex, iso8601DateTime } = MatchersV3;

    pact
      .given("the audit log has at least one entry")
      .uponReceiving("a request to query the audit log")
      .withRequest({ method: "GET", path: "/audit-log" })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: eachLike(
          {
            object_id: like("my-object"),
            action: regex("create|read|update|delete", "read"),
            timestamp: iso8601DateTime("2026-01-01T00:00:00Z"),
          },
          1,
        ),
      });

    await pact.executeTest(async (mockServer) => {
      const client = new Client(mockServer.url);
      const entries = await client.queryAuditLog();
      if (entries.length < 1) {
        throw new Error("expected at least one audit log entry");
      }
    });
  });
});
