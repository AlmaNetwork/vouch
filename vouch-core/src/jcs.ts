// Layer 1 Trust Core — JCS (RFC 8785) canonicalization.
//
// The trust core fixes only the "shape of the envelope" and "how the signature
// is attached" (§2-3). JCS gives us a single canonical byte sequence for any
// JSON value so that signing and verifying agree regardless of key order.
//
// The core does NOT interpret the value (§2-2) — it only turns it into bytes.

import canonicalize from "canonicalize";

function canonical(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) {
    // canonicalize returns undefined only for `undefined` input.
    throw new Error("alma-core: value is not JCS-canonicalizable (got undefined)");
  }
  return out;
}

/** RFC 8785 canonical JSON string for `value`. */
export function canonicalString(value: unknown): string {
  return canonical(value);
}

/** RFC 8785 canonical JSON of `value`, as the exact UTF-8 bytes that get signed. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonical(value));
}
