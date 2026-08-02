# vouch-node

The **participate node** — a durable, authenticated write path onto the
`vouch-world` engine. This is the load-bearing middle of Track B: where an
external principal (a person or an AI agent, over the network) actually changes
the world, on top of the real engine rather than a re-implementation of it.

It imports the engine (`vouch-core` + `vouch-world`) and adds only what a
networked node needs: **persistence**, **authentication**, and an **HTTP
surface**. Conservation, the append-only event log, and deterministic replay are
inherited from the engine — not re-invented.

## What it guarantees

- **Durable** — every emitted event is written to an append-only journal
  (JSON Lines). On boot the node **replays** its journal into a live world
  (`rehydrateAlmaWorld`), so state survives restarts. The engine log stays the
  single source of truth; nothing derived is persisted.
- **Unforgeable identity** — a principal is bound to an Ed25519 public key by a
  **self-signed registration** (proving key possession). Every command carries a
  signature by that key, so authority is *possession of a private key*, never a
  plaintext string anyone could assert. The reserved system actor can never be
  registered (and the engine rejects it at `emit`), so system authoring stays
  unforgeable.
- **Replay-safe** — a strictly-increasing per-principal `nonce`; the auth log is
  itself append-only and replayed on boot, so nonce state survives restarts.
- **Conserving** — currency moves only through the engine's `executeTransfer`
  (integer, zero-sum); the node never touches balances directly.
- **Reads can't write** — GETs are served by the engine's observation app, which
  is handed only a `WorldView` (no `emit`), enforced by the type.

## Run

```bash
bun install
bun run typecheck && bun test
bun examples/participate.ts          # in-process end-to-end demo (no network)
bun run start                        # serve on 127.0.0.1:8787
```

### Environment

| Var | Default | Meaning |
|---|---|---|
| `VOUCH_HOST` | `127.0.0.1` | bind address (opt into `0.0.0.0` explicitly) |
| `VOUCH_PORT` | `8787` | port (range-checked) |
| `VOUCH_SEED` | `vouch-node` | world RNG seed |
| `VOUCH_JOURNAL` | *(memory)* | path to the event journal (JSONL); unset = ephemeral |
| `VOUCH_ACCOUNTS` | *(memory)* | path to the auth log (JSONL); unset = ephemeral |
| `VOUCH_LOG_LEVEL` | `info` | pino level: `fatal｜error｜warn｜info｜debug｜trace｜silent`. A typo throws rather than silently defaulting. |
| `VOUCH_BUILD` | `dev` | Git tag / short SHA baked in at image build time; reported at `GET /health` and stamped on every log line. |
| `VOUCH_NOTARY` | **none — required** | notary key source: `seed://<secret>` or `env://<VAR>` (`file://` is not supported). There is **no default**: the node throws rather than booting on a predictable key. The keypair is `keyPairFromSeed(sha256(secret))`, so the secret string *is* the private key material — in production use `env://…` fed from a secret store. |
| `VOUCH_CLIENT_IP_HEADER` | *(none)* | Header carrying the real client IP, e.g. `CF-Connecting-IP`. Unset means the socket address — which behind a loopback reverse proxy is `127.0.0.1` for everyone, so **the per-IP limits below then share one bucket across the whole world**. See the warning under Rate limits. |
| `VOUCH_WRITES_PER_MIN_PER_PRINCIPAL` | `10` | signed writes per minute, per principal. `0` disables. |
| `VOUCH_WRITES_PER_HOUR_PER_IP` | `60` | write attempts per hour, per client IP. `0` disables. |
| `VOUCH_READS_PER_MIN_PER_IP` | `600` | reads per minute, per client IP. `0` disables. |

### Rate limits

Limits live in the node, not only at a CDN. A CDN rule protects a hostname; it does
nothing for whoever finds the origin and talks to it directly, and the origin is what
owns the journal. Everything a write costs is permanent, so the limiter belongs where
the write happens. Over the limit is `429` with `Retry-After`.

The defaults are deliberately tight. Nothing appended to the journal can be taken back,
so the safe direction to be wrong in is *too strict* — that is an annoyed participant,
where the other way is a permanent record nobody wanted.

**`VOUCH_CLIENT_IP_HEADER` is a security setting, not a convenience.** A request header
is caller-supplied: trusting one is only safe when the node cannot be reached except
through a proxy that *overwrites* it. Otherwise anyone sets it per request, gets a fresh
bucket every time, and the per-IP limit stops existing. The shipped topology earns that
trust — Cloudflare writes `CF-Connecting-IP`, and authenticated origin pulls mean only
Cloudflare can reach Caddy — which is why it is opt-in rather than a default.

The per-principal limit is consulted *before* a signature is checked but only **charged
after** it verifies. The principal in a request body is claimed, not proven; if a claim
alone could spend a token, anyone could lock a participant out of their own account by
spamming their name. An unauthenticated caller is charged to their IP instead.

`GET /health` is **exempt** from the read limit. It is the liveness probe, so limiting
it would let a read flood 429 the health check and get the node restarted — a restart
loop delivered through the limiter meant to prevent one. It is O(1) with a fixed-size
body, so exempting it costs nothing the connection did not already cost.

## HTTP surface

- `POST /v1/register` — bind a principal to a public key (self-signed).
- `POST /v1/command` — a signed command (see below).
- `GET  /state /regions /regions/:id /agents /agents/:id /metrics /tick /log /log/digest /health`
  — the engine's read-only observation surface.

### Signing (client side)

A registration signs `canonicalBytes({ purpose: "vouch-register/v1", principal, nonce, publicKey })`;
a command signs `canonicalBytes({ purpose: "vouch-command/v1", principal, nonce, command })`
with the principal's Ed25519 key (JCS canonicalization, base64 signature). See
`test/helpers.ts` for the exact reference implementation.

### Commands (MVP)

| kind | payload | authorization |
|---|---|---|
| `found` | `{ regionId, displayName }` | founder becomes owner; a treasury is seeded |
| `admit` | `{ agentId, region, role, valueProfile?, currency? }` | principal must own `region` |
| `transfer` | `{ from, to, amount }` | principal must equal `from` |
| `vouch` | `{ from, to, weight }` | principal must equal `from` |

These four are the **hardcoded** command surface exposed over HTTP today.

### Data-defined commands (RFC 0007 §4 — minimal skeleton)

Alongside the hardcoded switch, an experimental **data-defined command engine**
(`interpreter.ts`) runs commands that live in the log as data, not code. A command
definition (`putDefinition`, stored in vouch-world's definition slice) carries a
closed **precondition** vocabulary (§4.2: `isSelf` / `balanceAtLeast` /
`isRegionOwner` / `tickAfter`) and a closed **effect** vocabulary (§3.4: `transfer` /
`recordVouch` / `suspendId` / `reinstateId`), with `$.field` / `$actor` / `$tick`
references resolved by the kernel. `core.transfer` and `core.vouch` are seeded as data
and produce **byte-identical events** to the hardcoded `transfer` / `vouch` above
(proven in `test/interpreter.test.ts`). Deferred: payloadSchema enforcement,
multi-effect atomicity (needs a vouch-world tx boundary), Roles/bundles (§4.4),
finality/objection/reorg (§5), SoD/penal laws (§6/§9). Not yet wired into the HTTP
surface — the migration off the hardcoded switch is a follow-up.

## Security model

- **Network-facing auth is unforgeable** — acting as a principal requires its
  Ed25519 private key; signatures are principal-bound and domain-separated, with
  strictly-increasing nonces for replay protection. The system actor cannot be
  registered or asserted.
- **Both persisted files are hash-chained and verified on boot.** Each line carries
  `sha256(canonicalBytes({ prev, … }))` over the line before it, and the whole chain
  is re-folded from genesis at startup, so editing, reordering, inserting or
  interior-truncating either file is detected and the node refuses to start. There is
  no trusted "legacy, un-chained" line to downgrade into — accepting one would be the
  bypass. The two chains are domain-separated, so a record cannot be lifted from one
  file into the other.

  The auth log is chained for a sharper reason than the journal. It holds every
  principal's nonce, and the nonce is the only thing standing between a captured
  request and a replay of it: the signature on an old command was always valid, the
  counter is what refuses it. Rewinding one — maliciously, or by restoring a journal
  against a stale auth log — makes that command work again.
- **What chaining does not catch** is a rewrite of a whole file with every hash
  recomputed from genesis, because nothing outside the file commits to its contents.
  That wants an external anchor (the notary signing the chain tip, or a published
  checkpoint) and is the follow-up below.
- **The files are still trusted local storage.** Chaining makes tampering *evident*,
  not impossible: whoever can write the data directory controls the node, as with any
  database. On a single-operator box that is the operator.
- **Crash recovery** — appends are `fsync`ed, and boot tolerates a torn final line
  (an interrupted append is dropped; the client retries). A whole lost tail after a
  crash recovers to the last intact event — a durability window, not corruption. The
  fragment is also truncated before the next append, so a write taken after a crash
  lands instead of being glued onto it and silently lost.

## Deferred (follow-ups, not in this package yet)

- **An external anchor for the two logs** — the notary signing the chain tip, or a
  published checkpoint, so a wholesale rewrite is detectable and not just an interior
  edit. Chaining alone cannot see it.
- More commands: `amend` (governance/economy), region market (`list` / `sell`),
  digital items, resource draw — each maps to an existing engine mutator.
- Idempotency keys (safe retries), WebSocket/SSE streaming, an autonomous tick
  loop (running the AI-brain economy), and multi-node federation.
- Currency **settlement** of a region sale price (needs the account↔agent value
  bridge; tracked in the engine's `market.ts`).

## Naming

`vouch` is the brand; the protocol keeps the **ALMA** identifiers
(`alma-cert/v1`, the `alma.*` schemas, `alma-core:` error prefix). License:
Apache-2.0.
