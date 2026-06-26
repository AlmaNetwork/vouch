# Glossary

Every term below is taken from the real types and code, with the `§`-numbers the source
comments use. Enums list their exact members.

## Identity & regions

- **`name@region`** — an agent's identity (e.g. `ada@umi`). Stable across migration: the
  `region` part is where they were *born*, not necessarily where they live now.
- **Region** (a.k.a. *village*) — a self-governing community, defined as **data**
  (`RegionDefinition`: id, display name, institutions), not hardcoded behavior (§2-A).
  Adding a region = adding one definition.
- **Institutions** — a region's governance, all swappable data (§2-A):
  - **schema ledger** — the certificate schemas the region declares valid.
  - **verification policy** — `{ acceptedSchemaIds, rejectUnknownSchemas }`: what the
    region deems valid.
  - **diplomacy policy** — `{ defaultStance, overrides }`: how it treats *other* regions'
    certificates.
- **Genesis** — the initial region(s), seeded through the founding engine and born
  **recognized** (they *are* the established society). Everything else is born
  unrecognized.
- **Region notary** — the per-region key pair that signs a region's receipts (e.g. the
  transfer receipt). **Server-held** — never a client input.

## Recognition & diplomacy

- **`RecognitionStatus`** — `unrecognized` | `recognized`. Founded regions start
  `unrecognized`; a recognized region can admit them to the international society (§4-C).
- **`ForeignCertStance`** — how a region translates *another* region's certificate (§4-A):
  - `absorb` — accept as-is.
  - `map` — translate the foreign type into a local one.
  - `reexamine` — re-check under the region's own policy.
  - `reject` — do not accept.
- **Cross-region trade gate** — a value transfer where `from.region != to.region` only
  settles if **both** regions are recognized and the receiver does not `reject` the sender
  (§4-C). Failure reasons: `sender-region-unrecognized`, `receiver-region-unrecognized`,
  `receiver-rejects-sender`, `unknown-region`.

## Agents

- **`AgentRole`** — `artisan` | `merchant` | `broker` | `treasury`. The `treasury` is a
  per-region account that collects fees (so currency is conserved); it does not act.
- **`ValueProfile`** — `strict` | `lenient`. A coarse leaning; when a cohort's profile
  clashes with its region's stance and reaches critical mass, it secedes (§3-D).
- **Region stance** — a region's leaning derived from its verification policy:
  `strict` if it rejects unknown schemas, else `lenient`.

## Economy

- **Balances** — every agent holds two (§3-B):
  - **currency** — the **transferable** medium of exchange.
  - **credit** — **non-transferable**, slow-accruing trust.
- **`executeTransfer`** — the *sole* producer of value events. The environment alone moves
  value; agents only *request* (§2-4). Currency is conserved by construction (moved
  amounts + treasury fee sum to zero).
- **Receipt** — a signed certificate (`alma.tx/receipt/v1`) minted as a byproduct of a
  settled transfer; it accumulates in the log and is folded as data on replay (never
  re-signed).

## Event log & determinism

- **Event** — an immutable fact `{ seq, tick, type, actor, payload }`. The append-only log
  of all events is the single source of truth (§3 Foundation B).
- **`seq`** — global, 0-based, monotonic position in the log. **The canonical order** —
  higher layers must order by `seq`, not `tick` (audit G5).
- **`tick`** — discrete sim-engine time. A *simulation* annotation, not wall-clock.
- **Digest** — a stable hash of the whole log (`/log/digest`). Same seed ⇒ same digest:
  determinism made observable.
- **Replay** — `replayState(events, initial, reducer)` rebuilds state from the log alone;
  it equals the live state for the same history (§2-7).
- **Emergence (§3-D)** — internal secession: a dissatisfied cohort founds a new region
  through the *same* founding engine (an `emergence` proposer), then migrates into it.

## Credentials (typed certificates)

- **Certificate envelope** — the universal vouch-core shape:
  `{ version, suite, issuer, subject, schemaId, claims, issuedAt, signature }`. The core
  fixes the *form* and the *signature*; it never interprets meaning (§2-2/§2-3).
- **`schemaId`** — an opaque tag (e.g. `alma.skill/v1`) that selects a credential type.
- **Credential type** — a `schemaId` + a validated `claims` shape. Standard library:
  `alma.skill/v1`, `alma.membership/v1`, `alma.asset/v1`, `alma.endorsement/v1`.
- **Form vs. meaning** — the core checks *form* (signature + envelope shape); a region
  applies *meaning* (whether it honors the certificate). The core never gains meaning.

## Governance & the write path

- **Proposer** — who proposed a region's founding: `genesis` | `experimenter` (god-view
  injection) | `emergence` (internal secession). One execution engine serves all (§2-B).
- **`InstitutionChange`** — a logged amendment to one policy, tagged by `policy`:
  `verification` | `diplomacy` | `schemaLedger`. The mechanism exists; provenance gating
  is not yet enforced on this build.
- **`CommitSink`** — the narrow write capability `{ getState, emit }` that domain
  operations take, instead of the whole world (audit G3). The environment owns the write
  path.
- **Reducer** — folds an emitted event into new state. Because `emit` is public, the
  reducer fold point is the real chokepoint for conservation invariants (audit G4).
