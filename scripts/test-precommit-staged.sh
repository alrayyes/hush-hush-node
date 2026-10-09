#!/usr/bin/env sh
# pre-commit must judge only what the commit contains. In a scratch repo, dirty
# the tree with an unstaged badly formatted file, stage one clean file, and check
# the pre-commit hook neither fails on nor rewrites the dirty one. Also checks no
# pre-commit job lacks {staged_files}. The scratch repo keeps the junk out of
# the real tree, where parallel pre-push jobs would trip over it.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

if awk '/^pre-commit:/{f=1;next} /^[a-z]/{f=0} f&&/run:/&&!/\{staged_files\}/{bad=1} END{exit !bad}' lefthook.yml; then
  echo "FAIL: a pre-commit job does not take {staged_files}" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# A push hook exports GIT_DIR and friends; the scratch repo must not inherit them.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE LEFTHOOK_EXCLUDE
cp lefthook.yml biome.json "$tmp"/
ln -s "$root/node_modules" "$tmp/node_modules"
cd "$tmp"
git init -q .
printf 'const   x =  1 ;;\nlet y\n' >bad.ts # unstaged and untracked
before=$(cksum <bad.ts)
printf '{}\n' >good.json
git add good.json

"$root/node_modules/.bin/lefthook" run pre-commit --no-auto-install >/dev/null 2>&1 || {
  echo "FAIL: pre-commit failed because of an unstaged file" >&2
  exit 1
}
[ "$before" = "$(cksum <bad.ts)" ] || { echo "FAIL: hook rewrote an unstaged file" >&2; exit 1; }
echo "ok: pre-commit ignored the dirty tree"
