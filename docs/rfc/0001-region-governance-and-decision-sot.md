# RFC 0001 — Region governance & decision source-of-truth

- **Status:** Draft (for discussion)
- **Scope:** Layer 2 (Region) governance — the *procedure* that defines what counts as a
  binding decision, and the cross-region authority it exposes to Layer 4 diplomacy.
- **Non-goals:** how emergent outcomes are *observed* (see RFC 0002, measurement-only),
  and participation channels such as Voice (a separate design). This is a design
  discussion; nothing lands until agreed.

## 1. Context — what `main` already has

Region institutions already carry governance as data
(`vouch-world/src/region/types.ts`):

- `Governance = { kind: "dictatorship" } | { kind: "council"; members; threshold }`.
- `RegionState.owner: string | null` — the principal (an ID) that governs;
  `canGovern(region, principal)` resolves to the owner (dictatorship) or any listed
  member (council).
- Amendment path: `amendInstitution(env, regionId, change, by)` is owner-scoped; council
  regions are rejected and must use `openProposal` / `castVote` (resolves at `threshold`)
  — the collective path.
- Ownership is transferable and regions are never deleted: `transferRegionOwnership`,
  `listRegion`, `setRegionLifecycle` (market; `active | dormant`).
- Economy/resource are owner-set policy data (`EconomyPolicy`, `ResourcePolicy`).
- Cross-region surface (Layer 4): `recognizeRegion`, `assessCertificate`,
  `canTransactAcross`.

So two governance presets (autocracy, M-of-N council) and representative transfer
already exist. This RFC builds on that; it does **not** replace `Governance` with a
general engine.

## 2. Guiding principle — separate the constitutive procedure from the emergent outcome

Keep two things apart and never conflate them:

- **Procedure (source-of-truth).** The constitutive rule: *what counts as a binding
  decision* — who may propose, who may participate, how votes weigh, how an outcome
  resolves, the quorum. This is structural; it changes only through its own amendment
  rule. It is *set*.
- **Outcome (emergent).** *What* gets decided, and the regime that results — trust /
  legitimacy, a hawkish vs. dovish stance, prosperity, a "growth" vs. "cult" trajectory.
  These are *measured*, never set.

**Decision test:** if another region or the engine must rely on X to judge whether an act
is *binding / legitimate*, X is procedure (set it here). If X only describes the regime
that emerges, it is an outcome (measure it; see RFC 0002).

Two corollaries that anchor the whole design:

- The knobs a founder sets are **presets / affordances** — a skill catalog. Maximize
  freedom here; offer opinionated presets plus tunable parameters.
- The regime that results is **measured, never configured**. Configuring it would defeat
  the project goal of observing governance conflict as an emergent result. RFC 0002 is
  therefore measurement-only, and the *independent variables* of an experiment are the
  presets/affordances below (swept across runs) — there is no separate control layer.

## 3. Observed gaps (relative to `main`)

1. **Takeover by a thin / fresh electorate.** A council that resolves on a raw
   `threshold` count is vulnerable right after founding (e.g. two members admitted, then
   a 2-of-3 passes) and to flash-immigration. There is no quorum, no voter tenure, and no
   founding-maturity gate.
2. **Participation eligibility is implicit.** Participation today is "owner or listed
   council member". There is no explicit notion of *citizenship* vs. *residence*; an ID's
   home is encoded in `name@region`, but `immigrate` moves `AgentState.region`, blurring
   "who may take part".
3. **Representative authority for cross-region acts is under-specified.** Diplomacy needs
   other regions to verify "this act came from region X's legitimate authority". Today
   that authority is `owner`, but the binding/attestation model for cross-region acts
   (recognition, future treaties) is not stated.
4. **No weighting.** Council is an unweighted member count; reputation/stake-weighted
   forms are not expressible.

## 4. Proposal (build on `main`, additive — everything here is a preset/affordance the founder sets)

- **Keep the preset catalog; do not generalize into an open engine.** `dictatorship` and
  `council` stay as curated forms; new forms are added as named presets, not by exposing a
  fully open rule-DSL to founders. (Rationale: an open mechanism maximizes expressivity
  but is unusable, and per Arrow there is no single "correct" aggregation rule — a menu of
  known-tradeoff presets is better.)

- **Harden the collective path with per-region *tunable* guards** (data on the form /
  institutions), so they can be swept as experiment parameters:
  - `quorum`: minimum participation (count or fraction of eligible) for a resolution to
    bind.
  - voter `tenure`: an ID may participate only after holding citizenship/membership for
    ≥ K (measured by log `seq`, not wall-clock).
  - founding `maturity`: a region cannot pass binding governance amendments until it has
    ≥ N eligible members.
  - All three must fold deterministically from the log — no clock; any randomness via the
    engine RNG only.
  - **Important separation.** Sybil resistance rests on **citizenship / one-person-one-ID**
    (proof-of-personhood), which blocks fake IDs *without* slowing genuine newcomers.
    `tenure` / `maturity` are **not** Sybil tools — they are the *incumbent-vs-insurgent*
    (revolution-speed) axis, left tunable on purpose so that "how easily a fresh majority
    can overturn incumbents" is itself observable, not a baked-in default.

- **Make eligibility explicit and citizenship-based by default.** Participation =
  citizenship (the ID's home region), not current residence. **Naturalization** (granting
  newcomers political rights) is a **planned tunable, default off** — not a permanent
  exclusion. Keeping it tunable preserves the bottom-up-legitimacy / revolution-by-
  newcomers regime as something the simulation can express and observe.

- **Add vote weighting as a regime variable.** `equal | reputation | stake` as form data
  (`main`'s council is equal-weight today). Weighting is a legitimacy-source axis
  (democracy / meritocracy / plutocracy) and stays a regime variable; Sybil is handled by
  citizenship, not by forbidding weighting.

- **Model representative authority as a role pointer, not a shared key.** The region's
  representative is the current `owner` ID, which signs cross-region acts with *its own*
  key; other regions verify "signer == the region's current representative-of-record".
  Transferring representation updates the pointer via the existing ownership/governance
  path (`transferRegionOwnership`) — no region-wide secret is ever handed over. This
  matches the Trust Core (no key directory; each ID signs with its own key).

- **Electing / replacing the representative reuses the decision path.** It is a governance
  decision whose action transfers `owner`; no separate election subsystem is introduced.

## 5. Open questions — proposed answers (from the project goal)

- **Weighting vs Sybil.** Do not fix to equal-only. Weighting is an observable regime
  axis; Sybil is handled by citizenship / one-person-one-ID.
- **Action scope.** The constitutional boundary equals what we call procedure (SoT):
  policy (e.g. fee rates) is owner-set; procedure amendment, representative change, and
  recognition are collective.
- **Self-amendment / entrenchment.** Do **not** globally forbid or mandate it.
  Entrenchment is a **per-region optional clause, default off** — so both self-coup-able
  regions (a legal "enabling act" path into autocracy) and constitutionally-entrenched
  regions are observable. Self-coup is handled by observation + logging, not prohibition.
- **Quorum denominator.** Pin the eligible base by `seq`-based tenure
  (citizenship × tenure = "eligible as of which `seq`"), so admission timing cannot game
  the denominator.

## 6. Out of scope / deferred (marked, not solved)

- **Observation of the emergent regime** (trust, stance, growth-vs-cult, prosperity)
  → RFC 0002 (measurement-only).
- **Voice and other participation channels** (dissent paths for the governed who are not
  deciders) → separate design.
- Indirect / representative office layer (elected officers with terms; multi-stage
  elections).
- Naturalization *mechanics* (the eligibility switch is in §4; the detailed process is
  deferred).
- Rollback / impeachment / recovery from a rogue owner (a one-way door is accepted for
  now).
- Recognition / authority revocation propagation across regions (past acts stand; new
  acts are re-checked).

## 7. Relation to the earlier general-mechanism proposal

An earlier branch proposed a fully general, slot-decomposed decision mechanism (proposal
/ eligibility / weighting / selection / veto / appeal / emergency over a shared
predicate). Given `main` already ships the `dictatorship` / `council` forms and an
owner-scoped amendment path, the recommendation is to **not** pursue the general engine
(it duplicates the shipped forms and over-generalizes), and to address the targeted gaps
in §3–§4 instead. The shared-predicate idea survives only in the small, focused form of
the explicit eligibility / quorum guards above.
