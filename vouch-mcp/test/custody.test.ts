import { describe, expect, test } from "bun:test";
import type { Subject } from "../src/custody";
import { makeCustody } from "./helpers";

const ISS = "https://idp.test";

describe("custody — principal derivation", () => {
  test("slug is a valid vouch name, deterministic, and bound to both iss and sub", () => {
    const { custody } = makeCustody();
    const a: Subject = { iss: ISS, sub: "alice" };
    const slug = custody.principalFor(a);
    expect(slug).toMatch(/^u[0-9a-f]{64}$/); // full sha256 digest; grammar-valid name (letter then alphanumerics)
    expect(custody.principalFor(a)).toBe(slug); // deterministic
    expect(custody.principalFor({ iss: ISS, sub: "bob" })).not.toBe(slug); // different sub
    expect(custody.principalFor({ iss: "https://other", sub: "alice" })).not.toBe(slug); // different iss
  });
});

describe("custody — signing", () => {
  test("scope-denied stops before any signing or registration", () => {
    const { custody, node, audit } = makeCustody();
    const s: Subject = { iss: ISS, sub: "alice" };
    const slug = custody.principalFor(s);
    const out = custody.signAndSubmit(s, slug, "req-1", [], "found", { kind: "found", regionId: "nova", displayName: "Nova" });
    expect(out.kind).toBe("scope-denied");
    if (out.kind === "scope-denied") expect(out.needed).toBe("vouch:found");
    expect(node.nonceOf(slug)).toBeNull(); // never registered
    expect(audit.entries().at(-1)?.outcome).toBe("scope-denied");
  });

  test("register-on-first-use, then strictly increasing nonce", () => {
    const { custody, node } = makeCustody();
    const s: Subject = { iss: ISS, sub: "alice" };
    const slug = custody.principalFor(s);

    const one = custody.signAndSubmit(s, slug, "r1", ["vouch:found"], "found", { kind: "found", regionId: "nova", displayName: "Nova" });
    expect(one.kind === "signed" && one.result.ok).toBe(true);
    expect(node.isRegistered(slug)).toBe(true);
    expect(node.nonceOf(slug)).toBe(1);

    const two = custody.signAndSubmit(s, slug, "r2", ["vouch:found"], "found", { kind: "found", regionId: "delta", displayName: "Delta" });
    expect(two.kind === "signed" && two.result.ok).toBe(true);
    expect(node.nonceOf(slug)).toBe(2);
  });

  test("a rejected command still advances the nonce (the node consumed it)", () => {
    const { custody, node } = makeCustody();
    const s: Subject = { iss: ISS, sub: "carol" };
    const resident = `${custody.principalFor(s)}@nova`;
    // No region/agent exists yet → transfer is rejected by the engine, but the nonce is consumed.
    const out = custody.signAndSubmit(s, resident, "r1", ["vouch:transfer"], "transfer", {
      kind: "transfer",
      from: resident,
      to: "x@nova",
      amount: 1,
    });
    expect(out.kind === "signed" && out.result.ok).toBe(false);
    expect(node.nonceOf(resident)).toBe(1); // consumed, so the next signature won't be a stale replay
  });

  test("two subjects get independent identities", () => {
    const { custody, node } = makeCustody();
    const a: Subject = { iss: ISS, sub: "alice" };
    const b: Subject = { iss: ISS, sub: "bob" };
    custody.signAndSubmit(a, custody.principalFor(a), "ra", ["vouch:found"], "found", {
      kind: "found",
      regionId: "alfa",
      displayName: "Alfa",
    });
    custody.signAndSubmit(b, custody.principalFor(b), "rb", ["vouch:found"], "found", {
      kind: "found",
      regionId: "bravo",
      displayName: "Bravo",
    });
    expect(node.nonceOf(custody.principalFor(a))).toBe(1);
    expect(node.nonceOf(custody.principalFor(b))).toBe(1);
    expect(custody.principalFor(a)).not.toBe(custody.principalFor(b));
  });
});
