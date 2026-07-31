// Layer 1 Trust Core — signature-suite registry.
//
// The envelope carries a `suite` field (§4) so the byte format can grow later
// (CBOR, other curves, BBS+ ...) WITHOUT rebuilding the envelope. Signing and
// verifying dispatch through a registered suite. Today only "ed25519" is
// registered; an unknown suite is an explicit failure (§M0).

import { ed25519 } from "@noble/curves/ed25519";

export interface SignatureSuite {
  readonly id: string;
  sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
}

const registry = new Map<string, SignatureSuite>();

export function registerSuite(suite: SignatureSuite): void {
  registry.set(suite.id, suite);
}

export function getSuite(id: string): SignatureSuite | undefined {
  return registry.get(id);
}

export function listSuites(): string[] {
  return [...registry.keys()];
}

export const ED25519_SUITE: SignatureSuite = {
  id: "ed25519",
  sign(message, privateKey) {
    return ed25519.sign(message, privateKey);
  },
  verify(message, signature, publicKey) {
    try {
      return ed25519.verify(signature, message, publicKey);
    } catch {
      // Malformed signature/key bytes verify as `false` rather than throwing.
      return false;
    }
  },
};

registerSuite(ED25519_SUITE);

// --- RFC 0005 §4: the Signature Suite Registry (metadata) -----------------
//
// This is the DOCUMENTED registry — the append-only table of every named suite, its class,
// strength, and status — used by the minimum-strength policy and negotiation (RFC 0005 §6).
// It is DISTINCT from the executable registry above: only `ed25519` has a real sign/verify
// implementation today; the rest are metadata-only entries a region MAY advertise once it
// implements them. `securityBits` is the classical-equivalent strength (RFC 0005 §4); `pq`
// marks the post-quantum suites the table flags with "(PQ)". NIST PQ levels are mapped to
// their classical-equivalent floors (L1 -> 128, L3 -> 192, L5 -> 256).

/** The Mandatory-To-Implement suite every conforming region MUST verify (RFC 0005 §4/§6). */
export const MTI_SUITE_ID = ED25519_SUITE.id;

export type SuiteClass = "single" | "threshold";
export type SuiteStatus = "active" | "deprecated";

export interface SuiteMeta {
  readonly id: string;
  readonly name: string;
  readonly reference: string;
  readonly class: SuiteClass;
  readonly securityBits: number; // classical-equivalent strength (RFC 0005 §4)
  readonly pq: boolean; // post-quantum resistant ("(PQ)" in the RFC table)
  readonly status: SuiteStatus;
}

/** Suite ID grammar (RFC 0005 §3): `lower *( lower / DIGIT / "-" )`. */
const SUITE_ID_RE = /^[a-z][a-z0-9-]*$/;

export function isValidSuiteId(id: unknown): id is string {
  return typeof id === "string" && SUITE_ID_RE.test(id);
}

// Seed registry (RFC 0005 §4). Append-only: an `active` entry is never modified or removed,
// only moved to `deprecated`; new suites are appended.
const SUITE_META_ENTRIES: SuiteMeta[] = [
  { id: "ed25519", name: "EdDSA over Curve25519", reference: "RFC 8032", class: "single", securityBits: 128, pq: false, status: "active" },
  {
    id: "ecdsa-secp256k1",
    name: "ECDSA over secp256k1",
    reference: "SEC 2",
    class: "single",
    securityBits: 128,
    pq: false,
    status: "active",
  },
  {
    id: "ecdsa-p256",
    name: "ECDSA over NIST P-256",
    reference: "FIPS 186-4",
    class: "single",
    securityBits: 128,
    pq: false,
    status: "active",
  },
  {
    id: "ecdsa-p384",
    name: "ECDSA over NIST P-384",
    reference: "FIPS 186-4",
    class: "single",
    securityBits: 192,
    pq: false,
    status: "active",
  },
  { id: "ed448", name: "EdDSA over Curve448", reference: "RFC 8032", class: "single", securityBits: 224, pq: false, status: "active" },
  {
    id: "rsa-pss-sha256",
    name: "RSASSA-PSS SHA-256 (key >= 3072-bit)",
    reference: "RFC 8017",
    class: "single",
    securityBits: 128,
    pq: false,
    status: "active",
  },
  {
    id: "bbs-2023",
    name: "BBS+ over BLS12-381 (selective disclosure)",
    reference: "draft-irtf-cfrg-bbs-signatures",
    class: "single",
    securityBits: 128,
    pq: false,
    status: "active",
  },
  {
    id: "bls-12381",
    name: "BLS signatures over BLS12-381 (aggregatable)",
    reference: "draft-irtf-cfrg-bls-signature",
    class: "single",
    securityBits: 128,
    pq: false,
    status: "active",
  },
  { id: "sm2", name: "SM2", reference: "GB/T 32918", class: "single", securityBits: 128, pq: false, status: "active" },
  {
    id: "frost-ed25519",
    name: "FROST threshold Ed25519",
    reference: "RFC 9591",
    class: "threshold",
    securityBits: 128,
    pq: false,
    status: "active",
  },
  { id: "ml-dsa-65", name: "ML-DSA (NIST-L3)", reference: "FIPS 204", class: "single", securityBits: 192, pq: true, status: "active" },
  { id: "slh-dsa-128s", name: "SLH-DSA (NIST-L1)", reference: "FIPS 205", class: "single", securityBits: 128, pq: true, status: "active" },
  {
    id: "falcon-512",
    name: "FN-DSA / Falcon (NIST-L1)",
    reference: "FIPS 206 (draft)",
    class: "single",
    securityBits: 128,
    pq: true,
    status: "active",
  },
];

// Append-only AND immutable at runtime: RFC 0005 §4 "an active entry MUST NOT be modified" made a
// runtime fact (deep-frozen, like the events/state elsewhere) so a consumer cannot corrupt the table.
const SUITE_META: readonly SuiteMeta[] = Object.freeze(SUITE_META_ENTRIES.map((m) => Object.freeze(m)));

const suiteMetaById = new Map<string, SuiteMeta>(SUITE_META.map((m) => [m.id, m]));

/** The registry metadata for `id`, or `undefined` if `id` is not a registered suite. */
export function getSuiteMeta(id: string): SuiteMeta | undefined {
  return suiteMetaById.get(id);
}

/** The full registry, in append order. */
export function listSuiteMeta(): SuiteMeta[] {
  return [...SUITE_META];
}

/** The registered suites that are still selectable (not `deprecated`), in append order. */
export function activeSuiteIds(): string[] {
  return SUITE_META.filter((m) => m.status === "active").map((m) => m.id);
}
