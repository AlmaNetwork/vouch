import { describe, expect, test } from "bun:test";
import { generateKeyPair, issueCertificate, keyPairFromSeed } from "vouch-core";
import { z } from "zod";
import {
  AssetCredential,
  CredentialRegistry,
  defineCredentialType,
  EndorsementCredential,
  issueCredential,
  MembershipCredential,
  SkillCredential,
  StewardCredential,
  standardRegistry,
  verifyCredential,
  verifyCredentialWith,
} from "../../src/credential";

const ISSUED_AT = "2026-06-21T00:00:00.000Z";
const issuer = generateKeyPair();

describe("typed credentials — varied, validated certificate types", () => {
  test("issue + verify carries structured, typed claims", () => {
    const cert = issueCredential(
      SkillCredential,
      { issuer: "guild@umi", subject: "alice@umi", claims: { skill: "blacksmith", level: 7 }, issuedAt: ISSUED_AT },
      issuer.privateKey,
    );
    expect(cert.schemaId).toBe("alma.skill/v1");

    const res = verifyCredential(cert, issuer.publicKey, SkillCredential);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claims.skill).toBe("blacksmith");
      expect(res.claims.level).toBe(7); // typed access
    }
  });

  test("a variety of credential types each carry their own shape", () => {
    const certs = [
      issueCredential(
        MembershipCredential,
        { issuer: "guild@umi", subject: "alice@umi", claims: { org: "smiths", role: "master", since: "2024" }, issuedAt: ISSUED_AT },
        issuer.privateKey,
      ),
      issueCredential(
        AssetCredential,
        { issuer: "bank@umi", subject: "alice@umi", claims: { kind: "land", amount: 3, unit: "plot" }, issuedAt: ISSUED_AT },
        issuer.privateKey,
      ),
      issueCredential(
        EndorsementCredential,
        { issuer: "bob@umi", subject: "alice@umi", claims: { of: "alice@umi", weight: 4, note: "reliable" }, issuedAt: ISSUED_AT },
        issuer.privateKey,
      ),
    ];

    const registry = standardRegistry();
    for (const cert of certs) {
      const res = verifyCredentialWith(cert, issuer.publicKey, registry);
      expect(res.ok).toBe(true);
    }
    expect(registry.list().sort()).toEqual([
      "alma.asset/v1",
      "alma.endorsement/v1",
      "alma.gov/steward/v1",
      "alma.membership/v1",
      "alma.skill/v1",
    ]);
  });

  test("invalid elements are rejected at ISSUE time (level out of range)", () => {
    expect(() =>
      issueCredential(
        SkillCredential,
        { issuer: "guild@umi", subject: "alice@umi", claims: { skill: "blacksmith", level: 99 }, issuedAt: ISSUED_AT },
        issuer.privateKey,
      ),
    ).toThrow();
  });

  test("a signed cert whose claims violate the type fails with 'invalid-claims'", () => {
    // bypass the typed issuer: a validly-SIGNED cert with out-of-schema claims.
    const cert = issueCertificate(
      {
        issuer: "guild@umi",
        subject: "alice@umi",
        schemaId: "alma.skill/v1",
        claims: { skill: "blacksmith", level: 99 },
        issuedAt: ISSUED_AT,
      },
      issuer.privateKey,
    );
    const res = verifyCredential(cert, issuer.publicKey, SkillCredential);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid-claims");
  });

  test("verifying against the wrong type fails with 'schema-mismatch'", () => {
    const cert = issueCredential(
      SkillCredential,
      { issuer: "guild@umi", subject: "alice@umi", claims: { skill: "x", level: 1 }, issuedAt: ISSUED_AT },
      issuer.privateKey,
    );
    const res = verifyCredential(cert, issuer.publicKey, MembershipCredential);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("schema-mismatch");
  });

  test("an unknown schemaId via the registry fails with 'unknown-credential-type'", () => {
    const Unregistered = defineCredentialType("alma.custom/v1", z.object({ x: z.number() }));
    const cert = issueCredential(
      Unregistered,
      { issuer: "guild@umi", subject: "alice@umi", claims: { x: 1 }, issuedAt: ISSUED_AT },
      issuer.privateKey,
    );
    const res = verifyCredentialWith(cert, issuer.publicKey, standardRegistry());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unknown-credential-type");
  });

  test("form failures pass straight through from the core (tamper, wrong key)", () => {
    const cert = issueCredential(
      SkillCredential,
      { issuer: "guild@umi", subject: "alice@umi", claims: { skill: "x", level: 1 }, issuedAt: ISSUED_AT },
      issuer.privateKey,
    );

    const tampered = { ...cert, claims: { skill: "x", level: 2 } };
    const t = verifyCredential(tampered, issuer.publicKey, SkillCredential);
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toBe("bad-signature");

    const stranger = generateKeyPair();
    const w = verifyCredential(cert, stranger.publicKey, SkillCredential);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.reason).toBe("bad-signature");
  });

  test("the endorsement type validates that 'of' is a real identifier", () => {
    expect(() =>
      issueCredential(
        EndorsementCredential,
        { issuer: "bob@umi", subject: "alice@umi", claims: { of: "not an id", weight: 3 }, issuedAt: ISSUED_AT },
        issuer.privateKey,
      ),
    ).toThrow();
  });

  test("custom credential types compose with a registry", () => {
    const LicenseCredential = defineCredentialType("alma.license/v1", z.object({ scope: z.string(), expiresAt: z.string() }));
    const registry = new CredentialRegistry().register(LicenseCredential);
    const cert = issueCredential(
      LicenseCredential,
      { issuer: "gov@umi", subject: "alice@umi", claims: { scope: "trade", expiresAt: "2027-01-01" }, issuedAt: ISSUED_AT },
      issuer.privateKey,
    );
    const res = verifyCredentialWith(cert, issuer.publicKey, registry);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.claims.scope).toBe("trade");
  });

  test("the steward office credential round-trips with typed claims (C2 representation)", () => {
    const cert = issueCredential(
      StewardCredential,
      {
        issuer: "founder@nova",
        subject: "alice@nova",
        claims: { region: "nova", title: "steward", since: ISSUED_AT },
        issuedAt: ISSUED_AT,
      },
      issuer.privateKey,
    );
    expect(cert.schemaId).toBe("alma.gov/steward/v1");
    const res = verifyCredential(cert, issuer.publicKey, StewardCredential);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claims.region).toBe("nova");
      expect(res.claims.title).toBe("steward");
    }
  });

  test("the steward type rejects an invalid region string at issue time", () => {
    expect(() =>
      issueCredential(
        StewardCredential,
        {
          issuer: "founder@nova",
          subject: "alice@nova",
          claims: { region: "Not A Region", title: "steward", since: ISSUED_AT },
          issuedAt: ISSUED_AT,
        },
        issuer.privateKey,
      ),
    ).toThrow();
  });

  test("a validly-signed steward cert with out-of-schema claims fails 'invalid-claims'", () => {
    const cert = issueCertificate(
      {
        issuer: "founder@nova",
        subject: "alice@nova",
        schemaId: "alma.gov/steward/v1",
        claims: { region: "NOVA!", title: "", since: "" },
        issuedAt: ISSUED_AT,
      },
      issuer.privateKey,
    );
    const res = verifyCredential(cert, issuer.publicKey, StewardCredential);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid-claims");
  });

  test("credentials are deterministic under a seeded key + fixed issuedAt", () => {
    const k = keyPairFromSeed(new Uint8Array(32).fill(5));
    const a = issueCredential(
      SkillCredential,
      { issuer: "guild@umi", subject: "alice@umi", claims: { skill: "x", level: 3 }, issuedAt: ISSUED_AT },
      k.privateKey,
    );
    const b = issueCredential(
      SkillCredential,
      { issuer: "guild@umi", subject: "alice@umi", claims: { skill: "x", level: 3 }, issuedAt: ISSUED_AT },
      k.privateKey,
    );
    expect(a.signature).toBe(b.signature);
  });
});
