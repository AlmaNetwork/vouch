# syntax=docker/dockerfile:1
#
# The deployable is vouch-node — the canonical participate node (Bun + a durable
# JSONL journal). It depends on vouch-core + vouch-world through file: links, so all
# three packages are copied in and installed together.
#
# NOTE: not smoke-tested in the dev environment — run `docker build .` before shipping.

FROM oven/bun:1.3.2-alpine AS runtime
WORKDIR /app

# Copy the three packages the node needs (node_modules/tests/docs are excluded via .dockerignore).
COPY vouch-core ./vouch-core
COPY vouch-world ./vouch-world
COPY vouch-node ./vouch-node

WORKDIR /app/vouch-node
RUN bun install --frozen-lockfile

# Run as a non-root user with a writable data dir for the journal + auth log.
RUN addgroup -g 1001 -S vouch \
 && adduser -u 1001 -S vouch -G vouch \
 && mkdir -p /app/data \
 && chown -R vouch:vouch /app/data
USER vouch

ENV VOUCH_HOST=0.0.0.0 \
    VOUCH_PORT=8787 \
    VOUCH_JOURNAL=/app/data/journal.jsonl \
    VOUCH_ACCOUNTS=/app/data/accounts.jsonl
# VOUCH_NOTARY is REQUIRED at runtime (no fallback) — pass e.g.
#   -e VOUCH_NOTARY=env://VOUCH_NOTARY_SECRET -e VOUCH_NOTARY_SECRET=<secret>

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

CMD ["bun", "src/index.ts"]
