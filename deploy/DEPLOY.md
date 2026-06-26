# Deploying a vouch node

This is a **runtime-agnostic deploy skeleton**. It wraps the **real** read-only observation
server and a **stub** write node (the write surface is Track B's and isn't HTTP yet — see
[B-CONTRACT.md](B-CONTRACT.md)). When Track B's node entrypoint lands, the stub
(`node/write-stub.ts`) is swapped for its app and everything here is unchanged.

The entrypoint is `node/main.ts`: `main(config)` boots both servers and returns a handle
with `stop()`; the runnable path wires `SIGTERM`/`SIGINT` to a graceful shutdown.

## Configuration

One layer (`node/config.ts`), read from environment variables, with **local-safe defaults
and zero hardcoded cloud values**. Moving to AWS (or any host) is "different values for the
same keys" — never a code change.

| Key | Default | Owner | Meaning |
|---|---|---|---|
| `VOUCH_SEED` | `vouch-node` | C | World RNG seed (determinism anchor). |
| `READ_PORT` | `8787` | C | Read observation bind port. |
| `WRITE_PORT` | `8788` | B | Write node bind port (stub today). |
| `SEED_REGIONS` | `umi` | C | Genesis regions to seed (comma-separated). |
| `SIM_TICKS` | `8` | C | Ticks to run before serving (finite world on this build). |
| `NOTARY_KEY_SOURCE` | `seed://09` | A/B | Notary key **source** — `seed://` \| `env://` \| `file://`. Never key material. |
| `DURABLE_STORE_PATH` | `` | B | Durable append-store path. **Reserved** — the log is in-memory on this build. |
| `CORS_ORIGINS` | `` | C | Allowed origins for the read server (comma-separated, or `*`). Empty = none. |
| `WRITE_NODE_URL` | `` | C | URL of the write node for clients/FE (informational). |

Secrets are **indirect**: `NOTARY_KEY_SOURCE` names a *source scheme*, never the key. No
account id / ARN / key is baked into any file here.

## Run it

**Docker** (cloud-agnostic, `FROM oven/bun`):

```bash
docker build -f deploy/Dockerfile -t vouch-node .
docker run --rm -p 8787:8787 -p 8788:8788 \
  -e SEED_REGIONS=umi -e CORS_ORIGINS='*' vouch-node
docker stop <id>     # SIGTERM → graceful shutdown
```

**systemd**: `cp deploy/vouch-node.service /etc/systemd/system/`, put config in
`/etc/vouch/node.env`, then `systemctl enable --now vouch-node`.

**curl | sh** (parameterized by `VOUCH_REPO_URL` / `VOUCH_REF` / `VOUCH_PREFIX`):

```bash
curl -fsSL https://raw.githubusercontent.com/AlmaNetwork/vouch/main/deploy/install.sh | sh
```

**cloud-init**: [`cloud-init.yaml`](cloud-init.yaml) writes `/etc/vouch/node.env`, runs the
installer, and enables the service.

## Verify

```bash
curl -s localhost:8787/health    # {"ok":true,"tick":8}   (real observation)
curl -s localhost:8787/metrics   # real metrics
curl -s localhost:8788/health    # {"service":"vouch write node (STUB)", ...}
curl -s -X POST localhost:8788/v1/transact -d '{"from":"a@umi","to":"b@umi","amount":10}'
                                 # 501 — write surface pending Track B
```

## When the AWS account exists (deferred by design)

Nothing here assumes AWS. To target it, set the **same keys** to AWS values and add the
cloud-specific steps behind the optional, no-op hook `deploy/host-hook.sh` (instance
metadata, IAM role, secret fetch). Specifically:

1. Point `NOTARY_KEY_SOURCE` at the real custody (`env://` from a secret, or a Track-B
   `file://` source). Do **not** inline key material.
2. Set `CORS_ORIGINS` to the deployed frontend origin(s).
3. Set `WRITE_NODE_URL` once Track B's node is reachable.
4. Choose an orchestration target (ECS / EC2 / Fargate / plain VM) — that lives in your
   outer task-def/compose, which only references this image; it does not change the image.
5. Enable the disabled-by-default remote deploy-smoke CI job with target host + credentials
   in CI secrets (see `.github/workflows/ci.yml`).

Anything that can't be parameterized as "same key, AWS value" is an open question for the
AWS contract — raise it rather than hardcoding.
