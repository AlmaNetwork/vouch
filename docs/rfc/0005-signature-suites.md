# RFC 0005 — Signature Suites & Negotiation

- **Status:** Draft
- **Layer:** ALMA protocol candidate (reinforces lightpaper §3.4 / §3.6); drafted as a vouch RFC
- **Date:** 2026-07-05
- **Requires:** RFC 0004 (defines the Connection Agreement this RFC populates)
- **Requirements language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.

## 1. Motivation

ALMA fixes no single signature scheme, and must not. Different ecosystems bind identity and
value to different formats: W3C Verifiable Credentials favour Ed25519 and BBS+ (the latter for
selective disclosure); crypto-asset systems require secp256k1/ECDSA for wallet and chain
interoperability; regulated deployments may require RSA or NIST curves; and migration to
post-quantum schemes (ML-DSA) is inevitable. A protocol hard-wired to one scheme excludes every
constituency that needs another, and cannot evolve without a breaking change.

This document specifies cryptographic agility: a registry of named suites, per-region
advertisement, a negotiation that binds a region pair to an agreed set, per-message
identification, and the verification rules that make agility safe against downgrade and
algorithm-confusion attacks.

## 2. Terminology

- **Signature Suite** — a fully specified set of cryptographic choices sufficient to produce and
  verify one signature: algorithm, curve/parameters, public-key encoding, signature encoding,
  the canonicalization that fixes the exact bytes signed, and class (single/threshold).
  Identified by a **Suite ID**.
- **MTI suite** — the Mandatory-To-Implement suite every conforming region MUST verify.
- **Minimum-strength policy** — a region's floor on the `securityLevel` (§4) it will accept.
- **agreedSuites** — the ordered Suite ID set bound to a Connection Agreement (RFC 0004 §4).

## 3. Signature Suites

A suite MUST fully determine verification: same Suite ID + key + message + signature ⇒ same
accept/reject decision for any implementation. It MUST specify (1) algorithm and parameters;
(2) public-key encoding; (3) signature encoding; (4) the **canonicalization** (deterministic
message→octet-string; a suite MUST NOT leave this implementation-defined — that admits
malleability); (5) class `single` | `threshold`.

**Suite ID grammar** (ABNF):

```
suite-id = lower *( lower / DIGIT / "-" )
lower    = %x61-7A
```

A Suite ID is registry-assigned, lowercase, and immutable once assigned; any change to (1)–(5)
is published as a NEW Suite ID. A key pair MUST be bound to exactly one Suite ID; the same key
material MUST NOT be reused under two suites.

## 4. The Signature Suite Registry

An append-only table; each entry: `suite-id`, `name`, `reference`, `class`, `securityLevel`
(classical-equivalent strength in bits; `(PQ)` marks post-quantum resistance), `status`
(`active` | `deprecated`). `securityLevel` is what the minimum-strength policy (§6) checks.

Rules: an `active` entry MUST NOT be modified or removed; it MAY move to `deprecated`; a
deprecated suite MUST NOT be selected in a new negotiation and SHOULD be phased out at renewal;
new suites are appended.

Seed registry (all listed; a region implements only what it advertises):

| suite-id | name | class | securityLevel | status |
|----------|------|-------|---------------|--------|
| `ed25519` | EdDSA over Curve25519 (RFC 8032) | single | 128-bit | active (**MTI**) |
| `ecdsa-secp256k1` | ECDSA over secp256k1 | single | 128-bit | active |
| `ecdsa-p256` | ECDSA over NIST P-256 | single | 128-bit | active |
| `ecdsa-p384` | ECDSA over NIST P-384 | single | 192-bit | active |
| `ed448` | EdDSA over Curve448 (RFC 8032) | single | 224-bit | active |
| `rsa-pss-sha256` | RSASSA-PSS SHA-256 (key ≥3072-bit) | single | 128-bit | active |
| `bbs-2023` | BBS+ over BLS12-381 (selective disclosure) | single | 128-bit | active |
| `bls-12381` | BLS signatures over BLS12-381 (aggregatable) | single | 128-bit | active |
| `sm2` | SM2 (GB/T 32918) | single | 128-bit | active |
| `frost-ed25519` | FROST threshold Ed25519 | threshold | 128-bit | active |
| `ml-dsa-65` | ML-DSA (FIPS 204) | single | NIST-L3 `(PQ)` | active |
| `slh-dsa-128s` | SLH-DSA (FIPS 205) | single | NIST-L1 `(PQ)` | active |
| `falcon-512` | FN-DSA / Falcon | single | NIST-L1 `(PQ)` | active |

## 5. Capability Advertisement

A region MUST expose, in its region metadata (RFC 0004 §5.1), an ordered
`signatureSuites` list — the suites it can VERIFY, most-preferred first — and it MUST include
the MTI suite. It MAY expose `signingSuites` when the set it produces differs.

## 6. Negotiation

Each region MUST define a minimum-strength policy. When two regions establish a Connection
(RFC 0004 §5.3), they bind `agreedSuites`:

```
candidate = intersection( initiator.signatureSuites, responder.signatureSuites )
candidate = MUST exclude any suite below either region's minimum-strength policy
candidate = MUST exclude any 'deprecated' suite
```

6.1. The responder MUST select `agreedSuites` as a non-empty, preference-ordered subset of
`candidate`. If `candidate` is empty, the parties MUST fall back to the MTI suite — unless a
region's policy excludes the MTI, in which case negotiation MUST fail and no Connection forms.

6.2. **Bootstrap suite.** `agreedSuites` is not in force until the Agreement carrying it is
signed. Therefore the region signatures that ESTABLISH the Connection Agreement (RFC 0004 §4.2)
MUST be produced with the MTI suite (which every region is guaranteed to verify). Once signed,
subsequent messages use any member of `agreedSuites` (§7).

6.3. `agreedSuites` MUST be covered by both regions' signatures over the Agreement (defeats
downgrade). The Connection MUST be re-negotiated at renewal, and whenever a member of
`agreedSuites` becomes `deprecated`.

## 7. Per-message Suite Binding

Every signed cross-region message (e.g. the RFC 0004 TransferVoucher) MUST carry
`suite : Suite ID`. A verifier:

1. MUST reject the message if `suite ∉ agreedSuites` (outside a Connection, if it is not in the
   verifier's policy allow-list) — **before** any cryptographic verification;
2. MUST verify using exactly the algorithm/encodings/canonicalization the Registry binds to that
   Suite ID;
3. MUST NOT infer the algorithm from key material or any field other than `suite`;
4. MUST reject a message that omits `suite`.

## 8. Security Considerations

- **Weakest-suite dominance.** A message signed under ANY member of `agreedSuites` is accepted
  (§7); the Connection's effective security equals the WEAKEST agreed suite. Downgrade protection
  (§6.3) stops an attacker from introducing a suite, but not two honest regions from agreeing a
  weak one — the minimum-strength policy is the sole control. Mixing a PQ and a non-PQ suite
  yields non-PQ security; a region requiring post-quantum security MUST exclude all non-PQ suites.
- **Algorithm confusion.** §7 forecloses `alg=none` / RS256-vs-HS256-style attacks: the accepted
  suite is constrained to the agreed set and verification is driven by the Registry binding.
- **Deprecation.** A broken suite is marked `deprecated` and propagated over the RFC 0004 §9
  gossip channel; peers MUST stop selecting it and re-negotiate affected connections.
- **Threshold internalization.** A `threshold` suite yields a signature verifiable under a single
  group public key; a peer negotiates and verifies only the group's suite, never the internal
  `(t, n)`.
- **Canonicalization & key–suite binding.** Canonicalization is part of the suite (§3), closing
  malleability; a key belongs to one suite and MUST NOT be verified under another.

## 9. Conformance

A conforming region MUST: verify the MTI suite `ed25519`; advertise `signatureSuites` including
the MTI (§5); define and enforce a minimum-strength policy; run the §6 negotiation and bind
`agreedSuites` into the co-signed Connection Agreement; establish that Agreement with MTI
signatures (§6.2); attach `suite` to every signed message and enforce §7. It MAY support any
additional registered suites.

## 10. Open Questions

1. Confirm MTI = `ed25519`.
2. Default responder preference metric (`securityLevel` descending?).
3. Whether `bbs-2023` belongs to a recommended baseline set or is purely opt-in.
4. Registry governance: who may append an entry, and the `securityLevel` assignment criteria
   (especially for PQ).

## 11. Relationship to RFC 0004 and vouch

- RFC 0004 defines the Connection Agreement; this RFC owns its `agreedSuites` field and the
  `suite` tag on RFC 0004 messages, and reuses the RFC 0004 §9 gossip channel for deprecation.
- In vouch, signing is implicitly `ed25519` and the MCP verifier pins EdDSA. Adopting this RFC
  generalizes the single pin to an **agreed-set pin** (§7), adds a `suite` field to the signing
  envelope, and adds `signatureSuites` / `agreedSuites` to region metadata and the Connection
  Agreement. The existing behaviour is the conformant default (MTI-only).
