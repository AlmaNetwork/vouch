# vouch node — cloud-agnostic image (Bun-bound runtime).
# Build from the REPO ROOT:  docker build -f deploy/Dockerfile -t vouch-node .
#
# Serves the REAL read-only observation API + a write-node STUB (pending Track B).
# Swap node/write-stub.ts for Track B's app when its contract lands — the image is unchanged.
FROM oven/bun:1.3.2

WORKDIR /app

# Copy the two packages (vouch-world keeps its file:../vouch-core link) + the node runtime.
# node_modules are excluded by deploy/Dockerfile.dockerignore and reinstalled below.
COPY vouch-core ./vouch-core
COPY vouch-world ./vouch-world
COPY node ./node

# Install vouch-core FIRST: vouch-world resolves vouch-core through its node_modules.
RUN cd vouch-core  && bun install --frozen-lockfile \
 && cd ../vouch-world && bun install --frozen-lockfile

# Local-safe defaults; override every key at run time (see deploy/DEPLOY.md). No cloud values baked in.
ENV READ_PORT=8787 \
    WRITE_PORT=8788 \
    SEED_REGIONS=umi \
    SIM_TICKS=8 \
    NOTARY_KEY_SOURCE=seed://09

EXPOSE 8787 8788

# bun forwards SIGTERM/SIGINT to main.ts, which stops both servers and exits 0 (graceful).
ENTRYPOINT ["bun", "node/main.ts"]
