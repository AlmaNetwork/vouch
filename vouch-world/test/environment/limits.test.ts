// The engine's own bounds on what a write may name.
//
// These are enforced here, at the mutators, and NOT only at whatever HTTP surface
// happens to be in front — vouch-node has its own schemas, but vouch-mcp, an embedder
// and any future route all reach these functions directly, and each of them would
// otherwise have to remember. See docs/LAUNCH.md.

import { describe, expect, test } from "bun:test";
import { keyPairFromSeed, MAX_REGION_LENGTH } from "vouch-core";
import {
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  executeTransfer,
  experimenterProposal,
  MAX_BALANCE,
  mintCurrency,
  proposeFounding,
} from "../../src/environment";
import { defineRegion, MAX_DISPLAY_NAME_LENGTH } from "../../src/region";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(9));

/** A world with region "nova" and its treasury. */
function novaWorld() {
  const w = createAlmaWorld("limits");
  proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova"), "test", "acct:alice"));
  admitTreasury(w, "nova");
  return w;
}

describe("founding bounds", () => {
  test("an over-length region id is refused", () => {
    const w = createAlmaWorld("limits");
    const before = w.log.length;
    expect(() => proposeFounding(w, experimenterProposal(defineRegion("z".repeat(MAX_REGION_LENGTH + 1), "X"), "t", null))).toThrow(
      /invalid region id/,
    );
    expect(w.log.length).toBe(before);
  });

  test("a region id right at the limit is fine", () => {
    const w = createAlmaWorld("limits");
    expect(() => proposeFounding(w, experimenterProposal(defineRegion("z".repeat(MAX_REGION_LENGTH), "X"), "t", null))).not.toThrow();
  });

  test("an over-length displayName is refused", () => {
    const w = createAlmaWorld("limits");
    const before = w.log.length;
    expect(() =>
      proposeFounding(w, experimenterProposal(defineRegion("nova", "N".repeat(MAX_DISPLAY_NAME_LENGTH + 1)), "t", null)),
    ).toThrow(/displayName is longer than/);
    expect(w.log.length).toBe(before);
  });

  test("an empty displayName is refused", () => {
    const w = createAlmaWorld("limits");
    expect(() => proposeFounding(w, experimenterProposal(defineRegion("nova", ""), "t", null))).toThrow(/displayName is required/);
  });
});

describe("admission bounds", () => {
  test("an opening balance beyond the ceiling is refused", () => {
    const w = novaWorld();
    const before = w.log.length;
    expect(() =>
      admitAgent(w, {
        id: "greed@nova",
        region: "nova",
        role: "merchant",
        valueProfile: "lenient",
        publicKey: "",
        currency: MAX_BALANCE + 1,
      }),
    ).toThrow(/currency must be an integer/);
    expect(w.log.length).toBe(before);
  });

  test("Number.MAX_SAFE_INTEGER is refused — this is the mint path", () => {
    const w = novaWorld();
    expect(() =>
      admitAgent(w, {
        id: "greed@nova",
        region: "nova",
        role: "merchant",
        valueProfile: "lenient",
        publicKey: "",
        currency: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(/currency must be an integer/);
  });

  test("an opening balance right at the ceiling is fine", () => {
    const w = novaWorld();
    const agent = admitAgent(w, {
      id: "rich@nova",
      region: "nova",
      role: "merchant",
      valueProfile: "lenient",
      publicKey: "",
      currency: MAX_BALANCE,
    });
    expect(agent.balances.currency).toBe(MAX_BALANCE);
  });

  test("an over-length publicKey is refused", () => {
    const w = novaWorld();
    expect(() =>
      admitAgent(w, { id: "ann@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "k".repeat(200) }),
    ).toThrow(/publicKey must be a string of at most/);
  });

  test("an over-length agent id is refused", () => {
    const w = novaWorld();
    expect(() =>
      admitAgent(w, { id: `${"a".repeat(500)}@nova`, region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "" }),
    ).toThrow(/invalid agent id/);
  });
});

describe("value-movement bounds", () => {
  test("a transfer amount beyond the ceiling is refused", () => {
    const w = novaWorld();
    admitAgent(w, { id: "ann@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "", currency: MAX_BALANCE });
    admitAgent(w, { id: "bo@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "" });

    const res = executeTransfer(w, { from: "ann@nova", to: "bo@nova", amount: MAX_BALANCE + 1 }, { tick: w.tick, notary: NOTARY });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("bad-amount");
  });

  test("a mint beyond the ceiling is refused", () => {
    const w = novaWorld();
    admitAgent(w, { id: "ann@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "" });

    const res = mintCurrency(w, "ann@nova", Number.MAX_SAFE_INTEGER, "test");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("bad-amount");
  });
});
