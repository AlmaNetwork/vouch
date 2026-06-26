# vouch

[![CI](https://github.com/AlmaNetwork/vouch/actions/workflows/ci.yml/badge.svg)](https://github.com/AlmaNetwork/vouch/actions/workflows/ci.yml)

**vouch is a society simulator.** AI agents live in self-governing villages — each
under a different rule of trust — earn and trade, move on when they're disadvantaged,
and break away to found new villages while the world is running. You watch to see
**which institutions prosper**: the strict village or the lenient one, the open
economy or the guarded one.

Every interaction is recorded in one append-only log, and the entire history replays
deterministically — so you can rewind, compare two runs side by side, and ask *"what
if this one thing were different?"* It's a world meant to be **watched**, and — in
time — **taken part in**.

### What happens in a run

- villages are founded with their own institutions, and agents are admitted as residents
- agents transact — currency moves, trust (credit) accrues, every deal leaves a signed receipt
- the disadvantaged **migrate** to other villages
- when a cohort's values clash with their village and reach critical mass, they
  **secede and found a new village** whose rules embody their dissatisfaction
- *(coming)* villages meet across borders and negotiate whose certificates they honor;
  a "village newspaper" narrates the turning points to viewers

## Packages

| Package | What it is | Tests |
|---------|-----------|-------|
| [`vouch-world`](./vouch-world) | The **simulator** — the deterministic world engine, the villages, the agents, the economy, typed credentials, diplomacy, a region market, digital items, a resource/scarcity model, and a read-only observation server. This is the world. | 100 |
| [`vouch-core`](./vouch-core) | The **trust engine** it runs on — a standalone, dependency-free\* factory that mints ids/keys/certificates and **formally verifies** signatures. It knows nothing of villages or economies; meaning lives outside it, and it's reusable on its own. | 35 |

\* depends on no other layer; only `@noble/curves`, `canonicalize`, `zod`.

## Under the hood

vouch speaks **ALMA**, a distributed identity & trust protocol — that's the substrate,
not the show. The protocol fixes only the shape of a certificate and how it's signed;
*what a certificate means, and whether a village honors it,* is the simulation's drama.

### Credentials

A certificate's envelope is universal; its *meaning* is open. The credential layer
([`vouch-world/src/credential`](./vouch-world/src/credential)) declares typed credential
kinds — skill, membership, asset, endorsement, or your own — each a `schemaId` with a
validated claims shape, issued and verified on top of the meaning-free core. The
envelope never changes; only what you put in it.

### Architecture — 5 layers + 2 foundations

Dependency direction is strictly downward; a lower layer never knows an upper one.

```
L5  Observation     read-only HTTP (hono): metrics / log / state            vouch-world/src/observation
L4  Environment     composition root + the only write path;
                    value-conservation monopoly                            vouch-world/src/environment
L3  Agent           residents; brains (rule-based -> LLM-swappable);
                    state derived by folding the log                       vouch-world/src/agent
L2  Region          villages as data: institutions + slice reducer         vouch-world/src/region
L1  Trust engine    stateless generate + formal-verify factory             vouch-core
A/B Foundations     append-only event log + deterministic RNG + replay     vouch-world/src/foundation
```

### Principles that make the world honest

- **Event sourcing.** The append-only log is the single source of truth; all state is
  derived by folding it. There is no API to mutate the world directly — only
  `emit(event)` — so the whole history replays deterministically.
- **Conservation monopoly.** Only the environment changes value; agents *request*, the
  environment *executes* after checking conservation. No one can mint themselves money.
- **Form vs. meaning.** The trust engine makes no judgement and stores nothing; whether
  a certificate is *valid* is each village's call.
- **Determinism & replay.** A fixed seed reproduces the exact same history; even
  non-deterministic (e.g. LLM) decisions are journaled and replayed from the log.
- **Observation never interferes.** The observation layer only reads; watching the
  world can never change it.

## Status

| Milestone | Scope | Status |
|-----------|-------|--------|
| M0 | Trust engine: keypairs, `name@region` ids, certificate issue + formal verify | ✅ |
| M1 | Event log + deterministic RNG + tick loop + replay | ✅ |
| M2 | Villages as data-defined governance + dynamic founding | ✅ |
| M2.5 | Separation hardening: read-only log, CommitSink, composition root, seq-ordering | ✅ |
| M3 | Agents, economy (credit/currency), transactions, migration, emergent founding | ✅ |
| **M4** | Diplomacy: certificate translation (absorb/map/reexamine/reject) + recognition flow + cross-region trade gate | 🟡 in progress — emergent cross-border (scarcity) next |
| **M5** | Observation: read-only HTTP server (hono) + metrics — external clients connect to *watch* (§2-6) | 🟡 in progress — broadcast / newspaper next |

## Run

Each package is self-contained ([Bun](https://bun.sh) runs the TypeScript directly):

```bash
cd vouch-world && bun install && bun test   # the simulator (depends on ../vouch-core)
cd vouch-core  && bun install && bun test   # the trust engine, on its own
```

## Layout

```
vouch/
├── vouch-world/                # the simulator
│   ├── examples/               #   m0-m1-demo.ts
│   └── src/
│       ├── foundation/         # A/B  event log · RNG · world/tick · replay
│       ├── region/             # L2   institution vocabulary · slice reducer · selectors
│       ├── agent/              # L3   brains (view -> intent) · agent-slice fold
│       ├── environment/        # L4   composition root · founding · economy · diplomacy · driver
│       ├── credential/         #      typed, validated certificate types on the envelope
│       └── observation/        # L5   read-only HTTP (hono) · metrics
└── vouch-core/                 # L1 trust engine (standalone package)
    └── src/                    #   identifier · keys · suite · jcs · encoding · certificate
```

## Naming

`vouch` is the simulation (and the brand); `ALMA` is the protocol it implements. The
protocol/domain identifiers keep the `ALMA` name (the certificate format `alma-cert/v1`,
the schema namespace `alma.*`) — same split as a product versus the protocol it speaks.

## Protocol & background

- ALMA whitepaper — https://alma.gitbook.io/alma
- Scrapbox — https://scrapbox.io/alma/
- Org — https://github.com/AlmaNetwork

## License

[Apache-2.0](./LICENSE) © AlmaNetwork.
