# hush-hush-node

[![ci](https://github.com/alrayyes/hush-hush-node/actions/workflows/ci.yml/badge.svg)](https://github.com/alrayyes/hush-hush-node/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/alrayyes/hush-hush-node/graph/badge.svg)](https://codecov.io/gh/alrayyes/hush-hush-node)
[![npm](https://img.shields.io/npm/v/%40hush-hush%2Fsdk)](https://www.npmjs.com/package/@hush-hush/sdk)
[![release](https://img.shields.io/github/v/release/alrayyes/hush-hush-node)](https://github.com/alrayyes/hush-hush-node/releases)
[![license](https://img.shields.io/github/license/alrayyes/hush-hush-node)](LICENSE)

The official Node.js/TypeScript SDK for
[hush-hush](https://github.com/alrayyes/hush-hush), generated from its
OpenAPI spec and kept in sync with it automatically.

## Install

```sh
npm install @hush-hush/sdk
```

Requires Node.js 22 or newer.

## Quickstart

```ts
import { Client } from "@hush-hush/sdk";

const client = new Client("https://hush-hush.example.com", {
  apiKey: "your-api-key", // or set HUSH_HUSH_API_KEY
});

// Create is a write operation — it needs the credential above.
await client.createObject(
  "my-first-secret",
  new TextEncoder().encode("already-sealed-ciphertext"),
);

// Get needs a credential too - the apiKey above works (a write credential
// already reads any object, unrestricted), or a narrower consumer read
// token via readToken/HUSH_HUSH_READ_TOKEN when that's all you're given.
const value = await client.getObject("my-first-secret");
console.log(`got ${value.byteLength} bytes of sealed ciphertext`);

// The audit log records every read and write; querying it needs no
// credential either, and resolves with the full matching result set
// (there's no pagination on this endpoint).
for (const entry of await client.queryAuditLog()) {
  console.log(entry.action, entry.object_id, entry.timestamp);
}

// Consumers are the "what depends on this" directory objects' used_by
// lists build up. Registering one ahead of time — with its age public
// key, once it has one — needs the same credential as any other write.
await client.addConsumer("homelab/new-device");
await client.updateConsumer("homelab/new-device", { publicKey: "age1..." });
```

The API key is required for write operations (create/update/delete, plus
adding/updating/deleting a consumer), for listing consumers, and — unless
a narrower `readToken` is set instead — for `getObject`; every other read
(used-by, audit-log query) works without one. `readToken` (or
`HUSH_HUSH_READ_TOKEN`) is only consulted when `apiKey` isn't set, and
only ever changes what `getObject` sends - hush-hush scopes it to
whichever consumer it's bound to, via the object's own recorded
`usedBy`. A per-call `caller` option, accepted by create/get/update/delete,
is optional. The package ships both ESM and CommonJS builds. See the
[full API reference](https://alrayyes.github.io/hush-hush-node/) for
everything else. The latest green run's test and coverage reports are at
<https://apis.ryankes.eu/hush-hush-node/reports/>.

## Versioning

This SDK's version tracks hush-hush's OpenAPI spec, not this repo's own
commit history — see [CONTRIBUTING.md](CONTRIBUTING.md) for how a spec
change becomes a release.

## License

[MIT](LICENSE)
