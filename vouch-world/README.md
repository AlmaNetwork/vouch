# vouch-world

A proof-of-concept for ALMA — a distributed identity / trust-protocol simulator.
Built bottom-up, one milestone at a time. See `spec` for the full spec; this README
tracks what is actually implemented.

## Stack

- **Runtime / tests:** [Bun](https://bun.sh) (`bun test`, runs TypeScript directly)
- **Trust Core (Layer 1):** extracted into a standalone package, [`vouch-core`](../vouch-core)
  (consumed here as `vouch-core`, a `file:../vouch-core` dependency). It carries the
  Ed25519 / JCS / zod machinery — see that package's README.
- **HTTP (§5 observation):** `hono` — the read-only observation server (`src/observation`)

This repo is the **simulator** (`vouch-world`); the meaning-free Trust Core lives in its
own repo/package next to it (`vouch-core`). Dependency direction is one-way:
`vouch-world → vouch-core` (the core never depends back).

## Layout (5 layers + 2 foundations)

Dependency direction is strictly downward: an upper layer may know a lower one, never
the reverse (§3).

```
vouch-core/       ✅ Layer 1 Trust Core (M0) — its OWN package; generate + formal-verify factory
vouch-world/  (this repo, the simulator)
  src/
    foundation/  ✅ Foundations A/B Event log + deterministic RNG + tick loop + replay (M1)
                    + read-only WorldLog facade + CommitSink (M2.5 hardening)
    region/      ✅ Layer 2 Villages: institutions vocab + slice reducer + selectors (M2)
                    + decision-mechanism vocab & fold (governance form as data, T1)
    agent/       ✅ Layer 3 Residents: brains (view→intent) + agent-slice fold (M3)
    environment/ ✅ Layer 4 Composition root + founding + economy + diplomacy + driver (M2.5/M3/M4)
                    + decision engine (propose→ballot→resolve→execute, T1)
    credential/  ✅ Typed, validated certificate types on the universal envelope
    observation/ 🟡 Layer 5 Read-only HTTP (hono) + metrics (M5); broadcast next
  examples/      m0-m1-demo.ts — uses vouch-core + foundation together
```

Import direction (enforced today): `vouch-core` imports nothing; `foundation` is
domain-agnostic; `region` imports only `foundation`; `environment` (L4) owns the
composition root + write path and imports `region` + `foundation` + `vouch-core`.

## Run

```bash
bun install
bun test          # run all tests
bun run typecheck # tsc --noEmit (optional)
```

## Milestone status

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M0** | Trust Core: keypairs, `name@region` ids, certificate issue + formal verify | ✅ implemented, tests green |
| **M1** | Event log + deterministic RNG + tick loop + replay | ✅ implemented, tests green |
| **M2** | Regions as data-defined governance + dynamic founding | ✅ implemented, tests green |
| **M2.5** | Separation hardening (audit G1–G5): read-only log, CommitSink, composition root hoisted to environment/, sim-tick detached from protocol state (`foundedAtSeq`) | ✅ implemented, tests green |
| **M3** | Agents, economy (credit/currency), transactions, migration, emergent founding | ✅ implemented, tests green |
| **Credentials** | Typed, validated certificate types on the universal envelope (skill/membership/asset/endorsement + custom) | ✅ implemented, tests green |
| **M4** | Diplomacy: cert translation (absorb/map/reexamine/reject) + recognition flow + cross-region trade gate | 🟡 in progress — emergent cross-border (scarcity) next |
| **M5** | Observation: read-only HTTP server (hono) + metrics — external clients connect to watch (§2-6) | 🟡 in progress — broadcast / newspaper next |
| **T1** | Decision mechanism as data: governance form (proposal/eligibility/weight/selection/execution/veto/appeal/emergency) carried in institutions; dictatorship + M-of-N council wired; same action, different result by form | ✅ implemented, tests green |

## M0 — Trust Core (Layer 1) — extracted to the `vouch-core` package

The lowest layer, now its **own standalone package** ([`vouch-core`](../vouch-core)) and
consumed as a dependency. A **stateless factory** that generates ids/keys/certificates
and formally verifies signatures. It holds the ALMA core principles:

- **§2-2 No meaning, no storage.** The core generates and form-checks. It makes no
  trust judgement, stores nothing, and never interprets `claims`.
- **§2-3 Shared form, free meaning.** The core fixes only the *envelope shape* and *how
  the signature is attached*. What the envelope means is the village's business.
- **§2-7 Determinism.** The core never reads a clock or a global RNG. `issuedAt` is
  supplied by the caller; `keyPairFromSeed` derives keys from a given seed — so a later
  layer (M1) can make the whole world reproducible.

### Certificate envelope

```jsonc
{
  "version":   "alma-cert/v1",
  "suite":     "ed25519",          // signature suite — dispatch point for future formats
  "issuer":    "name@region",
  "subject":   "name@region",
  "schemaId":  "string",           // opaque tag; the core does not interpret it
  "claims":    { },                // opaque object; the core does not interpret it
  "issuedAt":  "2026-01-01T00:00:00.000Z",
  "signature": "base64"
}
```

The signing payload is every field **except `signature`**, JCS-canonicalized to bytes,
then signed. Because JCS sorts keys, the signature is independent of field order.

### API (`src/core`)

```ts
import {
  generateKeyPair, keyPairFromSeed,        // keys.ts
  isValidIdentifier, parseIdentifier,      // identifier.ts
  issueCertificate, verifyCertificate,     // certificate.ts
} from "./src/core";

const guild = generateKeyPair();
const cert = issueCertificate(
  {
    issuer: "guild@umi",
    subject: "alice@umi",
    schemaId: "alma.trust/artisan/v1",
    claims: { role: "artisan", grade: 2 },
    issuedAt: "2026-01-01T00:00:00.000Z", // caller supplies the time (no clock in the core)
  },
  guild.privateKey,
);

// verify takes the issuer's public key explicitly — the core keeps no key directory.
const result = verifyCertificate(cert, guild.publicKey);
// { ok: true }  |  { ok: false, reason, detail }
```

`verifyCertificate` returns a **reason**, not just a boolean. Failure reasons:
`malformed-envelope`, `invalid-issuer`, `invalid-subject`, `unknown-suite`,
`invalid-signature-encoding`, `bad-signature`.

### What M0 deliberately does NOT do

Storage · verification policy · certificate chains · revocation · regions · economy ·
currency · CBOR · any suite other than ed25519. Those arrive in later milestones.

## M1 — Foundations: event log + deterministic execution (Foundations A/B)

The basement everything else stands on. Built on one promise (§M1 design promise):
**there is no API to set world state directly.** State changes only by emitting an
event, which is appended to the log and folded through a reducer — so state is always
reconstructable from the log alone.

- **Foundation B `EventLog`** ([event-log.ts](src/foundation/event-log.ts)) — append-only, the
  single source of truth. Events carry `{ seq, tick, type, actor, payload }`, are
  deep-frozen on write, and readers get a copy. No update/delete.
- **Foundation A `Rng`** ([rng.ts](src/foundation/rng.ts)) — deterministic PRNG (cyrb128 +
  sfc32). All world randomness flows through it; same seed ⇒ same sequence. `bytes(32)`
  feeds M0's `keyPairFromSeed`, and `fork(label)` derives reproducible sub-streams.
- **`World`** ([world.ts](src/foundation/world.ts)) — ties the RNG + log + reducer.
  `emit()` is the only mutator; `advanceTick()` records the clock advance as an event;
  `run(ticks, onTick)` is the tick-loop skeleton (each tick records ≥1 event).
- **Replay** — `replayState(events, initial, reducer)` rebuilds `{ tick, state }` purely
  from the log; it equals the live world for the same history (§2-7).

```ts
import { World, replayState } from "./src/foundation";

const world = new World({ seed: "demo", initialState: { pings: 0 }, reducer });
world.run(50, (ctx) => {
  if (ctx.rng.bool(0.6)) ctx.emit("ping", ctx.rng.pick(["a@r", "b@r"]));
});
// same seed + same script ⇒ identical log (world.log.digest());
// replayState(world.log.all(), { pings: 0 }, reducer).state  ===  world.getState()
```

Two determinism properties are tested separately: **forward** (same seed ⇒ identical
history) and **reconstruction** (fold the log ⇒ the live state).

## M2 — Regions & founding (Layer 2)

A village is a **governance subject**, not hardcoded behaviour: it is a data
`RegionDefinition` carrying its **institutions** — a certificate-schema ledger, a
verification policy, and a diplomacy policy (§2-A). Adding a village = adding one
definition; the engine never grows.

- **Institutions as data** ([types.ts](src/region/types.ts)) — every policy is a plain
  object, so it can be *swapped*. This is the reserved **viewer-legislator hook** (§8):
  the mechanism to replace an institution and log the change exists
  (`amendInstitution`), but nothing external calls it — the tap is plumbed, the valve
  is shut.
- **Dynamic registry** ([state.ts](src/region/state.ts)) — `WorldState.regions` grows as
  `region.founded` events fold in; the whole village set is derived from the log, so M1
  replay still reconstructs it.
- **Founding = propose / execute split** ([founding.ts](src/region/founding.ts)) — the
  one execution engine `proposeFounding(world, proposal)` serves *every* proposer.
  Proposals reach it through a single `FoundingProposal` interface:
  - **(a) experimenter** — god-view injection, implemented: `experimenterProposal(...)`.
  - **(b) emergence** — reserved for M3: `emergenceProposal(...)` hits the *same* engine;
    only its trigger logic is missing.
  - genesis villages are seeded through the same engine (`seedGenesis`).

A founded village is born **unrecognized** with **zero residents**; the founding event
records **who proposed it** (§2 design promise). Recognition (the approval flow) is M4;
immigration is M3.

```ts
const world = createAlmaWorld("demo");
seedGenesis(world, [yamaDef, umiDef]);          // born "recognized"
world.run(3);                                    // world is live
proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova")));
// nova exists, status "unrecognized", proposer recorded in the log (foundedAtSeq from log seq).
```

## T1 — Decision mechanism as data (governance form as a variable)

Before T1, *who decides and how* was hardcoded: founding, recognition, and
amendment were all executed directly by `SYSTEM_ACTOR` (the "god hand"), so the
governance **form** was an implicit constant — the research had no independent
variable. T1 lifts that form into data a region carries, exactly like its other
institutions.

- **Form as data** ([types.ts](src/region/types.ts)) — a `DecisionMechanism` is eight
  independent slots: *proposal / eligibility / weighting / selection / execution /
  veto / appeal / emergency*. Voting is **not** the abstraction; it is one
  `selectionRule` among many. The slots share one predicate vocabulary (`Qualifier`),
  so a region can **mix** them (e.g. propose = reputation, decide = council, override =
  one key). The type is the general shape the 12 legitimacy classes reduce to; the MVP
  wires two of them.
- **Decision lifecycle = propose / ballot / resolve / execute**
  ([decision.ts](src/environment/decision.ts)) — `openDecision` checks the proposal
  rule and snapshots the mechanism; `castBallot` checks eligibility and records a
  ballot; resolution is a **pure fold** of the snapshot over the accumulated ballots
  (no clock; any randomness would go through the engine RNG). An approved decision
  executes through the engine that already owns the write (`amendInstitution`,
  `recognizeRegion`), always via `SYSTEM_ACTOR` — so the reducer stays the single
  chokepoint (§2-5). Every step is an event, so the whole decision replays.
- **Two MVP forms, data only** — **dictatorship** (`singleAuthority`: one approving
  ballot from the named authority decides) and **M-of-N council** (`threshold`). The
  default (`makeInstitutions()`) is the pre-T1 god hand expressed as data: only
  `SYSTEM_ACTOR` proposes and a single act decides.

```ts
const action = { kind: "amendInstitution", change: { policy: "verification",
  value: { acceptedSchemaIds: [], rejectUnknownSchemas: false } } } as const;

// Same action, different FORM → different result:
const dEdo = openDecision(world, "edo", action, "shogun@edo");   // dictatorship
castBallot(world, dEdo.id, "shogun@edo", true);                  // → approved + executed

const dKyo = openDecision(world, "kyo", action, "a@kyo");        // council 2-of-3
castBallot(world, dKyo.id, "a@kyo", true);                       // → still open (1 of 2)
```

The remaining slots (veto / appeal / emergency) and the RNG-driven selection rules
(`sortition` / `randomBeacon`) are **typed but not wired** — reserved like the
emergence trigger. Real cryptographic voting / threshold signatures are out of scope:
a "ballot" is a logged event and "M-of-N" is a count. Authority checks (T2) are meant
to read the very same `Qualifier` slots — see `evaluateQualifier`.
