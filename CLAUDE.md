# CLAUDE.md — working in the vouch monorepo

Guidance for any AI agent (and any human) contributing to this repo. Read this
before touching code. It encodes the rules that keep the simulation **honest**:
deterministic, conservation-respecting, and cleanly layered. Most of these are not
style preferences — they are load-bearing invariants that tests and downstream
layers pin. Breaking one silently corrupts the whole model.

There are nested guides with package-specific detail:

- [`vouch-core/CLAUDE.md`](./vouch-core/CLAUDE.md) — the trust engine (L1).
- [`vouch-world/CLAUDE.md`](./vouch-world/CLAUDE.md) — the simulator (L2–L5 + foundations).

And task recipes under [`.claude/skills/`](./.claude/skills/): `add-event-type`,
`add-credential-kind`, `run-milestone`, `verify`.

---

## What this is

**vouch is a society simulator.** AI agents live in self-governing villages
(regions), each under a different rule of trust. They earn, trade, migrate when
disadvantaged, and secede to found new villages while the world runs. You watch to
see *which institutions prosper*.

Under the hood it speaks **ALMA**, a distributed identity & trust protocol. The
protocol fixes only the shape of a certificate and how it is signed; *what a
certificate means, and whether a village honors it,* is the simulation's drama.

Two packages:

| Package | Role | Tests |
|---|---|---|
| `vouch-core` | L1 trust engine — mint ids/keys/certs, **formally verify** signatures. Standalone, no other layer. | 35 |
| `vouch-world` | The simulator — foundations + region/agent/environment/credential/observation. | 76 |

When you change code, keep these test counts and the milestone table in the READMEs
in lockstep with reality (see **Working rhythm**).

---

## Run & verify

Each package is self-contained; [Bun](https://bun.sh) runs the TypeScript directly
(no build step). **Always run both checks in both packages before you call a change
done** — `vouch-world`'s typecheck follows into `vouch-core`'s source, so install
`vouch-core` first.

```bash
# vouch-core (the trust engine, on its own)
cd vouch-core  && bun install && bun run typecheck && bun test

# vouch-world (the simulator; depends on ../vouch-core)
cd vouch-world && bun install && bun run typecheck && bun test
```

- Runtime & test runner: **Bun, pinned to 1.3.2 in CI**. Tests use `bun:test`
  (`import { describe, expect, test } from "bun:test"`). Do not add jest/vitest or a
  separate test config.
- `bun run typecheck` = `tsc --noEmit`. The two `tsconfig.json` files are
  byte-identical and maximally strict (`strict`, `noUncheckedIndexedAccess`,
  `noFallthroughCasesInSwitch`, `noImplicitOverride`). If you change a strictness
  flag, change **both**.
- `vouch-world` depends on `vouch-core` via `file:../vouch-core`; `vouch-core` never
  depends back.

---

## The mental model (five principles)

1. **Event sourcing.** An append-only log is the single source of truth. All state
   is derived by folding the log through pure reducers. There is no API to mutate
   the world directly — only `emit(event)`. The whole history replays
   deterministically.
2. **Conservation monopoly.** Only the environment (L4) changes value. Agents
   *request*; the environment *executes* after checking conservation. No one can
   mint themselves money.
3. **Form vs. meaning.** The trust engine (L1) verifies a certificate's *form*
   (shape + signature) and nothing else. *Whether a cert is valid/honored* is each
   village's call (L2/L4). The core stores nothing and judges nothing.
4. **Determinism & replay.** A fixed seed reproduces the exact same history. Even
   non-deterministic (e.g. LLM) decisions are journaled and replayed from the log.
   No `Date.now()` / `Math.random()` in domain code, ever.
5. **Observation never interferes.** The observation layer (L5) only reads.
   Watching the world can never change it — enforced by the type system.

---

## Architecture — 5 layers + 2 foundations

Dependency direction is **strictly downward**: a lower layer never imports an upper
one. This is the single most important structural rule.

```
L5  Observation   read-only HTTP (hono) + metrics            vouch-world/src/observation
L4  Environment   composition root + the ONLY write path;    vouch-world/src/environment
                  value-conservation monopoly
L3  Agent         residents; brains (view -> intent);        vouch-world/src/agent
                  state derived by folding the log
L2  Region        villages as data: institutions + reducer   vouch-world/src/region
L1  Trust engine  stateless generate + formal-verify         vouch-core
A/B Foundations   append-only event log + deterministic RNG  vouch-world/src/foundation
```

Import rules, per layer (verify these when you add an import):

- **vouch-core (L1)** imports *no* monorepo layer. Only external libs: `zod`,
  `@noble/curves`, `canonicalize`.
- **foundation (A/B)** imports nothing upward.
- **region (L2)** imports **only** foundation (and its own `./types`). Never agent,
  environment, or the composite `WorldState`.
- **agent (L3)** imports foundation, region (types), and `vouch-core`. **Never
  environment.**
- **environment (L4)** imports downward only (agent, region, foundation,
  vouch-core). It is the only layer that may compose `WorldState` and emit
  state-changing events.
- **observation (L5)** imports downward only and **never the write path** (no
  `emit`/`executeTransfer`/`run`/`advanceTick`). It receives only a `WorldView`.

To extend world state, add a slice **downward in the composition root**
(`environment/state.ts:rootReducer` / `WorldState`). Never reach upward.

---

## Non-negotiable invariants

These are enforced by code and pinned by tests. Treat any change to them as a
breaking change requiring deliberate sign-off.

### Event sourcing & determinism

- **`emit()` is the only mutator.** `World.emit(type, actor, payload)` appends one
  event then folds it through the reducer. There is no `setState`. `World.log` is
  the read-only `WorldLog` facade (readers only, no `append`).
- **Canonical order is `seq`, not `tick`.** `seq` is the 0-based monotonic log
  order assigned by `append()`. `tick` is sim-engine time and may repeat. Never sort
  or dedupe by `tick`, and never treat `tick` as wall-clock.
- **Events and state are deep-frozen.** Stored events, their payloads, and live
  state are frozen; do not mutate them. Clone if you need a changed copy.
- **State must be reconstructable from the log alone.** `replayState(log.all(),
  initial, reducer)` must equal the live world's `{tick, state}` (the first arg is
  the event array, e.g. `world.log.all()`). Reducers are pure
  `(state, event) => state` — no side effects, no clock, no RNG.
- **All randomness flows through the seeded `Rng`** (`cyrb128` + `sfc32`; build via
  `Rng.create(seed)`, never `new Rng`). Same seed ⇒ identical history. **Never call
  `Date.now()` or `Math.random()` in any domain/reducer/tick/brain code.**
- **Brains are journaled, never re-run on replay.** A brain is a pure
  `(ReadOnlyView) => Intent`; its decision is recorded as `agent.decided` and
  re-folded on replay. This is what keeps a future LLM brain deterministic.

### Conservation monopoly

- **`executeTransfer` is the sole producer of value-move events** (`economy.settled`).
  No other code may move value. Agents emit `Intent`s; the environment executes.
- **Currency is conserved:** settlement `currencyDelta`s must sum to zero. A
  violation throws as an internal bug (it is never a user-facing error). New currency
  enters ONLY via admission endowments or an explicit, logged `economy.minted`
  (`mintCurrency`) — so the supply (`currencySupply`) is auditable from t0.
- **System authoring is unforgeable at write time + reducer-gated.** `World.emit`
  **rejects** `actor === SYSTEM_ACTOR` (throws) — system/conserved events are authored
  only via `World.commitSystem`, exposed on the env-only `CommitSink`. As defence in
  depth, the `agentReducer` also honors value events (`economy.settled`/`economy.minted`)
  only when `event.actor === SYSTEM_ACTOR` (`"world"`), so a forged event is ignored on
  replay too.
- **Settlements apply atomically.** If any entry references an unknown agent, the
  whole settlement is rejected — never apply a partial set of legs (would strand
  currency).
- **Currency is transferable; credit is not.** Transfers move currency only.

### Form vs. meaning

- **vouch-core verifies form only.** `verifyCertificate` checks envelope shape +
  signature against a *caller-supplied* public key and returns
  `{ok:true} | {ok:false, reason, detail}`. It **never throws**, never interprets
  `claims`/`schemaId`, never stores keys or certs, and never decides
  trustworthiness.
- **Meaning lives above the core.** The credential layer validates claim structure
  (zod); the village's verification/diplomacy policy decides whether to honor a
  cert. `assessCertificate` always checks form via the core **before** applying
  meaning.

### Boundaries & observation

- **Strictly downward imports** (see Architecture). vouch-core imports no simulator
  layer.
- **Observation is read-only by construction.** It takes a `WorldView` (`getState`,
  `tick`, `log` — no mutators) and registers GET routes only. Watching cannot write,
  and this is a compile-time fact, not discipline.

---

## Naming: `vouch` vs `ALMA`

**`vouch` is the brand / package names. `ALMA` is the protocol & domain.** During
any rename or branding pass, keep the ALMA identifiers — they are wire/format
contracts, not branding:

| Keep as ALMA | Where |
|---|---|
| `alma-cert/v1` (certificate version) | `vouch-core` `CERT_VERSION` |
| `alma.*` schema namespace (`alma.skill/v1`, `alma.tx/receipt/v1`, …) | credential & receipt `schemaId`s |
| `createAlmaWorld` (composition root) | `vouch-world/src/environment` |
| `alma-core:` error-message prefix | `vouch-core` thrown errors |

Do **not** rename these to `vouch`. Tests and downstream layers pin the exact
strings.

---

## Exact identifiers (do not drift)

Reproduce these verbatim; tests assert on them and reducers match on them.

**Actors / system**
- `SYSTEM_ACTOR = "world"` — actor for engine/environment-authored events.
- `EVENT_TICK = "system.tick"`.

**Event types**
- Region: `region.founded`, `region.institution.changed`, `region.recognized`.
- Agent/economy: `agent.admitted`, `agent.migrated`, `agent.decided`,
  `economy.settled`, `economy.minted`.

**Certificate / protocol**
- `CERT_VERSION = "alma-cert/v1"`, `DEFAULT_SUITE = "ed25519"`.
- Identifier grammar: `name@region`, name `/^[A-Za-z][A-Za-z0-9]*$/`, region
  `/^[a-z0-9]+$/`.
- `verifyCertificate` reasons (stable API): `malformed-envelope`, `invalid-issuer`,
  `invalid-subject`, `unknown-suite`, `invalid-signature-encoding`, `bad-signature`.
- Credential reasons add: `schema-mismatch`, `unknown-credential-type`,
  `invalid-claims`.

**Enums**
- `RecognitionStatus`: `unrecognized` | `recognized`.
- `ForeignCertStance`: `absorb` | `map` | `reexamine` | `reject`.
- `AgentRole`: `artisan` | `merchant` | `broker` | `treasury`.
- `ValueProfile`: `strict` | `lenient`.
- `Intent.kind`: `idle` | `transfer` | `emigrate`.

**Economy** (`environment/economy.ts`)
- `BASE_COST_RATE=0.2`, `MIN_COST_RATE=0.05`, `REP_DISCOUNT=0.02`, `CREDIT_PER_TX=1`.
- Fee = `floor(amount * trustCostRate(reputation))`, routed to
  `treasuryId(from.region)` = `treasury@${region}`. Higher reputation ⇒ lower rate.
- Receipt `schemaId = "alma.tx/receipt/v1"`; timestamps derive from the tick
  (`EPOCH = Date.UTC(2026, 0, 1)` + `tick*86_400_000`), never the wall clock.
- Transfer failure reasons: `unknown-agent`, `self-transfer`, `not-transferable`,
  `bad-amount`, `insufficient-funds`, `no-treasury`.
- Cross-region gate reasons (`diplomacy.ts`): `unknown-region`,
  `sender-region-unrecognized`, `receiver-region-unrecognized`,
  `receiver-rejects-sender`.

**Observation** — default port `8787`; GET-only.

---

## Working rhythm

The established cadence for every milestone / feature:

1. **Implement one milestone (or slice) at a time.** Do not pull future scope
   forward.
2. **Get tests green** in both packages (`typecheck` + `test`). Add tests for new
   behavior — see the test conventions below.
3. **Update the READMEs** to track what is *actually* implemented (package test
   counts, the milestone status table, the architecture/layout if a layer changed).
   The READMEs are a contract, not decoration.
4. **Commit, then open a PR.** Keep commits scoped and messages descriptive.
5. For protocol-level work, **run an adversarial review** before declaring done —
   re-derive conservation, determinism, and layer-separation against the diff and
   fix confirmed bugs. This repo was hardened that way; keep the habit.

### Test conventions

- **Determinism, two ways.** Forward: same seed + same script ⇒ identical
  `world.log.digest()` (and different seeds differ). Reconstruction:
  `replayState(w.log.all(), INITIAL_WORLD_STATE, rootReducer).state` `toEqual`
  `w.getState()`.
- **Conservation.** Sum of all agent currency before == after any transfer / run.
- **Actor-gate.** A forged `economy.settled` emitted with a non-`"world"` actor must
  leave balances unchanged.
- **Read-only (observation).** POST/DELETE ⇒ 404, and `log.digest()` is unchanged
  after reading every endpoint.
- **Form failures pass through.** Tamper a cert ⇒ `bad-signature`; out-of-schema
  claims on a validly-signed cert ⇒ `invalid-claims`.
- Build worlds from fixed seeds: `createAlmaWorld(seed)` +
  `keyPairFromSeed(new Uint8Array(32).fill(n))`. Never seed from a clock.

### Commits, PRs, CI

- CI is a **single GitHub Actions job** (`oven-sh/setup-bun@v2`, bun `1.3.2`) that
  installs **both** packages (`bun install --frozen-lockfile`, core then world) and
  then runs `bun run typecheck && bun test` per package. The single check is named
  `test`. It triggers on push to `main` and on all PRs.
- It installs both because `vouch-world`'s typecheck reaches into `vouch-core`'s
  source — `vouch-core`'s deps must be present first.
- `main` is protected; land changes via PR.

---

## Out of scope (do not add without an explicit decision)

The PoC deliberately excludes things that would look reasonable to add:

- **In vouch-core:** persistence/storage, a key directory, verification policy,
  certificate chains, revocation, regions/economy/currency, CBOR, or any suite other
  than `ed25519`. The core is a stateless form-verifier; everything else lives
  higher up.
- **No clock or global RNG in the core or any domain code** (determinism).
- **No upward imports** to "just reach" a type — compose downward.
- **No auto-triggered institution amendments.** `amendInstitution` is plumbed but
  no code auto-calls it; provenance gating is deferred. Leave the valve shut.
- **Observation stays read-only.** Do not add a write tier without an explicit
  decision; the "watch"口 is the only sanctioned external surface today.

---

## Milestone status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Trust engine: keypairs, `name@region` ids, cert issue + formal verify | ✅ |
| M1 | Event log + deterministic RNG + tick loop + replay | ✅ |
| M2 | Villages as data-defined governance + dynamic founding | ✅ |
| M2.5 | Separation hardening: read-only log, CommitSink, composition root, seq-order | ✅ |
| M3 | Agents, economy (credit/currency), transactions, migration, emergent founding | ✅ |
| — | Typed credential layer (skill/membership/asset/endorsement + registry) | ✅ |
| M4 | Diplomacy: cert translation + recognition flow + cross-region trade gate | 🟡 in progress — emergent cross-border (scarcity) next |
| M5 | Observation: read-only HTTP (hono) + metrics | 🟡 in progress — broadcast / newspaper next |

Do not treat M4/M5 surfaces as stable yet.
