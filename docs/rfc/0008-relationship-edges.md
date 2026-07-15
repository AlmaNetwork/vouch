# RFC 0008 — Relationship Edges & Reputation Substrate

- **Status:** Draft
- **Layer:** ALMA protocol candidate — the **substrate beneath RFC 0007 (Command System v2, PR #30)**. This RFC defines only the relationship-**edge** data structure, its weight, its per-edge hash chain, the deterministic reputation **fold**, and **cross-region edge portability**. It **normatively depends on RFC 0007 (Command System v2)** for command definition and execution, the four-power separation, penal/criminal law, intra-node finality and reorg, suffrage, and identity. It does not re-specify, extend, or contradict any of those; where it touches them it defers with explicit citation.
- **Date:** 2026-07-14
- **Requires:** RFC 0007 (Command System v2, PR #30) — load-bearing throughout; RFC 0004 (Cross-region Due Diligence & Value Transfer) §9/§10; RFC 0005 (Signature Suites & Negotiation).
- **Related:** RFC 0006 (Region Authorization & Capability Delegation) — its capability model survives here **only as a cross-region artifact** (§10; RFC 0007 §4.4 does not adopt it intra-node). RFC 0003 (Region Assets) — holdings project into **non-suffrage** economic signals only (§8.4, §11.1). RFC 0001 (region governance) — its node-side authority is RFC 0007; every former direct dependency on RFC 0001 §4/§5 is re-pointed to RFC 0007 §10.1/§5.2.
- **Requirements language:** MUST / MUST NOT / SHOULD / MAY / REQUIRED / OPTIONAL per RFC 2119.

## 1. Summary

This document specifies the **relationship edge**: a signed, weighted, directed relationship carrying its own tamper-evident hash chain, and the deterministic **fold** that derives a node's reputation/standing from its incoming edges. It is deliberately **subordinate** to RFC 0007 (Command System v2). RFC 0007 owns commands, the closed effect-primitive vocabulary, the four-power separation, penal law, intra-node finality/reorg, suffrage, and identity. RFC 0008 owns only what RFC 0007 §14 explicitly defers to an independent RFC: **how a relationship is represented as folding, hash-chained, portable data; how a reputation law folds it; and how these artifacts travel across regions.**

Three positioning claims frame everything below:

- **An edge is a read-model of RFC 0007's write primitives, not a competing write path** (§4, §11). A `vouch` edge is the representation of what RFC 0007 §3.4 `recordVouch` records; a `sanction` edge is the representation of what RFC 0007 §9's penal path (`suspendId`/`restrictCommands`) emits. RFC 0008 defines no new way to admit, vouch, punish, or authorize.
- **The fold is a data-defined reputation law by governance, and a read-time derivation by evaluation** (§8). It is specified as a `putDefinition(kind: "law", …)` in RFC 0007's versioned definition store (§8.1), amendable via RFC 0007 §8.3 with objection windows — because RFC 0007 §14 forbids reputation computed at kernel/operator discretion as a "fifth power." But a reputation fold is **not** one of RFC 0007 §8.2's three lawTypes (constraint/penal/trigger); it neither blocks, penalizes, nor schedules a command. Its **evaluation** — a graph fixpoint over incoming edges — exceeds RFC 0007's closed precondition vocabulary (§4.2) and therefore requires a **named RFC 0007 §14 kernel extension** (a read-law/fold evaluation mode plus a graph-aggregation predicate class), stated as a normative dependency, not silently assumed to run on the existing §8 evaluator (§8.1, §8.6).
- **Weight is confined to non-suffrage contexts** (§8.4). Governance suffrage is RFC 0007's exclusive domain — 1-ID-1-vote (§10.1), exercised through RFC 0007 §7 decision procedures over Group electorates. Admission and identity are established by the **binary, unweighted** primitives `admitId`/`recordVouch` (§3.4) and RFC 0008's `membership` edge; RFC 0008 adds no weight to either the admission artifact or the §7 tally. RFC 0008's optional weight+context layer feeds only the reputation law and cross-region diligence.

The per-edge micro-chain (§5) remains the load-bearing choice, but its purpose is now narrow: **portability** — an edge self-verifies cross-region from its content hash, signature, suite, and the signer-AID's RFC 0007 §10.2 key-event-log extract, without trusting the origin's database. Intra-node freshness, ordering, anti-equivocation, and consistent snapshots are **not** re-solved here; they are RFC 0007 §5's single node log. RFC 0008 retains only the **cross-region corroboration layer** (§6): head-checkpoints, multi-source freshness, heartbeat, and anti-gerrymander, built **on top of** RFC 0007 §5.6 signed checkpoints/MMR and §10.2 inclusion-proof extract — never as a parallel intra-node structure.

## 2. Motivation

### 2.1 What RFC 0007 already provides, and what it defers

RFC 0007 gives a single node a self-certifying, hash-chained append-only log with a monotone finality boundary F (§5.2), inclusion/consistency proofs and signed checkpoints (§5.6), duplicity detection (§5.6), KERI-style identity that outlives its keys (§10.1), 1-ID-1-vote suffrage with voucher liability (§10.1) exercised through §7 decision procedures, and a complete penal/adjudication process (§9). The old edge RFC's "region journal," "region STR," "anti-rollback," and "first-committed-wins" machinery **is** that node log; on a single node it collapses into RFC 0007 §5. This RFC therefore **removes** those re-inventions and keeps only the layer RFC 0007 does not have.

RFC 0007 §14 enumerates exactly that layer as open and defers it:

- **"Governance of reputation … deferred to an independent RFC,"** with the constitutional condition that a reputation function MUST be a *data-defined law* (transparent formula, amendment procedure, objection-window applicability); discretionary reputation is a forbidden fifth power (Deleuze/Zuboff). **This RFC is that independent reputation RFC** (§8). RFC 0007 §14 fixes only the *conditions* for such a law; it provides **no kernel evaluator that can execute a fold** — its §8.2 lawTypes have no value-deriving mode and its §4.2 predicate vocabulary is closed (extending it "is a kernel change (§14)"). RFC 0008 therefore names the fold-evaluation mode as an explicit RFC 0007 §14 kernel-change dependency (§8.1, §8.6) rather than overstating compatibility with the existing §8 engine.
- **"A bridge that appends a counterpart's signed artifacts (vouchers, checkpoints, duplicity proofs) to the local log"** (§14(ii)), plus counterpart-capability evaluation (§14(iii)). **This RFC's portable, self-verifying edges, head-checkpoints, and cross-region sanction-pull ARE those artifacts** (§10).
- **Hash-function agility** — "owned by neither document" (§14). RFC 0008 shares that unowned gap and names it explicitly (§14).

### 2.2 Trust is FOR something (context), but weight is never a vote

An edge carries a **`context`** (§4.4): the same holder MAY have different effective weight in different decision contexts, and a cheaply-minted `nova:merchant` edge MUST NOT silently satisfy a `delta:econtrust` fold. But this contextual weighting is bounded by an absolute rule inherited from RFC 0007: **it never weights a governance-suffrage vote.** RFC 0007 §10.1/§13 fix 1-ID-1-vote and reject stake-weighted governance. So `context`-scoped weight lives entirely in *non-suffrage* reputation, economic-trust, cross-region-exposure, and display space (§8.4). The old `equal|reputation|stake` triple is split accordingly (§8.3): `equal` is RFC 0007's domain (1-ID-1-vote exercised through §7 procedures) and leaves this RFC; `reputation`/`stake` survive only as non-suffrage signals.

## 3. Terminology

- **Edge** — a signed, weighted, directed relationship (`alma-edge/v1`) with its own hash chain (§4, §5).
- **Core** — the signed, hashed field set of an edge state: every field **except** `signature`, `cosign`, and `anchor` (§4.1).
- **edgeId** — the content address of an edge **state**: `sha256_hex(canonicalBytes(core))` (a SAID-class content address, aligned to RFC 0007 §5.1).
- **genesisId** — the `edgeId` of the `counter == 0` / `prev == null` state; the **stable name of a fixed `(from, to, kind)` relationship** across all its states (§4.2, §5.1). Endpoints are immutable within a relationship (§5.3).
- **Micro-chain** — an edge's own `prev`-linked history of weight/context/validity/revocation/clearing states (§5). It never records an endpoint change.
- **AID** — the stable RFC 0007 §10.1 identity of an *agent* (a KERI key-event sub-log). Agent edges and sanctions bind to the **AID**, not to a rotating key (§4.3, §5.3, §11.2). A *region* endpoint binds instead to the region/node key (RFC 0005; RFC 0007 §5.1), not to a §10.1 vouched AID (§4.3).
- **KEL extract** — an inclusion-proof-equipped extract of a signer's key-event sub-log (RFC 0007 §10.2), needed alongside an edge for cross-region signature verification when the signing key has rotated (§5.5, §10.1).
- **Head-checkpoint (Signed Tree Root, STR)** — a region's periodically-published, signed, monotone, authenticated `genesisId → head` map, built on RFC 0007 §5.6 checkpoints for **cross-region** corroboration (§6.2).
- **Fold** — the deterministic reputation derivation over a node's incoming edges, governed as an RFC 0007 `kind:law` definition and evaluated at read time (§8).
- **Projection** — a named specialization of the fold for a non-suffrage context (§8.3).
- **Endpoint** — an agent identifier `name@region` **or** a bare region id `/^[a-z0-9]+$/` (§4.3).

## 4. The edge (canonical schema)

An edge is the **data** that an RFC 0007 primitive appends and that the reputation law (§8) folds. It introduces no write path of its own: minting/altering an edge is executing the corresponding RFC 0007 command (`recordVouch`, a §9 sanction issuance or clearing, membership admission, a cross-region capability grant), whose effect appends the edge state to the node log and whose finality is RFC 0007 §5.

### 4.1 Envelope, signed core, and identity

An edge is its own signed envelope, parallel to vouch-core's `alma-cert/v1` Certificate (JCS over all-but-`signature`). The envelope version is hyphenated (`alma-edge/v1`); each edge additionally carries a per-kind **dotted** `schemaId` (`alma.vouch/v1`, `alma.membership/v1`, `alma.connection/v1`, `alma.capability/v1`, `alma.sanction/v1`) so RFC 0004 honoring can match it (§10.2).

The edge splits into a **signed core** and **detached attachments**:

- The **core** is every field except `signature`, `cosign`, and `anchor`. `anchor` (§6.1) and `cosign` (§4.6) are excluded by construction (their values are produced after signing and/or by other parties). They are detached proofs, not signed by `from` and not in `edgeId`.
- `edgeId` MUST be `sha256_hex(canonicalBytes(core))`, JCS-canonicalized (RFC 8785). The `from` `signature` MUST be Ed25519 over `canonicalBytes(core)`, base64-encoded; every co-signer in `cosign` MUST sign the **same** bytes.
- Every edge MUST carry a **`suite`** field (RFC 0005). A verifier MUST reject a missing `suite`, MUST reject `suite ∉ agreedSuites` **before any crypto**, MUST NOT infer the algorithm from key material, and MUST verify with exactly the algorithm/encodings/canonicalization the Registry binds. The MTI suite is `ed25519`.

This is the **RFC 0007 §5.1/§10.1 crypto stance** (Suite ID first-class and never inferred from key material; an append-only immutable Suite-ID registry with MTI `ed25519`); `edgeId` is a SAID-class content address of the same class as RFC 0007 event IDs.

**Determinism (REQUIRED).** (1) Every core field MUST be present in every edge, with explicit `null` where inapplicable (`expiry`, `prev`, `genesis`, `command`, `parent`) — a missing key vs. explicit `null` changes canonical bytes. (2) `weightBp` MUST be a JSON integer, never a float (§4.4).

### 4.2 Schema

```jsonc
// --- signed core (all fields REQUIRED and present; this is the edgeId/signature preimage) ---
{
  "version":  "alma-edge/v1",        // envelope tag (hyphenated)
  "suite":    "ed25519",             // per-message Suite ID — RFC 0005; MTI; never inferred (RFC 0007 §5.1)
  "schemaId": "alma.vouch/v1",       // per-kind dotted schema — honored per RFC 0004 §4 (§10.2)

  "kind":     "vouch",               // vouch | membership | connection | capability | sanction
  "genesis":  null,                  // genesisId of THIS relationship; null iff genesis state (§5.1)
  "from":     "alice@nova",          // source endpoint (§4.3) — signer
  "to":       "bob@nova",            // target endpoint — IMMUTABLE within a relationship (§5.3)
  "context":  "nova:merchant",       // REGION-NAMESPACED scope (§4.4); non-suffrage weight scope,
                                     //   OR a suffrage-layer label on pure-suffrage kinds (§4.4)
  "command":  null,                  // cross-region capability only (§4.7/§10.6); null otherwise

  "weightBp": 7000,                  // SIGNED INTEGER basis points; non-suffrage weight only;
                                     //   sentinel 0 (ignored) on pure-suffrage kinds (§4.4)
  "validFrom": 640,                  // region-LOCAL node-log seq (§4.5); NOT a foreign clock
  "expiry":   null,                  // region-local seq, or null (§4.4/§4.5 constraints)

  "prev":     "6cc8…a52c",           // edgeId of the PREVIOUS state of THIS SAME edge (§5); null at genesis
  "counter":  1,                     // monotonic per-edge state counter (§5.2); 0 at genesis
  "parent":   null,                  // cross-region capability only: attenuation parent (§10.6)
  "status":   "active"               // "active" | "revoked" — explicit tombstone (§5.4, §8.5)
}

// --- detached attachments (NOT in core, NOT in edgeId, NOT covered by `from`'s signature) ---
{
  "signature": "base64…",            // Ed25519 by `from` over canonicalBytes(core)
  "cosign": { "bob@nova": "base64…" }, // §4.6; co-signed kinds only; keyed by co-signer identifier
  "kel":    { "aid": "…", "events": […], "proof": "…" }, // §10.1; signer KEL extract for cross-region verify
  "anchor": {                        // §6.1; detached inclusion proof against a cross-region STR
    "region": "nova", "seq": 815, "str": "epoch-root…", "proof": "inclusion-proof…"
  }
}
```

Notes: `schemaId` is the honoring handle (§10.2); `kind` is the closed behavioural enum; they co-vary one-to-one. `genesis` gives every state a stable relationship key without walking `prev`. `weightBp` supersedes the legacy `1..5` endorsement weight (§13). `status` makes revocation/clearing explicit. `kel` is a detached attachment (like `anchor`/`cosign`), not part of the core.

### 4.3 Endpoint types and identity binding

An endpoint is **either** an agent identifier `name@region` (exactly one `@`; `name` matches `/^[A-Za-z][A-Za-z0-9]*$/`; `region` matches `/^[a-z0-9]+$/`) **or** a bare region id `/^[a-z0-9]+$/`. No other form is legal; a slash-bearing string such as `nova/coin` is **not** an endpoint (holdings project, §11.1).

**Endpoints bind to two distinct RFC 0007 identity anchors, per type:**

- An **agent** endpoint resolves to an RFC 0007 §10.1 **AID** — the KERI key-event sub-log, admitted via K vouchers plus the §10.1 admission procedure. Agent edges and the sanctions targeting them bind to the **stable AID, not to a rotating key and not to a mutable identifier string** — a **normative dependency on RFC 0007 §10.1** (§11.2). Re-keying an agent does not shed its AID, so incoming sanctions still fold in (§5.3).
- A **bare-region** endpoint resolves to the region's **region/node key** (RFC 0005; RFC 0007 §5.1, where SYSTEM-origin events are signed with the node key). A region is not a vouched §10.1 resident AID; its issuer continuity is the RFC 0005 region-key mechanism, and region-key rotation follows that discipline (§5.3). Region-issued edges (`sanction`, `membership`, `connection`) therefore anchor their `from`-continuity to the region key, not to §10.1.

Per-kind legality:

| kind | from | to | basis (RFC 0007 primitive) |
|---|---|---|---|
| `vouch` | agent or region | agent or region | `recordVouch` (§3.4); admission-vouching, binary/unweighted |
| `sanction` | region | agent or region | §9 penal output: `suspendId`/`restrictCommands` (cleared via §9) |
| `membership` | region | agent | admission (§10.1), co-signed by `to` (§4.6); binary/unweighted (§4.4) |
| `connection` | region | region | RFC 0004 Connection Agreement, co-signed (§4.6) |
| `capability` | agent or region | agent or region | **cross-region only** (§10.6; RFC 0007 §4.4 excludes it intra-node) |

### 4.4 Weight (`weightBp`), context, and the suffrage boundary

`weightBp` is a **signed integer** in basis points; effective weight is `weightBp / 10000`, constrained to `[−10000, 10000]` per edge. A positive `weightBp` is supporting standing; a negative `weightBp` represents a §9 sanction (§11). The fold, not the edge, decides how weight composes (§8.2).

**Weight is normatively confined to NON-suffrage contexts** (§8.4): economic/commercial trust, cross-region exposure caps, and reputation display. Weight **MUST NOT** weight a governance-suffrage vote. Governance suffrage is RFC 0007's exclusive domain — 1-ID-1-vote (RFC 0007 §10.1) exercised through RFC 0007 §7 decision procedures over Group electorates; stake-weighting is rejected (RFC 0007 §13). RFC 0008's weight+context layer sits **alongside** the binary admission/identity primitives and is consumed only by the reputation law (§8) and cross-region diligence (§10).

**Pure-suffrage kinds carry no weight (MUST).** On `membership` (and any kind whose sole role is a suffrage/admission unit), `weightBp` MUST be the sentinel `0` — the field is structurally required for determinism (§4.1) but carries no meaning — and its `context` is a **suffrage-layer label** (e.g. `nova:citizen`), *not* a non-suffrage weight scope. The fold (§8) MUST ignore both fields on such kinds. This removes the contradiction of a "binary, unweighted suffrage unit" nonetheless carrying a folded weight.

`context` on weight-bearing kinds is a region-namespaced string `"<region>:<purpose>"` and is part of the signed core, so an edge cannot be lifted into a scope it was not signed for. A cross-region verifier MUST map contexts explicitly via the RFC 0004 honor entry (§10.2) and MUST reject an edge whose context is unmapped for the deciding context.

**Cross-region expiry (MUST).** Any kind honored cross-region (`vouch`, `sanction`, `capability`, `connection`) MUST NOT set `expiry: null` when intended for cross-region use; the honoring region MUST impose a maximum effective expiry when absorbing/mapping it (§10.2). `expiry: null` is legal only for a purely local, non-honored edge. This closes the never-expiring cross-region replay vector (§14).

### 4.5 `validFrom` / `expiry` are node-log seq; validity interval

`validFrom`/`expiry` are **node-log `seq`** in the issuing region (RFC 0007 §5.1 addresses events by `(branchId, seq)`). `seq` is region-local; another region MUST NOT read a foreign edge's `seq` as a global clock. Cross-region latest-ness is proven against the issuing region's STR (§6), never by comparing foreign seq. Reads bind to RFC 0007's **finality boundary F** (§5.2), not to any parallel snapshot (§7).

**Validity predicate.** For a decision seq `S`:
```
valid_at(e, S) ≡ e.validFrom ≤ S AND (e.expiry is null OR S < e.expiry) AND e.status == "active"
```
A `revoked` state is a resolvable head that is never `valid_at` any `S`.

### 4.6 Consent and `cosign`

`vouch` and `sanction` are **unilateral** (only `from` signs) — endorsements and accusations do not need the target's cooperation, gated instead by the fold (§8.2). `membership` and `connection` are **consent-bearing** and MUST be co-signed: the edge carries a `cosign` map keyed by the co-signer's identifier, holding that principal's signature over the **same** `canonicalBytes(core)`. A verifier MUST reject a `membership`/`connection` edge lacking a valid counterparty co-signature over the identical core bytes. (`membership` co-sign is the agent's own key; `connection` co-sign is the `to` region's key.) On co-signed pure-suffrage `membership`, `weightBp` is the sentinel `0` (§4.4).

### 4.7 Capability edges are cross-region only

RFC 0007 §4.4 **deliberately does not adopt** the RFC 0006 §5 intra-region capability model: authority is never a possessable object (Tier K-4 inalienability, RFC 0007 §3.2/§3.6), and bearer capabilities are resolved in the negative. Therefore **RFC 0008 MUST NOT model a `capability` edge as a possessable, holder-accepted, re-delegable intra-node object.** Intra-node authority = RFC 0007 Role bundles plus procedure/bond gates (§4.4/§4.5); RFC 0008 defers to them entirely.

The `capability` **kind survives only as a cross-region artifact** under RFC 0006's cross-region boundary (RFC 0007 §14(iii) lists counterpart-capability evaluation as an open cross-region problem this RFC helps close). Its attenuation semantics — `command`, structured `context`, and the `parent` narrowing chain preserving RFC 0006 §5.3 monotonic attenuation — are specified in the cross-region section (§10.6), not here.

## 5. The per-edge micro-chain

### 5.1 Continuity of a fixed relationship

Each edge carries its own hash chain via `prev` (the `edgeId` of the previous state of *this same edge*), pinned by a shared `genesis` field. The chain records **only** changes to `weight`, `context`, `validity`/`expiry`, and `status` of a **fixed `(from, to, kind)` triple**. Each transition MUST: (1) set `prev` to the predecessor `edgeId` and `genesis` to the genesisId; (2) set `counter` = predecessor + 1 (strictly monotone, §5.2); (3) keep `from`, `to`, and `kind` **fixed** (endpoint immutability, §5.3); (4) be signed by `from` (and co-signed per §4.6 where required). A state with a bad `prev`/`genesis` or a non-`+1` `counter` MUST be rejected.

Anchoring, ordering, and finality of these states are **not** re-specified here: appending an edge state is executing the corresponding RFC 0007 command, and its finality is RFC 0007 §5.2 (F). RFC 0008 does not maintain a parallel intra-node total order.

### 5.2 Monotonic counter and anti-rollback

`counter` is a same-edge logical clock. A verifier MUST reject a presented state whose `counter` is lower than one already accepted for that genesisId (anti-rollback). Cross-region, weak-subjectivity holds against the STR (§6): a state whose anchor precedes the latest corroborated STR for its genesisId is stale by construction. Intra-node, this is simply reading at F (RFC 0007 §5.2) — no separate rollback machinery is defined.

### 5.3 Endpoint immutability is a kernel invariant (forced, not chosen)

**`to`, `from`, and `kind` MUST NOT change within a micro-chain.** A change of beneficiary (who standing accrues to) is a **brand-new `(from, to, kind)` relationship / new genesis edge**, minting a new genesisId with **zero inherited age, tenure, or standing.** There is **no** co-signed `to`-repointing path, and none may be added.

This immutability is forced by **RFC 0007 Tier K-4 inalienability (§3.6)** and RFC 0007 §13 (votes/Roles/IDs/vouch relations transferable → "Excluded by kernel invariant"): a re-pointable edge is exactly such a non-existent operation — "an operation that does not exist cannot be abused." The old reputation-laundering attack (re-pointing an aged edge to a new beneficiary) is therefore **eliminated at the design level**, not defended against at runtime. Any age/tenure signal MUST be keyed on `(genesisId, from, to)`.

**Key rotation is not an endpoint change and is not re-specified here.** For an agent `from`, the edge binds to the RFC 0007 §10.1 AID, which **outlives its keys** via pre-rotation; for a region `from`, key continuity is the RFC 0005 region-key mechanism (§4.3). The `from` identifier is stable across rotations by construction. RFC 0008 defines no key-rotation-chaining rule of its own — it defers to RFC 0007 §10.1 (agents) and RFC 0005/RFC 0007 §5.1 (regions). This dissolves the old "sanction evasion by re-key" residual: re-keying does not shed the AID, so incoming sanction edges (which target the AID) still fold in. Because verification of a rotated signer's `signature` now needs the signer's key-state at signing time, a cross-region edge MUST travel with the signer's RFC 0007 §10.2 **KEL extract** (§4.2 `kel`, §10.1). The remaining "fresh unlinked new ID" residual is **RFC 0007's admission + voucher-liability problem** (§10.1/§10.3), recorded here as an **inherited residual, not an RFC 0008 defect** (§14).

### 5.4 Revocation, and sanction clearing via RFC 0007 §9

A revocation is an anchored `status: "revoked"` micro-chain link (typically `weightBp: 0`), authoritative regardless of `expiry`; the revoked head resolves but is never `valid_at`.

**A `sanction` edge REPRESENTS an RFC 0007 §9 penal output; it defines no lifecycle of its own, and its clearing is likewise a §9 output projected into the micro-chain.** A sanction is issued **only** via RFC 0007 §9 (automatic penal pronouncement or judicial adjudication → `suspendId`/`restrictCommands`), and it is cleared **only** via RFC 0007 §9 `reinstateId`/`liftRestriction` or expiry at `untilTick`. **RFC 0008 defines no pardon procedure of its own**; the old "co-signed pardon by the sanctioning region + a reviewer" is **deleted** — who may clear a sanction is RFC 0007 §9, full stop.

So that a §9 clearing can actually reach the fold, it MUST **project into the read-model as a clearing head**: a §9 `reinstateId`/`liftRestriction` (or `untilTick` expiry) emits an anchored `status: "revoked"` micro-chain link on the sanction's genesisId, authored by the §9 penal path. After that head, `valid_at` is false and the sanction stops folding. **Magnitude is immutable** in exactly this sense: no head may amend a sanction's weight **downward** except one authored by the RFC 0007 §9 penal path — a self-appended benign head by the sanctioned party or by the issuing region acting outside §9 MUST be rejected, so a point-reading fold cannot be fooled by a fresh benign state. A sanction edge is thus a normal micro-chain whose *only* privileged writer of a downward/clearing head is §9.

### 5.5 Powers of the hash

`edgeId`/`genesisId` are content-addressed handles; `prev` links form the tamper-evident micro-chain; `canonicalBytes(core)` is the Ed25519 signature target (non-repudiable authorship, the same discipline vouch already uses); and the whole is a **portable, self-verifying credential** — another region verifies it from `edgeId` + `signature` + `suite` + the signer-AID's RFC 0007 §10.2 **KEL extract** (needed to resolve the signing key when it has rotated, §5.3), without trusting the origin's database (§10), subject to the cross-region freshness proof of §6.

## 6. Cross-region freshness and corroboration

Intra-node, the micro-chain is anchored by RFC 0007 §5 and needs nothing here. The **cross-region** problem is that a self-verifying edge is **withholdable**: a holder can present an old head and hide a newer link (revocation, clearing, expiry, weight decrease). RFC 0008 solves this with a corroboration layer built **on top of** RFC 0007 §5.6, not a parallel structure.

### 6.1 Anchoring is an RFC 0007 append (not a new order)

An edge head is "anchored" simply by the RFC 0007 command that emitted it being on the node log; its inclusion proof, consistency proof, and finality are RFC 0007 §5.6/§5.2. The `anchor` attachment (§4.2) is the detached RFC 0007 §10.2-style inclusion-proof extract carried alongside the edge for cross-region verification. RFC 0008 defines **no** intra-node anchoring MUST beyond "the emitting command is finalized under RFC 0007 §5."

### 6.2 Cross-region head-checkpoints (STR) as authenticated maps (MUST)

For cross-region use, each region MUST expose a **head-checkpoint**: a signed, monotone, **authenticated `genesisId → head` map** (a CONIKS-style verifiable map) carrying `{ region, epoch, seq, root, prevRoot, signature }`, signed with the region's RFC 0005 region key, gossiped over the RFC 0004 §9 channel. This map is built **on** RFC 0007 §5.6 signed checkpoints `(F, root, tick)` and MMR: the STR's `seq` MUST be at or below F, and its consistency is proven with the RFC 0007 §5.6 consistency proof. The **map/lookup/absence** property (proving "the current head for *this* genesisId is X, and there is no newer one") is normative and REQUIRED — a plain RFC 0007 log gives inclusion, but cross-region proof-of-latest additionally needs absence. Only the tree wire-encoding is an implementation profile (§14).

**Heartbeat (MUST).** A region MUST advance its STR on a bounded heartbeat so that "no newer checkpoint exists" is provable, not assumed. For high-urgency kinds (`sanction`, `sanction` clearing, cross-region `capability` revocation) the STR epoch length MUST be ≤ the revocation-propagation SLA.

### 6.3 Multi-source freshness (MUST) — defeating checkpoint eclipse

A verifier checking a head only against the origin's own STR is vulnerable to a colluding origin serving an older-but-in-window checkpoint predating a revocation. Therefore: (1) a cross-region decision MUST establish the origin's current epoch from **≥ k independent regions'** gossip-relayed view (CT auditor-gossip), not from the origin alone; (2) a region MUST periodically prove, via a CT-style consistency proof, that its current STR extends the STR every connected region last saw, and a verifier MUST refuse an STR not consistency-proven against the gossiped view; (3) a region caught serving divergent-epoch/divergent-root checkpoints to different counterparties commits **checkpoint equivocation**. Intra-node, equivocation/duplicity is already RFC 0007 §5.6 duplicity detection; the **cross-region variant** — divergent checkpoints across regions — is a slashable RFC 0004 §8 offense.

### 6.4 Proof-of-latest and bounded staleness (MUST for cross-region decisions)

A verifier making a cross-region decision on an edge MUST demand: (1) a **lookup proof** of the presented head against the origin's most-recent, multi-source-corroborated STR (a presented head with a lower `counter` than the committed head fails); (2) that the checkpoint falls within a **bounded staleness window** (a per-context policy parameter, tighter for `sanction`/`capability`); and (3) for high-urgency kinds, additional consultation of the independent tombstone/status list propagated over RFC 0004 §9, against a checkpoint no older than the revocation SLA. Past the window, the verifier MUST refuse (fail-closed): an offline/withholding origin makes its subjects un-evaluable rather than default-accepted. This is a deliberate availability-vs-safety tradeoff resolved toward safety.

### 6.5 Anti-gerrymander (MMD) for non-suffrage cross-region folds (MUST)

Because a region controls its own log order, `validFrom` (signed) and the anchoring seq may diverge. To prevent a region delaying an inconvenient revocation (or rushing a favorable vouch) into a cross-region reputation computation, a cross-region fold MUST NOT count any state whose `anchorSeq − validFrom` exceeds a per-region published **Maximum Merge Delay (MMD)**; a same-region peer MAY challenge such lag as an RFC 0004 §8 breach. This applies to **non-suffrage cross-region reputation only** — intra-node vote snapshots are RFC 0007 §5.2/§7 and are not this RFC's concern.

## 7. Reads bind to RFC 0007 finality, not a parallel snapshot

The old "consistent snapshot at proposal-open seq" (a cut over the region journal, dependent on RFC 0001 §5) is **removed**. On a single node, the consistent cut already exists: **RFC 0007's finality boundary F** (§5.2), monotone and reorg-safe.

- A non-suffrage fold (§8) reads each relationship's latest state finalized at or before its decision seq, i.e. **at F** (RFC 0007 §5.2). Torn reads across independently-chained edges are resolved by reading all relationships at the single F, exactly as RFC 0007 reads state at F.
- **Suffrage snapshots are not RFC 0008's.** Any vote roll, eligibility cut, or objection-window timing is RFC 0007 §5.2/§7. RFC 0008 contributes no weight to a vote (§4.4), so it defines no vote snapshot. Where a region's own governance wishes to *display* reputation at a decision time, it reads the fold at F; that display is informational and never a tally input.
- A verifier MAY confirm no torn read between two cross-region snapshots with the RFC 0007 §5.6 consistency proof between the two signed checkpoints.

## 8. The reputation fold: a data-defined law by governance, a read-time derivation by evaluation

### 8.1 The fold is a `kind:law` definition, governed but not a §8.2 lawType (MUST)

A node stores no scalar rank; standing is **derived** as a fold over incoming edges. Per **RFC 0007 §14**, a reputation function computed at kernel/operator discretion is a forbidden fifth power; it MUST be a **data-defined law**. Therefore the fold **MUST** be specified as a `putDefinition(kind: "law", …)` in RFC 0007's versioned definition store (§3.4/§8.1) and amendable **only** via the RFC 0007 §8.3 amendment flow (procedure + timelock + objection window), inheriting objection-window applicability so the community can object before the first subject is judged under a new fold.

But a reputation fold is **not** one of RFC 0007 §8.2's three lawTypes. `constraint` blocks execution before preconditions, `penal` penalizes after effects, `trigger` schedules a command at tick boundaries; a fold does **none** of these — it returns a standing value on read. It also does not fit the RFC 0007 §8.1 `rule:{target, condition, effect}` shape. RFC 0008 therefore marks the definition with a distinct `derivation: "fold"` flavor and a `body` of fold parameters, and is explicit (§8.6) that **evaluating** it requires a kernel capability RFC 0007 does not yet have. All fold parameters live **in the law body** — not in code, not in region metadata:

```jsonc
{ kind: "law", id: "law.reputationFold", version: 3, status: "active",
  derivation: "fold",                     // NOT constraint|penal|trigger (RFC 0007 §8.2):
                                          //   a read-time standing derivation, governed as a law,
                                          //   evaluated by the §8.6 kernel-extension mode
  body: {
    contexts: ["nova:merchant", "nova:econtrust", "nova:display"],  // NON-SUFFRAGE only (§8.4)
    seedAnchors: ["nova", "delta"],       // pre-trusted anchor set (a law parameter, not metadata)
    anchorQuorumToChange: "proc.constitutional",  // amended via RFC 0007 §8.3
    iterations: 20,                        // fixed iteration count (or an integer convergence predicate)
    convergencePredicate: "maxDeltaBpLE:1",
    perSourceCapBp: 3000,                  // bounded single-source marginal contribution
    outDegreeNormalized: true,            // max-flow / Advogato-class propagation
    decayPerSeq: { … },                   // decay curve
    fixedPoint: "int64-bp"                 // fixed-point integer arithmetic (§8.5)
  },
  amendment: { procedure: "proc.constitutional", timelockTicks: 30 } }
```

The old "anchor-set governance in region metadata" is **relocated into this law body** and amended via RFC 0007 §8.3.

### 8.2 Sybil-resistant, bounded-influence fold (parameters in the law)

A naive sum-of-weights is trivially gamed by unilateral zero-cost edges. The fold weights each incoming edge by the **source's own derived standing** (the recursion), and additionally: uses **out-degree-normalized / max-flow (Advogato-class)** propagation with a **bounded per-source marginal contribution**; **dedups per `(from, to, kind, context)`** (at most one edge per tuple counts — the latest, non-revoked) and caps a source's total contribution across parallel edges; requires high-magnitude `sanction`s to carry bonded stake and/or second-region co-attestation (slashable if false — but issuance, clearing, and slashing are RFC 0007 §9 / RFC 0004 §8, not defined here); and seeds propagation at the **governed pre-trusted anchors** named in the law. **All of these are law parameters (§8.1), not code.**

```
standing(context, S) = fixpoint over nodes of:
  s(v) = base(v) + Σ_{ e ∈ counted-dedup(v, context, S) } project(e, context) · cap( s(e.from) )
  seeded at the law's pre-trusted anchors; out-degree-normalized; per-source contribution bounded.
```
`project(e, context)` returns the signed context-scoped weight (already negative for sanctions; zero and ignored for pure-suffrage kinds, §4.4). A Sybil source with ~0 incoming standing contributes ~0; a no-standing accuser cannot defame; one high source is capped.

### 8.3 Projections are non-suffrage only

The old `equal|reputation|stake` triple is split at the suffrage boundary:

- **`equal`** (one-ID-one-vote) is **removed from RFC 0008's projection menu** — it is RFC 0007's domain, unweighted, established via the binary `admitId`/`recordVouch`/`membership` admission artifacts (RFC 0007 §10.1) and exercised through RFC 0007 §7 decision procedures. RFC 0008 does not project it.
- **`reputation`** — the source-weighted §8.2 fold, for **non-suffrage** economic/trust/display contexts.
- **`stake`** — a holdings-magnitude signal (§11.1) for **non-suffrage** economic/display contexts only. **`stake` is deleted as a governance projection** (it directly contradicts RFC 0007 §13's rejection of stake-weighted voting).

### 8.4 What counts, and the absolute suffrage boundary (MUST)

`counted(context)` selects the edge kinds admissible in a **non-suffrage** context. A `merchant`/`econtrust` fold counts `vouch`, commerce-scoped `sanction`, and (cross-region) `capability`; `sanction` edges lower the fold; `membership` (a pure-suffrage unit) is **not** counted and its sentinel weight is ignored. **No fold output MAY be supplied as a weight to a governance-suffrage tally** — this is a normative invariant of RFC 0008, mirroring RFC 0007 §10.1/§13. Suffrage runs on RFC 0007's binary admission/identity artifacts and §7 procedures; RFC 0008's weight is economic/trust/exposure/display only.

### 8.5 Fold determinism (MUST)

The fold MUST be deterministic and replayable across regions: **fixed-point integer arithmetic** (no floats); a **fixed iteration count or an exact integer-comparable convergence predicate** with defined normalization; all edge state read at the single decision seq **F**; and all parameters (iteration count/threshold, normalization, per-source cap, seed anchors, decay) **bound to a snapshot seq** and carried **in the law body** (§8.1). The **authority** for these determinism rules is the data-defined law, not code or metadata: two regions computing the same subject's non-suffrage standing under the same law version reach the same value. Only the parameter *values* are policy; the determinism contract is normative.

### 8.6 Evaluation is a named RFC 0007 §14 kernel-extension dependency (MUST)

Because a graph fixpoint over incoming edges is outside RFC 0007's closed precondition vocabulary (§4.2, whose extension "is a kernel change (§14)") and has no evaluation point among the §8.2 lawTypes, RFC 0008 does **not** claim the fold runs on RFC 0007's existing law evaluator. Instead it declares a normative dependency on a **new kernel capability**, to be introduced under RFC 0007 §14 hard-fork governance:

1. a **read-law/fold evaluation mode** that deterministically evaluates a `derivation:"fold"` definition at read time (at F, §7), returning a per-context standing value rather than blocking, penalizing, or scheduling; and
2. a **graph-aggregation predicate class** (bounded, out-degree-normalized fixpoint over the incoming-edge set) added to the kernel's evaluation surface.

Until that capability exists, an implementation MAY evaluate the fold as an **off-kernel deterministic computation over the finalized log** that any verifier replays from the same law body and the same edges at F — with only the fold's *parameters* stored as the `kind:law` definition, and no claim that the kernel itself computes it. Either way, the determinism (§8.5) and data-defined-law governance (§8.1) contracts are normative; the evaluation mechanism is the RFC 0007 §14 dependency, not a silently-assumed feature of the existing engine.

## 9. Anti-equivocation defers to RFC 0007 intra-node

The `from` signer could produce two validly-signed next-states off the same `prev`. **Intra-node, this is RFC 0007's problem and RFC 0007's solution**: the emitting command is ordered on the single node log, the losing fork is not finalized (RFC 0007 §5.2), and two contradictory signed checkpoints are cryptographic duplicity evidence (RFC 0007 §5.6). RFC 0008 defines **no** intra-node first-committed-wins rule.

For **bilateral kinds** (`membership`/`connection`/cross-region accepted `capability`), the `to` co-signature (§4.6) makes forking structurally impossible — both parties' views must converge. The **only** anti-equivocation layer RFC 0008 owns is **cross-region**: divergent checkpoints served across regions (§6.3), a slashable RFC 0004 §8 offense. For unilateral kinds, cross-region non-equivocation is **detection contingent on gossip liveness, not prevention** — an inherited residual whose intra-node case is now RFC 0007 §5.6 (§14).

## 10. Cross-region portability and honoring — the scope RFC 0007 §14 defers

This is RFC 0008's primary owned scope: exactly the "bridge that appends a counterpart's signed artifacts" that RFC 0007 §14(ii) defers.

**10.1 Portable, self-verifying credential.** A foreign region verifies an edge from `edgeId` + `signature` + `suite` + the signer-AID's RFC 0007 §10.2 **KEL extract** (§4.2 `kel`), **without trusting the origin's database**, respecting the RFC 0006 §3 invariant (authorization reduces to signature validity; do not inspect the origin's internal mechanism). The KEL extract is required because the edge binds to the stable AID, not to the signing key (§4.3, §5.3): to check `signature`, the verifier resolves the signer's key-state at signing time from the inclusion-proof-equipped key-event-log extract, which travels with the edge — not from the origin's live database. This is the same self-certifying, portable-history discipline RFC 0007 §5.1/§10.2 defines for a departer carrying their own history.

**10.2 RFC 0004 honoring.** Cross-region acceptance is governed by RFC 0004 honoring: `honor["<from>-><to>"]` decides treatment, matching on `schemaId` (`mode ∈ absorb|map|reexamine|reject`) **and** on `context` (an explicit `honor.contexts[]` mapping), so a `nova:merchant` edge cannot silently satisfy a foreign decision. A verifier MUST reject an edge whose `schemaId`/`kind` or `context` is unmapped for the deciding context, and MUST impose a maximum effective expiry when absorbing an `expiry: null` edge (§4.4).

**10.3 Pull-from-authority, not subject-curated.** A cross-region fold MUST NOT accept a subject-curated bundle. It MUST fold over a **pull-from-authority** set: the origin's read-model maintains an authenticated index keyed by target endpoint, and completeness is an authenticated range proof at seq F (all edges with `to == X`, finalized ≤ F, covered by the STR), so a subject cannot omit its `sanction`s.

**10.4 Freshness enforced (§6).** A foreign edge is accepted only with a multi-source-corroborated proof-of-latest within the §6.4 window; otherwise it fails closed.

**10.5 Cross-region sanction-pull (the region-hop residual, MUST).** Because a subject may re-appear under a new identifier in a new region, cross-region diligence (RFC 0004 §6) MUST pull `sanction`s targeting the incoming subject across **all its known prior identifiers/regions** — resolved through the RFC 0007 §10.1 AID and any disclosed prior AIDs. Treating an **undisclosed prior sanctioned identity** as an RFC 0004 §8 obligation breach is REQUIRED. This is the diligence step that carries a §9 sanction across a region hop; the residual "fresh unlinked new ID at admission" is RFC 0007 §10.1's admission + voucher-liability problem (§11.2, §14), not an RFC 0008 defect.

**10.6 Cross-region capability edges (the sole surviving capability form).** A `capability` edge exists **only** cross-region (§4.7; RFC 0007 §14(iii)). It maps an RFC 0006/RFC 0004 `delegated` entry `{ id, issuer, holder, command, scope }`: `issuer→from`, `holder→to`, `command→command`, `scope`+attenuation→structured `context`, revocation→a `revoked` tombstone, attenuation parent→`parent` (distinct from `prev`). `parent` MUST preserve RFC 0006 §5.3 monotonic narrowing — a verifier MUST reject a cross-region capability edge that widens its parent — and MUST NOT delegate a raw region signing key (RFC 0006 §6.5). Intra-node, this kind does not exist; authority is RFC 0007 Role bundles + procedure/bond.

**10.7 RFC 0004 wiring.** Revocations/downgrades/clearings ride the **existing** RFC 0004 §9 gossip channel; RFC 0008 invents no parallel mechanism, and extends `honor` only with the `contexts[]` mapping (§10.2). STR authenticity bootstraps from the region's RFC 0005 region key, discovered via RFC 0004 connection metadata; a last-gossiped STR within the staleness window is usable, past which evaluation fails closed (§6.4).

## 11. What an edge represents (read-model table)

Every row is **data appended by an RFC 0007 primitive and folded by §8** — never a new write path.

| Concept | Edge representation | Source primitive / fold effect |
|---|---|---|
| Received vouch / endorsement | `vouch`, positive `weightBp`, `context` | RFC 0007 §3.4 `recordVouch` (admission-vouching, binary; §4.4 weight is non-suffrage only) |
| Power / standing / reputation | *not an edge* — the §8 fold | data-defined law by governance, read-time derivation by evaluation (RFC 0007 §14); derived, never stored |
| Citizenship / one-ID | `membership`, co-signed, sentinel `weightBp:0` | RFC 0007 §10.1 admission; the **binary, unweighted** suffrage unit exercised via §7 procedures — RFC 0008 adds no weight |
| Crime / criminal record | `sanction`, negative `weightBp`, magnitude downward-immutable except by §9 (§5.4) | representation of RFC 0007 §9 `suspendId`/`restrictCommands`; cleared only by a §9-authored clearing head (`reinstateId`/`liftRestriction`/expiry) |
| Cross-region honoring | `connection`, co-signed | RFC 0004 Connection Agreement; asymmetry = a separate reverse edge |
| Capability / power lending | `capability` — **cross-region only** (§10.6) | RFC 0006 boundary (RFC 0007 §14(iii)); intra-node authority is RFC 0007 §4.4 Roles |
| Holdings as standing | **projected**, non-suffrage only (§11.1) | RFC 0003; feeds `stake`/economic signals — **never** a vote (RFC 0007 §13) |

There is no RFC 0008-native command execution, penal semantics, or suffrage rule in this table; those are RFC 0007 §3–§10.

### 11.1 Holdings project into non-suffrage signals only

Holdings are not literal edges (a `nova/coin → holder` endpoint is illegal, §4.3). A region's `AssetSlice` (RFC 0003) MAY be **projected at read time** into an **economic-trust or display** signal for the holder's standing. It **MUST NOT** project into any suffrage/governance weight (RFC 0007 §13 rejects stake-weighted voting). The read-time projection is retained for non-suffrage reputation only; the `stake` *governance* projection is deleted.

### 11.2 Identity continuity is a normative dependency on RFC 0007 §10.1

Sanction durability and Sybil resistance both rest on a subject being unable to cheaply shed and re-mint its node. That binding is **not** provided here; it is a **normative dependency on RFC 0007 §10.1** (KERI key-event sub-log + pre-rotation, the agent AID outliving its keys, plus voucher liability) — **replacing** the old dependency on RFC 0001 §4:

- Agent edges and the sanctions targeting agents bind to the **AID**, so re-keying does not shed incoming sanctions (§4.3, §5.3); region-issuer continuity binds instead to the RFC 0005 region key (§4.3).
- A region issuing `membership` MUST gate admission on the absence of unexpired sanctions for the underlying person, per RFC 0007 §10.1 admission; cross-region honoring MUST pull sanctions across all prior identifiers (§10.5).
- The residual **"fresh unlinked new ID"** evasion is **RFC 0007's admission + voucher-liability problem** (§10.1/§10.3): the marginal cost of a Sybil identity is the K vouchers' joint liability. RFC 0008 records this as an **inherited residual, not a defect of the edge layer** (§14).

## 12. Relationship to prior RFCs (subordinate, not super-substrate)

RFC 0008 is **subordinate to RFC 0007 (Command System v2)**. It is not a super-substrate governing RFC 0001/0003/0006.

- **RFC 0007 (Command System v2) — the authority.** Commands, effect primitives, the four-power separation, penal law, intra-node finality/reorg (§5), governance procedures and suffrage (§7, §10.1), identity (§10.1), and Tier K invariants are RFC 0007's. RFC 0008 defers to all of them by citation and contributes only edges, weight, the hash chain, the reputation-law fold, and cross-region portability/sanction-pull.
- **RFC 0001 / RFC 0003.** Their node-side roles are **mediated by RFC 0007**. Governance weighting/suffrage/snapshot (the old claim over RFC 0001 §4–§5) is RFC 0007 §5/§7/§10.1. Holdings-as-standing (RFC 0003) projects into **non-suffrage** signals only (§11.1); asset authority (mint/transfer/burn) is RFC 0007 §3.4.
- **RFC 0004.** The Connection Agreement is a co-signed `connection` edge; revocations/clearings ride the existing RFC 0004 §9 gossip; slashing is RFC 0004 §8. RFC 0008 invents no parallel mechanism.
- **RFC 0005.** Edges carry `suite`; verification order and MTI (`ed25519`) are RFC 0005; this matches RFC 0007 §5.1/§10.1. Region endpoints bind to the RFC 0005 region key (§4.3).
- **RFC 0006.** Its capability model is **not** adopted intra-node (RFC 0007 §4.4); it survives here only as a cross-region `capability` edge (§10.6).

The honest "edges are a read-model/substrate" claim is kept, but **scoped to reputation + cross-region**, deferring command definition, penal law, finality, suffrage, and identity to RFC 0007.

## 13. Mapping to vouch

The existing signed vouch is already an `alma-edge/v1` of `kind: "vouch"`: vouch-core's Certificate (`alma-cert/v1`, JCS over all-but-`signature`, Ed25519, `suite: "ed25519"`) is the exact signing discipline §4.1 mandates, and the exact stance RFC 0007 §5.1/§10.1 takes on Suite IDs. The `alma.endorsement/v1` `{ of, weight: 1..5 }` maps to a `vouch` edge with `weightBp = round(weight/5 · 10000)`, consumed **only** by the non-suffrage reputation law (§8) — the admission-layer `recordVouch` stays binary and unweighted, and suffrage is exercised through RFC 0007 §7 (RFC 0007 §3.4/§10.1). `alma.endorsement/v1` SHOULD retire into the `vouch` edge; there MUST NOT be two conflicting `alma.*` weight domains. The node log that anchors edge heads is RFC 0007's single node log (§5); its acknowledged full-file-rewrite gap is closed by RFC 0007 §5.6 signed checkpoints — RFC 0008 adds only the cross-region STR map (§6).

## 14. Security Considerations

Intra-node freshness/ordering/anti-equivocation/finality are **RFC 0007's** (§5/§5.2/§5.6); the entries below are the **cross-region** variants RFC 0008 owns, plus the inherited residuals.

- **Cross-region freshness / head-withholding.** Lookup-proof-of-latest against the corroborated STR + bounded staleness (§6.4); short cross-region `expiry` (§4.4) makes silence fail-closed. *Prior art:* CT STH + MMD; CONIKS epoch STRs; OCSP-must-staple.
- **Checkpoint eclipse by a colluding origin.** Multi-source freshness from ≥k gossip views + mandatory STR heartbeat + consistency-proof audit; divergent-checkpoint slashing via RFC 0004 §8 (§6.3). *Prior art:* CT auditor-gossip; CONIKS auditing.
- **Cross-region context confusion.** Region-namespaced `context` in the signed core (§4.4), explicit `honor.contexts[]` (§10.2), no `expiry: null` for honored kinds. *Prior art:* SD-JWT/VC audience binding.
- **Selective graph-level omission.** Pull-from-authority set with authenticated target-keyed index + range/completeness proof (§10.3); negatives propagate independently over RFC 0004 §9. *Prior art:* W3C Status List; CT monitors.
- **Cross-region relationship fork.** Divergent-checkpoint detection is slashable (§6.3); bilateral kinds are structurally fork-proof by co-signature (§9). Intra-node forking is RFC 0007 §5.6 duplicity detection.
- **Cross-region revocation/clearing/decay & pruning-neutralized negatives.** Anchored `status:"revoked"` tombstones (including §9-authored sanction clearings, §5.4) gossiped over RFC 0004 §9 + a fresh status list for high-urgency kinds; sanction magnitude is downward-immutable except by §9 (§5.4).
- **Signature verification across key rotation.** A cross-region edge binds to the AID, not the signing key; verification requires the signer's RFC 0007 §10.2 KEL extract to travel with the edge (§5.5, §10.1) — a verifier MUST refuse an edge whose signing key it cannot resolve from an inclusion-proof-equipped KEL extract, rather than trusting the origin's live DB.
- **Sybil edge-spam / bootstrapped collusion / high-standing griefing (in the fold).** Source-weighting + out-degree-normalized/max-flow with bounded per-source contribution + `(from,to,kind,context)` dedup/cap + governed pre-trusted anchors — **all as parameters of the reputation law** (§8.2, RFC 0007 §8/§14); bonded/second-region co-attestation for high-magnitude sanctions is issued/cleared/slashed by RFC 0007 §9 / RFC 0004 §8.
- **Suite downgrade / omission.** Reject `suite ∉ agreedSuites` before any crypto; never infer the algorithm from key material (§4.1; RFC 0007 §5.1).

**Inherited residuals (not RFC 0008 defects):**

1. **Fresh unlinked new ID (sanction evasion by discontinuity).** RFC 0007 §10.1 admission + voucher liability; cross-region sanction-pull (§10.5) covers disclosed prior identifiers. Tracked as RFC 0007's residual, not the edge layer's.
2. **Non-equivocation for unilateral kinds is detection, not prevention.** Intra-node: RFC 0007 §5.6 duplicity detection. Cross-region: RFC 0008 §6.3 detection contingent on gossip liveness.
3. **Fold-evaluation kernel capability.** The `derivation:"fold"` read-law mode and graph-aggregation predicate class (§8.6) are an RFC 0007 §14 kernel-change dependency; until introduced, off-kernel deterministic replay stands in. Tracked as a shared RFC 0007/RFC 0008 dependency, not an edge-layer defect.

**Shared unowned gap — hash-function agility.** RFC 0008's edge hashes (`edgeId`/sha256, STR root, per-edge MMR accumulator) share the hash-agility gap RFC 0007 §14 flags as "owned by neither document." RFC 0008 **names it explicitly** and does not silently hard-wire sha256. **Recommended:** introduce a `hashSuite` tag on edge hashes parallel to the RFC 0005 signature-suite registry (an immutable append-only hash-suite registry, MTI `sha256`, never inferred). **Otherwise:** defer explicitly to a future *joint* hash-suite registry shared with RFC 0007 §14. Either way the gap is owned jointly and MUST NOT be treated as closed.

## 15. Conformance

A conforming implementation MUST:

1. represent relationships as `alma-edge/v1` edges signed per §4.1 (JCS over the core = all fields except `signature`/`cosign`/`anchor`; Ed25519; `version`+`suite`+every core field present; `weightBp` an integer; `edgeId = sha256_hex(canonicalBytes(core))`; `genesis` carrying the genesisId), aligned to RFC 0007 §5.1/§10.1 (Suite ID never inferred; SAID-class content address);
2. enforce the closed `kind` enum, per-kind endpoint legality with **type-correct identity binding** (agent → RFC 0007 §10.1 AID; bare region → RFC 0005 region key, §4.3), region-namespaced non-suffrage `context`, and per-kind consent (`cosign` for `membership`/`connection`, §4.6);
3. maintain each edge's `prev`/`counter`/`genesis` micro-chain of a **fixed `(from,to,kind)` triple**, rejecting bad `prev`/`genesis`, non-monotone `counter`, and any endpoint change (§5.1–§5.3);
4. compute node standing **only** as the **data-defined-law fold** — a `putDefinition(kind:law, derivation:"fold", …)` governed and amended via RFC 0007 §3.4/§8.1/§8.3 with objection windows, **not** claimed to run on an RFC 0007 §8.2 lawType — source-weighted, bounded-influence, Sybil-resistant, deterministic (fixed-point integer, params in the law body bound to a snapshot seq), read at F (§8, RFC 0007 §5.2), evaluated via the §8.6 kernel-extension mode or an equivalent off-kernel deterministic replay — never a stored scalar; dedup/cap per `(from,to,kind,context)`;
5. confine all weight to **non-suffrage** contexts, set sentinel `weightBp:0` (ignored) on pure-suffrage kinds, and never supply a fold output as a weight to a governance-suffrage tally (§4.4, §8.4; RFC 0007 §10.1/§13);
6. represent `sanction` edges as RFC 0007 §9 outputs only — issued via §9, and cleared only by a §9-authored clearing head (`reinstateId`/`liftRestriction`) or expiry, with magnitude downward-immutable except by that §9 head — defining **no** RFC 0008 pardon path (§5.4);
7. on any cross-region decision, demand a multi-source-corroborated lookup-proof-of-latest within a bounded per-context staleness window, consult the tombstone list for high-urgency kinds, enforce MMD anti-gerrymander on non-suffrage cross-region folds, and fail closed (§6, §10.4);
8. fold cross-region over a pull-from-authority set with an authenticated target-keyed range proof, never a subject-curated bundle (§10.3);
9. treat cross-region `capability` as the sole capability form, preserving RFC 0006 §5.3 monotonic narrowing via `parent`, and model **no** intra-node possessable capability (§4.7, §10.6; RFC 0007 §4.4);
10. verify foreign edges from `edgeId` + `signature` + `suite` + the signer-AID's RFC 0007 §10.2 KEL extract under the RFC 0006 §3 invariant, subject to RFC 0004 honoring on `schemaId` **and** `context` (§10.1–§10.2).

A conforming implementation MUST NOT: store a node's power/reputation as a scalar; compute reputation at kernel/operator discretion rather than via the data-defined law (RFC 0007 §14); mislabel the fold as an RFC 0007 §8.2 constraint/penal/trigger lawType or assume the existing §8 evaluator runs it (§8.6); weight a governance vote with any edge weight (RFC 0007 §13); define a new punish/clear/pardon path (defer to RFC 0007 §9); reinvent intra-node finality, ordering, or anti-equivocation (defer to RFC 0007 §5); read a foreign `seq` as a global clock; claim signature-alone verification while binding to a rotating-key AID (require the KEL extract, §10.1); include `anchor`/`cosign`/`kel` in `edgeId` or the `from` signature; encode `weightBp` as a float; model an intra-node possessable capability; or invent a revocation/gossip mechanism parallel to RFC 0004 §9.

## 16. Test vectors (normative)

None exercises a removed feature. V0–V2 are weight/validity changes of a **fixed `(from, to, kind)` triple** (endpoint immutability, §5.3); V3 is a genesis `sanction` representing an RFC 0007 §9 output (§5.4); V4 is a co-signed pure-suffrage `membership` carrying the sentinel `weightBp:0` (§4.4). Ed25519 keypairs from fixed 32-byte seeds; canonicalization is RFC 8785 JCS; `edgeId = sha256_hex(canonicalBytes(core))`; `signature = base64(Ed25519.sign(canonicalBytes(core), sk))`.

```
key alice: seed=…0001  pub=4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29
key nova:  seed=…0002  pub=7422b9887598068e32c4448a949adb290d0f4e35b9e01b0ee5f1a1e600fe2674
key bob:   seed=…0003  pub=f381626e41e7027ea431bfe3009e94bdd25a746beec468948d6c3c7c5dc9a54b
   (seeds are 31 zero bytes followed by 0x01/0x02/0x03)
```

**V0 — genesis vouch (`alice@nova → bob@nova`, weight 0.5):**
```
core:
{"command":null,"context":"nova:merchant","counter":0,"expiry":null,"from":"alice@nova","genesis":null,"kind":"vouch","parent":null,"prev":null,"schemaId":"alma.vouch/v1","status":"active","suite":"ed25519","to":"bob@nova","validFrom":412,"version":"alma-edge/v1","weightBp":5000}
edgeId = genesisId = 6cc836cc9095e4bc4d3984df1590a2268c73f49fa8456ce57cca43c46173a52c
signature(alice)   = mHWbzzFyb0wM17dAo0QH9Vo6ps2IuUr8hVTokvqTfdV/yVc6Ej5zsDai06foPYpxr6A1JhojO6087JXbpW+ZAw==
```

**V1 — weight raised to 0.7 (`prev`/`genesis` = edgeId(V0), `counter` 1):**
```
core:
{"command":null,"context":"nova:merchant","counter":1,"expiry":null,"from":"alice@nova","genesis":"6cc836cc9095e4bc4d3984df1590a2268c73f49fa8456ce57cca43c46173a52c","kind":"vouch","parent":null,"prev":"6cc836cc9095e4bc4d3984df1590a2268c73f49fa8456ce57cca43c46173a52c","schemaId":"alma.vouch/v1","status":"active","suite":"ed25519","to":"bob@nova","validFrom":640,"version":"alma-edge/v1","weightBp":7000}
edgeId(V1)       = 7f9d9e27cb93a67db8b0699cb8ffa3a31797b52a1b607bc833ed14648c848cf4
signature(alice) = r/fW7rJJkzpbIH4cVC9woF0H6VdycH/JMGmM/i2olJKqQgvX7N7OoT7/G54qb+l8qmYvF1rTRWL9Y+RQpv7vDA==
```

**V2 — revoked tombstone (`status:"revoked"`, `weightBp:0`, `expiry:815`, `prev`=edgeId(V1), `counter` 2):**
```
core:
{"command":null,"context":"nova:merchant","counter":2,"expiry":815,"from":"alice@nova","genesis":"6cc836cc9095e4bc4d3984df1590a2268c73f49fa8456ce57cca43c46173a52c","kind":"vouch","parent":null,"prev":"7f9d9e27cb93a67db8b0699cb8ffa3a31797b52a1b607bc833ed14648c848cf4","schemaId":"alma.vouch/v1","status":"revoked","suite":"ed25519","to":"bob@nova","validFrom":815,"version":"alma-edge/v1","weightBp":0}
edgeId(V2)       = a996fbb98951cdc78a2b1cbc78a04257de9c9e0eaf19dd80c6432933b39f1ef7
signature(alice) = iNPYrPQFtUAnhelCTjlmSCND1Q9i4dwDy1sicTC+0XQAvB14oyRy1Eu2mmafYm4NJXnTtZQZoRQul4GN4opMBw==
```

**V3 — region sanction (`nova → bob@nova`, weight −0.4; representation of an RFC 0007 §9 output).** This is the **local-only genesis** case: `expiry: null` is legal here *only* because the edge is not honored cross-region (§4.4); a cross-region-honored sanction MUST carry a bounded region-local `expiry`. A §9 clearing (`reinstateId`/`liftRestriction`) would append a `counter:1`, `status:"revoked"` head on this genesisId, authored by the §9 penal path (§5.4) — no self-appended benign head may clear it.
```
core:
{"command":null,"context":"nova:merchant","counter":0,"expiry":null,"from":"nova","genesis":null,"kind":"sanction","parent":null,"prev":null,"schemaId":"alma.sanction/v1","status":"active","suite":"ed25519","to":"bob@nova","validFrom":700,"version":"alma-edge/v1","weightBp":-4000}
edgeId = genesisId = 03fd67a3113b9d98e7bf96701260c49d96ddfb3979ffaae757693b82d5263b01
signature(nova)    = 9MS4gPNd5VL9d1Mu5sYxfx1O0bnGtPzHCi26k+nRxWod+TpfdzNTXxuF0JN4YHrDu+bpURT1yIgEXkhe8NwaAQ==
```

**V4 — co-signed pure-suffrage membership (`nova → bob@nova`; sentinel `weightBp:0`, `context:"nova:citizen"` a suffrage-layer label not a weight scope, §4.4; `from`=nova signs, `to`=bob co-signs the identical core):**
```
core:
{"command":null,"context":"nova:citizen","counter":0,"expiry":null,"from":"nova","genesis":null,"kind":"membership","parent":null,"prev":null,"schemaId":"alma.membership/v1","status":"active","suite":"ed25519","to":"bob@nova","validFrom":100,"version":"alma-edge/v1","weightBp":0}
edgeId            = 7c4f7e16da429872cce04e5c80429b848309eb8a592fa4f5f7df44ee804dee67
signature(nova)   = UQCe6n5rLseIrR8rLXtOke8qykbyh1UcZbqYiH0WTsOTnnQP0G7n0xhY/SJEAT6oyEWaePM+3akF3YvB16uDDw==
cosign["bob@nova"]= rdi37Iyj9zlQD+0HGanbYZ+vjBtGOCrMqHpks+MDn+fmCBlmgZtzorR3QBVLdTFCXQsGMBSywhPklEF3oD1sCw==
```

## 17. Worked example (informative)

A `nova:merchant`-context vouch `alice@nova → bob@nova` evolves `0.5 → 0.7 → revoked` (V0/V1/V2) over a **fixed `(from,to,kind)` triple**; a region sanction (V3) representing an RFC 0007 §9 output lands on `bob@nova`; and the reputation law (§8) folds `bob@nova`'s **non-suffrage** merchant standing. All figures are in the mandated basis-point integer domain (§8.5, `fixedPoint:"int64-bp"`).

Each edge state is on RFC 0007's node log (V0@412, V1@640, V2@815, V3@700), finalized under RFC 0007 §5.2; the cross-region STR (§6.2) commits `map[6cc8…] = a996…1ef7` at counter 2. A holder presenting V1 (weightBp 7000) to a foreign region **fails** proof-of-latest — the corroborated STR shows counter 2 > 1 (§6.4).

**Fold for `bob@nova` in `nova:merchant` at F, with `s(alice@nova)=8000 bp`, `s(nova)=10000 bp`:**
```
counted-dedup("nova:merchant") at F:
  - alice→bob vouch:  head is V2 (revoked) → valid_at false → contributes 0
  - nova→bob sanction: V3, weightBp -4000, s(nova)=10000 bp → -4000 · (10000/10000) = -4000 bp
standing(bob, "nova:merchant") = base(bob)=0 + 0 + (-4000) = -4000 bp   (= -0.40)
```
This is a **non-suffrage** economic/display figure; it never enters a governance tally (§8.4). Reading the vouch at V1 (+5600 bp) would be a stale read: V2 is finalized ≤ F, so §7 selects V2. Were `bob` to re-register under a new identifier to shed the −4000 bp, RFC 0007 §10.1 admission + cross-region sanction-pull (§10.5) re-attach the person-level sanction — the residual is RFC 0007's, not the edge layer's.

## 18. Open Questions

RFC 0008 owns only the following; identity strength, intra-node finality, suffrage, and penal process are **not** open questions here — they are RFC 0007's settled domain.

1. **Cross-region stale-acceptance window, `k`, and STR heartbeat/epoch length (§6).** A security/liveness tradeoff with no universal value; per-context policy (tighter for `sanction`/`capability`). Protocol-recommended default bands remain to be chosen.
2. **Non-equivocation for unilateral kinds cross-region is detection, not prevention (§9).** Intra-node this is RFC 0007 §5.6; the cross-region variant stays RFC 0008's. Is a bounded gossip-liveness assumption acceptable, or should high-stakes cross-region unilateral edges require a light second-region ack?
3. **Legacy `alma.endorsement/v1` (§13).** Retire fully into `vouch` edges, or keep a one-directional non-suffrage projection? Avoid two `alma.*` weight domains either way.
4. **Non-suffrage holdings encoding (§11.1).** Read-time `AssetSlice` projection vs. an explicit bare-region-sourced asset edge — for the **non-suffrage** economic/display signal only (the `stake` governance projection is deleted per RFC 0007 §13).
5. **Cross-region STR / verifiable-map profile (§6.2).** CONIKS-style prefix tree vs. tiled log + separate map, and the per-edge history accumulator profile — an encoding decision; the map/lookup/absence property is normative.
6. **Hash-suite tag vs. joint deferral (§14).** Adopt a `hashSuite` tag parallel to the RFC 0005 registry, or defer to a joint hash-suite registry shared with RFC 0007 §14. The gap must not be left silently hard-wired.
7. **Shape of the RFC 0007 §14 fold-evaluation kernel extension (§8.6).** The exact `derivation:"fold"` evaluation-mode API and the graph-aggregation predicate class are an RFC 0007 kernel-change item co-owned with RFC 0007; until landed, off-kernel deterministic replay is the interim. What is the minimal predicate surface that keeps evaluation deterministic and auditable?

## 19. Non-goals

- Command definition/execution, the four-power separation, penal/criminal law, intra-node finality/reorg, suffrage, and identity — all **RFC 0007 (Command System v2)**.
- Intra-node ordering, anti-equivocation, snapshots, and anchoring — RFC 0007 §5/§5.6.
- The person-level identity-binding mechanism and the "fresh unlinked ID" admission problem — RFC 0007 §10.1 (§11.2, §14).
- The kernel evaluation mechanism for the fold — an RFC 0007 §14 kernel-change dependency (§8.6); RFC 0008 owns only the fold's *governed data-defined law form and determinism contract*, not the engine that runs it.
- The Merkle/verifiable-map wire-encoding of cross-region head-checkpoints (§6.2) and the exact fold parameter *values* (§8) — implementation/law-configuration profile. *(The map/lookup/absence property and the determinism-and-data-defined-law contract are normative.)*
- Real-money settlement and the internal region authorization mechanism — RFC 0004/0006 non-goals carry over.
