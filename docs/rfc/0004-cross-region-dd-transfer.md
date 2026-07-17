# RFC 0004 — Cross-region Due Diligence & Value Transfer

- **Status:** Draft
- **Layer:** ALMA protocol candidate (reinforces lightpaper §3.8 interoperability); drafted as a vouch RFC
- **Date:** 2026-07-05
- **Related:** RFC 0005 (Signature Suites & Negotiation), RFC 0006 (Region Authorization & Capability Delegation), RFC 0003 (Region Assets)
- **Requirements language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.

## 1. Summary

This document specifies how two regions that do not fully trust each other establish a
connection through due diligence, and how they then move value across it without a global
ledger. It defines the **Connection Agreement** — the canonical, co-signed record of a
connection, shared and extended by RFC 0005 (which adds the negotiated signature suites) and
RFC 0006 (which adds authorization, obligations, and delegated capabilities) — and a
double-spend-safe cross-region transfer protocol.

## 2. Motivation

ALMA has no global consensus by design, yet the lightpaper (§3.8) asserts that assets are
"freely traded among the regions" without specifying any message flow, commit/abort, ordering,
or settlement. This RFC supplies that protocol, and the graded, bounded trust relationship it
operates within.

## 3. Prerequisite: intra-region total order

This RFC assumes each region can agree with itself on the order and outcome of its own writes.
A region MUST provide such a total order over its own state (in vouch this is the hash-chained,
replay-on-boot journal). How a region achieves it is out of scope. This RFC operates one layer
above it.

## 4. The Connection Agreement (canonical schema)

The Connection Agreement is the single, canonical record of a connection. It is **defined
here** and **extended** by RFC 0005 (`agreedSuites`) and RFC 0006 (`obligations`, `delegated`,
and the per-direction meaning of `honor`). All three RFCs, and all examples, MUST use these
field names.

```jsonc
{
  "regions": ["<regionId>", "<regionId>"],      // the two parties
  "agreedSuites": ["<SuiteID>"],                 // negotiated signature suites — RFC 0005
  "honor": {                                     // per-direction; one entry per ordered pair
    "<from>-><to>": {
      "schemas": [{ "schemaId": "<id>", "mode": "absorb|map|reexamine|reject" }],
      "assets":  [{ "assetId": "<id>", "cap": 0 }]   // cap = max inbound exposure toward <to>
    }
  },
  "obligations": [],                             // covenants — RFC 0006 §7; [] if none
  "delegated":   [],                             // delegated capabilities — RFC 0006 §6; [] if none
  "validFrom": "<timestamp>",
  "expiry":    "<timestamp>",
  "attestationCommit": "<hash>",                 // §5.4 — commitment to exchanged attestation secrets
  "signatures": { "<regionId>": "<region signature>" }   // both parties — RFC 0006 §3
}
```

4.1. `honor` MUST be expressed per direction; a symmetric connection simply carries mirrored
entries. There is no separate "symmetric/asymmetric" flag — asymmetry is structural (see
RFC 0006 §7).

4.2. A Connection Agreement MUST be signed by both regions (`signatures`), and the signatures
MUST cover the entire Agreement, including `agreedSuites` (RFC 0005 §6) and every `obligation`
and `delegated` entry (RFC 0006 §8.1).

## 5. Due-diligence handshake

A connection is established through the ordered phases:

```
Authenticate → Diligence → Negotiate → Commit → Operate → Monitor → Revoke
```

5.1. **Authenticate.** Each region has a stable region key. A MUST verify B's region key
out of band (against B's published genesis) before trusting any B-signed material, to defeat
region impersonation and man-in-the-middle. Each side retrieves the other's region metadata,
including its `signatureSuites` (RFC 0005 §5) and its disclosed authorization policy
(RFC 0006 §4.3).

5.2. **Diligence.** Each side gathers and assesses the evidence of §6. Diligence **assesses and
prices** the counterpart's governance and history; it MUST NOT attempt to enforce the
counterpart's internal rules (RFC 0006 §3.2).

5.3. **Negotiate.** The parties agree the Connection Agreement of §4: the per-direction `honor`
terms and exposure caps, `agreedSuites` (RFC 0005 §6), any `obligations` and `delegated`
capabilities (RFC 0006), and `expiry`. The result is a draft, not yet binding.

5.4. **Commit.** The parties exchange **attestation secrets** and record their commitment in
`attestationCommit`. These attestation secrets are dedicated to expressing mutual commitment;
a region MUST NOT exchange a share of its region signing key (RFC 0006 §6.5). Each region then
authorizes and produces its region signature over the Agreement (RFC 0006 §3), which becomes
live once both signatures are present.

5.5. **Operate.** Cross-region transfers (§7) proceed within the Agreement's caps and terms.

5.6. **Monitor.** See §8.

5.7. **Revoke.** See §9.

## 6. Diligence evidence

A region SHOULD assess, and weight into the exposure caps it offers, at least:

- **Governance** — who governs the counterpart, whether its state can be unilaterally
  rewritten, and its disclosed authorization policy (RFC 0006 §4).
- **Provenance** — age, member base, and the integrity of the counterpart's append-only
  history.
- **References** — queries to other connected regions, **weighted by the querier's own trust in
  the referrer and discounted for correlated (potentially Sybil-ring) references**.
- **Asset semantics** — how the counterpart's honored assets are issued and whether their
  supply is bounded (an unbounded-issuance asset MUST NOT be honored without a cap).
- **Operational** — node count/diversity, liveness, incident history.
- **Compliance** — where real-world value is involved, the counterpart's KYC/AML posture.

## 7. Cross-region transfer protocol

7.1. **Custody invariant.** A unit of an asset is in exactly one region's custody at a time. A
transfer moves custody atomically; it MUST NOT create custody in the receiver without removing
it from the sender.

7.2. **Protocol.** Each side maintains per-transfer state `PENDING → COMMITTED | ABORTED`.

```
A: LOCK(assetId, amount, nonce)                       ; A records nonce as consumed
   → TransferVoucher{ assetId, amount, nonce, to, expiry, suite, sig } to B
B: verify voucher (sig valid under A's region key and agreed suite — RFC 0005 §7;
   within the Agreement's cap; nonce unused) → CREDIT + ack
A: on ack → COMMIT (release lock; custody transferred)
A: on timeout → ABORT (roll back lock)
B: MUST reject any second voucher bearing the same (assetId, nonce)   ; double-spend guard
```

7.3. Every signed message (including the TransferVoucher) MUST carry a `suite` field and be
verified per RFC 0005 §7.

7.4. **Finality** is graded by stakes and MUST be stated per connection:
- low value — a notary/attestation signature suffices;
- high value — a threshold signature across both regions' nodes, or an HTLC (hashlock +
  timelock: both regions lock on one hash `H`, preimage reveal claims both sides, timeout
  refunds);
- where real settlement is involved — anchor finality on an external settlement chain (out of
  scope; see the money boundary).

## 8. Exposure, progressive trust, monitoring & slashing

8.1. Transfers MUST stay within the Agreement's per-direction `cap`, bounding the blast radius
of a misbehaving counterpart.

8.2. **Progressive trust.** Initial caps SHOULD be small and MAY grow as honored volume and
elapsed time accumulate, subject to an upper bound. This bootstraps new connections while
limiting long-con exposure.

8.3. **Monitoring & slashing (primitive).** For each `obligation` (RFC 0006 §7) and for any
posted bond, the Agreement names a monitoring method. A **provable breach** of an obligation, or
a provable protocol violation, is a defined trigger that MAY (per the Agreement) revoke the
connection and/or **slash** a posted bond. This section is the monitoring/slashing primitive
that RFC 0006 obligations reference.

## 9. Revocation & the gossip channel

9.1. A region MAY revoke a connection (or downgrade its terms) subject to the Agreement. On
revocation, the region MUST quarantine the counterpart's outstanding honored assets/certs per
the Agreement: `COMMITTED` transfers are irreversible; `PENDING` ones are aborted.

9.2. **Gossip channel.** Revocations, connection downgrades, suite deprecations (RFC 0005 §8),
and capability revocations (RFC 0006 §6.4) are propagated to connected regions over a gossip
channel (an algorithm/relationship revocation list). A region SHOULD act on received
revocations promptly. This channel is **defined here** and referenced by RFC 0005 and RFC 0006.

## 10. Security Considerations

- **Double spend.** Prevented by the custody invariant (§7.1) and single-use nonce (§7.2),
  since there is no global ledger.
- **Impersonation / MITM.** Prevented by out-of-band region-key verification (§5.1).
- **Reference poisoning / Sybil rings.** Mitigated by trust-weighted, correlation-discounted
  references (§6) and by exposure caps + progressive trust (§8).
- **Unbounded-asset honoring.** Refused without a cap (§6).

## 11. Non-goals

- Real-money settlement (this stays in-world / federated; see the money boundary).
- The concrete signature/threshold scheme (RFC 0005) and the internal authorization mechanism
  (RFC 0006).

## 12. Open Questions

1. Gossip propagation model: pull-with-TTL vs push.
2. Default finality tier per exposure band.
3. The progressive-trust growth function.

## 13. Mapping to vouch

- The diplomacy layer (`assessCertificate` absorb/map/reexamine/reject, `canTransactAcross`,
  the region stance table, `recognized`/`unrecognized`) is the seed of `honor` and the
  connection lifecycle.
- The intra-region total order (§3) is the existing hash-chained journal + deterministic replay.
- Region-authored (SYSTEM_ACTOR) events carry connection commits and revocations.
