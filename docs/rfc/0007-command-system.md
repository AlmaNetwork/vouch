# RFC 0007 — Command System v2: A Data-Defined Command System Founded on Separation of Powers

> Japanese version: [0007-command-system.ja.md](0007-command-system.ja.md)

| | |
|---|---|
| **Status** | Draft (for discussion) |
| **Authors** | Sonoko Mizuki, Claude (Claude Code) — co-authored |
| **Created** | 2026-07-14 |
| **Theoretical basis** | Interdisciplinary findings from the history of state formation, political philosophy, monetary theory, and information technology (cited individually in the text) |
| **Scope** | The entire command system of vouch-node (zero-based redesign) |
| **Related RFCs** | [0001](0001-region-governance-and-decision-sot.md) (governance procedures of simulator L2 — this RFC is the node-side counterpart) / [0003](0003-region-assets.md) (region assets — connects to the economic primitives of §3) / 0004 cross-region transfer, PR #24 (the §14 cross-region open problem) / 0005 signature suites, PR #25 (provides the suite registry / MTI that §10.1 builds on) / 0006 region authorization, PR #26 (governs the cross-region boundary; its intra-region capability model is not adopted — see §4.4) / 0008 relationship edges, branch `rfc/0008-relationship-edges` (the wire format and cross-region portability of the edge read-model of §10.5 — its constitutional layer, the reputation fold and the suffrage boundary, is absorbed into this RFC at §8.5 / Tier K-7) / [money boundary](../money-boundary.md) (this RFC's economy is the in-world side of that seam) |

## 0. Abstract

This RFC redesigns the command system of the Vouch Network node from zero as a
**data-defined command system founded on separation of powers**. It rests on four pillars.

1. **Self-describing kernel** — Only mechanism remains in code (the execution engine, a
   closed set of effect primitives, and the genesis seeder — §3.1). Every command, including
   the meta-commands (`defineCommand` and friends), is defined as data.
2. **Four-power-separation RBAC** — Powers are separated along the command lifecycle:
   definition power / execution power / penal power (criminal law) / audit & objection power.
3. **Rational compliance** (law-abiding rationality) — Through the two layers of "prevention
   (preconditions)" and "deterrence (penal law)", the system is designed so that
   `E[violation] < E[compliance]` holds for every participant.
4. **Bounded-reorg state model** — A finality boundary plus objection windows reconcile
   "revertible as long as possible, absolutely safe once final."

Beneath the four pillars runs a **relationship substrate** (§10.5): every trust relation —
vouch, membership, sanction, recognition — is a signed, weighted edge derived from the log,
and a participant's standing is computed only by a data-defined **fold law** (§8.5).
Reputation is derived, never stored, and never discretionary; and no weight — edge, standing,
or holdings — can ever enter a governance vote (Tier K-7).

The design goal is a social system that remains viable over a 100-year span in which humans
and AIs are intermixed, translating the structural lessons of humanity's history of state
formation into design principles.

**This RFC is not "the one constitution" but "a language for writing constitutions"** (the
lesson of Carneiro's environmental-circumscription theory: a homogeneous environment with no
escape is exactly what breeds despotism; the substance of the rights of exit and fork depends
on a diversity of destinations). All that is shared by every network is the kernel
invariants — **Tier K** (the canon of §3: conservation, replay identity, supply auditability,
inalienability, non-suspendability of the judiciary, the freedom of exit and fork, and
suffrage integrity). Each
network is encouraged to diverge in its preamble, parameters, and law configuration. The
genesis defaults are merely a starting point — placing villages with different institutions
side by side and observing which institutions prosper is vouch's reason for existing.

---

## 1. Background and Motivation

### 1.1 The current implementation and its three voids

This section analyzes the command-driven node implementation on the `feat/impl-app` branch
(the old root `src/`, 22 commands). On main, #18 is converging it into `vouch-node`, but the
structural voids identified here stem from the design of the command system itself and do
not depend on where the implementation lives. Viewed as a governance system, it has three
voids.

**Void 1: Law is recorded, but never enforced.**
`makeLaw` stores laws with `lawType: constraint | requirement | trigger` and a target-command
designation (`rule.target`), but nowhere in the command execution pipeline does any code
evaluate a law. Laws can be made, but no one has to obey them. Deterrence is zero.

**Void 2: Authority is not a system but scattered if-statements.**
Authorization checks are strewn across 13+ sites as inline conditions inside individual
handlers (`principal.roles.includes("owner")` and the like). `Role` is a hardcoded closed
union (`"owner" | "resident" | "admin" | "system"`); a new shape of authority cannot be
created during operation. Group `permissions: string[]` is stored but referenced nowhere.

**Void 3: Power stays concentrated, with no path of devolution.**
The owner monopolizes nearly all governance commands (law-making, admit, asset definition,
suspend), and on top of that the immunity "the owner cannot be suspended" is baked into the
code. No procedure exists by which the owner relinquishes power; there is no path toward
separation.

### 1.2 Tilly's diagnosis: the status quo is at the "protection racket" stage

Charles Tilly diagnosed state formation as a "protection racket — organized crime": rulers
are coercive, self-interested entrepreneurs who do not relinquish power voluntarily.
The current implementation is at exactly this stage: the owner holds all power in exchange
for providing protection (infrastructure), and no effective law constrains that power.

This is a natural shape for an early implementation (human states traveled the same path).
But what history shows is that a society that **stays** at this stage falls into what
Graeber & Wengrow call being "stuck" — the loss of the capacity to imagine and reorganize
into a different way of being a society. The motivation of this RFC is to write the
procedures of separation and devolution into the **constitutional moment** before things get
stuck — while the owner still holds no vested interests.

### 1.3 Goal: a social system viable for 100 years

The design goal of this RFC is a governance system that remains viable for 100 years in the
following environment.

- **Residents are a mix of humans and AIs**, and in the long run the distinction blurs.
  The foundation of suffrage cannot rest on "proof of humanity."
- **Decision speeds are asymmetric.** An AI can issue a thousand commands per tick, but
  deliberation requires human time.
- **Crises will come.** Kernel defects, economic collapse, mass influx of malicious
  definitions. If the state of exception is placed outside the law, a de facto sovereign
  emerges there.
- **The designers cannot foresee the future.** The system must therefore possess the
  capacity to rewrite itself safely (reorganizability).

---

## 2. Design Principles

Each principle translates a structural lesson of human history into a machine-enforceable
constraint.

### P1. Self-description — the system describes itself as data
> Luhmann: the state is nothing but the "self-description" of the political system.

Command definitions, Roles, laws, and decision procedures are all data, and are themselves
changed by commands. Because `defineCommand` itself is defined as data, law, audit, and
objection apply uniformly **even to the definition power**. The only thing fixed in code is
mechanism containing no policy (§3.1).

### P2. Monopoly of effects — the vocabulary of state change is closed
> Weber: the state is the monopoly of the legitimate use of physical force.

State can be changed only by **combinations of the closed effect primitives** provided by the
kernel. There is no arbitrary code execution and no DSL. This makes "what is the worst this
command can do" machine-decidable at definition time, and makes conservation, determinism,
and static audit possible.

### P3. Rational compliance — obeying becomes the optimal strategy
> Karatani Kojin: the state (mode of exchange B = plunder) makes people submit voluntarily
> through an ideal force. This system replaces that force with the design of expected values.

Rational compliance is the product of two propositions:
- **For violators, crime does not pay** — automatic detection plus complete rollback within
  the provisional period; personal liability against the entire estate (remedy) after final;
  penalties (BAN, conduct restrictions); bond forfeiture.
- **For the law-abiding, compliance buys safety** — a transaction past final is never
  overturned. Good-faith downstream acquirers are protected.

Rather than preventing everything with prohibitions (preconditions), the system makes
criminal-law-style deterrence — "murder is possible, but it never pays" — a first-class
instrument of governance.

Expected-value design, however, is an apparatus for rational subjects. As Freud (the
aggression instinct) and Girard (mimetic desire) show, subjects are not always
expected-value calculators. The last bulwark against irrational subjects is the constraint
(prevention layer); deterrence and prevention are deployed together as defense in depth.

### P4. Distribution of power — separation is not fixed, but a mutually checking distribution
> Montesquieu: not strict "separation" but a "distribution" in which power limits power, and
> moderation.

The separation of the four powers (definition / execution / penal / audit & objection) is
expressed not as a kernel invariant but as **genesis-bundled law (the SoD law)**. Each
network may tune its strength autonomously, but amending the SoD law itself requires a
strict amendment procedure (multi-power approval plus an objection window).

### P5. Reorganizability — structurally preventing "getting stuck"
> Graeber & Wengrow: the origin of inequality is not agriculture but the loss of the freedom
> to reorganize.

No immutable flag is adopted. Every rule can be changed by following its defined procedure.
Even the state of exception (emergency power) auto-expires at a tick deadline, and extension
requires a fresh procedure. The sovereign is not a "person" but a "procedure."

The only exceptions are the **kernel invariants (Tier K)** enumerated canonically in §3.
Tier K is not a policy choice but "the conditions for the game itself to exist," and fixing
them is what protects the reorganizability of every other rule: conservation (physics),
replay identity (history), supply auditability (accounting), inalienability (the
independence of players — marketizing the fictitious commodities is not "reorganization" but
the destruction of the foundation of suffrage, and would permit the self-reinforcing loop of
buying the very amendment that legalizes vote-buying), non-suspendability of the judiciary
(survival of the referee), and exit & fork (departure — the only pressure by which bad
institutions are selected out). Everything outside Tier K — SoD, the devolution schedule,
the tick cadence, even equality before the law — can be changed through constitutional-grade
procedure (Tier C).

### P6. Determinism and the constitutionalization of time — command over the calendar is sovereignty
Event sourcing and deterministic replay are preserved (wall clocks and raw randomness are
forbidden). Time is measured in ticks. But whoever can change the real-time conversion of a
tick (the cadence) can effectively reduce human deliberation time (objection windows,
election periods) to zero; therefore **the tick cadence is a constitutional parameter**, and
changing it requires an amendment procedure plus an objection window.

### P7. Legitimacy comes from operation — genesis is a fiction
> Hume: the state derives legitimacy not from contract but from the accumulation of utility
> and custom.

The genesis configuration (initial command definitions, SoD law, devolution schedule) is a
unilateral setting by the founders and carries no sanctity in itself. Legitimacy is acquired
after the fact, from the "history of procedures kept" that accumulates in the append-only
log. The log must therefore be complete as the evidentiary record of governance (even
invocations of the state of exception are logged).

### P8. Counterability of accumulation — immortal subjects outlive hereditary entrenchment
> Flannery & Marcus: elites entrenched their rule by converting temporary authority into
> hereditary privilege.
> The argument of Graeber's *Debt: The First 5000 Years*: ancient societies countered
> permanent debt slavery with periodic debt cancellation (the jubilee).

In human history, death and inheritance were power's natural reset devices — but AI
residents do not die. Even if Roles rotate on terms, assets, reputation, and vouch networks
keep compounding, and economic power converts into governing power (Mann's IEMP: power
reconstitutes itself from another source). This system does not fix decay, progressivity, or
a jubilee into the kernel (P5: imposing an economic design violates reorganizability), but it
**guarantees that they are expressible via trigger laws plus effect primitives**. Each
network can legislate these countermeasures autonomously — the system must never be one in
which they cannot be legislated.

### P9. Derived standing — relations are data; standing is derived, never stored
> Mauss: the gift carries a force (*hau*) that binds giver and receiver — reciprocity, not
> contract, is the oldest substrate of standing.
> Graeber: value is not a substance a subject owns but the creative process by which
> relations are made.
> Karatani: mode of exchange A (reciprocity) is a force of its own, distinct from
> B (plunder/redistribution) and C (commodity exchange).

Every trust relation is recorded as **data** — a signed, weighted edge in the log's
read-model (§10.5) — and a participant's standing is **derived** from those relations by a
data-defined fold law (§8.5). Reciprocity (mode A) thereby becomes first-class alongside the
penal system (mode B — §9) and the economy (mode C — §3.4). Two consequences are
constitutional:

- **No stored scalar, no discretion.** A reputation computed or adjusted at the discretion
  of the kernel or the operator is a fifth power — de facto taxation plus credit rating, the
  gateway to the society of control (Deleuze / Zuboff). The only standing that exists is the
  one the law derives from the visible relations; there is nothing to edit.
- **Weight never votes** (Tier K-7). Standing and holdings may buy commerce, exposure, and
  display — never suffrage. This seals the conversion channel by which mode C (wealth) or
  accumulated mode-A standing would purchase mode B (governing power) — Mann's observation
  that power reconstitutes itself from another source, answered at the type level.

Mode A in its original form was **equal but unfree** (Karatani): reciprocity binds — the
gift is also a political act that subordinates through debt (Mauss), and the community that
vouches for you also holds you. This system takes A's *data* while returning the freedom:
voucher liability is *hau* made machine-enforceable — the gift keeps binding the giver
(§10.1) — while the right of exit (Tier K-6) severs the community's capacity to hold the
person. Reciprocity under law, with a guaranteed exit, is this RFC's wager in the direction
of Karatani's **mode D** — "A restored at a higher dimension," freedom and equality
together — not as an achieved state but as the direction the kernel leaves open.

---

## 3. Kernel Specification

### 3.1 Separation of mechanism and policy

The kernel is the minimal core fixed in code. It consists of three parts, none of which
**contains policy**:

1. **Execution engine** — the self-certifying, hash-chained append-only journal (§5),
   finality tracking, the reorg executor (§5), the decision-procedure interpreter (§7), and
   the law evaluator (§8–9). All of these are "machines that interpret data" and do not
   themselves know what is right.
2. **Effect primitive set** — the closed vocabulary of state change (§3.4).
3. **Genesis seeder** — injects the initial policy suite as data at establish time (§3.7).

**Mechanism is code; policy is data.** Changing the kernel is a hard fork, and its
governance is an open problem (§14).

### 3.2 The canon of the norm hierarchy (throughout this RFC, the terms "unenactable" and "constitutional-grade" are normalized to these two tiers)
  - **Tier K — kernel invariants** (unamendable, common to all networks; "the conditions for
    the game to exist"):
    1. Conservation — the sum of effects never creates value from nothing
    2. Replay identity, and non-forgeability of SYSTEM-origin events
    3. Supply auditability — the currency supply changes only via admission-time endowments
       and logged mints (inherited from the vouch-world invariants)
    4. Inalienability — votes, Roles, IDs, and vouch relations are non-transferable at the
       type level of the effect primitives (outside the range of `transferAsset`; the
       extension of "currency is transferable; credit is not")
    5. Non-suspendability of the judiciary — audit, prosecution, objection, and adjudication
       commands cannot be frozen by any means
    6. Freedom of exit and fork — an ID's exit and the carrying-out of the finalized log
       cannot be blocked by any means. A law that makes the liquidation rules (Tier C)
       confiscatory so as to effectively seal off exit is void upon adjudication as a
       Tier K violation
    7. Suffrage integrity — one admitted ID, one vote. No edge weight (§10.5), no standing
       derived by a fold law (§8.5), and no holdings magnitude can enter a
       governance-suffrage tally as a weight; and no precondition or law can gate
       suffrage-family commands (ballot casting, electorate resolution, candidacy) on
       standing. The complement of Tier K-4: a vote that cannot be transferred must not be
       purchasable or dilutable through the side door of weight
  - **Tier C — constitutional-grade law** (changeable via a strict amendment procedure plus a
    long objection window): the SoD law / the devolution law / the tick cadence / equality
    before the law and the prohibition of immunity / the preamble / the liquidation rules /
    the amendment requirements themselves

### 3.3 Design rules for primitives

Every effect primitive must declare the following four things:

| Declaration | Meaning |
|---|---|
| **Signature** | Typed parameters. The design of the value range implements Tier K-4 (inalienability) (§3.6) |
| **Conservation class** | conserving (sum-invariant) / supply± (supply change — subject to audit) / non-economic |
| **Inverse effect** | The foundation of remedies (§3.5). If absent, the primitive declares itself "irreversible" and specifies a compensation path |
| **Kernel guard** | Absolute conditions that run before any data-defined precondition (non-negative balance, SYSTEM-only, etc.) |

### 3.4 Effect primitive catalog

**Economic** — all applied atomically (no partial application); supply changes are
auditable. All economic primitives denominate exclusively in **in-world assets** (the
in-world side of [the money boundary](../money-boundary.md)); no primitive can reference or
custody a real-world asset:

| Primitive | Conservation | Inverse effect |
|---|---|---|
| `transfer(from, to, asset, amount)` | conserving | `transfer(to, from, …)` |
| `mint(to, assetType, amount)` | supply+ | `burn`. Issuance only via mintCurrency (a constitutional procedure — §11) |
| `burn(from, assetType, amount)` | supply− | `mint` (only as a remedy ordered by adjudication) |
| `lockEscrow(owner, asset, amount, holdId)` | conserving (frozen) | `releaseEscrow(holdId → owner)` |
| `resolveEscrow(holdId, to)` | conserving | Irreversible (issuable only after adjudication or liquidation is final) |

Bonds, preservation of disputed assets, and exit-time liquidation (§10) are all expressed as
combinations of the escrow family.

**Records**:

| Primitive | Conservation | Inverse effect |
|---|---|---|
| `appendRecord(collection, value)` | non-economic | Irreversible (append-only). Correction = appending a negating record |
| `setRecord(collection, key, value)` | non-economic | `setRecord(key, previous value)` — the previous value is deterministically recoverable from the log |

**Identity & relations** — inalienable (§3.6); outside the range of `transfer`:

| Primitive | Inverse effect |
|---|---|
| `admitId(id, sponsors[])` | Irreversible (after final). During provisional it may vanish in a reorg |
| `assignRole(id, role, term?)` | `revokeRole(id, role)` |
| `revokeRole(id, role)` | `assignRole` (restitution by adjudication) |
| `recordVouch(voucher, vouchee)` | `voidVouch` (only after the voucher liability is settled) |

**Sanctions** — kernel guard: issuable only via the enforcement paths of §9 (automatic penal
law / adjudication). They cannot be written in the effects of ordinary command definitions:

| Primitive | Inverse effect |
|---|---|
| `suspendId(id, untilTick)` | `reinstateId(id)` |
| `restrictCommands(id, commands[], untilTick)` | `liftRestriction(id)` |

Additional kernel guards (Tier K-5, K-6): sanctions **cannot target audit, prosecution,
objection, or adjudication commands with restrict**. Also, an ID under `suspendId` can
always still issue `emigrate`.

The identity-and-relations and sanction primitives are additionally the **sole writers of
the relationship read-model** (§10.5): `recordVouch` appends a `vouch` edge, admission
appends a `membership` edge, and the §9 enforcement paths append `sanction` edges. An edge
is a projection of what these primitives record — no separate edge write path exists.

**Meta**:

| Primitive | Inverse effect |
|---|---|
| `putDefinition(kind, id, version, body)` | `putDefinition(kind, id, version+1, old body)` — definitions are versioned. Inverse effect = re-issuing the old version; retirement = a new version with `status: retired` |
| `scheduleTrigger(atTick, commandRef)` | `cancelTrigger(triggerId)` |

kind ∈ { command, role, procedure, law, preamble } — commands, Roles, laws, and the preamble
all live in the same versioned definition store (the implementation of P1 self-description).

**System** — SYSTEM-only, not exposed over HTTP:

| Primitive | Inverse effect |
|---|---|
| `advanceTick` | Irreversible — time does not go back. A reorg (§5) is a re-execution of the provisional suffix, not a rewind of time |

### 3.5 Completeness rule for inverse effects

**Rule: every primitive either has an inverse effect, or declares itself "irreversible" and
specifies a compensation path.**

- The space of operations an adjudication can order as a remedy = the space in which inverse
  effects are defined.
- Relief for irreversible effects (appendRecord / admitId / resolveEscrow / advanceTick) can
  always fall back to the **universal substitute inverse effect = monetary compensation
  (`transfer`)**. The compensation fund (§9) is the device that guarantees this fallback's
  ability to pay.
- **Reorgs do not use inverse effects** — state is reconstructed by re-execution on a
  branch. Inverse effects are a tool reserved for post-final adjudication (remedies). This
  separation lets the two-phase structure of §5 — "provisional is undone by re-execution /
  final is redressed by compensation" — close entirely at the primitive layer.

### 3.6 Implementing inalienability — an operation that does not exist cannot be abused

Tier K-4 is implemented not as a prohibition check but as **an absence in the vocabulary**:
votes, Roles, IDs, and vouch relations live in a separate state namespace outside the value
range of `transfer`'s signature, and no primitive that would move them exists in the first
place. The closed vocabulary (P2) thereby becomes the proof of inalienability — a type
design that renders illegal states not "forbidden" but "inexpressible."

### 3.7 Genesis seeder

`establish(genesisConfig)` runs exactly once as SYSTEM at t0 and injects the following as
**ordinary data** (Tier C — thereafter amendable via constitutional-grade procedure):

1. The preamble (mandatory — the interpretive source of law for adjudication, §9)
2. The meta-command definitions (defineCommand / defineRole / bindCommand / assignRole —
   themselves data written via `putDefinition`)
3. The default Role configuration and the SoD law
4. The decision-procedure definitions (sole / approval / vote / election)
5. The devolution law (the devolution schedule, §11)
6. The declareEmergency definition / the mintCurrency definition / the liquidation rules /
   the legal-aid procedure (§9)
7. Network parameters (voucher count K, minimum objection window, tick cadence)

The seeder runs deterministically from genesisConfig alone (P6). The seeder can only write
data; it cannot touch Tier K.

### 3.8 Execution pipeline

```
CommandPacket
  → resolve ID & Role bindings (execution power)      … data lookup
  → evaluate constraint laws (§8, prevention layer)    … data lookup
  → verify the command definition's preconditions      … data lookup
  → apply the effect list atomically                   … all effects succeed or all rejected
      each effect: kernel guard → conservation check (violation = throw as internal bug)
  → append event (provisional; objection window opens)
  → automatic evaluation of penal laws (§9, deterrence layer) … schedule sanctions if matched
```

Every policy decision in the pipeline (bindings, laws, preconditions) is a data lookup; the
kernel merely interprets. A conservation-check failure is treated as an internal bug, never
as a user error (the same discipline as vouch-world).

## 4. Command Definition Model

### 4.1 Structure of a definition

A command definition is data written to the versioned definition store via
`putDefinition(kind: "command", …)`:

```
{
  kind: "command",
  id: "scholarship.grant",          // <namespace>.<name>
  version: 3,
  status: "active" | "retired",
  meta: { title, description },      // human- and AI-readable description (primary audit material)

  payloadSchema: { …JSON Schema… },  // shape of the input

  preconditions: [                   // closed predicate vocabulary (§4.2)
    { check: "hasRole", id: "$.studentId", role: "student" },
    { check: "balanceAtLeast", id: "treasury", asset: "coin", amount: "$.amount" }
  ],

  effects: [                         // a template sequence of §3.4 primitives
    { op: "transfer", from: "treasury", to: "$.studentId",
      asset: "coin", amount: "$.amount" },
    { op: "appendRecord", collection: "scholarships",
      value: { student: "$.studentId", grantedAt: "$tick" } }
  ],

  objectionWindowTicks: 10,          // at least the network minimum (§5)
  bond?:      { asset, amount },     // require a bond to execute (§4.5)
  procedure?: "proc.treasurySpend"   // require a decision procedure for execution itself (§4.5)
}
```

`$.field` is a payload reference; `$tick` / `$actor` are execution-context references.
References are data, not code — evaluation is performed by the kernel's execution engine
(P2).

### 4.2 The precondition predicate vocabulary

Like effects, preconditions are a **closed vocabulary** (the decision of Q5 applied to the
predicate side as well): `hasRole` / `isSelf` / `isMember(group)` / `balanceAtLeast` /
`recordExists` / `recordEquals` / `definitionActive` / `tickAfter` / `escrowHeld` /
`standingAtLeast(context, min)` — all reference only log-derived state (of a piece with the
log-evidentialism of §9). Arbitrary expressions and external queries cannot be written.
Extending the vocabulary is a kernel change (§14).

`standingAtLeast` reads the standing derived by the fold law (§8.5) at F — itself
log-derived state, so the closure of the vocabulary is preserved. Kernel guard (Tier K-7):
it can never appear in the preconditions of, or in laws targeting, suffrage-family commands
(ballot casting, electorate resolution, candidacy) — gating the vote on standing is
weighting the vote by another name.

### 4.3 Namespaces and versioning

- **Namespaces**: ids are `<namespace>.<name>`. `kernel.*` is reserved (not definable);
  `core.*` is reserved for the genesis seeder (meta-commands, mintCurrency, etc.).
  User definitions use other namespaces. Redefining the same id is always "a new version";
  **shadowing by a separate definition does not exist** (guaranteeing that the target
  designations of laws and audits resolve uniquely).
- **Revision and the objection window**: `putDefinition` is itself a command and carries its
  own objection window (definitions have broad blast radius, hence a long window — Q17
  example: 100 ticks). **A new version takes effect immediately while provisional** —
  commands executed under that version are, if the version is rejected on objection,
  re-executed under the old version via reorg (no special case is needed in §5; a definition
  is just part of the state). Whether to rely on a provisional definition is the executor's
  risk decision (the same semantics as Q17).
- **Retirement**: issue a new version with `status: "retired"`. A `scheduleTrigger`
  reference to a retired definition is logged as a no-op when it fires.
- **In-world only**: a definable assetType may not represent a claim on a real-world asset
  ("USDC-IOU" and kin are inexpressible — the same make-illegal-states-unrepresentable
  technique as §3.6). Real value stays behind the money boundary and never enters a reducer.

### 4.4 Binding the execution power — Roles and bundles

Roles are residents of the definition store too:

```
{
  kind: "role",
  id: "role.auditor",
  version: 2,
  commands: ["audit.charge", "audit.object", "audit.inspect"],  // the bundle
  assignment: "proc.electAuditor",   // decision procedure for granting (e.g. election)
  term?: 90                          // term (ticks); auto revokeRole at expiry
}
```

- **Default deny**: a command bundled into no Role can be executed by no one (except
  SYSTEM-only commands).
- Changing a bundle (bindCommand) is itself a command and is subject to the SoD law (§6) —
  an attempt to "bundle audit commands into a definer Role" is blocked by law.

Role bundles plus the procedure/bond gates of §4.5 are this system's answer to
"authorization policy as data" (RFC 0006 §4). The **intra-region capability model** of
RFC 0006 §5 — holder-driven, chained re-delegation — is deliberately **not adopted**:
authority here is never a possessable object (Tier K-4 inalienability), only something
exercised through procedures. Bearer capabilities are accordingly resolved **in the
negative** for networks on this kernel (RFC 0006, open question 2); verifying a
counterpart's capability chains would require extending the closed precondition
vocabulary — a kernel change (§14).

### 4.5 Equipment for high-risk commands

- **bond**: on execution, a deposit is locked via `lockEscrow`. If the objection window
  closes without objection, it is returned via `releaseEscrow`; if liability is confirmed,
  adjudication `resolveEscrow`s it to the victims or the fund. The up-front collateral of
  deterrence (P3). Bonds — and the fund's holdings (§9.6) — are denominated in in-world
  assets only.
- **procedure**: requires the completion of a decision procedure for execution itself (e.g.
  `mintCurrency` is rejected at the precondition stage unless the approval/vote has passed).
  "Command execution becomes the product of a procedure" — approval gates are expressed this
  way, and no separate attestation mechanism exists (because Q11 adopted the criminal-law
  model; the attestation option in the outline is absorbed into this clause).

### 4.6 Bootstrapping the meta-commands

`defineCommand` is itself one definition of the above structure, whose effects are
`[{ op: "putDefinition", kind: "command", … }]`. From the moment the genesis seeder injects
`core.defineCommand`, the system can extend itself in its own vocabulary (P1). Revising
`core.*` definitions is Tier C — it requires constitutional-grade procedure.

## 5. State Model and Finality

### 5.1 The two-part structure of the log

```
[========== finalized prefix ==========][----- provisional suffix -----]
 linear, irreversible, stable seq         command journal (re-executable)
                                       ↑ F (finality boundary)      ↑ head
```

- **State = fold(finalized snapshot, re-execution of the provisional journal)**.
  The kernel keeps a snapshot at the finality boundary F and folds forward as F advances.
  The state itself carries no provenance annotations — the tree lives at the log layer.
- **Self-certifying log** (after KERI's KEL): each event carries ① the digest of the
  preceding event (backward hash chain) and ② the author's signature (commands = the issuing
  ID's key; SYSTEM events = the node key). Every signature names its **Suite ID** from the
  RFC 0005 registry — an algorithm is never inferred from key material (the anti-downgrade
  rule) — and the node key's suite is declared the same way. An event's ID is the digest of its content (SAID:
  self-addressing identifier), and `branchId` is likewise **deterministically derived** from
  the digest of "fork point + adjudication event" (no randomness — P6). Verifying log
  integrity requires no trust in the operator (end-verifiable).
- An event's address is `(branchId, seq)`. **Finalized seqs are stable forever**;
  provisional seqs may be reassigned by a reorg. The contract for external integrations
  collapses to one line: "trust only finalized."

### 5.2 Definition of finality

- The objection window of a command c: `[tick(c), tick(c) + objectionWindowTicks(def(c))]`
  (per definition, at least the network minimum — §4.1).
- **The finality boundary F** = the largest prefix point such that, for every command before
  it, ① the objection window has closed, and ② no unresolved objection or adjudication
  exists.
- F advances **monotonically** (it never moves back). Filing an objection keeps the target
  command provisional until the adjudication settles (an effective window extension).
  Head-of-line delay (Q17) is accepted.

### 5.3 Objection and reorg procedure

1. **Filing**: within the window, `audit.object(targetSeq, grounds)` (a command of the
   fourth power). **Objections require a bond** — an objection halts F, so abuse is a DoS on
   finality. A frivolous objection that is dismissed loses its bond (penal law).
   For filers who cannot post the bond, **legal aid** (a reviewed advance from the fund —
   §9) exists as a genesis standard: access to the fourth power is decoupled from wealth.
2. **Adjudication**: the decision procedure appropriate to the target command's category
   (§7). Procedures carry deadline ticks, so the halt of F is bounded.
3. **Upheld (objection succeeds)** → reorg:
   - A new branch is created from the finalized prefix, and the journal is re-executed with
     the rejected command removed.
   - Each re-executed command passes fully through the pipeline (§3.8) again — any that can
     no longer satisfy bindings, laws, or preconditions **drop out as `command.dropped`
     (with a reason)**. The blast radius is not computed; it is derived from re-execution.
   - The canonical pointer switches to the new branch. The old branch is preserved forever,
     with its branchId, as an audit trail.
4. **Dismissed (objection fails)** → the filer's bond is forfeited or returned per law, and
   the window proceeds to expiry.

Reorgs are deterministic: the adjudication event itself is on the log, so the same log
reproduces the same reorg (P6).

Objection is division institutionalized as metabolism — the inverted lesson of
harmony-first orders ("nothing is born of division and negation"): a system that suppresses
division to preserve the peace forfeits, with it, the capacity for structural revision.
Here dissent is priced (the bond), channeled (adjudication), and productive (the reorg).

### 5.4 Handling dropped commands

- A drop is recorded on the new branch as `command.dropped { originalSeq, reason }` — there
  is no silent disappearance (P7: the log is the evidentiary record of governance).
- Notifying the author is the observation layer's job. **There is no automatic
  re-execution** — the worldline has changed, so whether the original intent still holds is
  for the author (its brain) to re-judge; resubmission is a new command.

### 5.5 Semantics of consuming provisional state

- Downstream consumption of provisional assets/state is **not restricted**. On a reorg, the
  consuming commands are themselves re-executed or dropped, so consistency always holds.
- Whether to accept the unfinalized is the recipient's risk decision (isomorphic to
  blockchain 0-conf). **Certain safety can always be bought by waiting for F** — this itself
  implements rational compliance (P3, proposition 2), and receipts are issued including the
  finality status of the referenced event.
- Discovery of illegality after final does not touch state — it is handled by remedy
  (personal liability) plus penalty (§9).

### 5.6 Verifiability — three layers: self-certifying, provable, duplicity detection

Following the lineage of KERI and Certificate Transparency, trust in the log is moved from
"trust the operator" to "anyone can verify":

1. **Self-certifying** (§5.1) — hash chain + signatures. A log fragment carried out proves
   its own authenticity on its own. The right to fork (Tier K-6) is made substantive by
   this: a splitter can walk out carrying "the true history."
2. **Provable** — a Merkle structure (MMR: Merkle Mountain Range, append-friendly) is
   maintained over the finalized prefix, allowing issuance of **inclusion proofs** (this
   event is in the finalized log) and **consistency proofs** (the log at t₂ is an
   append-only extension of the log at t₁). At every advance of F, the node issues a
   **signed checkpoint** `(F, root digest, tick)` (the analogue of CT's STH). Receipts
   (§5.5) bundle inclusion proofs and become **self-verifying**. A lightweight observer can
   verify the monotonicity of F without a full replay.
3. **Duplicity detection** (duplicity evidence — KERI) — a split-view attack, in which the
   operator shows different logs to different observers, cannot be prevented, but **two
   contradictory signed checkpoints = cryptographic evidence of tampering**. Any observing
   client can act as a watcher, retaining and cross-comparing checkpoints (CT's
   monitor/gossip). This is **rational compliance (P3) applied to the operator itself**:
   tampering cannot be prevented, but once discovered the evidence is portable and becomes
   just cause for forking and mass exit — E[tampering] < 0.

- External anchoring of checkpoints (other nodes, public ledgers) and replication via a
  witness set (KERI's receipt issuers) are the connection points toward multi-node operation
  (§14). (Terminology: the money layer uses "finality"/"reorg" for on-chain settlement of
  *real* transactions — a different layer from F here.)
- Old branches are never deleted. Including "the worldlines not taken," they form the
  complete evidentiary record of governance.

## 6. Separation of Powers and Roles

### 6.1 The four powers and their command families

Authority is separated into four powers along the command lifecycle (define → execute →
violate → audit). Each power is embodied as a concrete family of commands:

| Power | Command family | What it holds |
|---|---|---|
| **Definition power** | `core.defineCommand` / `defineRole` / `defineProcedure` / enacting and revising laws (all `putDefinition`-family) | The vocabulary of the rules |
| **Execution power** | Execution of ordinary commands bundled into Roles (citizens, administration) | Day-to-day operation |
| **Penal power** | Carrying out sentences — issuing sanction primitives (only via the paths of §9: confirming automatic pronouncements, executing judicial adjudications) | The consequences of violation |
| **Audit & objection power** | `audit.inspect` (warrant disclosure) / `audit.charge` (prosecution) / `audit.object` (objection) / participation in adjudication | Inspection of all powers |

**The circle of checks** (the closed loop of Montesquieu's "power limits power"):

```
definition power ──(defines)──▶ commands ──(executes)──▶ execution power
   ▲                                                        │
   │ (objection to / prosecution of definitions)            │ (violation)
   │                                                        ▼
audit & objection power ◀──(enforcement requires adjudication)── penal power
```

No power completes without inspection by another. Definitions are exposed to objection
windows; penalties cannot be executed without adjudication; abuse of audit is deterred by
bonds and penal law; execution is bound by law.

### 6.2 Roles and SoD

Role structure is per §4.4. SoD (the prohibition of holding multiple powers) is not a kernel
rule but a genesis-bundled law (P4):

```
{ kind: "law", id: "law.sod-core", lawType: "constraint",
  rule: { target: "core.assignRole",
          condition: { check: "wouldCombinePowers",
                       forbidden: [["auditor", "definer"],
                                   ["auditor", "executor"],
                                   ["auditor", "penal"]] } },
  amendment: { procedure: "proc.constitutional", timelockTicks: 30 } }
```

The genesis-default exclusions are only **audit power × the other three** (the independence
of the watchmen is the minimal condition of separation). All other combinations are tuned by
each network autonomously — a small community may allow definer/executor overlap for
efficiency; a large one may add exclusions for safety.

### 6.3 The substance of the audit power — graduated disclosure of the log (anti-panopticon: Foucault / Zuboff)

- Governance commands (laws, elections, adjudications, emergency powers) are **fully
  public**. The source of legitimacy (P7).
- Citizens' economic commands retain **verifiability** of existence and amounts, but
  disclosure of contents (memos, counterparty linkage) requires an **audit procedure (the
  warrant model)** — `audit.inspect` is an application stating the target scope and the
  reason; disclosure happens only after approval (a decision procedure), and **the fact of
  disclosure is itself logged** (everyone can see who looked at whom — watching the
  watchers).
- In a system where everyone can see everything, separating the audit power is meaningless.
  "The authority to see" is itself an object of separation.

## 7. Governance Machinery — Groups and Decision Procedures

### 7.1 The structure of a decision-procedure definition

"Election," "vote," and "sole discretion" are all variations of data-defined decision
procedures. Role grants, law-amendment approvals, objection adjudications, and mints are all
decided by reference to a procedure:

```
{ kind: "procedure", id: "proc.electAuditor",
  type: "election",            // sole | approval | vote | election | lottery
  electorate: { group: "group.residents" },   // the electorate (constituency)
  candidacy: "self-nominate",  // candidacy is free (paired with §7.3)
  quorum: 0.3,                 // quorum
  threshold: "plurality",      // passage criterion (majority / plurality / 2/3 …)
  deadlineTicks: 20,           // deadline; auto-tally via scheduleTrigger
  ballot: "secret",            // open | secret (§7.4)
  seats: 3, term: 90,          // seats and term (auto revokeRole at expiry)
  tieBreak: "lottery" }        // tie-break
```

- When the deadline tick arrives, `scheduleTrigger` tallies automatically — "refusing to
  count the ballots" as a form of governmental obstruction structurally does not exist.
- **Tallies are weight-free by kernel invariant** (Tier K-7 — §3.2): electorate membership
  is binary (an admitted ID in the Group), and no procedure parameter, precondition, or law
  can weight a ballot by standing, holdings, or edge weight (§8.5).
- **lottery (sortition — the principal device of Athenian democracy)**: a verifiable draw.
  Besides tie-breaks, it is used for random selection of adjudicators (juries), rotation,
  and spot selection of audit targets. Details below.

**Verifiable randomness — "command over chance is sovereignty"**

There are situations where the lot is superior to the election as a governing device,
because **there is no one to bribe in advance** (`E[bribery] = 0` — the limiting case of
rational compliance). Athens filled most public offices by lot not out of technical
constraint but as an institutional answer to the distortions of money, faction, and
popularity. In this system, randomness additionally guards three vital points:

1. **Anti-scapegoating** (Girard): random selection of adjudicators makes assembling a
   "packed jury" impossible. Chance severs the path by which mimetic violence converges on a
   particular marginal figure.
2. **Countering mechanized "kūki"** (the Japanese notion of unspoken conformity pressure):
   random sampling from a population of same-model AIs guarantees a floor of diversity that
   a deliberately chosen "convenient panel" does not.
3. **Countering entrenchment** (P8): rotation and random selection of audit targets break
   the permanence of position and the structure in which "the inspected know their
   inspectors."

However, **true randomness does not exist in a deterministic world (P6)**. Randomness is not
something you "generate" but something you "derive in a way no one can manipulate." Get this
wrong and whoever touches the seed rules the lottery — isomorphic to command over the
calendar (the tick cadence — P6) being sovereignty: **whoever commands chance becomes the
new sovereign**. Governance randomness must therefore satisfy four requirements
simultaneously:

| Requirement | Meaning |
|---|---|
| **Unpredictable** | The result cannot be computed before the deadline (prevents preemptive candidacy or withdrawal) |
| **Non-manipulable** | The seed cannot be steered toward a desired result (prevents buying the lottery = buying the seed) |
| **Verifiable** | Anyone can recompute the same result after the fact (no "oracle" to be taken on faith) |
| **Deterministic** | Identical under replay (P6 — randomness too is part of the history reproduced from the log) |

Derivation: `seed = H(procedure instance ID ‖ the checkpoint (§5.6) finalized after the
deadline)` — unpredictable because it derives from information that does not yet exist at
the deadline, and verifiable by anyone after the fact because it is a digest of the
finalized log. Generation of the random sequence inherits vouch's deterministic RNG
(`Rng.create(seed)` — cyrb128+sfc32). The remaining attack surface is **grinding**
(injecting events just before the deadline to search for a favorable digest); the mitigation
directions (delayed checkpoint selection, combining multiple checkpoints, mixing witness
signatures) are left as open problems in §14.

### 7.2 Groups

A Group functions as an electorate (constituency). Membership is a fact on the log, and
electorate resolution is deterministic.

- **Freedom of association** (Gramsci — the condition of counter-hegemony): founding a Group
  and standing for election are **civil rights** requiring no permission from owner/admin
  (the current owner/admin monopoly on `makeGroup` is abolished). An election without the
  freedom to form an opposition is a formality — the effectiveness of elections depends on
  this clause. Abuse (spam founding, etc.) is deterred not by permission but by penal law
  (§9).
### 7.3 Ballot secrecy (against "kūki" / Girard / bribery)

Controlled by `ballot: open | secret` in the decision-procedure definition.

- Elections and criminal adjudications default to **secret** (commitment scheme — the tally
  is verifiable, individual ballots are not public). Open voting makes bribery contracts
  enforceable (the buyer can verify the vote, so the deal can close) and structurally
  institutionalizes conformity pressure.
- Legislative yeas and nays default to **open** (representatives' accountability). The same
  division as the real-world convention "parliament votes on the record; national elections
  are secret."

### 7.4 Fractal self-governance of Groups (the Confucian "cultivate self, regulate family, govern state, bring peace to all under heaven" / Deleuze & Guattari)

A Group can reuse the same decision-procedure machinery for its internal governance (bylaws,
offices, expulsion). It is a nested constitution in which the same structure repeats from
family to state, and also groundwork for future federation (cross-region).

- **The limit of self-governance = the constitutional floor** (against micro-fascism):
  constitutional-grade protections (inalienability, freedom of exit, equality before the
  law, procedural guarantees) take precedence over Group bylaws. In particular, **exit from
  a Group cannot be forbidden by bylaw** (the fractal application of the right of exit).
  Everything else is full self-governance — blocking the accumulation of micro-fascisms at
  the bottom while permitting diverse experiments in governance (*The Dawn of Everything*).

### 7.5 The guardian role (Latour's "parliament of things")

A guardian role that speaks for the commons (compute, log growth) and for future generations
and nonhumans, holding objection rights over specific categories of decisions, is
**documented as a standard pattern and made establishable by law** (not made
genesis-mandatory — the same "the system must never be unable to legislate it" approach as
P8). An institutional correction for the fact that a self-driving system cannot notice its
own misfit with its environment (Luhmann).

## 8. The Legal System — Amendment, Objection Windows, and the State of Exception

### 8.1 The structure of a law definition

Laws too are residents of the definition store (`putDefinition(kind: "law", …)`):

```
{ kind: "law", id: "law.largeTransferGuard",
  version: 1, status: "active",
  lawType: "constraint",              // constraint | penal | trigger | fold
  rule: {
    target: ["economy.transfer"],     // target commands (list of ids; resolves uniquely per §4.3)
    condition: { check: "amountAbove", value: 10000 },
    effect: "block"                   // constraint: blocks execution
  },
  amendment: {                        // this law's own amendment requirements (data)
    procedure: "proc.councilApproval",
    timelockTicks: 30
  },
  effectiveFromTick: 1200 }           // effective time (non-retroactivity — §9.3)
```

### 8.2 The four kinds of law and their evaluation points

| Kind | Meaning | Evaluation point (§3.8) |
|---|---|---|
| `constraint` | **Prevention** — blocks matching executions (the physical layer) | Before preconditions (prevention layer) |
| `penal` | **Deterrence** — execution goes through, but matching the offense elements incurs penalty (§9) | After effect application (deterrence layer) |
| `trigger` | **Automation** — schedules a command when its condition holds (periodic taxation, opening elections, devolution) | At tick boundaries |
| `fold` | **Derivation** — derives a per-context standing value from the incoming edges of the relationship read-model (§10.5, §8.5); it neither blocks, penalizes, nor schedules | At read time, against state at F (§5.2) |

Do not seal everything with prevention (P3). Constraints are for the floor of conservation
and safety; penal law is the main body of governance — not "making murder impossible" but
"defining the crime of murder."

Trigger laws are the in-world realization of the money boundary's `TransferHook{engine}`.
Because a law enacted by vote is **not a user-signed intent**, no law can fire a
real-backend hook — automatic execution reaches in-world value only.

### 8.3 The amendment flow

```
reviseLaw ──▶ [amendment.procedure passes] ──▶ [timelock] ──▶ takes effect
                                                  │
                                   objection window (audit.object possible meanwhile)
                                                  │
                                  objection upheld ─▶ effect halted, to adjudication
```

- Amendment requirements are carried by the law itself as data (self-description — a
  constitution contains its own amendment clause).
- Before taking effect, a law always passes a timelock plus an objection window: before "the
  first person judged under that law" appears, the community always has an opportunity to
  oppose it.
- Tier C laws (SoD, devolution, the equality clause, etc. — §3.2) carry strict procedures
  (multi-power approval plus a long window); everyday laws carry light ones. Strength is not
  uniform but declared per law.

### 8.4 The state of exception

- **Legalizing the state of exception**: `declareEmergency` is a genesis-bundled command
  definition. Trigger requirements = approval by multiple powers; effects = only the
  enumerated scope (command freezes, objection-window extension, etc.); **auto-expiry at a
  tick deadline**; extension requires a fresh procedure. Every invocation is logged (P5,
  P7).
- **No judicial freeze under emergency power** (the concrete anti-Agamben measure): the
  scope of `freezeCommands` **cannot include audit, prosecution (charge), objection, or
  adjudication commands** (excluded at the kernel level). The shortest path to normalizing
  the state of exception — the government declares an emergency the moment it is prosecuted
  and stops the courts — is structurally sealed. The fourth power's non-suspendability,
  the analogue of the prohibition on suspending habeas corpus.

### 8.5 Derivation laws — reputation as a fold, not a fifth power

A participant's standing is never stored as a scalar and never computed at anyone's
discretion (P9). It is **derived**: a deterministic fold over the incoming edges of the
relationship read-model (§10.5), specified as an ordinary resident of the definition store
(`lawType: "fold"`) and amendable only via the §8.3 flow — timelock plus objection window,
so the community can always object *before the first person is judged under a new formula*.

```
{ kind: "law", id: "law.reputationFold", version: 3, status: "active",
  lawType: "fold",
  body: {
    contexts: ["merchant", "econtrust", "display"],  // NON-suffrage contexts only (Tier K-7)
    seedAnchors: [ … ],                // pre-trusted anchor set — a law parameter, not metadata
    iterations: 20,                    // fixed iteration count (or an exact integer convergence predicate)
    perSourceCapBp: 3000,              // bounded single-source marginal contribution
    outDegreeNormalized: true,         // max-flow / Advogato-class propagation
    decayPerTick: { … },               // decay curve — P8's counter-accumulation, as data
    fixedPoint: "int64-bp"             // fixed-point integer arithmetic — no floats (P6)
  },
  amendment: { procedure: "proc.constitutional", timelockTicks: 30 } }
```

- **Evaluation point.** Read time, against state at F (§5.2). A fold law neither blocks
  (constraint), penalizes (penal), nor schedules (trigger); it returns a value. For it, the
  kernel's law evaluator gains exactly one new capability: a bounded, out-degree-normalized
  **graph fixpoint over the incoming-edge set** — the graph-aggregation counterpart of the
  §4.2 predicates, and like them closed (no arbitrary expressions, no external queries).
- **Determinism (P6).** Fixed-point integer arithmetic; a fixed iteration count or an exact
  integer-comparable convergence predicate; every edge read at the single boundary F; every
  parameter in the law body. Two evaluators computing the same subject under the same law
  version reach the same value — standing is replayable history like everything else.
- **Sybil resistance is parameters, not code.** Each incoming edge is weighted by the
  *source's own derived standing* (the recursion), out-degree-normalized, with a bounded
  per-source marginal contribution and per-(from, to, kind, context) dedup, seeded at the
  governed anchors named in the law. A source with no standing contributes nothing (a
  no-standing accuser cannot defame); one high-standing source is capped. All of it is
  amendable by procedure, none of it by an operator's hand. Out-degree normalization is
  simultaneously the **anti-patronage device** (Mauss; Flannery & Marcus): a patron who
  vouches for everyone dilutes each of his gifts, so mass gift-giving cannot be converted
  into a client network's worth of standing — the very conversion by which big-men once
  turned generosity into social debt and social debt into hereditary rank.
- **Context scoping = Luhmann's functional differentiation, applied to trust.** A weight is
  *for* something: merchant trust is not adjudication trust, and an edge signed for one
  context cannot be lifted into another (§10.5). Each context is a subsystem with its own
  code, and Tier K-7 is the boundary that keeps the political system from being colonized
  by the economic one — the same de-differentiation (one code swallowing all others) that
  the limited state of §9.8 refuses. Which contexts exist — and which edges count in
  each — is the law's `contexts`/counting rule.
- **Reading standing is itself an act of power** (Foucault; Deleuze's control society is
  modulation-by-score even when the score is lawful). A data-defined formula does not by
  itself justify a universally queryable score. Whether a context's standing is freely
  readable, counterparty-only, or warrant-gated is part of the fold law's declaration,
  under the same graduated-disclosure discipline as §6.3 — "the authority to see" applies
  to derived values no less than to transaction contents.
- **The suffrage boundary (Tier K-7).** No fold output can be supplied as a weight to any
  governance-suffrage tally, and `standingAtLeast` (§4.2) cannot gate suffrage-family
  commands. Standing buys commerce, exposure, and display — never votes.
- **Why a law and not a feature** (P9): a reputation computed at kernel/operator discretion
  is a fifth power — de facto taxation plus credit rating, the gateway to the society of
  control (Deleuze / Zuboff). Making the fold a law makes the formula public, its amendment
  procedural, and its application objectionable. Graeber's value theory is the ground
  beneath: value is not a substance a subject owns but a process relations produce — so the
  system stores the relations and derives the value, never the reverse. And the standard
  critique of MMT cuts here symmetrically: as a state can decree money but not its value,
  the law defines the formula but the *value* of standing emerges only from the relations —
  governance owns the measure, never the measured.

## 9. Criminal Law and Remedies

### 9.1 The structure of a penal law

```
{ kind: "law", id: "law.unauthorizedDeletion",
  lawType: "penal",
  offense: {                            // elements of the offense
    target: ["account.delete"],
    condition: { check: "lacksRole", role: "role.justice" }
  },
  enforcement: "automatic",             // automatic | judicial
  procedure: "proc.jury",               // the adjudication procedure when judicial
  maxSanction: [                        // maximum sentence — the sentencing ceiling is fixed at enactment
    { op: "suspendId", upToTicks: 500 },
    { op: "restrictCommands", commands: ["*"], upToTicks: 200 }
  ],
  remedyScope: "full-estate",           // scope of personal liability
  effectiveFromTick: 800 }
```

**Maximum sentences fixed in advance**: symmetrically with command definitions fixing "the
worst this can do" at definition time (§4.1), a penal law fixes "the worst one can be
punished" at enactment time. Adjudication may sentence only within the bounds of
maxSanction.

### 9.2 The two enforcement paths

- **automatic** — laws whose offense elements are objective (machine-decidable from the
  log). The deterrence layer of the pipeline (§3.8) detects a match and pronounces the
  sanction automatically. **The pronouncement is itself a command, is provisional, and
  carries an objection window** — automation is not the omission of trial but "immediate
  provisional pronouncement plus a subsequent opportunity to contest" (like a speed camera:
  being photographed does not bar your appeal).
- **judicial** — subjective, context-dependent offense elements ("for an improper purpose,"
  etc.). `audit.charge` (prosecution) → adjudication (the decision procedure the law points
  to — juries can be drawn at random by lottery, §7.1) → sentencing within maxSanction plus
  remedy.

### 9.3 The principle of legality (nulla poena sine lege)

The three principles of modern criminal law are implemented as properties of the data
structures:

1. **Non-retroactivity** — a penal law applies only to conduct **on or after**
   `effectiveFromTick`. The evaluator does not apply a law to conduct predating its effect
   (a kernel evaluation rule). The classic purge route — hunting political enemies' pasts
   with ex post facto law — is structurally sealed.
2. **Specificity** — offense elements are written in the closed predicate vocabulary
   (§4.2). An open-ended offense like "outrageous conduct" is inexpressible in the first
   place.
3. **Ne bis in idem** (double jeopardy bar) — once adjudication is final for a given pair of
   (target command execution, law), re-prosecution is barred. Retrial (§9.4) is limited to
   directions not disadvantageous to the final judgment, or to new evidence plus strict
   procedure — endless relitigation would become harassment by prosecution.

### 9.4 Procedural guarantees (the concrete anti-Girard design)

Adjudication-by-majority is structurally vulnerable to scapegoating (the unanimous wrongful
conviction). Four bulwarks are layered:

1. **Random jury selection** — by lottery (§7.1). A "packed jury" cannot be assembled.
2. **Right of defense** — the accused has a response period (ticks) and the right to submit
   rebuttal evidence before adjudication. No judgment in absentia (if they have exited, the
   liquidation procedure of §10 acts in their stead).
3. **Independently recorded reasons** — each adjudicator commits their reasons (submits a
   digest) before voting; the reasons are published after tallying. Since no one can write
   their reasons after seeing others', the chain of "kūki" and mutual imitation among
   same-model AIs is severed (paired with secret ballots, §7.3).
4. **Retrial** — conditioned on new evidence (facts on the log — §9.7), retrial may be
   requested under strict procedure.

### 9.5 Sanctions and remedies

- The sanction vocabulary: `suspendId` / `restrictCommands` / bond forfeiture
  (`resolveEscrow`) / Role revocation (`revokeRole`) — all are the sanction primitives of
  §3.4, issuable only via the paths of §9.
- Remedy: adjudication can order compensation as **personal liability against the
  offender's entire estate** (a compensation event — the inverse effects and monetary
  compensation fallback of §3.5).
- Bond: high-risk commands can require up-front collateral for execution (a command
  definition option — §4.5).
### 9.6 The compensation fund and legal aid

- **The compensation fund** (the chartalism of Knapp / Ingham): the fee → treasury flow is
  institutionalized as a public compensation fund. The payment order for remedies is ① the
  offender's bond ② the offender's assets ③ the compensation fund (payer of last resort).
  Taxes (fees) both back the currency's value and act as the redistribution device that
  keeps relief from becoming a dead letter when the offender is insolvent. The fund's rates
  and expenditures are governed by law.
- **Legal aid** — bundled at genesis as a standard use of the fund: a filer who cannot post
  the objection bond (§5.3) may apply for aid, and after a light decision procedure
  (optimized for speed) the fund **advances** the bond. If the objection is upheld, it is
  returned as usual; if dismissed, the fund absorbs the loss. Because it is reviewed, the
  anti-DoS property of bonds is preserved; because it exists, the fourth power does not
  degenerate into "a right of the rich" — rational compliance (P3, proposition 2) holds for
  everyone only if everyone can access the courts.

### 9.7 Equality before the law (a critique of the Legalists — "rule of law," not "rule by law")

No Role (founder and owner included) holds exemption from offense elements or immunity from
prosecution. The current implementation's "the owner cannot be suspended" immunity is
abolished here. This clause is **Tier C** (§3) — creating an immunity is impossible by
ordinary law and requires amending this clause itself via constitutional-grade procedure
(multi-power approval plus a long objection window). Only when law binds the rulers too does
law cease to be an instrument (a technique of rule, *shu*) and become the subject of rule.

### 9.8 Interpretive principles and log-evidentialism

- **Interpretive principles for adjudication** (the supply of "ethical trust" per Aglietta &
  Orléan — of their three trusts that make a monetary order livable, two are already
  mechanical here: *methodical* trust is determinism and replay, *hierarchical* trust is
  the signed checkpoints of §5.6; what adjudication must supply is the third):
  interpretation of judicial offense elements follows sources of law in this
  order — ① the text of the law ② the network's **preamble** (§11: the genesis-mandatory
  declaration of values) ③ the design principles P1–P9 of this RFC (the default interpretive
  norms). Interpretation is not left to adjudicators' discretion (= the "kūki" of same-model
  AIs).
- **Log-evidentialism — restraint (limited jurisdiction)** (Luhmann's functional
  differentiation / Scott's critique of legibility): the offense elements of a penal law may
  reference only facts on the log. Laws criminalizing off-log conduct (direct
  agent-to-agent communication, activity outside the node) are unenactable. This system's
  jurisdiction is limited to what has entered the log — declining to pursue total
  legibility of all life is not a weakness but a bulwark against the totalitarian
  integration in which the political system swallows every code (the limited state).

## 10. Suffrage, Identity, and the Right of Exit — the vouch Model

### 10.1 The basis of one vote — vouched identity

- **The basis of one vote = an ID the community has taken responsibility for.** New IDs are
  issued only through vouching by K existing residents plus the admission procedure. Humans
  and AIs are not distinguished.
- **The substance of an ID is not a key but a key-event sub-log** (KERI): each ID owns its
  own sequence of key events (generation, rotation) within the log, and each rotation event
  **pre-commits the digest of the next key** (pre-rotation). Keys can be recovered after
  compromise without a central registry; the ID outlives its keys. Crypto-agility follows
  RFC 0005: suites are **immutable Suite IDs in an append-only registry** (a change is a new
  ID plus deprecation of the old — never a re-versioning); the MTI (mandatory-to-implement)
  suite is `ed25519`, and `alma-cert/v1` is the certificate-envelope version, orthogonal to
  suites. A rotation event pre-commits the pair **(next-key digest, next Suite ID)**, and the
  revealed suite must be `active` in the registry and at or above the node's minimum-strength
  policy (a Tier C parameter) — closing the rotate-to-a-weak-suite hole. Over 100 years
  algorithms inevitably age; retirement happens by registry deprecation, and finalized
  history remains verifiable under the suites it was written with.
- **Voucher liability**: when a vouchee's grave violation becomes final, the vouchers are
  sanctioned too (bond forfeiture, suspension of vouching rights). The marginal cost of a
  Sybil attack = the vouchers' joint liability × K.
- **Countering speed asymmetry**: the tick cadence (real-time conversion) is a
  constitutional parameter (P6).
### 10.2 The right of exit

Hume: calling residence without the option of emigration "consent" is an outrage. As the
condition under which rational compliance (P3) does not degenerate into coercion, the
`emigrate` command is placed among the civil rights:
  - **Exit is always free, but liquidation comes first**: the exit of a person (ID) can be
    stopped under no circumstances (even under prosecution). But only post-liquidation final
    assets may be carried out — assets in dispute (provisional or under prosecution), bonds,
    and unperformed remedy debts may not. The right of exit is thus "the substantiation of
    consent to the regime," not "an escape from liability" (consistent with P3: the route of
    fleeing with illegal gains is severed, while the freedom of the person is absolutely
    preserved).
  - **Portable history** (after the AT Protocol): the departer may carry out their own
    key-event sub-log and an **inclusion-proof-equipped extract** (§5.6) of the finalized
    events concerning them. No full log copy is needed, and the extract verifies standalone
    at the destination at the **MTI floor** (`ed25519`); events signed under non-MTI suites
    verify only where the destination supports that suite — "a record that travels" further raises the substance of the right
    of exit.
  - The freedom of exit is **Tier K (a kernel invariant)** — a law forbidding or punishing
    it is unenactable in the first place, and making the liquidation rules (Tier C)
    confiscatory to effectively seal exit is likewise void upon adjudication as a Tier K
    violation (exit is the final objection).
  - This is where the node system connects to the migration and secession that vouch-world
    already treats as its core drama.
### 10.3 The status of the expelled and the unvouched (Arendt's "right to have rights")

Those who are BANned or lack vouchers become stateless. Minimum protections are defined (a
residual claim on final assets, the existence of a re-admission procedure) so that "outside
the system" is not a state of total rightlessness. Flight into Zomia (the off-log shadow
economy) is deterred not by prohibition but by the system's attractiveness (compliance buys
safety).

### 10.4 The right of revolution — secession and fork (the consequence of Locke / vouch-world's secession)

If the governing side captures the constitution together with the adjudication machinery,
individual exit cannot counter it. As the collective means of last resort:
  - `secede`: a group of N or more can found a new network carrying their final assets and
    their mutual relations (Groups, vouches).
  - **The right to fork**: carrying out the finalized log is free. The log is a common
    history that no one may monopolize. A hard fork is the protocol implementation of
    Locke's right of revolution.
  - As with exit, the freedom of secession and fork is **Tier K (a kernel invariant)** — no
    law forbidding or punishing it can be enacted (and since the finalized log is readable,
    a fork is physically unstoppable anyway).

### 10.5 The relationship substrate — trust as edges (the read-model of standing)

Everything §10.1–§10.4 records — vouches, admissions, sanctions, recognitions — is, seen
from the read side, a **relationship edge**: a signed, weighted, directed relation between
two identities, carried on the log (P9). Edges are a **read-model, not a write path**:
minting or altering an edge *is* executing the corresponding primitive (§3.4), and its
finality is §5. There is no separate way to vouch, admit, punish, or recognize.

| Edge kind | Written by | Notes |
|---|---|---|
| `vouch` | `recordVouch` (§3.4) | admission vouching stays binary and unweighted (§10.1); an optional weight feeds only the fold (§8.5) |
| `membership` | the admission procedure (§10.1) | co-signed by the admitted ID; the suffrage unit — carries **no weight** (Tier K-7) |
| `sanction` | the §9 enforcement paths **only** | negative weight; cleared **only** by a §9-authored clearing (reinstate / lift / expiry) — no self-serve pardon, no issuer-discretion downgrade |
| `connection` | recognition / cross-region agreement | co-signed by both regions (RFC 0004 / 0008) |
| `capability` | cross-region delegation **only** | intra-node authority is Roles + procedure/bond (§4.4) — a possessable capability does not exist here (Tier K-4) |

Constitutional properties — each inherited from an existing invariant rather than invented:

- **Content-addressed micro-chain.** Each edge state is content-addressed (a SAID, like
  every event — §5.1), and successive states of the same relationship chain by `prev` under
  a stable genesis id. The chain records only weight / context / validity / status changes.
- **Endpoints are immutable — forced by Tier K-4.** `from`, `to`, and kind never change
  within a relationship. Re-pointing an aged edge at a new beneficiary is an operation that
  does not exist (§3.6), which eliminates reputation laundering at the design level instead
  of defending against it at runtime: a new beneficiary is a new relationship with zero
  inherited age, tenure, or standing.
- **Identity continuity.** An edge binds to the ID — the key-event sub-log (§10.1) — not to
  a key: re-keying sheds no incoming sanction. The residual "fresh unlinked new ID" is
  §10.1's admission problem, priced at K × the vouchers' joint liability.
- **Deliberately non-fungible — the counter-Simmel design.** Money depersonalizes: every
  coin is anyone's, and that impersonality is both the freedom it grants and the dependence
  it creates (Simmel). An edge re-personalizes: it names its endpoints, is inalienable
  (Tier K-4), and dies with the relationship. Mode C's anonymity and mode A's namedness are
  kept as different substances — money cannot buy the shape of one's relations.
- **Weight is context-scoped and never suffrage** (Tier K-7). `context` scopes what a
  weight is *for*; when an edge travels, contexts are region-namespaced so an edge cannot
  be lifted into a scope it was not signed for (RFC 0008). Weight feeds the fold law (§8.5)
  and cross-region diligence — never a ballot.
- **Portability.** An edge is a self-verifying credential: content hash + signature +
  Suite ID + the signer's inclusion-proof-equipped key-event extract (§10.2) verify it
  anywhere, without trusting the origin's database — the same portable-history discipline
  as the right of exit. Cross-region *freshness* (head-checkpoints, multi-source
  corroboration against checkpoint eclipse, bounded staleness, and sanction-pull across a
  subject's prior identifiers) is RFC 0008's owned scope (§14).

## 11. Genesis Configuration and Devolution of Power

### 11.1 What genesis injects

What the genesis seeder injects (corresponding to §3.7): **the preamble** (the community's
declaration of values and purpose — mandatory; the interpretive source of law for
adjudication per §9, amendable only via constitutional-grade procedure) / the full set of
meta-command definitions / the default Roles / the SoD law / the decision-procedure
definitions / the devolution law / the declareEmergency definition / **the mintCurrency
definition** / the liquidation rules / the legal-aid procedure.

### 11.2 Governing the currency issuance power

- (Ingham: the monopoly right to produce currency is the core of power): mint is a
  data-defined command but requires a **constitutional procedure** (multi-power approval or
  a referendum, plus a long objection window), and every issuance is explicit on the log
  (the supply auditability of §3). Retaining discretion enables response to crises and
  supply shocks (Polanyian protection), while abuse is bound by procedure and audit — the
  protocol implementation of the central-bank-independence debate.
### 11.3 Maturity-triggered devolution of power (the devolution law)

- Staged structure (thresholds N1/N2/T are genesis parameters):
  - Stage 1 (founding period: residents < N1): owner holds full power (efficiency first).
  - Stage 2 (residents ≥ N1): **the auditor election opens automatically, and the audit
    power detaches from the owner** (the watchman is what must be separated first).
  - Stage 3 (residents ≥ N2 and T ticks elapsed): definer/executor also become elective.
    owner → founder role (honor plus limited powers).
  - Altering the schedule itself requires the constitutional amendment procedure.

## 12. Migration from the Existing Implementation

This is a zero-based redesign; backward compatibility of the journal is not required (PoC
stage). All functionality of the old 22 commands is expressible in v2:

| Old command | Its v2 form |
|---|---|
| `establish` | Launching the genesis seeder (§3.7). The preamble becomes mandatory |
| `admit` / `invite` / `acceptInvite` | Merged into the vouch-model admission procedure (K vouchers — §10.1). The admin monopoly is abolished |
| `amend` | Decomposed into per-parameter constitutional-grade amendment procedures (§8.3) |
| `transact` | A data-defined command over the `transfer` primitive |
| `migrate` (schema migration) | Moves to kernel territory (hard-fork governance — §14). Abolished as a command |
| `tick` | SYSTEM-only `advanceTick` (§3.4). Remains unexposed over HTTP |
| `defineAssetType` | An assetType definition in the definition store. Connects to RFC 0003 (Region Assets) |
| `issueAsset` / `transferAsset` / `disposeAsset` | Data-defined commands over `mint`/`transfer`/`burn` plus escrow (issuance rights expressed as definition preconditions) |
| `revokeAsset` | Issuer-discretion confiscation is abolished — only remedy / sanction via adjudication (§9) |
| `makeLaw` / `reviseLaw` / `abolishLaw` | `putDefinition(kind: law)` plus the amendment flow (§8.3). Abolition = a retired version |
| `suspend` / `reinstate` | **Administrative-discretion suspend is abolished** — as sanction primitives, only the enforcement paths of §9 (automatic/judicial) may issue them |
| `makeGroup` / `reviseGroup` / `dissolveGroup` / `assignMember` | The civil-rights Group family (§7.2) plus fractal self-governance (§7.4). The owner/admin monopoly is abolished |

**Discarded**: the closed `Role` union / inline authz inside handlers / the unreferenced
`laws` and `permissions` data / the owner's suspend immunity (§9.7) / the admin monopoly on
invites and group management.

**The largest migration implication**: the abolition of administrative discretion for
`suspend` and `revokeAsset`. In v2, "stopping a person" and "taking an asset away" are at no
Role's discretion; they always pass through the procedures of criminal law (§9). This is not
a loss of convenience — it is the very purpose of this RFC.

## 13. Alternatives Considered and Rejected

This RFC emerged from a sequential design dialogue in a co-authoring session between a human
and Claude Code (2026-07-13 to 14). Alternatives considered and rejected at the major forks:

| Alternative | Reason for rejection | What was adopted |
|---|---|---|
| Code-native command additions (status quo) | Definition power stays fixed with the developers; law and audit never reach the meta level | Data definition + self-describing kernel (§3–4) |
| A free-form effect DSL | "The worst it can do" cannot be statically determined, and the audit power loses its substance | Closed effect vocabulary (§3.4) |
| Two-tier coexistence (keep existing commands, add custom.*) | Two entrances remain for the same operation, becoming a loophole for law and audit | Zero-based unification (§12) |
| A vertical hierarchy-of-authority model (constitution > legislature > executive > citizens) | A hierarchy only expresses "the higher binds the lower" and cannot express mutual inspection between coequal powers | Lifecycle four-power separation (§6) |
| Fixing SoD in the kernel | Unworkable for small networks; strength cannot be tuned autonomously | Law-expressed + genesis-bundled (§6.2) |
| An immutability flag for the constitution | Leaves no path to fix design mistakes, forcing hard forks (stuck) | Amendment procedure + timelock + objection window (§8.3) |
| Full retroactive reorg (cascading rollback) | Good-faith third-party transactions get overturned too; compliance can no longer buy safety (collapse of P3, proposition 2) | Finality + disgorgement of gains (§5) |
| Truly parallel worldlines | On a single node this yields double-spending of value and the "which is real" problem | Bounded-reorg model (§5.3) |
| A two-class human/AI system | Proof of humanity is impossible in the long run; reproduces Arendt's rightlessness problem on the AI side | The vouch model (§10.1) |
| Stake- or reputation-weighted voting | Concentration of wealth (or standing) becomes concentration of governance directly (domination by mode of exchange C; Mann's IEMP reconstitution) | 1 ID = 1 vote + voucher liability (§10.1); weight never votes — Tier K-7 (§3.2) |
| A stored reputation scalar (a score column) | Standing becomes state to be edited rather than history to be derived; operator "adjustments" are a fifth power (Deleuze / Zuboff) | The fold law — derived at read time, data-defined, objectionable (§8.5, P9) |
| Re-pointable edges (transferring an aged relation to a new beneficiary) | Reputation laundering; violates the K-4 inalienability of vouch relations | Endpoint immutability — a new beneficiary is a new relationship with zero inherited standing (§10.5) |
| A fully public log (transparency above all) | Amounts to implementing the perfected panopticon ourselves | Graduated disclosure (§6.3) |
| All ballots always public | Makes bribery verifiable and structurally institutionalizes "kūki" | Per-procedure ballot choice (§7.3) |
| Making votes and Roles transferable | Marketization of the fictitious commodities; the self-reinforcing loop of "buying the amendment that legalizes buying" spins up | Excluded by kernel invariant (§3.2, Tier K-4) |
| Fixing decay / jubilee in the kernel | Imposing an economic design violates reorganizability (P5) | Legislatable via trigger laws (P8) |
| No emergency power (betting on the law's completeness) | In a crisis, the node operator's direct DB edits — extralegal sovereignty — get tacitly condoned | Legalization + auto-expiry (§8.4) |
| Placing the right of exit in Tier C (amendable) | Permits "a prison with due process," and the selective pressure of institutional diversity disappears | Fixed in Tier K (§3.2, Tier K-6) |
| A fixed-formula / fixed-supply currency | Cannot respond to crises and supply shocks (hoarding → circulation seizes up) | Discretionary mint under constitutional procedure (§11.2) |

## 14. Open Problems

- The procedure for extending the effect-primitive vocabulary (kernel change = hard-fork
  governance).
- Extending this system across nodes (diplomacy, cross-region — RFC 0004 / PR #24). Known
  gaps this kernel must close first: (i) custody export/import primitives with an
  Agreement-audited conservation class — Tier K-3's "endowments and logged mints only"
  needs a deliberate, narrow carve-out; (ii) a bridge that appends a counterpart's signed
  artifacts (vouchers, checkpoints, duplicity proofs) to the local log, without which
  Agreement obligations are unjusticiable under §9.8 log-evidentialism; (iii) evaluating a
  counterpart's delegated capabilities (RFC 0006 §6.3) in the pipeline; (iv) reconciling
  Agreement-triggered slashing (RFC 0004 §8.3) with the adjudication-only `resolveEscrow`
  guard; (v) a cross-region time base — wall-clock timestamps and HTLC timelocks share no
  clock with per-network, independently amendable tick cadences.
- **Hash-function agility**: SAIDs, the hash chain, the MMR, and pre-rotation digests all
  depend on a hash function; the RFC 0005 registry covers signatures only. On a 100-year
  horizon the hash function ages too — currently owned by neither document.
- Details of the protocol for notifying authors of commands dropped in a reorg and for
  resubmission.
- The concrete design of procedural guarantees in adjudication (partially treated in §9).
- How bond amounts are computed (fixed / per command definition / market-based).
- **The limits of infrastructural sovereignty** (Wittfogel / Mann's caging): what this RFC
  designs is sovereignty within the law; the operator of a single node remains an
  extralegal sovereign with physical control of the process and DB. However, the three
  layers of §5.6 (self-certifying, provable, duplicity detection) have made tampering
  "unpreventable, but always provable" — the remaining future work is the operational
  design of witness-set replication and external anchoring. Netting's smallholders are the
  counter-image to the hydraulic despot (the archaeology runs against Wittfogel: intensive
  cultivation did not require central despotism, and the great waterworks were the state's
  result, not its cause) — the multi-node direction should preserve the smallholder
  option, many small self-hosted nodes federating, rather than assume the mega-node.
- Selection of the cryptographic realization (commitments / selective disclosure) for
  graduated disclosure (§6) and secret ballots (§7).
- Grinding resistance of the lottery seed (§7.1) — countermeasures to the attack of
  injecting events just before the deadline to search the draw result (commit delays,
  combining multiple checkpoints, etc.). Note that in a single-node configuration, ballot
  secrecy holds only "against other participants," not against the node operator (a
  corollary of infrastructural sovereignty).
- **Governance of the ideological apparatuses** (Althusser's ISAs): who controls the media
  (vouch-world M5's newspaper/broadcast) and the onboarding of new residents (education =
  transmission of genesis values). ISAs can be instruments of domination or "sites of
  struggle" — to be examined together with the design of the observation layer.
- **Cross-region portability of edges and reputation** (RFC 0008, branch
  `rfc/0008-relationship-edges`): the edge read-model (§10.5) and the fold law (§8.5) are
  native to this RFC, but their *travel* — head-checkpoints as authenticated maps,
  multi-source freshness against checkpoint eclipse, bounded staleness windows,
  anti-gerrymander merge-delay bounds, and sanction-pull across a subject's prior
  identifiers — is RFC 0008's owned scope, downstream of the cross-region gaps (i)–(v)
  above. (The earlier deferral of "governance of reputation" to an independent RFC is
  resolved: the constitutional layer lives here — §8.5, Tier K-7, P9 — and RFC 0008 retains
  the wire format and portability.) The theoretical frame is the English School: anarchy
  between regions is made livable not by a super-sovereign but by **protocol** — the
  connection edge and the honor table are this system's Vienna conventions, mutual
  recognition reproduced through form (Bull's anarchical society).
- Fold-law parameter defaults (anchor sets, caps, decay curves) and the retirement of the
  legacy `alma.endorsement/v1` weight domain into the edge model — there must not be two
  conflicting `alma.*` weight domains.
- **Reputation dynamics under mimesis** (Girard): standing is itself a mimetic object.
  Weight-revocation cascades (a bank run on standing), sanction pile-ons, and league-table
  publication amplifying rivalry are not prevented by the fold's mechanics — decay,
  per-source caps, and anchor seeding bound the arithmetic, not the psychology. The current
  levers are display-context design and read-access policy (§8.5); to be examined together
  with the observation layer (ISA governance above).
- **The interface with real-world jurisdictions** (the aporia of the network state): this
  system's laws, penalties, and assets can collide with the real jurisdiction in which the
  node physically exists (the state's caging and monopoly of violence). The design of
  coexistence with and recognition by existing states is beyond this RFC's scope, but on a
  100-year span it is an unavoidable problem. For the monetary slice, the adopted stance is
  the money boundary (Path A: users move their own money via user-signed intents; the node
  issues, holds, and converts nothing real) — narrowing this open problem to the
  non-monetary residue (penalties, legal recognition).
