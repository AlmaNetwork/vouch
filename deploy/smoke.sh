#!/usr/bin/env sh
# Deploy smoke test. Exercises the READ surface, a real SIGNED write round-trip, and
# the rejection path, against a running node.
#
#   sh deploy/smoke.sh https://node.example.org
#   sh deploy/smoke.sh http://127.0.0.1:8787
#
# The write half goes through vouch-cli on purpose. A signed command is an Ed25519
# signature over JCS-canonicalized bytes with a domain-separated purpose string — curl
# cannot produce that without reimplementing the signing scheme in shell, and a smoke
# test that only does reads cannot tell a working node from one that accepts unsigned
# commands or silently fails to persist.
#
# Needs: bun on PATH, and a checkout (it runs vouch-cli from source).
#
# What this does NOT prove: that writes are DURABLE. A node running with an in-memory
# journal (VOUCH_JOURNAL unset) passes every check here, because within one process the
# write is visible — persistence only shows up across a restart, and nothing the node
# exposes reveals its journal path. Verified: a deliberately ephemeral node passes.
# The restart check is a first-deploy step in DEPLOY.md, not something this script can do.
set -eu

BASE="${1:-http://127.0.0.1:8787}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CLI_HOME="$(mktemp -d)"
# A unique principal per run: registration is first-writer-wins, so a fixed name would
# pass once and then fail on every later run against the same node.
PRINCIPAL="smoke$(date +%s)$$"
REGION="smoke$(date +%s)$$"

cleanup() { rm -rf "$CLI_HOME"; }
trap cleanup EXIT

export VOUCH_NODE_URL="$BASE"
export VOUCH_CONFIG_DIR="$CLI_HOME"

say() { printf '== %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

say "read surface: $BASE"
curl -fsS --max-time 10 "$BASE/health" | grep -q '"ok":true' || fail "/health did not report ok"
curl -fsS --max-time 10 "$BASE/metrics" | grep -q '"regions"' || fail "/metrics did not return metrics"
BEFORE="$(curl -fsS --max-time 10 "$BASE/log/digest")" || fail "/log/digest unreachable"
printf '   digest before: %s\n' "$BEFORE"

say "signed write round-trip (keygen -> register -> found)"
bun "$ROOT/vouch-cli/src/main.ts" keygen >/dev/null || fail "keygen failed"
bun "$ROOT/vouch-cli/src/main.ts" register "$PRINCIPAL" >/dev/null || fail "register failed"
bun "$ROOT/vouch-cli/src/main.ts" found "$REGION" "Smoke" >/dev/null || fail "found failed"

AFTER="$(curl -fsS --max-time 10 "$BASE/log/digest")"
printf '   digest after:  %s\n' "$AFTER"
[ "$BEFORE" != "$AFTER" ] || fail "the log did not advance — the write was not persisted"
curl -fsS --max-time 10 "$BASE/regions" | grep -q "$REGION" || fail "the founded region is not in /regions"

say "rejection path: a corrupted signature must NOT be accepted"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$BASE/v1/command" \
  -H 'content-type: application/json' \
  -d "{\"principal\":\"$PRINCIPAL\",\"nonce\":99,\"command\":{\"kind\":\"found\",\"regionId\":\"nope\",\"displayName\":\"N\"},\"signature\":\"AAAA\"}")"
[ "$CODE" = "401" ] || fail "expected 401 for a bad signature, got $CODE"

printf '\nsmoke passed against %s\n' "$BASE"
