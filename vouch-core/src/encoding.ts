// Layer 1 Trust Core — byte <-> base64 encoding for the envelope's signature field.

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Strict base64 decode. Throws on malformed input so callers can report a precise reason. */
export function decodeBase64(s: string): Uint8Array {
  if (typeof s !== "string" || s.length % 4 !== 0 || !BASE64_RE.test(s)) {
    throw new Error("invalid base64 string");
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}
