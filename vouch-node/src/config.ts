// Node configuration from the environment.
//
// Deliberately strict: integers are range-checked (a typo can't silently bind a
// nonsense port), the server binds loopback by default (opt in to 0.0.0.0), and
// the notary secret has NO silent fallback — a missing key throws rather than
// booting with a predictable well-known key.

import { createHash } from "node:crypto";
import { type KeyPair, keyPairFromSeed } from "vouch-core";
import { isLogLevel, LOG_LEVELS, type LogLevel } from "./log";

export type RawEnv = Record<string, string | undefined>;

export interface NodeConfig {
  readonly host: string;
  readonly port: number;
  readonly seed: string;
  readonly journalPath: string | null; // null => in-memory (ephemeral)
  readonly accountsPath: string | null; // null => in-memory (ephemeral)
  readonly notary: KeyPair;
  readonly logLevel: LogLevel;
  readonly build: string; // git tag / short SHA baked in at build time; "dev" when unset
  /**
   * Header carrying the real client IP, lowercased; null means use the socket address.
   *
   * SECURITY: a request header is caller-supplied. Trusting one is only safe when the
   * node cannot be reached except through a proxy that OVERWRITES it — otherwise
   * anyone sets it per request, gets a fresh bucket every time, and the per-IP limit
   * stops existing. The shipped topology earns that (Cloudflare sets
   * `CF-Connecting-IP`, and authenticated origin pulls mean only Cloudflare can reach
   * Caddy), which is why this is opt-in rather than a default.
   *
   * It is also close to mandatory in that topology: behind a loopback reverse proxy
   * every request's socket address is 127.0.0.1, so without this the whole world
   * shares one bucket.
   */
  readonly clientIpHeader: string | null;
  /** Signed writes per minute, per principal. 0 disables. */
  readonly writesPerMinutePerPrincipal: number;
  /** Write attempts per hour, per client IP. 0 disables. */
  readonly writesPerHourPerIp: number;
  /** Reads per minute, per client IP. 0 disables. */
  readonly readsPerMinutePerIp: number;
}

function requireInt(raw: string | undefined, name: string, def: number, min: number, max: number): number {
  if (raw === undefined) return def;
  // Plain decimal only — reject hex ("0x50"), exponent ("1e3"), whitespace, etc.,
  // which Number() would otherwise silently accept.
  if (!/^-?\d+$/.test(raw)) throw new Error(`config: ${name} must be a decimal integer, got "${raw}"`);
  const n = Number(raw);
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
  // No silent fallback: an unset VOUCH_NOTARY throws rather than booting a live node
  // with a well-known, publicly-derivable key. Dev sets `seed://<secret>`; production
  // sets `env://VOUCH_NOTARY_SECRET` (see README).
  const notarySource = env.VOUCH_NOTARY;
  if (!notarySource || notarySource.length === 0) {
    throw new Error("config: VOUCH_NOTARY is required (e.g. seed://<dev-secret> or env://VOUCH_NOTARY_SECRET)");
  }
  // Same strictness as the ints: a typo'd level is an error, not a silent default,
  // so nobody discovers at 3am that the node has been logging at the wrong level.
  const rawLevel = env.VOUCH_LOG_LEVEL ?? "info";
  if (!isLogLevel(rawLevel)) {
    throw new Error(`config: VOUCH_LOG_LEVEL must be one of ${LOG_LEVELS.join(" | ")}, got "${rawLevel}"`);
  }

  // Rate limits start deliberately tight. Nothing appended to the journal can be taken
  // back, so the safe direction to be wrong in is "too strict" — that is an annoyed
  // participant, where the other way is a permanent record we did not want.
  return {
    // Loopback by default — an operator opts into public exposure explicitly.
    host: env.VOUCH_HOST ?? "127.0.0.1",
    port: requireInt(env.VOUCH_PORT, "VOUCH_PORT", 8787, 1, 65535),
    seed: env.VOUCH_SEED ?? "vouch-node",
    journalPath: env.VOUCH_JOURNAL ?? null,
    accountsPath: env.VOUCH_ACCOUNTS ?? null,
    notary: resolveNotary(notarySource, env),
    logLevel: rawLevel,
    build: env.VOUCH_BUILD ?? "dev",
    clientIpHeader: env.VOUCH_CLIENT_IP_HEADER ? env.VOUCH_CLIENT_IP_HEADER.toLowerCase() : null,
    writesPerMinutePerPrincipal: requireInt(env.VOUCH_WRITES_PER_MIN_PER_PRINCIPAL, "VOUCH_WRITES_PER_MIN_PER_PRINCIPAL", 10, 0, 1_000_000),
    writesPerHourPerIp: requireInt(env.VOUCH_WRITES_PER_HOUR_PER_IP, "VOUCH_WRITES_PER_HOUR_PER_IP", 60, 0, 1_000_000),
    readsPerMinutePerIp: requireInt(env.VOUCH_READS_PER_MIN_PER_IP, "VOUCH_READS_PER_MIN_PER_IP", 600, 0, 1_000_000),
  };
}
