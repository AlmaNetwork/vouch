#!/usr/bin/env sh
# Build a standalone HTML reference for the read-only observation API from
# openapi/read.yaml, using the pinned Redocly CLI. Output: docs/dist/observation-api.html
# (git-ignored). Requires bun on PATH.
set -eu

REDOCLY_VERSION="2.35.1"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p docs/dist
bunx "@redocly/cli@${REDOCLY_VERSION}" build-docs openapi/read.yaml -o docs/dist/observation-api.html
echo "wrote docs/dist/observation-api.html"
