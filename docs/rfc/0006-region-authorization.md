# RFC 0006 — Region Authorization & Capability Delegation

- **Status:** Draft
- **Layer:** ALMA protocol candidate (extends the Connection Agreement of RFC 0004; refines
  lightpaper §3.7.1 Roles / §3.7.4 Authority Management); drafted as a vouch RFC
- **Date:** 2026-07-05
- **Requires:** RFC 0004 (Cross-region Due Diligence & Value Transfer), RFC 0005 (Signature
  Suites & Negotiation)
- **Related:** RFC 0001 (region governance), RFC 0003 (Region Assets — holdings as standing)
- **Requirements language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.

## 1. Summary

This document specifies how a region authorizes cross-region acts, and how asymmetric or
subordinate relationships between regions are expressed. The protocol imposes a single
invariant — a cross-region act is valid iff it carries a valid **region signature** — and leaves
**who, internally, may cause that signature** entirely to each region's own,
disclosed-but-unenforced, authorization policy. Bounded authority (including toward a
counterpart region) is delegated with **capabilities**, and asymmetric terms are carried
explicitly in the Connection Agreement (RFC 0004 §4).

## 2. Terminology

- **Region signature** — a signature verifiable under a region's region key using an
  RFC 0005-agreed suite. It is the region's authoritative "voice."
- **Authorization policy** — a region's internal, region-defined rule determining whether it
  emits a region signature for a given command.
- **Capability** — a signed grant authorizing its holder to cause a specific, bounded action.
- **Attenuation** — narrowing a capability when re-delegating it (never broadening).
- **Obligation** — a covenant a region commits to maintain for a connection's duration.

## 3. The authorization invariant

3.1. A cross-region act attributed to region A MUST carry a valid region signature of A (§2).

3.2. A counterpart MUST authorize the act solely by verifying that region signature. It MUST NOT
require, inspect, or enforce A's internal mechanism for producing it. (Due diligence may
*assess and price* A's governance — RFC 0004 §5.2, §6 — but never enforces it.)

3.3. How A produces its region signature — a single key, a threshold of nodes, a governance
vote, the exercise of a capability, or any composition — is internal to A and outside protocol
scope.

3.4. At the protocol boundary, "authorization" reduces to region-signature validity. There is no
protocol-level notion of *who* authorized an act, only *that the region did*.

## 4. Authorization policy as data

4.1. A region MUST maintain an **authorization policy**: for each command-kind, a predicate over
presented proofs that determines whether the region emits its region signature.

4.2. The policy MAY be any predicate, from "any registered member's signature suffices" to a
weighted, quorum-based, time-locked, or holding-conditioned rule. Named templates
(`single-authority`, `threshold-council`, `open`, `delegated`) SHOULD be provided; a region MAY
use an arbitrary predicate.

4.3. A region MUST disclose, in its region metadata (RFC 0004 §5.1), enough of its authorization
policy for a counterpart to assess governance risk during due diligence. The policy is
region-sovereign; no other region enforces it (§3.2).

4.4. A permissive policy (e.g. `open`) is valid; the protocol MUST NOT forbid it. Its risk is
borne by the region and priced by counterparts (§8).

## 5. Capabilities

5.1. A **capability** carries: `issuer`, `holder` (or `bearer`), the authorized command scope,
attenuation constraints (limits, allow-lists, conditions), `expiry`, a revocation reference, and
a signature.

5.2. A capability MUST be **bounded** (authorizes only its scope), **attenuable** (a holder MAY
re-delegate a *narrower* capability, and MUST NOT delegate a broader one), **revocable**, and
**expirable**.

5.3. A capability MUST NOT authorize more than its issuer holds. A delegation chain MUST be
verifiable end to end, each link a subset of its parent; a verifier MUST reject any link that
widens its parent (no privilege escalation).

5.4. Exercising a valid, in-scope, unexpired, unrevoked capability contributes to satisfying the
region's authorization predicate (§4) for the scoped command.

## 6. Cross-region capability delegation

6.1. Region A MAY grant region B a capability over a bounded set of A's actions (e.g. veto of
A's transfers above an amount; required co-signature on A's new connections).

6.2. Such a grant MUST be recorded in the Connection Agreement's `delegated` field (RFC 0004 §4,
§7); it MUST NOT exist as an out-of-band understanding.

6.3. B exercises the capability by presenting it with B's region signature. A's nodes MUST verify
the capability's issuer, scope, chain, non-expiry, and non-revocation before honoring it.

6.4. A MUST retain the ability to revoke the grant subject to the Agreement's terms; revocation
MUST propagate over the RFC 0004 §9 gossip channel.

6.5. A region MUST NOT delegate its raw region signing key (nor a share of it — RFC 0004 §5.4);
only scoped, attenuated capabilities may be delegated (§9).

## 7. Asymmetric Connection Agreements

7.1. The Connection Agreement (RFC 0004 §4) is not symmetric. Its `honor` field is expressed per
direction; the two directions MAY differ in `schemas` (and `mode`) and in `assets` (and `cap`).
Asymmetry is structural — there is no symmetric/asymmetric flag.

7.2. The `obligations` field carries covenants. An obligation MUST name the obligated region, the
covenant (e.g. maintain a stated KYC level; do not connect to a named region; post and maintain
a bond), and a monitoring method. A provable breach is a defined revocation and/or slashing
trigger — the monitoring/slashing primitive of RFC 0004 §8, with revocation per RFC 0004 §9.

7.3. The `delegated` field (§6) carries delegated capabilities.

7.4. The relationship spectrum — symmetric peer ⊆ asymmetric terms ⊆ conditional recognition
(obligations) ⊆ subordination (delegated capabilities that give one region control over the
other) — is expressed entirely by these fields. A region MAY sign anywhere on this spectrum; that
choice is its sovereignty.

## 8. Emergence and legibility

8.1. All asymmetry — every `obligation` and every `delegated` capability — MUST be represented in
the co-signed Connection Agreement (RFC 0004 §4.2). It MUST NOT be a side-channel arrangement.

8.2. Relative power between regions is not a protocol primitive. It emerges from each region's
standing (RFC 0003 holdings and received vouches) and its alternatives. The protocol neither
creates nor prevents subordination; it records and exposes it.

8.3. (Informative.) Because §8.1 makes obligations and delegations legible, a counterpart doing
due diligence can read and price them. A region MAY instead adopt an opaque or highly fluid
authorization policy; it should expect counterparts to assess it as higher-risk and set lower
exposure caps. Flexibility and legibility trade off; each region chooses its point.

## 9. Security Considerations

- **Raw-key delegation is prohibited (§6.5).** The region signing key is unbounded authority;
  only bounded, attenuated capabilities may be handed out. Attestation secrets exchanged at
  connection time (RFC 0004 §5.4) are dedicated and are NOT signing-key shares.
- **Privilege escalation.** Delegation MUST be monotonically narrowing (§5.3); verifiers MUST
  reject a widening link.
- **Capability leakage / confused deputy.** A capability SHOULD be bound to a holder rather than
  bearer; it MUST be attenuated and expirable so a leaked capability's damage is bounded.
- **Over-delegation / subordination.** A capability granted to B is real power inside A; the
  Agreement MUST bound what any single delegation can do, and A MUST be able to revoke it.
- **Revocation freshness.** Exercised capabilities MUST be checked against current revocation
  state; stale-acceptance windows MUST be bounded.

## 10. Conformance

A conforming region MUST: authorize a counterpart's act solely by verifying its region signature
(§3); maintain and disclose an authorization policy (§4); issue, verify, attenuate, and revoke
capabilities per §5; represent every obligation and delegated capability in the co-signed
Connection Agreement (§7, §8.1); and never delegate its raw region signing key (§6.5).

## 11. Non-goals

- No particular authorization policy, role set, or separation of powers is prescribed; those are
  region-defined templates.
- Intra-region ordering/consensus (how a region reaches its own decision to sign) is out of
  scope (RFC 0004 §3).

## 12. Open Questions

1. Capability encoding: adopt an existing format (UCAN / macaroons / biscuit) or define a
   minimal ALMA capability object?
2. Permit `bearer` capabilities at all, or holder-bound only?
3. Minimum monitoring guarantees before an obligation breach may trigger slashing.
4. Whether subordination beyond a threshold (e.g. governance-level co-signature) MUST itself be
   ratified by a region's strongest authority template.

## 13. Mapping to vouch

- vouch's `canGovern` predicate (dictatorship → owner; council → threshold) is already a
  per-region authorization predicate; this RFC generalizes it to a per-command, arbitrary
  policy-as-data (§4).
- A region "speaks with one voice" via its existing env-authored / region-key signing path —
  that is the region signature of §2.
- Capabilities are attenuated signed grants recorded in region state; delegation to a
  counterpart is recorded in the Connection Agreement (§6, §7).
- RFC 0003 holdings and received vouches supply the **weight** an authorization predicate may
  consume (§4.2, §8.2), unifying governance power with standing.

## Appendix A — Worked examples (informative)

### A.1 The common case: two peers connect by council vote

Both regions authorize the `connect` command with a 2-of-3 council:

```jsonc
{ "connect": { "kind": "threshold", "role": "council", "n": 2 } }
```

Inside `nova` — its own business; `delta` never sees this:

```jsonc
// nova's council votes; 2 "yes" >= 2 -> nova emits its region signature
{ "proposal": "connect delta", "votes": ["alice: yes", "bob: yes"], "result": "passed" }
```

The Connection Agreement (RFC 0004 §4) they both sign — symmetric, nothing owed either way:

```jsonc
{
  "regions": ["nova", "delta"],
  "agreedSuites": ["ed25519"],
  "honor": {
    "nova->delta": { "assets": [{ "assetId": "delta.coin", "cap": 1000000 }] },
    "delta->nova": { "assets": [{ "assetId": "nova.coin",  "cap": 1000000 }] }
  },
  "obligations": [],
  "delegated":   [],
  "signatures": { "nova": "<by nova's council>", "delta": "<by delta's council>" }
}
```

To ratify, each side checks **only** the other's region signature — never the other's votes:

```ts
assert(verifyRegionSig(agreement.signatures["delta"], "delta")); // §3: that is all
```

### A.2 (Advanced) An unequal connection — one region concedes

Same shape as A.1; the asymmetry is just the fields that were empty now being filled. Here
`nova` concedes to `delta`: it posts a bond and grants `delta` a veto over its large transfers.

```jsonc
{
  "regions": ["nova", "delta"],
  "agreedSuites": ["ed25519"],
  "honor": {
    "nova->delta": { "assets": [{ "assetId": "delta.coin", "cap": 10000000 }] },
    "delta->nova": { "assets": [{ "assetId": "nova.coin",  "cap": 500000 }] }
  },
  "obligations": [
    { "on": "nova", "covenant": "bond", "asset": "delta.coin", "amount": 200000, "slashableBy": "delta" }
  ],
  "delegated": [
    { "id": "cap1", "issuer": "nova", "holder": "delta",
      "command": "transfer.veto", "scope": "nova transfers over 1000000" }
  ],
  "signatures": { "nova": "...", "delta": "..." }
}
```

Because the `obligations` and `delegated` entries are all on `nova`, any third region reading
this agreement can see that `nova` is subordinate to `delta` (§8). The peer case A.1 is simply
this agreement with `obligations` and `delegated` empty and `honor` mirrored.
