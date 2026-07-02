import { describe, expect, test } from "bun:test";
import { generateKeyPair } from "../src/keys";
import { ED25519_SUITE, getSuite, listSuites } from "../src/suite";

describe("signature-suite registry", () => {
  test("ed25519 is registered out of the box", () => {
    expect(getSuite("ed25519")).toBeDefined();
    expect(listSuites()).toContain("ed25519");
  });

  test("an unknown suite is not registered", () => {
    expect(getSuite("rsa-pkcs1")).toBeUndefined();
  });

  test("the ed25519 suite signs and verifies round-trip", () => {
    const { privateKey, publicKey } = generateKeyPair();
    const msg = new TextEncoder().encode("hello alma");
    const sig = ED25519_SUITE.sign(msg, privateKey);
    expect(ED25519_SUITE.verify(msg, sig, publicKey)).toBe(true);
  });

  test("verify returns false (not throws) on garbage bytes", () => {
    const { publicKey } = generateKeyPair();
    const msg = new TextEncoder().encode("hello alma");
    expect(ED25519_SUITE.verify(msg, new Uint8Array([1, 2, 3]), publicKey)).toBe(false);
  });
});
