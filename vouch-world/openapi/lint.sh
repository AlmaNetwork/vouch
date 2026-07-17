#!/usr/bin/env sh
# Lint the observation-API OpenAPI spec with Redocly (config: ../redocly.yaml).
# Run locally (`sh vouch-world/openapi/lint.sh`) or in CI (.github/workflows/ci.yml, job `openapi`).
# Requires bun on PATH (bunx fetches the pinned Redocly CLI).
set -eu

REDOCLY_VERSION="2.35.1"
PKG="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$PKG"

echo "== redocly lint openapi/read.yaml =="
bunx "@redocly/cli@${REDOCLY_VERSION}" lint openapi/read.yaml
