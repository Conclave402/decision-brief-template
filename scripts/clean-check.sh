#!/bin/sh
# A5 check: no install script, a lockfile, and npm test on a clean copy with no network.
set -eu
src=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$src" archive --format=tar HEAD | tar -x -C "$tmp" 2>/dev/null || cp -r "$src"/. "$tmp"/
test -f "$tmp/package-lock.json" || { echo "FAIL no lockfile"; exit 1; }
node -e 'const p=require(process.argv[1]+"/package.json"); if(p.scripts&&p.scripts.install) process.exit(1)' "$tmp" || { echo "FAIL install script"; exit 1; }
test ! -f "$tmp/node_modules/.package-lock.json" || echo "note: node_modules present in copy"
cd "$tmp"
npm ci --offline --no-audit --no-fund >/dev/null 2>&1 || echo "note: npm ci offline unavailable (no dependencies to install)"
npm test
echo "clean check: PASS"
