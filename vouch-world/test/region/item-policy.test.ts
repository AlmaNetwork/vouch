// The `items` institution — who may mint — and its backward-compatibility story.
//
// The field is honestly optional: a region replayed from a journal older than the
// policy never carried it, so live state can genuinely lack it. `itemPolicyOf` is
// the one correct read, and these tests pin that a pre-policy region and a fresh
// region with the default behave identically.

import { describe, expect, test } from "bun:test";
import { amendInstitution, createAlmaWorld, experimenterProposal, proposeFounding, seedGenesis } from "../../src/environment";
import {
  DEFAULT_ITEM_POLICY,
  defineRegion,
  getRegion,
  type Institutions,
  itemPolicyOf,
  makeInstitutions,
  validateItemPolicy,
} from "../../src/region";

function worldWith(institutions?: Institutions) {
  const w = createAlmaWorld("item-policy");
  seedGenesis(w, [defineRegion("umi", "Umi", institutions)]);
  return w;
}

describe("itemPolicyOf — the fallback read", () => {
  test("a fresh region carries the default explicitly", () => {
    const w = worldWith();
    const region = getRegion(w.getState(), "umi");
    if (!region) throw new Error("unreachable");
    expect(region.institutions.itemPolicy).toEqual(DEFAULT_ITEM_POLICY);
    expect(itemPolicyOf(region).minting).toBe("owner");
  });

  test("a region whose institutions never carried the policy reads as the default", () => {
    // Simulate a region replayed from an older journal: institutions WITHOUT the
    // field, exactly as a pre-policy founding event would fold into state.
    const legacy = makeInstitutions();
    const { itemPolicy: _dropped, ...withoutPolicy } = legacy;
    const w = worldWith(withoutPolicy as Institutions);

    const region = getRegion(w.getState(), "umi");
    if (!region) throw new Error("unreachable");
    expect(region.institutions.itemPolicy).toBeUndefined();
    expect(itemPolicyOf(region)).toEqual(DEFAULT_ITEM_POLICY);
  });
});

describe("the policy is amendable and validated like every other institution", () => {
  test("amend flips the mode, and the change folds through the reducer", () => {
    const w = createAlmaWorld("item-policy-amend");
    // An OWNED region (genesis regions are owner-null and cannot be amended by anyone).
    proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova"), "founded by alice", "alice"));

    const after = amendInstitution(w, "nova", { policy: "items", value: { minting: "anyone" } }, "alice");
    expect(itemPolicyOf(after).minting).toBe("anyone");
    // and it is really in folded state, not just the mutator's return value
    const readBack = getRegion(w.getState(), "nova");
    if (!readBack) throw new Error("unreachable");
    expect(itemPolicyOf(readBack).minting).toBe("anyone");
  });

  test("a degenerate mode is refused at amend, before anything is journalled", () => {
    const w = createAlmaWorld("item-policy-amend-bad");
    proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova"), "founded by alice", "alice"));
    const before = w.log.length;
    expect(() =>
      amendInstitution(w, "nova", { policy: "items", value: { minting: "gods" } as unknown as { minting: "owner" } }, "alice"),
    ).toThrow();
    expect(w.log.length).toBe(before);
  });

  test("validateItemPolicy rejects a mode outside the vocabulary", () => {
    expect(() => validateItemPolicy({ minting: "owner" })).not.toThrow();
    expect(() => validateItemPolicy({ minting: "gods" } as unknown as { minting: "owner" })).toThrow();
  });

  test("makeInstitutions validates the partial it is given", () => {
    expect(() => makeInstitutions({ itemPolicy: { minting: "nobody" } as unknown as { minting: "owner" } })).toThrow();
  });
});
