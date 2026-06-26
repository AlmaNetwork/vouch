#!/usr/bin/env sh
# Lint the vouch OpenAPI specs with Redocly (config: ../redocly.yaml).
# Run locally (`sh openapi/lint.sh`) or in CI (.github/workflows/ci.yml, job `openapi`).
# Requires bun on PATH (bunx fetches the pinned Redocly CLI).
set -eu

REDOCLY_VERSION="2.35.1"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

# The read spec is the live contract; the write draft is speculative (task C10, pending
# Track B ratification) but is still linted so it stays valid.
SPECS="openapi/read.yaml openapi/write.draft.yaml"

for spec in $SPECS; do
  echo "== redocly lint $spec =="
  bunx "@redocly/cli@${REDOCLY_VERSION}" lint "$spec"
done
