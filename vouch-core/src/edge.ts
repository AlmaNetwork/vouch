// Layer 1 Trust Core — the relationship-edge envelope (RFC 0008 §4): build + verify.
//
// An edge is a signed, weighted, directed relationship — the wire form of RFC 0007
// §10.5's read-model. Mirroring the Certificate (certificate.ts), the core does exactly
// two things:
//   1. issueEdge  — stamp a signed core and sign it with the `from` key.
//   2. verifyEdge — check the envelope's SHAPE and the `from` SIGNATURE only.
//
// The signed core is every field EXCEPT `signature`/`cosign`/`anchor` (§4.1), JCS-
// canonicalized (RFC 8785). `edgeId = sha256_hex(canonicalBytes(core))` is a SAID-class
// content address; the `from` signature is Ed25519 over the same bytes.
//
// Scope of this module = RFC 0008 §4 (wire format) + §5 (per-edge micro-chain). The §5
// transition-continuity rules (prev/genesis/counter, endpoint immutability) are checked by
// verifyTransition / verifyChain — structure only; each state's own signature is verifyEdge's
// job. It does NOT yet verify §4.6 per-kind co-signatures (membership/connection): a `cosign`
// map is carried on the wire as a detached attachment, but verifyEdge checks only the `from`
// signature. §4.6 cosign is a separate follow-up. See RFC 0008 §5 / §4.6.

import { createHash } from "node:crypto";
import { z } from "zod";
import { decodeBase64, encodeBase64 } from "./encoding";
import { isValidIdentifier, isValidRegion } from "./identifier";
import { canonicalBytes } from "./jcs";
import { getSuite } from "./suite";

export const EDGE_VERSION = "alma-edge/v1";
const DEFAULT_SUITE = "ed25519";

export const EDGE_KINDS = ["vouch", "membership", "connection", "capability", "sanction"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type EdgeStatus = "active" | "revoked";

/**
 * The signed, hashed field set (§4.1): every field EXCEPT `signature`/`cosign`/`anchor`.
 * Every field is REQUIRED and present — an omitted key vs. an explicit `null` changes the
 * canonical bytes, so the nullable fields (`genesis`/`command`/`expiry`/`prev`/`parent`)
 * carry an explicit `null` when inapplicable (§4.1 determinism).
 */
export interface EdgeCore {
  readonly version: string; // "alma-edge/v1"
  readonly suite: string; // signature suite id — RFC 0005; MTI "ed25519"
  readonly schemaId: string; // per-kind dotted schema, e.g. "alma.vouch/v1" (§10.2)
  readonly kind: EdgeKind;
  readonly genesis: string | null; // genesisId of this relationship; null at the genesis state (§5.1)
  readonly from: string; // source endpoint (§4.3) — the signer
  readonly to: string; // target endpoint — immutable within a relationship (§5.3)
  readonly context: string; // region-namespaced scope, e.g. "nova:merchant" (§4.4)
  readonly command: string | null; // cross-region capability only (§4.7); null otherwise
  readonly weightBp: number; // SIGNED INTEGER basis points, [-10000, 10000] (§4.4)
  readonly validFrom: number; // region-local node-log seq (§4.5)
  readonly expiry: number | null; // region-local seq, or null (§4.4/§4.5)
  readonly prev: string | null; // edgeId of the previous state of this edge; null at genesis (§5)
  readonly counter: number; // monotonic per-edge state counter; 0 at genesis (§5.2)
  readonly parent: string | null; // cross-region capability attenuation parent (§10.6); null otherwise
  readonly status: EdgeStatus; // "active" | "revoked" (§5.4)
}

/** A signed edge: the core plus the detached `from` signature (and optional co-signatures). */
export interface Edge extends EdgeCore {
  readonly signature: string; // base64 Ed25519 by `from` over canonicalBytes(core)
  // §4.6 co-signatures (membership/connection), keyed by co-signer identifier. Carried on the
  // wire as a detached attachment; NOT covered by `from`'s signature or `edgeId`, and NOT yet
  // verified here — that check lands with §4.6.
  readonly cosign?: Readonly<Record<string, string>>;
}

export interface IssueEdgeInput {
  readonly schemaId: string;
  readonly kind: EdgeKind;
  readonly from: string;
  readonly to: string;
  readonly context: string;
  readonly weightBp: number;
  readonly validFrom: number;
  readonly suite?: string;
  readonly genesis?: string | null;
  readonly command?: string | null;
  readonly expiry?: number | null;
  readonly prev?: string | null;
  readonly counter?: number;
  readonly parent?: string | null;
  readonly status?: EdgeStatus;
}

export type EdgeVerificationFailureReason =
  | "malformed-envelope"
  | "invalid-from"
  | "invalid-to"
  | "unknown-suite"
  | "invalid-signature-encoding"
  | "bad-signature";

export type EdgeVerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: EdgeVerificationFailureReason; readonly detail: string };

// --- validators ----------------------------------------------------------

/** An endpoint (§4.3) is an agent `name@region` OR a bare region id `[a-z0-9]+`. */
export function isValidEndpoint(s: unknown): s is string {
  return typeof s === "string" && (isValidIdentifier(s) || isValidRegion(s));
}

const endpointSchema = z.string().refine(isValidEndpoint, "must be a name@region identifier or a bare region id");
const hashRefSchema = z.string().min(1).nullable(); // genesis / prev / parent / command
const weightBpSchema = z.number().int().min(-10000).max(10000);
const seqSchema = z.number().int().min(0);

const coreShape = {
  version: z.literal(EDGE_VERSION),
  suite: z.string().min(1),
  schemaId: z.string().min(1),
  kind: z.enum(EDGE_KINDS),
  genesis: hashRefSchema,
  from: endpointSchema,
  to: endpointSchema,
  context: z.string().min(1),
  command: hashRefSchema,
  weightBp: weightBpSchema,
  validFrom: seqSchema,
  expiry: seqSchema.nullable(),
  prev: hashRefSchema,
  counter: seqSchema,
  parent: hashRefSchema,
  status: z.enum(["active", "revoked"]),
} as const;

const edgeSchema = z.object({
  ...coreShape,
  signature: z.string(),
  cosign: z.record(z.string(), z.string()).optional(),
});

const issueInputSchema = z.object({
  schemaId: z.string().min(1),
  kind: z.enum(EDGE_KINDS),
  from: endpointSchema,
  to: endpointSchema,
  context: z.string().min(1),
  weightBp: weightBpSchema,
  validFrom: seqSchema,
  suite: z.string().min(1).optional(),
  genesis: hashRefSchema.optional(),
  command: hashRefSchema.optional(),
  expiry: seqSchema.nullable().optional(),
  prev: hashRefSchema.optional(),
  counter: seqSchema.optional(),
  parent: hashRefSchema.optional(),
  status: z.enum(["active", "revoked"]).optional(),
});

function fail(reason: EdgeVerificationFailureReason, detail: string): EdgeVerificationResult {
  return { ok: false, reason, detail };
}

// --- signing payload / content address -----------------------------------

/**
 * The exact unsigned byte payload that gets signed and verified: the signed core — every
 * field EXCEPT `signature`/`cosign`/`anchor` — JCS-canonicalized. Because JCS sorts keys,
 * the bytes are independent of field order. Every co-signer (§4.6) signs these same bytes.
 */
export function edgeSigningBytes(core: EdgeCore): Uint8Array {
  return canonicalBytes({
    version: core.version,
    suite: core.suite,
    schemaId: core.schemaId,
    kind: core.kind,
    genesis: core.genesis,
    from: core.from,
    to: core.to,
    context: core.context,
    command: core.command,
    weightBp: core.weightBp,
    validFrom: core.validFrom,
    expiry: core.expiry,
    prev: core.prev,
    counter: core.counter,
    parent: core.parent,
    status: core.status,
  });
}

/** The content address of an edge STATE: `sha256_hex(canonicalBytes(core))` (§4.1). */
export function edgeId(core: EdgeCore): string {
  return createHash("sha256").update(edgeSigningBytes(core)).digest("hex");
}

// --- issue ---------------------------------------------------------------

export function issueEdge(input: IssueEdgeInput, fromPrivateKey: Uint8Array): Edge {
  const parsed = issueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `alma-core: invalid edge input — ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
    );
  }
  const d = parsed.data;
  const suiteId = d.suite ?? DEFAULT_SUITE;
  const suite = getSuite(suiteId);
  if (!suite) {
    throw new Error(`alma-core: unknown signature suite "${suiteId}"`);
  }

  const core: EdgeCore = {
    version: EDGE_VERSION,
    suite: suiteId,
    schemaId: d.schemaId,
    kind: d.kind,
    genesis: d.genesis ?? null,
    from: d.from,
    to: d.to,
    context: d.context,
    command: d.command ?? null,
    weightBp: d.weightBp,
    validFrom: d.validFrom,
    expiry: d.expiry ?? null,
    prev: d.prev ?? null,
    counter: d.counter ?? 0,
    parent: d.parent ?? null,
    status: d.status ?? "active",
  };
  const signature = encodeBase64(suite.sign(edgeSigningBytes(core), fromPrivateKey));
  return { ...core, signature };
}

// --- verify --------------------------------------------------------------

/**
 * Verify the envelope SHAPE and the `from` SIGNATURE over the core (§4.1). The §5 micro-chain
 * transition rules are checked separately by verifyTransition / verifyChain. Per RFC 0008 §4.6,
 * `membership`/`connection` additionally require a valid counterparty co-signature; that check
 * is a separate follow-up and is NOT performed here.
 */
export function verifyEdge(edge: unknown, fromPublicKey: Uint8Array): EdgeVerificationResult {
  const parsed = edgeSchema.safeParse(edge);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const head = issue?.path[0];
    if (head === "from") return fail("invalid-from", issue?.message ?? "invalid from endpoint");
    if (head === "to") return fail("invalid-to", issue?.message ?? "invalid to endpoint");
    const where = issue ? `${issue.path.join(".") || "<root>"}: ${issue.message}` : "invalid edge envelope";
    return fail("malformed-envelope", where);
  }
  const e = parsed.data;

  const suite = getSuite(e.suite);
  if (!suite) {
    return fail("unknown-suite", `signature suite "${e.suite}" is not registered`);
  }

  let signature: Uint8Array;
  try {
    signature = decodeBase64(e.signature);
  } catch (err) {
    return fail("invalid-signature-encoding", err instanceof Error ? err.message : String(err));
  }

  if (!suite.verify(edgeSigningBytes(e), signature, fromPublicKey)) {
    return fail("bad-signature", "signature does not verify against the provided `from` public key");
  }
  return { ok: true };
}

// --- §5 micro-chain ------------------------------------------------------

export type EdgeTransitionFailureReason =
  | "not-a-transition"
  | "endpoint-changed"
  | "counter-not-incremented"
  | "prev-mismatch"
  | "genesis-mismatch";

export type EdgeTransitionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: EdgeTransitionFailureReason; readonly detail: string };

/** True iff `core` is a genesis state: `counter` 0, no `prev`, no `genesis` pointer (§5.1). */
export function isGenesisState(core: EdgeCore): boolean {
  return core.counter === 0 && core.prev === null && core.genesis === null;
}

/**
 * The stable name of the relationship `core` belongs to (§5.1): the `edgeId` of its genesis
 * state. For a genesis state that is its own `edgeId`; for a later state it is the carried
 * `genesis` pointer.
 */
export function genesisId(core: EdgeCore): string {
  return core.genesis ?? edgeId(core);
}

/**
 * Verify a single §5 micro-chain transition `prev -> next` — STRUCTURAL continuity only; each
 * state's own signature is verifyEdge's job. Enforces (§5.1–§5.3): the endpoints
 * `(from, to, kind)` stay fixed (§5.3 endpoint immutability), `counter` increments by exactly
 * 1, `next.prev == edgeId(prev)`, and `next.genesis` is the relationship's genesisId. The
 * §5.4 rule that only an RFC 0007 §9-authored head may clear/lower a `sanction` is a penal-
 * authority policy, not a structural edge rule, and is out of scope here.
 */
export function verifyTransition(prev: EdgeCore, next: EdgeCore): EdgeTransitionResult {
  if (next.from !== prev.from || next.to !== prev.to || next.kind !== prev.kind) {
    return {
      ok: false,
      reason: "endpoint-changed",
      detail: "(from, to, kind) MUST stay fixed within a micro-chain (§5.3)",
    };
  }
  if (isGenesisState(next)) {
    return { ok: false, reason: "not-a-transition", detail: "next is a genesis state (counter 0 / null prev / null genesis)" };
  }
  if (next.counter !== prev.counter + 1) {
    return { ok: false, reason: "counter-not-incremented", detail: `counter must be ${prev.counter + 1}, got ${next.counter}` };
  }
  if (next.prev !== edgeId(prev)) {
    return { ok: false, reason: "prev-mismatch", detail: "next.prev MUST equal edgeId(prev) (§5.1)" };
  }
  if (next.genesis !== genesisId(prev)) {
    return { ok: false, reason: "genesis-mismatch", detail: "next.genesis MUST equal the relationship genesisId (§5.1)" };
  }
  return { ok: true };
}

/**
 * Verify an ordered micro-chain `[genesis, ...states]` end to end (§5): the first state is a
 * genesis state, and every consecutive pair is a valid transition. Because `counter` is strictly
 * `+1` each link, a lower-`counter` state can never re-attach — anti-rollback (§5.2). Returns
 * the first failure.
 */
export function verifyChain(states: readonly EdgeCore[]): EdgeTransitionResult {
  const first = states[0];
  if (!first) {
    return { ok: false, reason: "not-a-transition", detail: "empty chain" };
  }
  if (!isGenesisState(first)) {
    return { ok: false, reason: "not-a-transition", detail: "a chain MUST start at a genesis state (§5.1)" };
  }
  let prev = first;
  for (let i = 1; i < states.length; i++) {
    const next = states[i];
    if (!next) break;
    const res = verifyTransition(prev, next);
    if (!res.ok) return res;
    prev = next;
  }
  return { ok: true };
}
