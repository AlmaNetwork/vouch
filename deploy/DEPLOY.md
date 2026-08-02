# Deploying a vouch node

The deployable is **vouch-node**: one Bun process, plus two append-only JSONL files that
are the entire state. Everything below is written against the real configuration surface
(`vouch-node/src/config.ts`) and was verified against a running container.

## Configuration

These are the **only** variables the node reads. There are no others; older deploy notes
listing `READ_PORT`, `NOTARY_KEY_SOURCE`, `SEED_REGIONS`, `CORS_ORIGINS` and friends
describe an interface that never shipped, and a node started from them boots on pure
defaults — loopback bind, in-memory journal — while looking healthy.

| Variable | Default | Meaning |
|---|---|---|
| `VOUCH_HOST` | `127.0.0.1` | Bind address. The loopback default serves nothing on a server; keep it and put a proxy in front, or use `0.0.0.0` only inside a container whose published port is itself loopback-bound. |
| `VOUCH_PORT` | `8787` | Bind port. |
| `VOUCH_SEED` | `vouch-node` | World RNG seed. **Permanent** — see below. |
| `VOUCH_JOURNAL` | *(unset = in-memory)* | Event journal path. Unset means the world is lost on restart. |
| `VOUCH_ACCOUNTS` | *(unset = in-memory)* | Auth log path (per-principal nonces). |
| `VOUCH_NOTARY` | **none — required** | `seed://<literal>` or `env://<VAR>`. `file://` is not supported. |

Three properties worth knowing before you touch any of them:

- **`VOUCH_NOTARY` has no fallback, on purpose.** The node throws rather than booting on a
  predictable key. The keypair is `keyPairFromSeed(sha256(secret))`, so the secret string
  *is* the private key material — a guessable one means forgeable notary-signed receipts.
- **`VOUCH_SEED` is permanent.** It is fed to `rehydrateAlmaWorld` on every boot alongside
  the replayed journal, so changing it later changes replay-derived behaviour against an
  existing journal. Pin it at first deploy and record it.
- **The two JSONL files are the state.** The journal is replayed from genesis on every
  boot; the accounts log holds each principal's nonce. Back them up **together** — restoring
  a journal against a stale accounts log rewinds nonces and reopens the replay window the
  auth design rests on. Only ever one writer: `FileJournal` opens with `"a"` and keeps its
  chain tip in memory, so a second process on the same path corrupts the chain.

## Rate limits

Four more variables, all optional, all with working defaults:

| Variable | Default | Meaning |
|---|---|---|
| `VOUCH_CLIENT_IP_HEADER` | *(unset)* | Header carrying the real client IP, e.g. `CF-Connecting-IP`. **Set this.** |
| `VOUCH_WRITES_PER_MIN_PER_PRINCIPAL` | `10` | Signed writes per minute, per principal. `0` disables. |
| `VOUCH_WRITES_PER_HOUR_PER_IP` | `60` | Write attempts per hour, per client IP. `0` disables. |
| `VOUCH_READS_PER_MIN_PER_IP` | `600` | Reads per minute, per client IP. `0` disables. |

The limits start deliberately tight. Nothing appended to the journal can be taken back,
so the safe direction to be wrong in is *too strict* — that costs an annoyed
participant, where the other way costs a permanent record nobody wanted. Loosen from
here rather than starting loose.

**`VOUCH_CLIENT_IP_HEADER` decides whether the per-IP limits mean anything at all.**
With a proxy in front, every request reaches the node from `127.0.0.1` — so leaving it
unset puts the entire internet in one bucket.

It is also a security setting rather than a convenience. A header is caller-supplied,
so trusting one is safe *only* because this node cannot be reached except through
Cloudflare (authenticated origin pulls) and Cloudflare overwrites `CF-Connecting-IP`.
Expose the node directly and anyone sets it per request, takes a fresh bucket each time,
and the limit is gone. Left unset, an unidentifiable caller falls back to the socket
address rather than being treated as exempt: too strict fails loudly, exempt fails
silently.

`GET /health` is exempt, because rate-limiting a liveness probe lets a read flood get
the node restarted.

## Files here

| File | What it is |
|---|---|
| `node.env.example` | Template for `/etc/vouch/node.env`. |
| `vouch-node.service` | systemd unit for running Bun directly (no container). |
| `Caddyfile` | Reverse proxy + TLS, with a Cloudflare Origin CA cert. |
| `smoke.sh` | Post-deploy check. Read-only by default; `--write` adds a real signed write. |

The repo root also carries `Dockerfile` / `docker-compose.yml` for the container route.
Pick **one** of container-or-systemd; running both against the same data directory
produces two writers and a broken journal.

## First deploy

1. **Build the state directory and the config.**
   ```
   sudo useradd --system --home /var/lib/vouch --shell /usr/sbin/nologin vouch
   sudo install -d -o vouch -g vouch -m 0700 /var/lib/vouch
   sudo install -d -o root  -g vouch -m 0750 /etc/vouch
   sudo install -o root -g vouch -m 0640 deploy/node.env.example /etc/vouch/node.env
   ```
   `0700` on the data directory matters: the node creates the files with the default
   mode, so they land world-readable — exposing every principal and transfer amount to
   any local account.

2. **Generate the notary secret and put it in `/etc/vouch/node.env`.** Never on a command
   line, never in cloud user-data, never committed.
   ```
   openssl rand -base64 48
   ```
   On AWS, keep it in SSM Parameter Store as a `SecureString` and have an `ExecStartPre`
   fetch it into the env file, so it is not sitting in an image or a template.

3. **Pin `VOUCH_SEED`** explicitly in `node.env`, even to the default value, and record it
   with the deploy baseline (step 8).

4. **Deploy the code at a tag**, never a branch:
   ```
   sudo git -C /opt/vouch fetch --tags
   sudo git -C /opt/vouch checkout v0.1.0
   ( cd /opt/vouch/vouch-core && bun install --frozen-lockfile )
   ( cd /opt/vouch/vouch-world && bun install --frozen-lockfile )
   ( cd /opt/vouch/vouch-node && bun install --frozen-lockfile )
   ```
   The three installs are in dependency order and all three are required — the `file:`
   links are symlinks, so each package resolves its own dependencies from its own
   directory. Installing only in `vouch-node` produces a node that starts and dies with
   `Cannot find package 'vouch-core'`.

   *(Container route instead: `docker build -t vouch-node:v0.1.0 .` then
   `docker compose up -d`. Compose publishes to `127.0.0.1` only and refuses to start
   without `VOUCH_NOTARY`.)*

5. **Start it.**
   ```
   sudo cp deploy/vouch-node.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now vouch-node
   systemctl status vouch-node
   ```

6. **Check the exposure.** This one command catches every variant of the mistake — a
   forgotten `VOUCH_HOST`, a compose file that lost its `127.0.0.1` prefix, a Docker
   iptables rule that went around the host firewall:
   ```
   ss -ltnp | grep 8787          # must show 127.0.0.1:8787, never 0.0.0.0:8787
   curl -m 5 http://<public-ip>:8787/health   # must NOT answer
   ```

7. **Run the smoke test against the public hostname**, through the proxy — not against
   localhost:
   ```
   sh deploy/smoke.sh https://node.example.org --write
   ```

   `--write` founds a `smoke*` region through the real signed path. **Regions are
   never deleted by design**, so each `--write` run leaves a permanent region in the
   world and its log. That is the right trade on a deploy — it is the only way to
   prove the signature path and the write path actually work — and the wrong one for
   a probe on a timer, which is why the default is read-only. If you monitor the node
   continuously, run it without `--write`.

8. **Prove writes survive a restart.** The smoke test cannot do this, and this is the one
   failure that hides: a node with an unwritable data directory (or an in-memory journal)
   starts, answers `/health` with 200, and silently discards every write, because
   persistence is only touched at the first append — not at boot.
   ```
   curl -s https://node.example.org/log/digest      # note digest + length
   sudo systemctl restart vouch-node
   curl -s https://node.example.org/log/digest      # must be IDENTICAL
   ```

9. **Record the deploy baseline**: the `/log/digest` value and length, the git tag (and
   image digest if containerised), `VOUCH_SEED`, and the notary **public** key. The
   digest gives you an exact-equality check for every future restore and rollback. The
   notary public key is the first entry in the key registry you will need if the notary
   is ever rotated — receipts embed the key id, and nothing in the repo publishes a
   registry, so without this record historical receipts become unverifiable.

## Ongoing

- **Backups.** Snapshot the volume holding both JSONL files, capturing them at the same
  instant. Crash-consistent snapshots are safe here: each append is `fsync`ed and the
  loader tolerates a torn *final* line while throwing on an interior one, so a snapshot
  can only ever catch a partial write at the tail. Rehearse a restore and compare
  `/log/digest` — an untested backup is not a backup.
- **Never point logrotate at the data directory.** The `.jsonl` extension and the word
  "journal" invite it; truncating or compressing the journal breaks the hash chain and
  the node then refuses to boot.
- **A corrupt journal is a hard stop, by design.** The node exits with
  `journal: hash-chain broken at line N` rather than serving divergent state. The unit's
  `StartLimitBurst` turns that into an alert instead of an infinite crash loop. There is
  no repair tooling yet — restore from a snapshot.
- **Rollback is a tag swap for code, but data is not reversible.** The journal is
  replayed from genesis on every boot, so an interior edit makes the node refuse to
  start. Roll code back; never hand-edit the journal.
