# Track B (and A) contract — the assumptions this skeleton makes

The deploy skeleton, the write stub, and the speculative write OpenAPI
(`openapi/write.draft.yaml`) were built **before Track B's interface is frozen**. Rather
than fill the gaps silently, every assumption is listed here. Each is **pending Track B /
Track A ratification**; when the real contract lands, reconcile against this list and raise
any conflict instead of assuming.

## Track B — to freeze

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
