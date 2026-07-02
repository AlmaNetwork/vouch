/**
 * JCS (JSON Canonicalization Scheme) serialization
 * RFC 8785 compliant canonical JSON + hash chain
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const canonicalize = require("canonicalize") as (value: unknown) => string | undefined;

/**
 * Convert value to canonical JSON string
 * @throws Error if value is not serializable
 */
export function toCanonical(value: unknown): string {
  const result = canonicalize(value);
  if (typeof result !== "string") {
    throw new Error("jcs: value is not serializable");
  }
  return result;
}

/**
 * Compute SHA-256 hash of canonical JSON
 */
export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(toCanonical(value), "utf8").digest("hex");
}

/**
 * Compute chained hash: hash(canonical(record) + prevHash)
 * Used for append-only log integrity verification
 */
export function chainHash(record: unknown, prevHash: string | null): string {
  const canonical = toCanonical(record);
  return createHash("sha256")
    .update(canonical, "utf8")
    .update(prevHash ?? "", "utf8")
    .digest("hex");
}

/**
 * Verify hash chain integrity
 */
export function verifyChain(_recordHash: string, prevHash: string | null, expectedPrevHash: string | null): boolean {
  return prevHash === expectedPrevHash;
}
