#!/usr/bin/env sh
# Biome lint for TRACK-C-OWNED code only (node/, scripts/, apps/web/ — scoped in biome.json).
# Track A/B own their own source + linting (vouch-core / vouch-world use their own tooling),
# so Track C does NOT lint their code here. Task C7.
# Run locally (`sh scripts/lint.sh`) or in CI (.github/workflows/ci.yml, job `lint`).
#
# Track-C code is kept biome-clean, so this passes. The CI job is still continue-on-error
# (advisory); to make it a hard gate, remove `continue-on-error` from the `lint` job.
#
# Config: ../biome.json (formatter matched to the house style; recommended lint rules; files
# scoped to the Track-C dirs above).
set -eu

BIOME_VERSION="2.5.1"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

bunx "@biomejs/biome@${BIOME_VERSION}" lint .
