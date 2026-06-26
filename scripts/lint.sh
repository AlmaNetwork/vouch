#!/usr/bin/env sh
# Biome lint for the whole repo. Track C deliverable (task C7).
# Run locally (`sh scripts/lint.sh`) or in CI (.github/workflows/ci.yml, job `lint`).
#
# ADVISORY phase: `biome lint` reports warnings but exits 0 on them, and the CI step is
# marked continue-on-error, so this never blocks Track A / Track B. To move to ENFORCING
# later: add `--error-on-warnings` below AND remove `continue-on-error` from the CI job.
#
# Config: ../biome.json (formatter matched to the house style; recommended lint rules).
# Note: only Track-C-owned packages (e.g. web/) get a package.json `lint` script — the
# existing vouch-core / vouch-world manifests are left untouched to avoid A/B conflicts.
set -eu

BIOME_VERSION="2.5.1"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

bunx "@biomejs/biome@${BIOME_VERSION}" lint .
