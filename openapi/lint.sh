#!/usr/bin/env sh
# Lint the vouch OpenAPI spec with Redocly (config: ../redocly.yaml).
# Run locally (`sh openapi/lint.sh`) or in CI (.github/workflows/ci.yml, job `openapi`).
# Requires bun on PATH (bunx fetches the pinned Redocly CLI).
set -eu

REDOCLY_VERSION="2.35.1"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

echo "== redocly lint openapi/read.yaml =="
bunx "@redocly/cli@${REDOCLY_VERSION}" lint openapi/read.yaml
