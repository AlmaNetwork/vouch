import { describe, expect, test } from "bun:test";
import {
  EDGE_VERSION,
  type Edge,
  edgeId,
  edgeSigningBytes,
  type IssueEdgeInput,
  issueEdge,
  isValidEndpoint,
  verifyEdge,
} from "../src/edge";
import { decodeBase64, encodeBase64 } from "../src/encoding";
import { generateKeyPair, keyPairFromSeed } from "../src/keys";
import { ED25519_SUITE } from "../src/suite";

// RFC 0008 §16 fixed keys: seeds are 31 zero bytes followed by 0x01/0x02/0x03.
function seed(last: number): Uint8Array {
  const s = new Uint8Array(32);
  s[31] = last;
  return s;
}
const alice = keyPairFromSeed(seed(1));
const nova = keyPairFromSeed(seed(2));
const bob = keyPairFromSeed(seed(3));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const V0_ID = "6cc836cc9095e4bc4d3984df1590a2268c73f49fa8456ce57cca43c46173a52c";
const V1_ID = "7f9d9e27cb93a67db8b0699cb8ffa3a31797b52a1b607bc833ed14648c848cf4";
const V2_ID = "a996fbb98951cdc78a2b1cbc78a04257de9c9e0eaf19dd80c6432933b39f1ef7";
const V3_ID = "03fd67a3113b9d98e7bf96701260c49d96ddfb3979ffaae757693b82d5263b01";
const V4_ID = "7c4f7e16da429872cce04e5c80429b848309eb8a592fa4f5f7df44ee804dee67";

interface Vector {
  readonly name: string;
  readonly input: IssueEdgeInput;
  readonly signer: { privateKey: Uint8Array; publicKey: Uint8Array };
  readonly edgeId: string;
  readonly signature: string;
}

const VECTORS: Vector[] = [
  {
    name: "V0 — genesis vouch alice@nova → bob@nova (0.5)",
    input: {
      schemaId: "alma.vouch/v1",
      kind: "vouch",
      from: "alice@nova",
      to: "bob@nova",
      context: "nova:merchant",
      weightBp: 5000,
      validFrom: 412,
      genesis: null,
      command: null,
      expiry: null,
      prev: null,
      counter: 0,
      parent: null,
      status: "active",
    },
    signer: alice,
    edgeId: V0_ID,
    signature: "mHWbzzFyb0wM17dAo0QH9Vo6ps2IuUr8hVTokvqTfdV/yVc6Ej5zsDai06foPYpxr6A1JhojO6087JXbpW+ZAw==",
  },
  {
    name: "V1 — weight raised to 0.7 (counter 1)",
    input: {
      schemaId: "alma.vouch/v1",
      kind: "vouch",
      from: "alice@nova",
      to: "bob@nova",
      context: "nova:merchant",
      weightBp: 7000,
      validFrom: 640,
      genesis: V0_ID,
      command: null,
      expiry: null,
      prev: V0_ID,
      counter: 1,
      parent: null,
      status: "active",
    },
    signer: alice,
    edgeId: V1_ID,
    signature: "r/fW7rJJkzpbIH4cVC9woF0H6VdycH/JMGmM/i2olJKqQgvX7N7OoT7/G54qb+l8qmYvF1rTRWL9Y+RQpv7vDA==",
  },
  {
    name: "V2 — revoked tombstone (counter 2)",
    input: {
      schemaId: "alma.vouch/v1",
      kind: "vouch",
      from: "alice@nova",
      to: "bob@nova",
      context: "nova:merchant",
      weightBp: 0,
      validFrom: 815,
      genesis: V0_ID,
      command: null,
      expiry: 815,
      prev: V1_ID,
      counter: 2,
      parent: null,
      status: "revoked",
    },
    signer: alice,
    edgeId: V2_ID,
    signature: "iNPYrPQFtUAnhelCTjlmSCND1Q9i4dwDy1sicTC+0XQAvB14oyRy1Eu2mmafYm4NJXnTtZQZoRQul4GN4opMBw==",
  },
  {
    name: "V3 — region sanction nova → bob@nova (−0.4)",
    input: {
      schemaId: "alma.sanction/v1",
      kind: "sanction",
      from: "nova",
      to: "bob@nova",
      context: "nova:merchant",
      weightBp: -4000,
      validFrom: 700,
      genesis: null,
      command: null,
      expiry: null,
      prev: null,
      counter: 0,
      parent: null,
      status: "active",
    },
    signer: nova,
    edgeId: V3_ID,
    signature: "9MS4gPNd5VL9d1Mu5sYxfx1O0bnGtPzHCi26k+nRxWod+TpfdzNTXxuF0JN4YHrDu+bpURT1yIgEXkhe8NwaAQ==",
  },
  {
    name: "V4 — co-signed membership nova → bob@nova (sentinel weightBp 0)",
    input: {
      schemaId: "alma.membership/v1",
      kind: "membership",
      from: "nova",
      to: "bob@nova",
      context: "nova:citizen",
      weightBp: 0,
      validFrom: 100,
      genesis: null,
      command: null,
      expiry: null,
      prev: null,
      counter: 0,
      parent: null,
      status: "active",
    },
    signer: nova,
    edgeId: V4_ID,
    signature: "UQCe6n5rLseIrR8rLXtOke8qykbyh1UcZbqYiH0WTsOTnnQP0G7n0xhY/SJEAT6oyEWaePM+3akF3YvB16uDDw==",
  },
];
const V4_COSIGN_BOB = "rdi37Iyj9zlQD+0HGanbYZ+vjBtGOCrMqHpks+MDn+fmCBlmgZtzorR3QBVLdTFCXQsGMBSywhPklEF3oD1sCw==";
const v0 = VECTORS[0];
const v4 = VECTORS[4];
if (!v0 || !v4) throw new Error("edge test vectors missing");

// The exact RFC 8785 canonical string of V0's core (§16), keys sorted.
const V0_CORE_JSON =
  '{"command":null,"context":"nova:merchant","counter":0,"expiry":null,"from":"alice@nova","genesis":null,"kind":"vouch","parent":null,"prev":null,"schemaId":"alma.vouch/v1","status":"active","suite":"ed25519","to":"bob@nova","validFrom":412,"version":"alma-edge/v1","weightBp":5000}';

describe("RFC 0008 §16 golden vectors", () => {
  test("fixed seeds derive the published public keys", () => {
    expect(hex(alice.publicKey)).toBe("4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29");
    expect(hex(nova.publicKey)).toBe("7422b9887598068e32c4448a949adb290d0f4e35b9e01b0ee5f1a1e600fe2674");
    expect(hex(bob.publicKey)).toBe("f381626e41e7027ea431bfe3009e94bdd25a746beec468948d6c3c7c5dc9a54b");
  });

  test("V0 core canonicalizes to the exact RFC 8785 bytes", () => {
    const edge = issueEdge(v0.input, alice.privateKey);
    expect(new TextDecoder().decode(edgeSigningBytes(edge))).toBe(V0_CORE_JSON);
  });

  for (const v of VECTORS) {
    test(`${v.name}: edgeId + signature reproduce, and verify`, () => {
      const edge = issueEdge(v.input, v.signer.privateKey);
      expect(edgeId(edge)).toBe(v.edgeId);
      expect(edge.signature).toBe(v.signature);
      expect(verifyEdge(edge, v.signer.publicKey)).toEqual({ ok: true });
    });
  }

  test("V4 co-signature: bob signs the identical core bytes", () => {
    const edge = issueEdge(v4.input, nova.privateKey);
    const cosign = encodeBase64(ED25519_SUITE.sign(edgeSigningBytes(edge), bob.privateKey));
    expect(cosign).toBe(V4_COSIGN_BOB);
    // the co-signature verifies against bob's key over the same signed bytes
    expect(ED25519_SUITE.verify(edgeSigningBytes(edge), decodeBase64(cosign), bob.publicKey)).toBe(true);
  });
});

describe("edge issue + verify", () => {
  const base = (o: Partial<IssueEdgeInput> = {}): IssueEdgeInput => ({
    schemaId: "alma.vouch/v1",
    kind: "vouch",
    from: "alice@nova",
    to: "bob@nova",
    context: "nova:merchant",
    weightBp: 5000,
    validFrom: 1,
    ...o,
  });

  test("a freshly issued edge verifies", () => {
    const k = generateKeyPair();
    const edge = issueEdge(base(), k.privateKey);
    expect(edge.version).toBe(EDGE_VERSION);
    expect(edge.suite).toBe("ed25519");
    expect(verifyEdge(edge, k.publicKey)).toEqual({ ok: true });
  });

  test("a bare-region `from` endpoint is valid (region-issued edge)", () => {
    expect(isValidEndpoint("nova")).toBe(true);
    expect(isValidEndpoint("bob@nova")).toBe(true);
    expect(isValidEndpoint("nova/coin")).toBe(false);
    const edge = issueEdge(base({ kind: "sanction", schemaId: "alma.sanction/v1", from: "nova", weightBp: -4000 }), nova.privateKey);
    expect(verifyEdge(edge, nova.publicKey)).toEqual({ ok: true });
  });

  test("a tampered core field fails with 'bad-signature'", () => {
    const k = generateKeyPair();
    const edge = issueEdge(base(), k.privateKey);
    const tampered: Edge = { ...edge, context: "nova:hacker" };
    const res = verifyEdge(tampered, k.publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad-signature");
  });

  test("a different public key fails with 'bad-signature'", () => {
    const k = generateKeyPair();
    const edge = issueEdge(base(), k.privateKey);
    const res = verifyEdge(edge, generateKeyPair().publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad-signature");
  });

  test("an unknown suite is rejected BEFORE any crypto", () => {
    const k = generateKeyPair();
    const edge = issueEdge(base(), k.privateKey);
    const res = verifyEdge({ ...edge, suite: "made-up-suite" }, k.publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unknown-suite");
  });

  test("a malformed endpoint is rejected as invalid-from / invalid-to", () => {
    const k = generateKeyPair();
    const edge = issueEdge(base(), k.privateKey);
    const bad = verifyEdge({ ...edge, to: "nova/coin" }, k.publicKey);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("invalid-to");
    const bad2 = verifyEdge({ ...edge, from: "x/y" }, k.publicKey);
    expect(bad2.ok).toBe(false);
    if (!bad2.ok) expect(bad2.reason).toBe("invalid-from");
  });

  test("weightBp must be an integer in [-10000, 10000] (determinism)", () => {
    const k = generateKeyPair();
    expect(() => issueEdge(base({ weightBp: 0.5 }), k.privateKey)).toThrow();
    expect(() => issueEdge(base({ weightBp: 20000 }), k.privateKey)).toThrow();
    expect(() => issueEdge(base({ weightBp: -20000 }), k.privateKey)).toThrow();
  });

  test("edgeId is independent of caller field order (JCS)", () => {
    const k = generateKeyPair();
    const edge = issueEdge(base(), k.privateKey);
    const reordered = {
      status: edge.status,
      to: edge.to,
      from: edge.from,
      weightBp: edge.weightBp,
      version: edge.version,
      suite: edge.suite,
      schemaId: edge.schemaId,
      kind: edge.kind,
      genesis: edge.genesis,
      context: edge.context,
      command: edge.command,
      validFrom: edge.validFrom,
      expiry: edge.expiry,
      prev: edge.prev,
      counter: edge.counter,
      parent: edge.parent,
    };
    expect(edgeId(reordered)).toBe(edgeId(edge));
  });
});
