# CLAUDE.md — vouch-world (the simulator)

Package-specific rules. Read the [root CLAUDE.md](../CLAUDE.md) first — it has the
five principles, the layer map, the naming split, and the full list of exact
identifiers. This file is the per-layer working detail.

`vouch-world` is the deterministic world engine plus L2–L5: regions, agents, the
economy, typed credentials, diplomacy, and a read-only observation server. It
depends on `vouch-core` (`file:../vouch-core`).

```
src/
  foundation/   A/B  event log · seeded RNG · World/tick · replay
  region/       L2   institutions-as-data · slice reducer · selectors
  agent/        L3   AgentState · brains (view -> intent) · agent-slice fold
  item/         L3   digital-item ownership ledger (mint/transfer) · slice fold
  environment/  L4   composition root · founding · economy · diplomacy · driver
  credential/        typed, validated credential kinds on the core envelope
  observation/  L5   read-only HTTP (hono) · metrics
```

Layout note: `region`/`agent` are pure read-models and brains; **all writes go
through `environment`**. `region` exports only types/reducer/slice/selectors and the
`makeInstitutions`/`defineRegion` data builders — the write path
(`proposeFounding`, `seedGenesis`, `amendInstitution`, `createAlmaWorld`,
`rootReducer`, `INITIAL_WORLD_STATE`) lives in `environment`.

---

## foundation (A/B) — the deterministic substrate

- **`emit()` is the only mutator.** `World.emit(type, actor, payload)` appends +
  folds. `World.log` is the read-only `WorldLog` facade (no `append`). There is no
  `setState`.
- **Order by `seq`, never `tick`.** `seq` = monotonic log order; `tick` = sim time,
  can repeat, is not wall-clock.
- **Seeded RNG only.** `Rng.create(seed)` (private constructor — never `new Rng`);
  `create(42)` and `create("42")` are the same stream. `fork(label)` consumes two
  draws from the parent and advances it. Never `Date.now()` / `Math.random()`.
- **Two narrow capability views** (pass the narrowest a function needs):
  - `CommitSink<S>` = `{ getState, emit, commitSystem }` — the env-only write capability.
    `emit(type, actor, …)` authors a PRINCIPAL event and **rejects `actor === SYSTEM_ACTOR`**
    (throws). System/conserved events go through `commitSystem(type, payload)` (actor =
    `"world"`). Keep `CommitSink` out of untrusted hands — that, plus the emit guard, makes
    a forged `world`-authored settlement impossible at write time.
  - `WorldView<S>` = `{ getState, tick, log }` — readers only; give this to
    observation so watching can't write.
- Events, payloads, and state are **deep-frozen**; clone to change.
- `replayState(events, initial, reducer)` must equal a live world's `{tick, state}`.

## region (L2) — villages as data

- A village is a `RegionDefinition` (pure data) built via `defineRegion` +
  `makeInstitutions`. **Don't hardcode villages in logic** — adding a village = adding
  data.
- `regionReducer` is a pure `Reducer<RegionSlice>`; every branch returns a new object
  via spread, and the default branch returns `state` unchanged.
- **`foundedAtSeq` is `event.seq`, not the tick.**
- `region.institution.changed` and `region.recognized` are **no-ops if the region is
  absent**; `region.recognized` is idempotent and monotonic toward `recognized`.
- **No residency field on `RegionState`** — membership is derived from the agent
  slice (`agentsInRegion`). Single source of truth.
- **`owner: string | null`** on `RegionState` = the account/ID that governs it; `null` =
  system/unowned (genesis, emergence). `experimenterProposal(def, note?, owner)` sets it;
  selectors `ownerOf` / `ownedRegionsOf`. The Sybil rule is **1 person = 1 ID** (an ID can
  be resident and/or founder); an ID may govern **multiple** regions (no one-region cap).
  Regions are **never deleted** (append-only; the market transfers ownership instead).
- **Market / lifecycle (P3, the "instance control"):** `RegionState.lifecycle`
  (`active`/`dormant`) + `salePrice`. `setRegionLifecycle` / `listRegion` (dormant-only) /
  `transferRegionOwnership` (`environment/market.ts`) are **owner-only** (`isOwner`, the asset
  right — distinct from `canGovern`, the rules right). A sale PRESERVES the region
  (institutions/residents/treasury survive) and **resets governance to dictatorship** under the
  new owner (so a seller's stale council seat can't retain control). A **dormant region's
  economy is frozen** (`executeTransfer` refuses `region-dormant`). Price settlement in currency
  is deferred (the account↔agent value bridge is Track B).
- **Governance (§8 valve, now OPEN+gated):** `Institutions.governance` = `dictatorship` (the
  owner is sole authority) | `council` (a set of `members` + a `threshold`).
  - **dictatorship:** `amendInstitution(env, regionId, change, by)` throws unless `by` is the
    owner; the owner can rewrite any rule **including governance itself** (open a council).
  - **council (P3 voting):** `amendInstitution` is REJECTED — a member `openProposal(...)`s and
    members `castVote(...)`; the change APPLIES in the reducer once `votes.length >= threshold`
    (the proposer's open counts as vote 1, so a threshold-1 council resolves at once). One open
    proposal at a time; no double-vote; resolution is a pure deterministic fold.
  - `validateGovernance` rejects an empty council, and a change to a `dictatorship` is rejected
    when `owner === null` (both would brick the region — no one could ever govern it).
  - The reducer's top actor-gate makes all of this unforgeable (a non-system institution/vote
    event is ignored, live + replay).
- **Scarcity / resources (P3, the "compete" substrate):** `Institutions.resourcePolicy`
  `{capacity, regenPerTick}` + `RegionState.resourceLevel`. `regenerateResources` (driven each
  tick by the driver, id-sorted) produces into the pool up to capacity; `drawResource(env,
  agentId, amount)` moves pool → the agent's `resources` in one conserved event (refused if the
  pool is too low = scarcity, or the region is dormant). `validateResourcePolicy` is checked at
  founding **and** amend (founding now validates ALL policies — `makeInstitutions` validates,
  but a hand-built `Institutions` literal would otherwise bypass it).
- **`economyPolicy`** on `Institutions` = the region's own fee/tax schedule
  (`baseCostRate`/`minCostRate`/`repDiscount`/`creditPerTx`); `executeTransfer` reads the
  SENDER region's policy. Owner-amendable (`InstitutionChange` "economy"), **validated** by
  `validateEconomyPolicy` (rates in [0,1], `min<=base`, `creditPerTx` a non-negative int) so no
  owner can set fee > amount (which would drive the recipient negative); `executeTransfer` also
  guards `0 <= fee <= amount` as defence in depth.
- `makeInstitutions` defaults are asymmetric: `rejectUnknownSchemas: true`,
  `diplomacyPolicy.defaultStance: "reexamine"`. Build a "lenient" village by
  overriding.
- Imports **only** foundation. Never agent/environment.

## agent (L3) — residents & brains

- `AgentState`: `{ id (name@region), region, role, publicKey, balances:{credit,
  currency}, reputation, trust, resources, valueProfile }`. `id` is stable across migration;
  `region` changes on migration. `reputation` is economy-derived; **`trust` is social capital
  from being vouched for** — kept distinct (a vouch doesn't buy a cheaper fee). `resources` is
  the amount drawn from region resource pools (P3 scarcity).
- **`vouchFor(env, from, to, weight)`** (the brand verb, `environment/social.ts`) → an
  env-authored `agent.vouched` event → the reducer adds `weight` (1..5) to the subject's
  `trust`. Sybil-resistance of the vouch graph is P3.
- **A `Brain` is pure: `(ReadOnlyView) => Intent`.** No `emit`, no rng, no clock.
  Stochasticity arrives only as `view.roll` (a single deterministic draw the driver
  supplies). `Intent` is `idle | transfer | emigrate | propose | vote`; `transfer`
  moves currency only. `propose`/`vote` are the GOVERNANCE intents (A2): the driver
  routes them to `openProposal`/`castVote` in `intent.regionId` (defaulting to the
  HOME region), whose `canGovern` gate decides whether the voice is binding — a
  non-member's governance intent is journaled but fails quietly. A council seat is
  id-bound, not residency-bound, so an emigrated member names its region to keep
  voting (else an open proposal would wedge). `voterBrain` (opt-in, NOT in
  `defaultBrains`) backs an open council proposal wherever the agent's vote is
  binding (home region first, then the others), else trades.
- **Actor-gate (defence in depth):** BOTH the agent and region reducers gate at the top —
  `if (event.actor !== SYSTEM_ACTOR) return state;` — so **every** state-changing event
  (admit/migrate/settle/mint, found/recognize/institution.changed) is honored only when
  env-authored; a forged non-system event is ignored on live fold and replay. Write-time,
  `World.emit` already rejects `SYSTEM_ACTOR` and system events go through `commitSystem`
  (env-only `CommitSink`) — so a forge is blocked before the log AND ignored if one slipped
  in. (`agent.decided`, actor = the agent, is principal-authored and a reducer no-op.)
- **Atomic settlement:** if any entry's agent is unknown, reject the whole event
  (`CC-1`). Never apply a partial set of legs.
- `agent.decided` changes no state — it journals the brain's decision for
  deterministic replay. **Replay re-folds it; brains are never re-invoked.**
- `agentsInRegion` excludes the `treasury` role and sorts by `id` ascending
  (determinism `DET-1`). `treasuryId(region)` = `treasury@${region}`.
- Imports foundation, region (types), `vouch-core`. **Never environment.**

## item (L3) — digital items

- A unique, tradeable asset distinct from currency, tracked by an event-sourced ledger
  (`itemId → owner`, an agent). `mintItem` / `transferItem` (`environment/items.ts`) are
  env-authored; **transfer is holder-gated** (`by === item.owner`). Reducer gates at the top
  on `SYSTEM_ACTOR` (forged item events ignored). Items are unique (deed-like), not a fungible
  quota; an item-for-currency atomic swap is a later refinement. Imports only foundation.

## environment (L4) — composition root + the only write path

- `WorldState extends RegionSlice, AgentSlice`. `rootReducer` composes
  `regionReducer` + `agentReducer` and **returns the same reference when nothing
  changed** (no churn). `createAlmaWorld(seed)` is the composition root.
- **`executeTransfer` is the sole producer of `economy.settled`** — the value
  monopoly. It validates, applies the pure conservation predicate, issues a receipt
  certificate, emits one event. Fee = `floor(amount * trustCostRate(reputation))`
  → `treasuryId(from.region)` (the **sender's** treasury, even cross-region). Refuses
  with `no-treasury` if that treasury is absent (so currency can't leak).
- **Failures return `{ok:false, reason}`; they do not throw.** Reasons:
  `unknown-agent`, `self-transfer`, `not-transferable`, `bad-amount`,
  `insufficient-funds`, `no-treasury`, plus the cross-region gate reasons. Only the
  internal conservation-violation case throws. Branch on `result.ok`, don't try/catch.
- All write ops (`proposeFounding`/`seedGenesis`/`admitAgent`/`admitTreasury`/
  `immigrate`/`amendInstitution`/`recognizeRegion`) change state **only** by emitting
  one `SYSTEM_ACTOR` event and reading the folded result back. Take a `CommitSink`.
- **Founding status:** born `recognized` **only** when `proposer.kind ===
  "genesis"`; experimenter/emergence start `unrecognized`. `recognizeRegion` requires
  the recognizer to itself be recognized AND (A2 proof of authority) an acting
  principal `approvedBy` satisfying `canRepresent` when the recognizer has
  representation — a system/unowned recognizer is spoken for by the world
  (`approvedBy: null` in the payload). The authority gate runs FIRST, so an
  unentitled caller always throws; only then is it idempotent for an
  already-recognized target.
- **Diplomacy (M4):** `assessCertificate` verifies **form via the core first**, then
  applies **meaning** (domestic → local verification policy; foreign → diplomacy
  stance `absorb/map/reexamine/reject`). `canTransactAcross` allows a cross-region
  transfer only if both regions are recognized and the receiver doesn't `reject` the
  sender; `executeTransfer` calls it for cross-region moves.
- **Driver:** `economyStep` has each non-treasury agent (id-sorted) decide via its
  brain, **journals** the decision (`agent.decided`) **before** dispatching it, then
  checks emergence. Treasuries don't act. `dispatchIntent` swallows invalid-intent
  exceptions (a bad intent fails quietly). Timestamps derive from the tick, never the
  clock. `DEFAULT_CRITICAL_MASS = 3`.
- Imports downward only. To extend state, add a slice in `state.ts` — never import
  upward.

## credential — typed credentials on the meaning-free envelope

- **Declare a kind only via `defineCredentialType(schemaId, zodSchema, label?)`** —
  never hand-build the object. Standard kinds: `alma.skill/v1`, `alma.membership/v1`,
  `alma.asset/v1`, `alma.endorsement/v1`, `alma.gov/steward/v1` (the C2 office
  attestation — portable EVIDENCE of a region's stewardship; the office-of-record
  stays the region's `owner` pointer).
- `issueCredential` validates claims with `schema.parse` (**throws** on bad claims)
  **before** signing, and sets the cert `schemaId` from `type.schemaId` (never caller
  input).
- `verifyCredential` checks **form (core) before meaning**: `schema-mismatch` if
  `schemaId` differs, `invalid-claims` if claims fail `safeParse`; core form reasons
  (e.g. `bad-signature`) pass straight through. `verifyCredentialWith(registry)`
  resolves the type by `schemaId` and adds `unknown-credential-type`.
- **`CredentialRegistry.register` is intentionally non-generic** (takes erased
  `CredentialType`) — a zod-v4 covariance workaround. Don't make the registry
  generic; recover `T` at the verify boundary by passing the type explicitly.
- **A valid signature does not imply valid claims.** Always re-validate on verify.
  Versioning a kind = a **new** `schemaId` (`alma.skill/v2`), never editing v1 in
  place. Use the shared `identifier` validator for `name@region` claim fields.

## observation (L5) — read-only HTTP

- Takes only a `WorldView`. `createObservationApp(view)` registers **GET routes
  only**; any write method 404s. `serveObservation(view, {port=8787})` wraps
  `Bun.serve`. Tests hit the hono app via `app.request()` (no socket).
- `metrics()` / `gini()` are pure read-only lenses. `currencyGini` is over residents
  only; `totalCurrency`/`totalCredit` include treasuries. Don't conflate the two
  populations.
- **Never** pass a `World`/`CommitSink` here, add a non-GET route, or import the write
  path. Read-only is a compile-time guarantee.

---

## Common recipes

See `.claude/skills/` for step-by-step versions:

- **Add an event type** → `add-event-type`: declare the `EVENT_*` constant + payload
  type in the owning layer, add a reducer case (default = return `state`), expose a
  write helper in `environment` that emits it as `SYSTEM_ACTOR`, add determinism +
  replay tests.
- **Add a credential kind** → `add-credential-kind`.
- **Add a village**: build a `RegionDefinition` (`defineRegion` +
  `makeInstitutions`), seed via `seedGenesis` (genesis ⇒ recognized) or
  `proposeFounding(experimenterProposal(...))` (⇒ unrecognized).
- **Add a brain**: implement a pure `Brain = (view) => Intent` (use only
  `view.roll`); register it in `defaultBrains` or pass via `EconomyConfig.brains`.
  Never add a brain for `treasury`.

## Examples

```bash
bun examples/m0-m1-demo.ts   # M0+M1: tick loop + credential issue/verify + replay + determinism
bun examples/observe.ts      # read-only observation server on :8787
```
