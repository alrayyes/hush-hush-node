# hush-hush-node

[![ci](https://github.com/alrayyes/hush-hush-node/actions/workflows/ci.yml/badge.svg)](https://github.com/alrayyes/hush-hush-node/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/alrayyes/hush-hush-node/graph/badge.svg)](https://codecov.io/gh/alrayyes/hush-hush-node)
[![npm](https://img.shields.io/npm/v/hush-hush)](https://www.npmjs.com/package/hush-hush)
[![release](https://img.shields.io/github/v/release/alrayyes/hush-hush-node)](https://github.com/alrayyes/hush-hush-node/releases)
[![license](https://img.shields.io/github/license/alrayyes/hush-hush-node)](LICENSE)

The official Node.js/TypeScript SDK for
[hush-hush](https://github.com/alrayyes/hush-hush), generated from its
OpenAPI spec and kept in sync with it automatically.

## Install

```sh
npm install hush-hush
```

Requires Node.js 22 or newer.

## Quickstart

```ts
import { Client } from "hush-hush";

const client = new Client("https://hush-hush.example.com", {
  apiKey: "your-api-key", // or set HUSH_HUSH_API_KEY
});

// Create is a write operation — it needs the credential above.
await client.createObject(
  "my-first-secret",
  new TextEncoder().encode("already-sealed-ciphertext"),
);

// Get needs no credential — hush-hush's confidentiality boundary is
// "who holds a matching private key," not who's calling this endpoint.
const value = await client.getObject("my-first-secret");
console.log(`got ${value.byteLength} bytes of sealed ciphertext`);

// The audit log records every read and write; querying it needs no
// credential either, and resolves with the full matching result set
// (there's no pagination on this endpoint).
for (const entry of await client.queryAuditLog()) {
  console.log(entry.action, entry.object_id, entry.timestamp);
}
```

The API key is only required for write operations (create/update/delete);
reads (get, used-by, audit-log query) work without one. A per-call `caller`
option, accepted by create/get/update/delete, is optional. The package
ships both ESM and CommonJS builds. See the
[full API reference](https://alrayyes.github.io/hush-hush-node/) for
everything else.

## Versioning

This SDK's version tracks hush-hush's OpenAPI spec, not this repo's own
commit history — see [CONTRIBUTING.md](CONTRIBUTING.md) for how a spec
change becomes a release.

## License

[MIT](LICENSE)
