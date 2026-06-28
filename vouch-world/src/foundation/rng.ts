// Foundation A: deterministic random source — deterministic RNG.
//
// All of the world's randomness flows through this (§M1, §2-7). Given a seed,
// the sequence is fixed, so the same seed replays the same history. Algorithm:
// cyrb128 (seed -> 128-bit state) + sfc32 (fast, well-distributed generator).

type Generator32 = () => number; // returns a uint32

function cyrb128(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  return [h1 >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function sfc32(a: number, b: number, c: number, d: number): Generator32 {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
}

export class Rng {
  readonly seed: string;
  private readonly gen: Generator32;

  private constructor(seed: string, state: [number, number, number, number]) {
    this.seed = seed;
    this.gen = sfc32(state[0], state[1], state[2], state[3]);
  }

  static create(seed: string | number): Rng {
    const s = String(seed);
    return new Rng(s, cyrb128(s));
  }

  /** Next 32-bit unsigned integer. */
  nextUint32(): number {
    return this.gen() >>> 0;
  }

  /** Next float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("rng.int: maxExclusive must be a positive integer");
    }
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  /** Integer in [minInclusive, maxExclusive). */
  range(minInclusive: number, maxExclusive: number): number {
    return minInclusive + this.int(maxExclusive - minInclusive);
  }

  /** True with probability `p` (default 0.5). */
  bool(p = 0.5): boolean {
    return this.nextFloat() < p;
  }

  /** Uniformly pick one element. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error("rng.pick: cannot pick from an empty array");
    return item;
  }

  /** `n` deterministic bytes — e.g. a 32-byte seed for keyPairFromSeed (§2-7). */
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 4) {
      let v = this.nextUint32();
      for (let j = 0; j < 4 && i + j < n; j++) {
        out[i + j] = v & 0xff;
        v >>>= 8;
      }
    }
    return out;
  }

  /** Derive an independent sub-stream, deterministically, from this one's position. */
  fork(label = ""): Rng {
    return Rng.create(`${this.seed}::${label}::${this.nextUint32()}::${this.nextUint32()}`);
  }
}
