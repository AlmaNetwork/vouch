import { describe, expect, test } from "bun:test";
import { generateKeyPair, keyPairFromSeed } from "../src/keys";
import {
  type Certificate,
  type IssueCertificateInput,
  CERT_VERSION,
  issueCertificate,
  verifyCertificate,
} from "../src/certificate";

const ISSUED_AT = "2026-01-01T00:00:00.000Z";

function baseInput(overrides: Partial<IssueCertificateInput> = {}): IssueCertificateInput {
  return {
    issuer: "guild@umi",
    subject: "alice@umi",
    schemaId: "alma.trust/artisan/v1",
    claims: { role: "artisan", grade: 2 },
    issuedAt: ISSUED_AT,
    ...overrides,
  };
}

describe("certificate issue + verify", () => {
  const issuer = generateKeyPair();

  test("a freshly issued certificate verifies", () => {
    const cert = issueCertificate(baseInput(), issuer.privateKey);
    expect(cert.version).toBe(CERT_VERSION);
    expect(cert.suite).toBe("ed25519");
    expect(verifyCertificate(cert, issuer.publicKey)).toEqual({ ok: true });
  });

  test("tampered claims fail with reason 'bad-signature'", () => {
    const cert = issueCertificate(baseInput(), issuer.privateKey);
    const tampered: Certificate = { ...cert, claims: { role: "merchant", grade: 9 } };
    const res = verifyCertificate(tampered, issuer.publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad-signature");
  });

  test("a different public key fails with reason 'bad-signature'", () => {
    const cert = issueCertificate(baseInput(), issuer.privateKey);
    const stranger = generateKeyPair();
    const res = verifyCertificate(cert, stranger.publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad-signature");
  });

  test("an unknown suite fails with reason 'unknown-suite'", () => {
    const cert = issueCertificate(baseInput(), issuer.privateKey);
    const weird: Certificate = { ...cert, suite: "rsa-pkcs1" };
    const res = verifyCertificate(weird, issuer.publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unknown-suite");
  });

  test("a malformed signature encoding is reported precisely", () => {
    const cert = issueCertificate(baseInput(), issuer.privateKey);
    const bad: Certificate = { ...cert, signature: "not*base64*" };
    const res = verifyCertificate(bad, issuer.publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid-signature-encoding");
  });

  test("issuing with an unknown suite throws", () => {
    expect(() => issueCertificate(baseInput({ suite: "rsa-pkcs1" }), issuer.privateKey)).toThrow(/unknown signature suite/);
  });

  test("issuing with an invalid issuer identifier throws", () => {
    expect(() => issueCertificate(baseInput({ issuer: "1bad@umi" }), issuer.privateKey)).toThrow();
  });

  test("issuing with an invalid subject identifier throws", () => {
    expect(() => issueCertificate(baseInput({ subject: "bob@Umi" }), issuer.privateKey)).toThrow();
  });

  test("a non-ISO issuedAt is rejected at issue time", () => {
    expect(() => issueCertificate(baseInput({ issuedAt: "yesterday" }), issuer.privateKey)).toThrow();
  });

  describe("malformed envelopes fail with reason 'malformed-envelope'", () => {
    const good = issueCertificate(baseInput(), issuer.privateKey);

    const cases: Array<[string, unknown]> = [
      ["not an object", 42],
      ["null", null],
      ["wrong version", { ...good, version: "alma-cert/v0" }],
      ["missing signature field", (() => { const { signature, ...rest } = good; return rest; })()],
      ["claims is an array", { ...good, claims: [1, 2, 3] }],
      ["claims is null", { ...good, claims: null }],
      ["empty schemaId", { ...good, schemaId: "" }],
      ["non-ISO issuedAt", { ...good, issuedAt: "2026/01/01" }],
    ];

    for (const [name, value] of cases) {
      test(name, () => {
        const res = verifyCertificate(value, issuer.publicKey);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe("malformed-envelope");
      });
    }
  });

  test("an invalid issuer in the envelope fails with reason 'invalid-issuer'", () => {
    const good = issueCertificate(baseInput(), issuer.privateKey);
    const res = verifyCertificate({ ...good, issuer: "1bad@umi" }, issuer.publicKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid-issuer");
  });

  test("reordering claim keys does not break verification (JCS determinism)", () => {
    const cert = issueCertificate(baseInput({ claims: { a: 1, b: 2, c: 3 } }), issuer.privateKey);
    const reordered: Certificate = { ...cert, claims: { c: 3, a: 1, b: 2 } };
    expect(verifyCertificate(reordered, issuer.publicKey)).toEqual({ ok: true });
  });

  test("the core does not interpret claims — arbitrary nested payloads round-trip", () => {
    const cert = issueCertificate(
      baseInput({
        schemaId: "alma.value/currency/v1",
        claims: { amount: 1000, currency: "umi-coin", meta: { transferable: true, history: [1, 2, 3] } },
      }),
      issuer.privateKey,
    );
    expect(verifyCertificate(cert, issuer.publicKey)).toEqual({ ok: true });
  });

  test("keyPairFromSeed is deterministic", () => {
    const seed = new Uint8Array(32).fill(7);
    const k1 = keyPairFromSeed(seed);
    const k2 = keyPairFromSeed(seed);
    expect(Array.from(k1.publicKey)).toEqual(Array.from(k2.publicKey));

    // and a certificate signed under a seeded key verifies under its derived public key
    const cert = issueCertificate(baseInput(), k1.privateKey);
    expect(verifyCertificate(cert, k2.publicKey)).toEqual({ ok: true });
  });
});
