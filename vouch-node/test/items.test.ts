// Digital items over the network — `mint-item` and `transfer-item`.
//
// The engine deliberately does not decide who may mint (items.ts: "WHO may mint is
// left to the API layer"), and the node's answer is an INSTITUTION: each region's
// `items` policy names the minter class, and the policy consulted is the recipient's
// region of residence. That makes minting an experiment variable — a village that
// lets anyone mint and a village that keeps it owner-only can now be compared —
// which is the same reason governance was opened.
//
// Transfer has no such question: the engine is holder-gated, and the node binds the
// holder to the authenticated principal, so acting for someone else is inexpressible.

import { describe, expect, test } from "bun:test";
import { getItem } from "vouch-world/item";
import { itemPolicyOf } from "vouch-world/region";
import { MemoryAccountLog } from "../src/account-log";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { keypair, signCommand, signRegister } from "./helpers";

const ALICE = keypair(1); // founds + owns umi
const ANN = keypair(2); // resident agent ann@umi
const BO = keypair(3); // resident agent bo@umi
const MALLORY = keypair(4); // outside account, no region, no residence

/** alice owns umi; ann@umi and bo@umi live there with their own keys; mallory is nobody. */
function world(): VouchNode {
  const node = new VouchNode({ seed: "items", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
  expect(node.register(signRegister("alice", 0, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 2, { kind: "admit", agentId: "ann@umi", region: "umi", role: "merchant" }, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 3, { kind: "admit", agentId: "bo@umi", region: "umi", role: "artisan" }, ALICE)).ok).toBe(true);
  expect(node.register(signRegister("ann@umi", 0, ANN)).ok).toBe(true);
  expect(node.register(signRegister("bo@umi", 0, BO)).ok).toBe(true);
  expect(node.register(signRegister("mallory", 0, MALLORY)).ok).toBe(true);
  return node;
}

/** Amend umi's items institution to the given minting mode (alice is the dictator). */
function setMinting(node: VouchNode, nonce: number, minting: "owner" | "residents" | "anyone"): number {
  const res = node.submit(
    signCommand("alice", nonce, { kind: "amend", regionId: "umi", change: { policy: "items", value: { minting } } }, ALICE),
  );
  expect(res.ok).toBe(true);
  return nonce + 1;
}

describe("the items institution", () => {
  test("a freshly founded region defaults to owner-only minting", () => {
    const node = world();
    const region = node.world.getState().regions.umi;
    expect(region).toBeDefined();
    if (!region) throw new Error("unreachable");
    expect(itemPolicyOf(region).minting).toBe("owner");
  });

  test("amending it is a logged institution change like any other", () => {
    const node = world();
    setMinting(node, 4, "anyone");
    const region = node.world.getState().regions.umi;
    if (!region) throw new Error("unreachable");
    expect(itemPolicyOf(region).minting).toBe("anyone");
  });

  test("a mode outside the vocabulary is refused at the schema", () => {
    const node = world();
    const res = node.submit(
      signCommand("alice", 4, { kind: "amend", regionId: "umi", change: { policy: "items", value: { minting: "gods" } } }, ALICE),
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
  });
});

describe("mint-item under {minting:'owner'} (the default)", () => {
  test("the region owner mints for a resident", () => {
    const node = world();
    const res = node.submit(signCommand("alice", 4, { kind: "mint-item", itemId: "deed-1", itemKind: "deed", owner: "ann@umi" }, ALICE));

    expect(res.ok).toBe(true);
    expect(getItem(node.world.getState(), "deed-1")?.owner).toBe("ann@umi");
  });

  test("a resident cannot mint, and the refusal names the rule in force", () => {
    const node = world();
    const res = node.submit(signCommand("ann@umi", 1, { kind: "mint-item", itemId: "d", itemKind: "deed", owner: "ann@umi" }, ANN));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("minting-restricted-to-owner");
  });
});

describe("mint-item under {minting:'residents'}", () => {
  test("a resident mints for a neighbour", () => {
    const node = world();
    setMinting(node, 4, "residents");
    const res = node.submit(signCommand("ann@umi", 1, { kind: "mint-item", itemId: "b-1", itemKind: "badge", owner: "bo@umi" }, ANN));

    expect(res.ok).toBe(true);
    expect(getItem(node.world.getState(), "b-1")?.owner).toBe("bo@umi");
  });

  test("an account with no residence there cannot — including the owner acting as an account", () => {
    const node = world();
    const next = setMinting(node, 4, "residents");
    const mallory = node.submit(
      signCommand("mallory", 1, { kind: "mint-item", itemId: "m", itemKind: "badge", owner: "ann@umi" }, MALLORY),
    );
    expect(mallory.ok).toBe(false);
    if (mallory.ok) throw new Error("unreachable");
    expect(mallory.reason).toBe("minting-restricted-to-residents");

    // "residents" means residents: alice OWNS umi but does not LIVE there, so the mode
    // she amended in binds her too. (She can amend it back — that is the point of it
    // being an institution rather than a hardcoded rule.)
    const owner = node.submit(signCommand("alice", next, { kind: "mint-item", itemId: "a", itemKind: "badge", owner: "ann@umi" }, ALICE));
    expect(owner.ok).toBe(false);
    if (owner.ok) throw new Error("unreachable");
    expect(owner.reason).toBe("minting-restricted-to-residents");
  });
});

describe("mint-item under {minting:'anyone'}", () => {
  test("any authenticated principal mints", () => {
    const node = world();
    setMinting(node, 4, "anyone");
    const res = node.submit(signCommand("mallory", 1, { kind: "mint-item", itemId: "m-1", itemKind: "badge", owner: "ann@umi" }, MALLORY));

    expect(res.ok).toBe(true);
    expect(getItem(node.world.getState(), "m-1")?.owner).toBe("ann@umi");
  });
});

describe("mint-item refusals that hold in every mode", () => {
  test("the recipient must be a real agent", () => {
    const node = world();
    const res = node.submit(signCommand("alice", 4, { kind: "mint-item", itemId: "d", itemKind: "deed", owner: "ghost@umi" }, ALICE));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unknown-agent");
  });

  test("an item id is world-unique — a second mint of the same id is refused", () => {
    const node = world();
    expect(node.submit(signCommand("alice", 4, { kind: "mint-item", itemId: "d", itemKind: "deed", owner: "ann@umi" }, ALICE)).ok).toBe(
      true,
    );
    const again = node.submit(signCommand("alice", 5, { kind: "mint-item", itemId: "d", itemKind: "deed", owner: "bo@umi" }, ALICE));
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.reason).toBe("item-exists");
  });

  test("an oversized item id is refused at the schema, before any engine work", () => {
    const node = world();
    const before = node.world.log.length;
    const res = node.submit(
      signCommand("alice", 4, { kind: "mint-item", itemId: "x".repeat(100_000), itemKind: "deed", owner: "ann@umi" }, ALICE),
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
    expect(node.world.log.length).toBe(before);
  });
});

describe("transfer-item", () => {
  function minted(): VouchNode {
    const node = world();
    expect(
      node.submit(signCommand("alice", 4, { kind: "mint-item", itemId: "deed-1", itemKind: "deed", owner: "ann@umi" }, ALICE)).ok,
    ).toBe(true);
    return node;
  }

  test("the holder hands it over, and ownership actually moves", () => {
    const node = minted();
    const res = node.submit(signCommand("ann@umi", 1, { kind: "transfer-item", itemId: "deed-1", to: "bo@umi" }, ANN));

    expect(res.ok).toBe(true);
    expect(getItem(node.world.getState(), "deed-1")?.owner).toBe("bo@umi");
  });

  test("anyone else is not-owner — naming yourself as recipient does not help", () => {
    const node = minted();
    const res = node.submit(signCommand("bo@umi", 1, { kind: "transfer-item", itemId: "deed-1", to: "bo@umi" }, BO));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-owner");
    expect(getItem(node.world.getState(), "deed-1")?.owner).toBe("ann@umi");
  });

  test("handing an item to its current holder is refused, not journalled", () => {
    const node = minted();
    const before = node.world.log.length;
    const res = node.submit(signCommand("ann@umi", 1, { kind: "transfer-item", itemId: "deed-1", to: "ann@umi" }, ANN));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("already-owner");
    expect(node.world.log.length).toBe(before);
  });

  test("an unknown item is refused", () => {
    const node = minted();
    const res = node.submit(signCommand("ann@umi", 1, { kind: "transfer-item", itemId: "nope", to: "bo@umi" }, ANN));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unknown-item");
  });
});

describe("items survive a restart", () => {
  test("mint + transfer replay from the journal", () => {
    const journal = new MemoryJournal();
    const accountLog = new MemoryAccountLog();
    const node = new VouchNode({ seed: "items", notary: keypair(7), journal, accountLog });
    expect(node.register(signRegister("alice", 0, ALICE)).ok).toBe(true);
    expect(node.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE)).ok).toBe(true);
    expect(node.submit(signCommand("alice", 2, { kind: "admit", agentId: "ann@umi", region: "umi", role: "merchant" }, ALICE)).ok).toBe(
      true,
    );
    expect(
      node.submit(signCommand("alice", 3, { kind: "mint-item", itemId: "deed-1", itemKind: "deed", owner: "ann@umi" }, ALICE)).ok,
    ).toBe(true);

    const rebooted = new VouchNode({ seed: "items", notary: keypair(7), journal, accountLog });
    expect(getItem(rebooted.world.getState(), "deed-1")?.owner).toBe("ann@umi");
    expect(rebooted.world.log.digest()).toBe(node.world.log.digest());
  });
});
