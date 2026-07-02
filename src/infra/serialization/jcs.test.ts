/**
 * Tests for JCS serialization
 */

import { describe, expect, it } from "vitest";
import { chainHash, hashCanonical, toCanonical } from "./jcs.js";

describe("toCanonical", () => {
  it("should produce consistent output for same input", () => {
    const obj = { b: 2, a: 1 };
    const result1 = toCanonical(obj);
    const result2 = toCanonical(obj);

    expect(result1).toBe(result2);
  });

  it("should sort keys alphabetically", () => {
    const obj = { z: 1, a: 2, m: 3 };
    const result = toCanonical(obj);

    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("should handle nested objects", () => {
    const obj = { outer: { b: 2, a: 1 } };
    const result = toCanonical(obj);

    expect(result).toBe('{"outer":{"a":1,"b":2}}');
  });

  it("should handle arrays", () => {
    const arr = [3, 1, 2];
    const result = toCanonical(arr);

    expect(result).toBe("[3,1,2]");
  });

  it("should throw for undefined", () => {
    expect(() => toCanonical(undefined)).toThrow();
  });
});

describe("hashCanonical", () => {
  it("should produce consistent hash", () => {
    const obj = { test: "value" };
    const hash1 = hashCanonical(obj);
    const hash2 = hashCanonical(obj);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("should produce different hash for different input", () => {
    const hash1 = hashCanonical({ a: 1 });
    const hash2 = hashCanonical({ a: 2 });

    expect(hash1).not.toBe(hash2);
  });
});

describe("chainHash", () => {
  it("should include prevHash in computation", () => {
    const record = { data: "test" };
    const hash1 = chainHash(record, null);
    const hash2 = chainHash(record, "abc123");

    expect(hash1).not.toBe(hash2);
  });

  it("should be deterministic", () => {
    const record = { data: "test" };
    const prevHash = "prev123";

    const hash1 = chainHash(record, prevHash);
    const hash2 = chainHash(record, prevHash);

    expect(hash1).toBe(hash2);
  });
});
