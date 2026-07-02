// Node configuration from the environment.
//
// Deliberately strict: integers are range-checked (a typo can't silently bind a
// nonsense port), the server binds loopback by default (opt in to 0.0.0.0), and
// the notary secret has NO silent fallback — a missing key throws rather than
// booting with a predictable well-known key.

import { createHash } from "node:crypto";
import { type KeyPair, keyPairFromSeed } from "vouch-core";

export type RawEnv = Record<string, string | undefined>;

export interface NodeConfig {
  readonly host: string;
  readonly port: number;
  readonly seed: string;
  readonly journalPath: string | null; // null => in-memory (ephemeral)
  readonly accountsPath: string | null; // null => in-memory (ephemeral)
  readonly notary: KeyPair;
}

function requireInt(raw: string | undefined, name: string, def: number, min: number, max: number): number {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`config: ${name} must be an integer, got "${raw}"`);
  if (n < min || n > max) throw new Error(`config: ${name} must be in [${min}, ${max}], got ${n}`);
  return n;
}

/** Derive a 32-byte Ed25519 seed from arbitrary secret material (SHA-256). */
function seed32(material: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(material).digest());
}

/**
 * Resolve the notary keypair from a source URI. NO silent fallback: an `env://`
 * source whose variable is unset throws, so an operator who mis-types the secret
 * var gets an error instead of a node signing receipts with a predictable key.
 */
export function resolveNotary(source: string, env: RawEnv): KeyPair {
  const sep = source.indexOf("://");
  if (sep < 0) throw new Error(`config: notary source "${source}" must be seed://… or env://…`);
  const scheme = source.slice(0, sep);
  const value = source.slice(sep + 3);
  if (scheme === "seed") {
    if (value.length === 0) throw new Error("config: seed:// notary source is empty");
    return keyPairFromSeed(seed32(value));
  }
  if (scheme === "env") {
    const secret = env[value];
    if (!secret || secret.length === 0) throw new Error(`config: notary env var "${value}" is unset or empty`);
    return keyPairFromSeed(seed32(secret));
  }
  throw new Error(`config: unknown notary source scheme "${scheme}" (use seed:// or env://)`);
}

export function loadConfig(env: RawEnv): NodeConfig {
  return {
    // Loopback by default — an operator opts into public exposure explicitly.
    host: env.VOUCH_HOST ?? "127.0.0.1",
    port: requireInt(env.VOUCH_PORT, "VOUCH_PORT", 8787, 1, 65535),
    seed: env.VOUCH_SEED ?? "vouch-node",
    journalPath: env.VOUCH_JOURNAL ?? null,
    accountsPath: env.VOUCH_ACCOUNTS ?? null,
    // `seed://dev-notary` is an obvious development default; production sets
    // VOUCH_NOTARY=env://VOUCH_NOTARY_SECRET (see README).
    notary: resolveNotary(env.VOUCH_NOTARY ?? "seed://dev-notary", env),
  };
}
