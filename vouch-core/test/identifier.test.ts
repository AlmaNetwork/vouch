import { describe, expect, test } from "bun:test";
import {
  formatIdentifier,
  isValidIdentifier,
  isValidName,
  isValidRegion,
  MAX_IDENTIFIER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_REGION_LENGTH,
  parseIdentifier,
} from "../src/identifier";

describe("identifier (name@region)", () => {
  test("accepts a valid identifier and parses parts", () => {
    expect(isValidIdentifier("alice@umi")).toBe(true);
    expect(parseIdentifier("alice@umi")).toEqual({ name: "alice", region: "umi" });
  });

  test("name may contain digits but must start with a letter", () => {
    expect(isValidIdentifier("a1b2@r9")).toBe(true);
    expect(isValidIdentifier("1alice@umi")).toBe(false);
  });

  test("region must be lowercase alphanumeric", () => {
    expect(isValidIdentifier("alice@umi2")).toBe(true);
    expect(isValidIdentifier("alice@Umi")).toBe(false);
  });

  test("rejects a missing '@'", () => {
    expect(isValidIdentifier("aliceumi")).toBe(false);
    expect(parseIdentifier("aliceumi")).toBeUndefined();
  });

  test("rejects symbols and double '@'", () => {
    expect(isValidIdentifier("al!ce@umi")).toBe(false);
    expect(isValidIdentifier("alice@u_mi")).toBe(false);
    expect(isValidIdentifier("alice@@umi")).toBe(false);
    expect(isValidIdentifier("a@b@c")).toBe(false);
  });

  test("rejects empty parts", () => {
    expect(isValidIdentifier("@umi")).toBe(false);
    expect(isValidIdentifier("alice@")).toBe(false);
  });

  test("round-trips through format", () => {
    expect(formatIdentifier({ name: "bob", region: "yama" })).toBe("bob@yama");
  });

  // Length is part of the grammar, not a separate concern. The character class alone
  // accepts a 200KB region id, and a `found` carrying one writes a 600KB entry into a
  // hash-chained journal that can never be trimmed.
  describe("length", () => {
    const name = (n: number) => `a${"b".repeat(n - 1)}`;
    const region = (n: number) => "r".repeat(n);

    test("a name is accepted at the limit and refused one past it", () => {
      expect(isValidName(name(MAX_NAME_LENGTH))).toBe(true);
      expect(isValidName(name(MAX_NAME_LENGTH + 1))).toBe(false);
    });

    test("a region is accepted at the limit and refused one past it", () => {
      expect(isValidRegion(region(MAX_REGION_LENGTH))).toBe(true);
      expect(isValidRegion(region(MAX_REGION_LENGTH + 1))).toBe(false);
    });

    test("an identifier at the full limit parses, and one character more does not", () => {
      const longest = `${name(MAX_NAME_LENGTH)}@${region(MAX_REGION_LENGTH)}`;
      expect(longest.length).toBe(MAX_IDENTIFIER_LENGTH);
      expect(parseIdentifier(longest)).toEqual({ name: name(MAX_NAME_LENGTH), region: region(MAX_REGION_LENGTH) });
      expect(isValidIdentifier(`${name(MAX_NAME_LENGTH + 1)}@${region(MAX_REGION_LENGTH)}`)).toBe(false);
    });

    test("an oversized input is refused rather than parsed", () => {
      expect(isValidRegion("r".repeat(200 * 1024))).toBe(false);
      expect(isValidIdentifier(`alice@${"r".repeat(200 * 1024)}`)).toBe(false);
      expect(parseIdentifier(`${"a".repeat(200 * 1024)}@umi`)).toBeUndefined();
    });

    // vouch-mcp derives its account principals as `u` + a full (deliberately
    // un-truncated) sha256 hex digest, and a resident agent id is `principal@region`.
    // If a name could not hold one, every MCP subject would be unable to take part.
    test("a name is long enough to hold a derived MCP principal", () => {
      expect(isValidName(`u${"0".repeat(64)}`)).toBe(true);
    });
  });
});
