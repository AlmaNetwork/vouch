// Unforgeable identity for the participate node.
//
// A principal is bound to an Ed25519 public key by a SELF-SIGNED registration
// (proving key possession), and every later command must carry a signature by
// that key. Authority is therefore possession of a private key — NOT a plaintext
// string that anyone could assert. The system actor is reserved and can never be
// registered, so system authority stays unforgeable (the engine also rejects it
// at `emit`; see vouch-world foundation).
//
// Replay protection: a strictly-increasing per-principal `nonce`. The registry is
// event-sourced (append-only auth log, replayed on boot) so it survives restarts
// alongside the engine journal.

import { canonicalBytes, decodeBase64, ED25519_SUITE, MAX_NAME_LENGTH } from "vouch-core";
import { SYSTEM_ACTOR } from "vouch-world/foundation";
import type { AccountLog } from "./account-log";

/** Bytes a client signs for a registration — domain-separated from commands. */
export function registerBytes(principal: string, nonce: number, publicKey: string): Uint8Array {
  return canonicalBytes({ purpose: "vouch-register/v1", principal, nonce, publicKey });
}

/** Bytes a client signs for a command — domain-separated from registrations. */
export function commandBytes(principal: string, nonce: number, command: unknown): Uint8Array {
  return canonicalBytes({ purpose: "vouch-command/v1", principal, nonce, command });
}

export interface RegisterRequest {
  readonly principal: string;
  readonly publicKey: string; // base64 Ed25519 public key (32 bytes)
  readonly nonce: number;
  readonly signature: string; // base64, over registerBytes, by the matching private key
}

export interface SignedRequest {
  readonly principal: string;
  readonly nonce: number;
  readonly command: unknown;
  readonly signature: string; // base64, over commandBytes, by the principal's key
}

/**
 * Longest principal that may be registered.
 *
 * A principal is a caller-chosen label, so nothing else constrains it — and a
 * registration is PERMANENT: it appends to the auth log, which is replayed in full on
 * every boot. Unbounded, a single request writes 100KB of durable, un-removable,
 * replayed-forever storage (measured; see docs/LAUNCH.md).
 *
 * Tied to `MAX_NAME_LENGTH` rather than picked separately: a resident agent id is
 * `principal@region`, so a principal longer than a name would be registrable but could
 * never take part in a region. Letting these two drift apart is how you get an account
 * that exists and can do nothing.
 */
export const MAX_PRINCIPAL_LENGTH = MAX_NAME_LENGTH;

/** Longest `publicKey` field accepted. A base64 Ed25519 public key is 44 characters. */
const MAX_PUBLIC_KEY_LENGTH = 64;

/** Longest base64 signature accepted. An Ed25519 signature is 64 bytes, 88 in base64. */
const MAX_SIGNATURE_LENGTH = 128;

/** HTTP status codes the auth/command layer can produce (kept a literal union so it satisfies hono's typed status). */
export type HttpStatus = 200 | 400 | 401 | 409 | 422 | 500;

export type AuthResult =
  | { readonly ok: true; readonly principal: string }
  | { readonly ok: false; readonly status: HttpStatus; readonly reason: string };

interface AccountRecord {
  publicKey: string; // base64
  lastNonce: number;
}

function verifyEd25519(message: Uint8Array, signatureB64: string, publicKey: Uint8Array): boolean {
  let signature: Uint8Array;
  try {
    signature = decodeBase64(signatureB64);
  } catch {
    return false;
  }
  return ED25519_SUITE.verify(message, signature, publicKey);
}

export class AccountRegistry {
  private readonly accounts = new Map<string, AccountRecord>();

  constructor(private readonly log: AccountLog) {
    for (const line of log.load()) {
      if (line.kind === "register") {
        // First registration for a principal wins (later ones can't hijack it).
        if (!this.accounts.has(line.principal)) {
          this.accounts.set(line.principal, { publicKey: line.publicKey, lastNonce: line.nonce });
        }
      } else {
        const rec = this.accounts.get(line.principal);
        if (rec && line.nonce > rec.lastNonce) rec.lastNonce = line.nonce;
      }
    }
  }

  has(principal: string): boolean {
    return this.accounts.has(principal);
  }

  /**
   * The last nonce recorded for a principal, or null if it isn't registered. A
   * custodial signer (vouch-mcp) reads this to allocate the next strictly-increasing
   * nonce for the principal it signs on behalf of — the registry stays the single
   * source of truth for the replay counter, so a signer never drifts out of step.
   */
  nonceOf(principal: string): number | null {
    return this.accounts.get(principal)?.lastNonce ?? null;
  }

  /** Bind a principal to a public key via a self-signed registration (first-writer-wins). */
  register(req: RegisterRequest): AuthResult {
    if (typeof req.principal !== "string" || req.principal.length === 0 || req.principal === SYSTEM_ACTOR) {
      return { ok: false, status: 400, reason: "reserved-or-empty-principal" };
    }
    // Before the signature check, not after: verifying costs a hash over the canonical
    // bytes of the whole request, so an oversized principal should be refused first.
    if (req.principal.length > MAX_PRINCIPAL_LENGTH) return { ok: false, status: 400, reason: "principal-too-long" };
    if (!Number.isInteger(req.nonce) || req.nonce < 0) return { ok: false, status: 400, reason: "bad-nonce" };
    if (typeof req.publicKey !== "string" || req.publicKey.length > MAX_PUBLIC_KEY_LENGTH) {
      return { ok: false, status: 400, reason: "bad-public-key-encoding" };
    }
    if (typeof req.signature !== "string" || req.signature.length > MAX_SIGNATURE_LENGTH) {
      return { ok: false, status: 400, reason: "bad-signature" };
    }
    let publicKey: Uint8Array;
    try {
      publicKey = decodeBase64(req.publicKey);
    } catch {
      return { ok: false, status: 400, reason: "bad-public-key-encoding" };
    }
    if (publicKey.length !== 32) return { ok: false, status: 400, reason: "bad-public-key-length" };
    if (!verifyEd25519(registerBytes(req.principal, req.nonce, req.publicKey), req.signature, publicKey)) {
      return { ok: false, status: 401, reason: "bad-signature" };
    }
    if (this.accounts.has(req.principal)) return { ok: false, status: 409, reason: "already-registered" };

    this.accounts.set(req.principal, { publicKey: req.publicKey, lastNonce: req.nonce });
    this.log.append({ kind: "register", principal: req.principal, publicKey: req.publicKey, nonce: req.nonce });
    return { ok: true, principal: req.principal };
  }

  /** Verify a signed command against the registered key + advance the nonce (replay-safe). */
  verify(req: SignedRequest): AuthResult {
    // An over-length principal can never have been registered, so the lookup below would
    // miss anyway — but checking first avoids hashing an arbitrarily long map key.
    if (typeof req.principal !== "string" || req.principal.length > MAX_PRINCIPAL_LENGTH) {
      return { ok: false, status: 401, reason: "unregistered-principal" };
    }
    if (typeof req.signature !== "string" || req.signature.length > MAX_SIGNATURE_LENGTH) {
      return { ok: false, status: 401, reason: "bad-signature" };
    }
    const rec = this.accounts.get(req.principal);
    if (!rec) return { ok: false, status: 401, reason: "unregistered-principal" };
    if (!Number.isInteger(req.nonce) || req.nonce <= rec.lastNonce) return { ok: false, status: 401, reason: "stale-nonce" };
    let publicKey: Uint8Array;
    try {
      publicKey = decodeBase64(rec.publicKey);
    } catch {
      return { ok: false, status: 500, reason: "corrupt-registered-key" };
    }
    if (!verifyEd25519(commandBytes(req.principal, req.nonce, req.command), req.signature, publicKey)) {
      return { ok: false, status: 401, reason: "bad-signature" };
    }
    rec.lastNonce = req.nonce;
    this.log.append({ kind: "nonce", principal: req.principal, nonce: req.nonce });
    return { ok: true, principal: req.principal };
  }
}
