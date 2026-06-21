import { describe, expect, test } from "bun:test";
import { Rng } from "../../src/foundation/rng";

function drawN(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextUint32());
}

describe("deterministic RNG", () => {
  test("the same seed yields the same sequence", () => {
    expect(drawN(Rng.create("alma"), 16)).toEqual(drawN(Rng.create("alma"), 16));
    expect(drawN(Rng.create(42), 16)).toEqual(drawN(Rng.create(42), 16));
  });

  test("different seeds yield different sequences", () => {
    expect(drawN(Rng.create("alma"), 16)).not.toEqual(drawN(Rng.create("alma!"), 16));
  });

  test("nextFloat stays in [0, 1)", () => {
    const rng = Rng.create("floats");
    for (let i = 0; i < 1000; i++) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  test("int(n) stays in [0, n)", () => {
    const rng = Rng.create("ints");
    for (let i = 0; i < 1000; i++) {
      const x = rng.int(7);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(7);
      expect(Number.isInteger(x)).toBe(true);
    }
  });

  test("int rejects a non-positive bound", () => {
    expect(() => Rng.create("x").int(0)).toThrow();
    expect(() => Rng.create("x").int(-3)).toThrow();
  });

  test("pick is deterministic and never picks from empty", () => {
    const items = ["a", "b", "c", "d"];
    expect(Array.from({ length: 10 }, () => Rng.create("pick").pick(items))).toEqual(
      Array.from({ length: 10 }, () => Rng.create("pick").pick(items)),
    );
    expect(() => Rng.create("x").pick([])).toThrow();
  });

  test("bytes(n) is deterministic, correct length, and in range", () => {
    const a = Rng.create("bytes").bytes(32);
    const b = Rng.create("bytes").bytes(32);
    expect(a.length).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const v of a) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(255);
  });

  test("fork derives reproducible but distinct sub-streams", () => {
    // Same parent seed + same fork label -> identical child stream.
    const childX1 = drawN(Rng.create("root").fork("x"), 8);
    const childX2 = drawN(Rng.create("root").fork("x"), 8);
    expect(childX1).toEqual(childX2);

    // Different labels -> different child streams.
    const childY = drawN(Rng.create("root").fork("y"), 8);
    expect(childX1).not.toEqual(childY);
  });

  test("a long run is reproducible across instances", () => {
    expect(drawN(Rng.create("long"), 5000)).toEqual(drawN(Rng.create("long"), 5000));
  });
});
