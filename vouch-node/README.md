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
bun run typecheck && bun test        # 25 tests
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
| `VOUCH_NOTARY` | `seed://dev-notary` | notary key source: `seed://<secret>` or `env://<VAR>`. **In production set `env://…`** — a missing env var throws (no silent well-known-key fallback). |

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
- **The persisted files are trusted local storage.** The event journal and auth
  log are not yet cryptographically tamper-evident, so anyone who can write those
  files controls the node (as with any database). On a single-operator box that is
  the operator. Per-line signing / hash-chaining + a boot-time digest check is the
  top hardening follow-up (see below).
- **Crash recovery** — appends are `fsync`ed, and boot tolerates a torn final line
  (an interrupted append is dropped; the client retries). A whole lost tail after a
  crash recovers to the last intact event — a durability window, not corruption.

## Deferred (follow-ups, not in this package yet)

- **Journal integrity** — per-line signature / hash-chain + a committed
  length/digest checkpoint, so a tampered or truncated log is detected on boot.
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
