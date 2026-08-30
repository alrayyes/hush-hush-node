#!/usr/bin/env bash
# Regenerates src/generated/types.ts from the pinned hush-hush submodule.
# Idempotent: running this twice against the same submodule commit produces
# a byte-identical file. See design.md's "Generated/hand-written boundary"
# and "Spec pinning via git submodule" decisions.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SPEC_COMMIT=$(git -C hush-hush rev-parse HEAD)
OUT=src/generated/types.ts

mkdir -p src/generated
npx openapi-typescript hush-hush/api/openapi.yaml -o "$OUT"

# openapi-typescript already stamps its own generated-file banner; this adds
# the pinned spec commit so a maintainer can trace a release back to the
# exact hush-hush version it was generated from (spec-version traceability
# requirement), without relying solely on this repo's own commit history.
sed -i "3a\\
 * Generated from hush-hush spec commit ${SPEC_COMMIT}." "$OUT"

npx biome check --write "$OUT" >/dev/null
