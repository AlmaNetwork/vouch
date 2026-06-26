import { describe, expect, test } from "bun:test";
import { canonicalBytes, canonicalString } from "../src/jcs";

describe("JCS canonicalization (RFC 8785)", () => {
  test("field order does not change the canonical string", () => {
    const a = canonicalString({ b: 1, a: 2, nested: { y: 1, x: 2 } });
    const b = canonicalString({ a: 2, nested: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  test("canonical bytes are deterministic regardless of key order", () => {
    const x = canonicalBytes({ hello: "world", n: 3 });
    const y = canonicalBytes({ n: 3, hello: "world" });
    expect(Array.from(x)).toEqual(Array.from(y));
  });

  test("produces sorted-key JSON", () => {
    expect(canonicalString({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
