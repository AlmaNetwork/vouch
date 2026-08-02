// Layer 1 Trust Core — identifier syntax: `name@region`.
//
// The core only checks SYNTAX. It does not know what a region is, who owns it,
// or whether it is trustworthy (§2-1, §2-2). It just generates and validates the
// shape of an identifier string.
//
//   name   : starts with a letter, then alphanumerics, up to 128
//   region : lowercase alphanumerics, up to 63
//
// LENGTH IS PART OF THE GRAMMAR, not a separate concern layered on top. Without
// it the character class alone accepts a 200KB region id, and every layer above
// inherits that: a `found` command with one writes a 600KB entry into a
// hash-chained journal that can never be trimmed (measured — see docs/LAUNCH.md).
// Bounding it here means every caller of the grammar is bounded, rather than each
// one having to remember.

/**
 * Longest `name` part of an identifier.
 *
 * A name has to be able to hold a whole account principal, because a resident agent
 * id is `principal@region`: anything a caller may register as a principal must still
 * be usable as a name, or it could hold an account it can never inhabit. So this is
 * the number that governs both, and it is why it is not smaller — vouch-mcp derives
 * its principals as `u` + a full sha256 hex digest, 65 characters, and the digest is
 * deliberately un-truncated for collision resistance.
 */
export const MAX_NAME_LENGTH = 128;

/**
 * Longest `region` part of an identifier. 63 is the DNS label limit — the closest
 * well-worn precedent for a short name people type and pass around.
 */
export const MAX_REGION_LENGTH = 63;

const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const REGION_RE = /^[a-z0-9]+$/;

export interface Identifier {
  readonly name: string;
  readonly region: string;
}

export function isValidName(name: string): boolean {
  // Length before the pattern: the check is O(1) and the input may be arbitrarily
  // large, since this is reached straight from an unauthenticated request body.
  return typeof name === "string" && name.length <= MAX_NAME_LENGTH && NAME_RE.test(name);
}

export function isValidRegion(region: string): boolean {
  return typeof region === "string" && region.length <= MAX_REGION_LENGTH && REGION_RE.test(region);
}

export function isValidIdentifier(id: unknown): id is string {
  return typeof id === "string" && parseIdentifier(id) !== undefined;
}

/** Longest whole `name@region` identifier: both parts plus the separator. */
export const MAX_IDENTIFIER_LENGTH = MAX_NAME_LENGTH + 1 + MAX_REGION_LENGTH;

/** Parse `name@region` into parts, or `undefined` if it is malformed. */
export function parseIdentifier(id: string): Identifier | undefined {
  if (typeof id !== "string") return undefined;
  // Reject on length first, before slicing: the parts are validated below anyway, but
  // an oversized input should not be copied twice on its way to being refused.
  if (id.length > MAX_IDENTIFIER_LENGTH) return undefined;
  const at = id.indexOf("@");
  if (at < 0) return undefined;
  if (id.indexOf("@", at + 1) !== -1) return undefined; // exactly one '@'
  const name = id.slice(0, at);
  const region = id.slice(at + 1);
  if (!isValidName(name) || !isValidRegion(region)) return undefined;
  return { name, region };
}

export function formatIdentifier(id: Identifier): string {
  return `${id.name}@${id.region}`;
}
