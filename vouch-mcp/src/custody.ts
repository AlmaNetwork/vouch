// The custodial signer.
//
// vouch's write path is NON-custodial by design: authority = possession of an
// Ed25519 private key the client holds, and the node only verifies signatures. An
// MCP participant, though, is an AI that has been authenticated by OAuth — it does
// not hold a vouch key. So this module bridges the two: it deterministically
// DERIVES a per-subject Ed25519 key from one server master secret, and signs vouch
// commands on the authenticated subject's behalf.
//
// This makes the server a signing ORACLE, which is a real posture change, so it is
// tightly bounded (see SECURITY in the README):
//   1. the principal is ALWAYS derived server-side from the token's verified
//      (iss, sub) — NEVER taken from the request body — so a token for subject A
//      can never sign as subject B;
//   2. the token's scope must authorize the specific command (scope → command gate)
//      before anything is signed;
//   3. the derived seed / private key live only for the duration of one signature
//      and are zeroed immediately after;
//   4. every attempt is written to an append-only audit log.
//
// Key derivation binds BOTH iss and sub (so two IdPs cannot collide onto one vouch
// identity) and is versioned (`/v1`) so the scheme can be rotated deliberately.

import { createHash, hkdfSync } from "node:crypto";
import { ED25519_SUITE, encodeBase64, type KeyPair, keyPairFromSeed } from "vouch-core";
import { commandBytes, registerBytes, type SubmitResult, type VouchNode } from "vouch-node";
import { type AuditSink, commandHash } from "./audit";
import { commandAllowed } from "./scopes";

/** The authenticated OAuth subject — the identity a token proves. */
export interface Subject {
  readonly iss: string;
  readonly sub: string;
  /** The verified token's JWT id, threaded into the audit log for per-token attribution. */
  readonly jti?: string | null;
}

export type SignOutcome =
  | { readonly kind: "signed"; readonly principal: string; readonly result: SubmitResult }
  | { readonly kind: "scope-denied"; readonly principal: string; readonly needed: string };

export class Custody {
  constructor(
    private readonly master: Uint8Array,
    private readonly salt: Uint8Array,
    private readonly node: VouchNode,
    private readonly audit: AuditSink,
  ) {}

  /**
   * The subject's stable slug — a valid vouch NAME (`[A-Za-z][A-Za-z0-9]*`), opaque,
   * deterministic, and bound to BOTH iss and sub. It doubles as the subject's
   * account/owner principal (for found/admit), and — suffixed with `@<region>` —
   * as their resident agent id in a region (for transfer/vouch). Callers must derive
   * this only here, NEVER from a request body (that would let one token act as
   * another). Hex keeps it inside the identifier grammar; the `u` makes it start with
   * a letter as the grammar requires. The FULL digest is used (not a truncation): the
   * principal is identity-bearing and first-writer-wins on the node, so it must carry
   * sha256's full collision resistance to rule out a collision hard-locking a subject.
   */
  principalFor(s: Subject): string {
    const hex = createHash("sha256").update(`vouch-mcp-principal/v1\n${s.iss}\n${s.sub}`).digest("hex");
    return `u${hex}`;
  }

  /** HKDF-derive the subject's 32-byte Ed25519 seed. The caller must zero it after use. */
  private deriveSeed(s: Subject): Uint8Array {
    const info = new TextEncoder().encode(`vouch-ed25519/v1|iss=${s.iss}|sub=${s.sub}`);
    // hkdfSync returns an ArrayBuffer; wrap it as a mutable byte view so it can be zeroed.
    return new Uint8Array(hkdfSync("sha256", this.master, this.salt, info, 32));
  }

  /** Zero a derived keypair's private material as soon as we are done signing with it. */
  private static wipe(seed: Uint8Array, kp: KeyPair): void {
    seed.fill(0);
    kp.privateKey.fill(0);
  }

  /**
   * Bind the subject's derived public key to its principal on the node, once. The
   * registration is self-signed at nonce 0 — exactly what a non-custodial client
   * would send — so the node's first-writer-wins rule makes this principal
   * controllable only by whoever can reproduce this key (i.e. this server, for this
   * verified subject). A no-op if already registered.
   */
  private ensureRegistered(principal: string, s: Subject): void {
    if (this.node.nonceOf(principal) !== null) return;
    const seed = this.deriveSeed(s);
    const kp = keyPairFromSeed(seed);
    const publicKey = encodeBase64(kp.publicKey);
    // finally: guarantee the private key is zeroed even if signing throws (defence in
    // depth for a future non-canonicalizable command), honouring the "keys live for
    // one signature" guarantee on the exceptional path too.
    let signature: string;
    try {
      signature = encodeBase64(ED25519_SUITE.sign(registerBytes(principal, 0, publicKey), kp.privateKey));
    } finally {
      Custody.wipe(seed, kp);
    }
    const res = this.node.register({ principal, publicKey, nonce: 0, signature });
    if (!res.ok && res.reason !== "already-registered") {
      throw new Error(`custody: registration failed for ${principal}: ${res.reason}`);
    }
  }

  /**
   * Scope-gate, sign, and submit a command AS `actingPrincipal`, using the subject's
   * derived key. `actingPrincipal` is the subject's own slug (for owner actions like
   * found/admit) or `slug@region` (for resident actions like transfer/vouch) — the
   * caller derives it from the verified subject, never from a request body, so a
   * token can only ever act as one of its own identities. The nonce is read from the
   * node (the single source of truth) so it is always strictly increasing, even
   * across a restart. Fully synchronous end-to-end, so two concurrent tool calls can
   * never interleave onto the same nonce.
   */
  signAndSubmit(
    s: Subject,
    actingPrincipal: string,
    requestId: string,
    scope: readonly string[],
    commandKind: string,
    command: unknown,
  ): SignOutcome {
    const cmdHash = commandHash(command);

    const gate = commandAllowed(scope, commandKind);
    if (!gate.ok) {
      this.audit.append({
        requestId,
        ts: Date.now(),
        iss: s.iss,
        sub: s.sub,
        principal: actingPrincipal,
        nonce: -1,
        scope,
        jti: s.jti ?? null,
        commandKind,
        commandHash: cmdHash,
        outcome: "scope-denied",
        reason: `needs ${gate.needed}`,
      });
      return { kind: "scope-denied", principal: actingPrincipal, needed: gate.needed };
    }

    this.ensureRegistered(actingPrincipal, s);
    const nonce = (this.node.nonceOf(actingPrincipal) ?? 0) + 1;

    const seed = this.deriveSeed(s);
    const kp = keyPairFromSeed(seed);
    let signature: string;
    try {
      signature = encodeBase64(ED25519_SUITE.sign(commandBytes(actingPrincipal, nonce, command), kp.privateKey));
    } finally {
      Custody.wipe(seed, kp);
    }

    const result = this.node.submit({ principal: actingPrincipal, nonce, command, signature });
    this.audit.append({
      requestId,
      ts: Date.now(),
      iss: s.iss,
      sub: s.sub,
      principal: actingPrincipal,
      nonce,
      scope,
      jti: s.jti ?? null,
      commandKind,
      commandHash: cmdHash,
      outcome: result.ok ? "accepted" : "rejected",
      reason: result.ok ? null : result.reason,
    });
    return { kind: "signed", principal: actingPrincipal, result };
  }
}
