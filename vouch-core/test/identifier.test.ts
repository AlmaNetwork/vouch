import { describe, expect, test } from "bun:test";
import { formatIdentifier, isValidIdentifier, parseIdentifier } from "../src/identifier";

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
});
