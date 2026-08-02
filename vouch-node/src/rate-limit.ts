// Token buckets — the node's own rate limiting.
//
// In the app and not only at the CDN, deliberately. A CDN rule protects the
// hostname; it does nothing for anyone who finds the origin and talks to it
// directly, and it is the origin that owns the journal. Everything a write costs
// is permanent, so the limiter has to sit where the write happens.
//
// Nothing here is persisted. A restart hands everyone a full bucket, which is the
// right trade: the alternative is another append-only file on the write path, and a
// node that restarts often enough for that to matter has a louder problem.

/** A bucket's shape: how many requests may burst, and how fast the allowance returns. */
export interface BucketSpec {
  /** Burst size. **0 disables the limit entirely.** */
  readonly capacity: number;
  /** Tokens returned per second. Capacity divided by the window length. */
  readonly refillPerSecond: number;
}

/** `n` events per minute, as a bucket. */
export function perMinute(n: number): BucketSpec {
  return { capacity: n, refillPerSecond: n / 60 };
}

/** `n` events per hour, as a bucket. */
export function perHour(n: number): BucketSpec {
  return { capacity: n, refillPerSecond: n / 3600 };
}

interface Bucket {
  tokens: number;
  updated: number; // epoch ms of the last refill
}

/**
 * A bounded set of token buckets keyed by caller.
 *
 * The map is capped. An unbounded one would be its own denial of service — the keys
 * are attacker-chosen (an IP, or a principal from a request body), so "remember every
 * caller forever" is a memory leak with a stranger's hand on the tap.
 *
 * Eviction is lossless where it can be: **a full bucket is indistinguishable from one
 * that was never created**, so dropping full buckets forgets nothing. Only when every
 * bucket is mid-refill — an actual flood of distinct keys — does it fall back to
 * dropping the least recently touched, which is the one closest to being full anyway.
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly spec: BucketSpec,
    private readonly maxKeys = 10_000,
    /** Injectable so tests can advance time without sleeping. */
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether this limiter does anything at all. */
  get enabled(): boolean {
    return this.spec.capacity > 0;
  }

  /** How many keys are currently tracked (for tests and `/health`). */
  get size(): number {
    return this.buckets.size;
  }

  /** Would `take` succeed right now, without spending anything? */
  peek(key: string): boolean {
    if (!this.enabled) return true;
    return this.refresh(key).tokens >= 1;
  }

  /** Spend one token. Returns false — and spends nothing — if the bucket is empty. */
  take(key: string): boolean {
    if (!this.enabled) return true;
    const b = this.refresh(key);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Seconds until this key has a token again. 0 if it has one now. */
  retryAfter(key: string): number {
    if (!this.enabled) return 0;
    const b = this.refresh(key);
    if (b.tokens >= 1) return 0;
    return Math.ceil((1 - b.tokens) / this.spec.refillPerSecond);
  }

  private refresh(key: string): Bucket {
    const t = this.now();
    const existing = this.buckets.get(key);
    if (existing) {
      const elapsed = (t - existing.updated) / 1000;
      if (elapsed > 0) {
        existing.tokens = Math.min(this.spec.capacity, existing.tokens + elapsed * this.spec.refillPerSecond);
        existing.updated = t;
      }
      return existing;
    }
    this.evict(t);
    const fresh: Bucket = { tokens: this.spec.capacity, updated: t };
    this.buckets.set(key, fresh);
    return fresh;
  }

  private evict(t: number): void {
    if (this.buckets.size < this.maxKeys) return;
    for (const [key, b] of this.buckets) {
      const refilled = b.tokens + ((t - b.updated) / 1000) * this.spec.refillPerSecond;
      if (refilled >= this.spec.capacity) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maxKeys) return;
    // Every tracked key is mid-refill, so something is genuinely flooding us with
    // distinct keys. Drop the one that has been waiting longest — it is the nearest
    // to full, so it is the one whose loss forgives the least.
    let oldestKey: string | undefined;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, b] of this.buckets) {
      if (b.updated < oldest) {
        oldest = b.updated;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }
}
