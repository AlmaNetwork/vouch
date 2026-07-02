// Foundation utilities — immutability + stable serialization + deterministic time.

/** Epoch for deterministic timestamps (must stay fixed — it feeds receipt issuedAt / the log digest). */
const EPOCH_MS = Date.UTC(2026, 0, 1);

/**
 * A deterministic ISO-8601 timestamp derived from a tick — one sim day per tick.
 * The domain has no wall clock (§2-7); anything that needs an "issuedAt" (e.g. a
 * receipt certificate) derives it from the tick so replay is bit-stable.
 */
export function tickToIso(tick: number): string {
  return new Date(EPOCH_MS + tick * 86_400_000).toISOString();
}

/** Recursively freeze an object so it cannot be mutated after the fact. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** JSON with recursively sorted keys, so equal content yields an equal string. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** FNV-1a 32-bit hash, hex string. Cheap content fingerprint for the log digest. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
