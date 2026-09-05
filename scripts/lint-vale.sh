#!/usr/bin/env sh
# Style: house voice, weasel words, corporate speak, the cliches proselint
# knows. Advice, not a gate - Vale only fails on error-severity alerts
# (MinAlertLevel in .vale.ini), which is why this script's own exit code is
# the real signal and nothing here downgrades it.
set -eu

VERSION=v3.17.1
IMAGE="jdkato/vale:$VERSION"

cd "$(dirname "$0")/.."

if command -v vale >/dev/null 2>&1; then
  vale sync
  vale README.md CONTRIBUTING.md CLAUDE.md SECURITY.md
else
  docker run --rm -v "$PWD:/work" -w /work --entrypoint sh "$IMAGE" \
    -c "vale sync && vale README.md CONTRIBUTING.md CLAUDE.md SECURITY.md"
fi
