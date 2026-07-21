import { describe, expect, test } from "bun:test";
import { generateKeyPair } from "../src/keys";
import {
  activeSuiteIds,
  ED25519_SUITE,
  getSuite,
  getSuiteMeta,
  isValidSuiteId,
  listSuiteMeta,
  listSuites,
  MTI_SUITE_ID,
  negotiate,
  type SuitePolicy,
} from "../src/suite";

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

describe("RFC 0005 §4 suite registry (metadata)", () => {
  test("MTI is ed25519 and is active", () => {
    expect(MTI_SUITE_ID).toBe("ed25519");
    const mti = getSuiteMeta(MTI_SUITE_ID);
    expect(mti?.status).toBe("active");
    expect(activeSuiteIds()).toContain("ed25519");
  });

  test("every seed entry has a valid, unique suite id (RFC 0005 §3 grammar)", () => {
    const all = listSuiteMeta();
    expect(all.length).toBe(13);
    for (const m of all) {
      expect(isValidSuiteId(m.id)).toBe(true);
    }
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length); // no duplicates
  });

  test("ed25519 metadata", () => {
    expect(getSuiteMeta("ed25519")).toEqual({
      id: "ed25519",
      name: "EdDSA over Curve25519",
      reference: "RFC 8032",
      class: "single",
      securityBits: 128,
      pq: false,
      status: "active",
    });
  });

  test("post-quantum + threshold + strength are captured", () => {
    expect(getSuiteMeta("ml-dsa-65")?.pq).toBe(true);
    expect(getSuiteMeta("ml-dsa-65")?.securityBits).toBe(192);
    expect(getSuiteMeta("ecdsa-p384")?.securityBits).toBe(192);
    expect(getSuiteMeta("ed448")?.securityBits).toBe(224);
    expect(getSuiteMeta("frost-ed25519")?.class).toBe("threshold");
    expect(getSuiteMeta("ed25519")?.pq).toBe(false);
  });

  test("an unregistered suite has no metadata", () => {
    expect(getSuiteMeta("rsa-pkcs1")).toBeUndefined();
  });

  test("isValidSuiteId enforces the §3 grammar", () => {
    expect(isValidSuiteId("ed25519")).toBe(true);
    expect(isValidSuiteId("ecdsa-p256")).toBe(true);
    expect(isValidSuiteId("Ed25519")).toBe(false); // uppercase
    expect(isValidSuiteId("1abc")).toBe(false); // must start with a lowercase letter
    expect(isValidSuiteId("a_b")).toBe(false); // underscore not allowed
    expect(isValidSuiteId("")).toBe(false);
  });

  test("the seed registry is all-active (nothing deprecated yet)", () => {
    expect(activeSuiteIds().length).toBe(listSuiteMeta().length);
  });

  test("the two registries stay consistent: executable ⊆ metadata, and the MTI is executable", () => {
    for (const id of listSuites()) {
      expect(getSuiteMeta(id)).toBeDefined();
    }
    expect(getSuite(MTI_SUITE_ID)).toBeDefined(); // else §6.1's MTI fallback would be a lie
  });

  test("the metadata table is deep-frozen — runtime mutation is impossible", () => {
    const meta = getSuiteMeta("ed25519");
    expect(() => {
      (meta as { status: string }).status = "deprecated";
    }).toThrow(TypeError);
    expect(getSuiteMeta("ed25519")?.status).toBe("active");
  });
});

describe("RFC 0005 §6 negotiation", () => {
  const policy = (signatureSuites: string[], minSecurityBits = 128, requirePq = false): SuitePolicy => ({
    signatureSuites,
    minSecurityBits,
    requirePq,
  });

  test("two MTI-only regions agree on ed25519", () => {
    expect(negotiate(policy(["ed25519"]), policy(["ed25519"]))).toEqual({ ok: true, agreedSuites: ["ed25519"] });
  });

  test("agreedSuites follow the responder's preference order", () => {
    const r = negotiate(policy(["ed25519", "ecdsa-p384"]), policy(["ecdsa-p384", "ed25519"]));
    expect(r).toEqual({ ok: true, agreedSuites: ["ecdsa-p384", "ed25519"] });
  });

  test("a suite below either region's minimum strength is excluded", () => {
    // initiator floor is 192-bit, so ed25519 (128) drops out; p384 (192) survives.
    const r = negotiate(policy(["ed25519", "ecdsa-p384"], 192), policy(["ed25519", "ecdsa-p384"]));
    expect(r).toEqual({ ok: true, agreedSuites: ["ecdsa-p384"] });
  });

  test("unregistered advertised ids are skipped", () => {
    const r = negotiate(policy(["ed25519", "made-up-suite"]), policy(["ed25519", "made-up-suite"]));
    expect(r).toEqual({ ok: true, agreedSuites: ["ed25519"] });
  });

  test("negotiation fails when the MTI is excluded by strength", () => {
    const r = negotiate(policy(["ed25519"], 256), policy(["ed25519"]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-acceptable-suite");
  });

  test("a PQ-requiring region excludes all non-PQ suites (§8)", () => {
    const r = negotiate(policy(["ed25519", "ml-dsa-65"]), policy(["ed25519", "ml-dsa-65"], 128, true));
    expect(r).toEqual({ ok: true, agreedSuites: ["ml-dsa-65"] });
  });

  test("PQ required with no common PQ suite fails (MTI is non-PQ)", () => {
    const r = negotiate(policy(["ed25519"]), policy(["ed25519"], 128, true));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-acceptable-suite");
  });
});
