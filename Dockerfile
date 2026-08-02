# syntax=docker/dockerfile:1
#
# The deployable is vouch-node — the canonical participate node (Bun + a durable
# JSONL journal). It depends on vouch-core + vouch-world through file: links, so all
# three packages are copied in and installed together.

FROM oven/bun:1.3.2-alpine AS runtime
WORKDIR /app

# Copy the three packages the node needs (node_modules/tests/docs are excluded via .dockerignore).
COPY vouch-core ./vouch-core
COPY vouch-world ./vouch-world
COPY vouch-node ./vouch-node

# Install in dependency order — the same order .github/workflows/ci.yml uses.
# The `file:` links are symlinks, so each package resolves its OWN dependencies from
# its OWN directory: installing only in vouch-node leaves vouch-core without
# @noble/curves, and the node dies at boot with "Cannot find module
# '@noble/curves/ed25519' from '/app/vouch-core/src/suite.ts'" — the image builds
# fine and only fails when it runs, so build success alone proves nothing here.
RUN cd /app/vouch-core  && bun install --frozen-lockfile \
 && cd /app/vouch-world && bun install --frozen-lockfile \
 && cd /app/vouch-node  && bun install --frozen-lockfile

WORKDIR /app/vouch-node

# Run as a non-root user with a writable data dir for the journal + auth log.
RUN addgroup -g 1001 -S vouch \
 && adduser -u 1001 -S vouch -G vouch \
 && mkdir -p /app/data \
 && chown -R vouch:vouch /app/data
USER vouch

# Which code is in this image — surfaced at GET /health so a deploy and a failed
# rollback are distinguishable. Pass a git tag or short SHA:
#   docker build --build-arg VOUCH_BUILD="$(git describe --tags --always)" .
ARG VOUCH_BUILD=dev

ENV VOUCH_BUILD=${VOUCH_BUILD} \
    VOUCH_HOST=0.0.0.0 \
    VOUCH_PORT=8787 \
    VOUCH_JOURNAL=/app/data/journal.jsonl \
    VOUCH_ACCOUNTS=/app/data/accounts.jsonl
# VOUCH_NOTARY is REQUIRED at runtime (no fallback) — pass e.g.
#   -e VOUCH_NOTARY=env://VOUCH_NOTARY_SECRET -e VOUCH_NOTARY_SECRET=<secret>

EXPOSE 8787
# 127.0.0.1, NOT localhost: busybox resolves localhost to [::1] first, the node binds
# IPv4 only, and the probe fails with ECONNREFUSED — leaving a perfectly healthy
# container permanently marked unhealthy (verified: FailingStreak climbs from boot).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8787/health || exit 1

CMD ["bun", "src/index.ts"]
