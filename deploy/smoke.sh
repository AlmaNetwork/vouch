#!/usr/bin/env sh
# Deploy smoke test.
#
#   sh deploy/smoke.sh https://node.example.org           # READ-ONLY (default)
#   sh deploy/smoke.sh https://node.example.org --write   # + a real signed write
#
# The write half is OPT-IN, deliberately. It founds a region through the real signed
# path, and regions are never deleted by design — so every write run appends a
# permanent `smoke*` region to the world and its append-only log, visible in /regions
# and counted in /metrics forever. That is the right trade at DEPLOY time (it is the
# only way to prove the signature path and the write path actually work) and the wrong
# one for a probe you might put on a timer. Default read-only; pass --write on deploys.
#
# The write half goes through vouch-cli on purpose. A signed command is an Ed25519
# signature over JCS-canonicalized bytes with a domain-separated purpose string — curl
# cannot produce that without reimplementing the signing scheme in shell, and a
# read-only check cannot tell a working node from one that accepts unsigned commands.
#
# Needs: bun on PATH, and a checkout (it runs vouch-cli from source) — for --write only.
#
# What --write does NOT prove: that writes are DURABLE. A node running with an
# in-memory journal (VOUCH_JOURNAL unset) passes every check here, because within one
# process the write is visible — persistence only shows up across a restart, and
# nothing the node exposes reveals its journal path. Verified: a deliberately ephemeral
# node passes. The restart check is a first-deploy step in DEPLOY.md instead.
set -eu

BASE="http://127.0.0.1:8787"
WRITE=""
for arg in "$@"; do
  case "$arg" in
    --write) WRITE=1 ;;
    -*) printf 'unknown flag: %s\n' "$arg" >&2; exit 2 ;;
    *) BASE="$arg" ;;
  esac
done

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

say "rejection path: an unsigned/corrupted command must NOT be accepted"
# Read-only: a rejected command consumes no nonce and emits nothing, so this is safe
# to run on a timer against production.
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$BASE/v1/command" \
  -H 'content-type: application/json' \
  -d "{\"principal\":\"nobody$$\",\"nonce\":99,\"command\":{\"kind\":\"found\",\"regionId\":\"nope\",\"displayName\":\"N\"},\"signature\":\"AAAA\"}")"
case "$CODE" in
  401 | 403) ;; # unregistered principal or bad signature — either is a correct refusal
  *) fail "expected the node to refuse an unsigned command (401/403), got $CODE" ;;
esac

if [ -z "$WRITE" ]; then
  printf '\nread-only smoke passed against %s  (pass --write to also exercise the signed write path)\n' "$BASE"
  exit 0
fi

say "signed write round-trip (keygen -> register -> found)  [--write]"
bun "$ROOT/vouch-cli/src/main.ts" keygen >/dev/null || fail "keygen failed"
bun "$ROOT/vouch-cli/src/main.ts" register "$PRINCIPAL" >/dev/null || fail "register failed"
bun "$ROOT/vouch-cli/src/main.ts" found "$REGION" "Smoke" >/dev/null || fail "found failed"

AFTER="$(curl -fsS --max-time 10 "$BASE/log/digest")"
printf '   digest after:  %s\n' "$AFTER"
[ "$BEFORE" != "$AFTER" ] || fail "the log did not advance — the write was not persisted"
curl -fsS --max-time 10 "$BASE/regions" | grep -q "$REGION" || fail "the founded region is not in /regions"

printf '\nsmoke passed against %s  (wrote region %s — permanent, by design)\n' "$BASE" "$REGION"
