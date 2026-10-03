#!/usr/bin/env sh
# Style: house voice, weasel words, corporate speak, the cliches proselint
# knows. Advice, not a gate - Vale only fails on error-severity alerts
# (MinAlertLevel in .vale.ini), which is why this script's own exit code is
# the real signal and nothing here downgrades it.
set -eu

# The official image, pinned by tag and digest so a moved tag can't change the run
# unnoticed. The comment is what Renovate reads to bump both together.
IMAGE=jdkato/vale:v3.17.1@sha256:7dba3c9104ba366f172d119022c4ec53a005f7d14dc1b80e285421a3f0b71657 # renovate: datasource=docker depName=jdkato/vale

cd "$(dirname "$0")/.."

if command -v vale >/dev/null 2>&1; then
  vale sync
  vale README.md CONTRIBUTING.md CLAUDE.md SECURITY.md
else
  docker run --rm -v "$PWD:/work" -w /work --entrypoint sh "$IMAGE" \
    -c "vale sync && vale README.md CONTRIBUTING.md CLAUDE.md SECURITY.md"
fi
