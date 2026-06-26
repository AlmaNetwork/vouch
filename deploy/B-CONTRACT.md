# Track B (and A) contract — the assumptions this skeleton makes

The deploy skeleton, the write stub, and the speculative write OpenAPI
(`openapi/write.draft.yaml`) were built **before Track B's interface is frozen**. Rather
than fill the gaps silently, every assumption is listed here. Each is **pending Track B /
Track A ratification**; when the real contract lands, reconcile against this list and raise
any conflict instead of assuming.

## ⚠️ Discovered against PR #3 / #4 (2026-06-26) — reconciliation needed

Track B's node landed as **PR #3** (`feat/impl-app`) with Docker in **PR #4**. It diverges
from the assumptions below on almost every axis — and, more fundamentally, it is a
**from-scratch implementation that does not reuse the simulator** (`vouch-world`). This is a
**team decision to resolve, not a file edit**: is the production node Track B's app, or a
simulator-reusing node, and do the two domain models converge?

| Assumption (below) | Track B reality (PR #3) | Status |
|---|---|---|
| `main(config)` → `{readPort, writePort, stop()}` | `bootFromEnv()` → `{app, shutdown}`; **single** hono app, one `PORT` (default 3000) | ✗ contradicted |
| Per-action `/v1/{found,amend,admit,transact,migrate}` | **command-bus**: `POST /v1/execute` + `/v1/simulate`; reads `/v1/state` `/v1/residents` `/v1/ledger` | ✗ contradicted |
| Logical bodies = `name@region` / institutions / role / valueProfile | UUID/email domain: `found {regionId, ownerEmail}`, `admit {accountId, email, residentId, name}`, `transact {fromResidentId, toResidentId, amount, memo}` | ✗ different domain model |
| Bun runtime, reuse observation server | Node + `@hono/node-server`, npm + vitest, its **own** read endpoints | ✗ contradicted |
| In-memory log (durability reserved) | **SQLite journal + replay-on-boot** (durability implemented) | ✗ (B is further along) |
| Client never sends a private key | owner model is **email/UUID + session + Idempotency-Key** (no publicKey/signature in command bodies seen) | ⚠ different model — re-confirm the key-custody stance |
| Read-server ownership (co-located vs sidecar) | Track B's node has its own `/v1/state` etc., **separate** from the simulator's observation server → two read surfaces | ⚠ open |

**Repo-layout collision:** PR #1 (`add-vouch-simulator`) and PR #3 (`feat/impl-app`) both
target `main` with overlapping root files (`README.md`, `.gitignore`) and incompatible
layouts (2-package monorepo vs single root `src/`). Merging both as-is conflicts.

**Track C impact:** the simulator-based read artifacts (read OpenAPI, observation client,
docs, determinism gate) remain valid for the simulator.

**RESOLVED on the user's call (2026-06-26): Track C's write artifacts now reflect Track B's
real spec.** `openapi/write.draft.yaml` is a **verbatim mirror** of Track B's own OpenAPI
(`feat/impl-app:src/http/openapi.ts`, regen instructions in that file's header); the deploy
stub (`node/write-stub.ts`), the C11 integration gate, and SKILL parts now target Track B's
real routes (`/v1/execute` + per-action + Bearer + Idempotency-Key). `capabilities.yaml`
stays as the **simulator engine's** logical ops (a different thing — the in-process API),
and the SKILL is explicit that Track B's HTTP **domain differs** (account/UUID/email vs
`name@region`).

**Still an OPEN team decision (not Track C's to make):** whether Track B's account/UUID/email
domain and the simulator's `name@region` domain CONVERGE, and the repo-layout collision below.
Track C now records Track B's contract faithfully but takes no position on that convergence.

## Track B — to freeze (original assumptions, kept as the record)

1. **Node entrypoint.** Assumed: `main(config)` loads nothing itself (config injected),
   runs the boot ritual, starts the write app **and** the read observation app, and returns
   a lifecycle handle with `stop()`. → Implemented as `node/main.ts`. If B's entrypoint
   differs (async boot, separate processes, different handle), adapt this wiring.

2. **Config surface.** Assumed keys (owner column in [DEPLOY.md](DEPLOY.md)): node identity
   / seed region(s) / seed value / notary key source / write bind port / durable store path
   / CORS / write-node URL. Track C's config is a **superset** that passes B's keys through
   unchanged. If B owns more/other keys, extend `node/config.ts` — don't rename.

3. **`/v1` HTTP contract.** Assumed routes `POST /v1/{found,amend,admit,transact,migrate}`
   with the **logical bodies** from `skills/capabilities.yaml`. The **command envelope**
   (signing, journaling, single-writer commit) is NOT modeled — B defines it. The stub
   echoes the body and returns `501`. Reconcile paths, envelope, and response shapes against
   `openapi/write.draft.yaml` (marked speculative).

4. **Auth / session + key model.** Assumed only the non-negotiable: **a client never sends a
   private signing key.** The region notary key is server-held (`executeTransfer` needs it
   server-side); `issueCredential` takes a raw key in-process. Whatever auth/session B
   chooses must preserve this. `NOTARY_KEY_SOURCE` is a *source scheme*, never material.

5. **Durability / restore.** Assumed: the log is **in-memory** on this build, so a restart
   loses state; `DURABLE_STORE_PATH` is reserved. Open question: does B restore from a
   durable append store, or replay a fresh sim on boot? If the observation node is meant to
   advance live (it currently runs a finite sim then freezes — see #6 of the brief's read-
   server question), that needs a continuous-tick design that preserves determinism (tick by
   log `seq`, RNG from the environment, wall-clock for *scheduling only*).

6. **Read-server ownership.** Assumed: the read observation server (`serveObservation`,
   Bun.serve) is co-located with the node here for convenience. B decides whether it is
   co-located or a sidecar. Do not assume the read server IS the production node.

## Track A — to freeze (relied on indirectly)

- **Conservation guarantees.** `executeTransfer` is currency-conserving; the failure-reason
  set is stable (mirrored in `write.draft.yaml`'s `TransferFailureReason`). If A changes the
  set, update the spec enum.
- **SYSTEM_ACTOR / genesis mint.** Assumed the boot ritual (`seedGenesis` born recognized,
  `keyPairFromSeed` notary) is the sanctioned mint path. This branch has **no** owner field
  or SYSTEM_ACTOR forgery enforcement yet — those arrive with A.
- **Receipt replay-safety.** Assumed the notary-signed receipt (`alma.tx/receipt/v1`) is
  replay-safe and schema-stable.

## Invariants this skeleton must not break

Emit-only state · determinism/replay (no wall-clock deciding outcomes) · downward-only
imports · the narrow `CommitSink` write path. The read side wraps the real engine; the only
Track-C additions are the CORS shim, the config layer, and the Bun.serve wiring — none of
which touch state, ordering, or the write path.
