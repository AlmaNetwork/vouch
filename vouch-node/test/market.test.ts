// The region market — `lifecycle`, `list`, `handover`.
//
// A region is NEVER deleted. That is the design, and it is why this group exists: a
// defunct village is hibernated and handed on rather than removed. The three commands
// are the stages of that — put it to sleep, price it, pass it over.
//
// The sharp edge, and the reason for the one guard the node adds: a region's owner is
// the only account that can amend, list or hand it on. Give it to an account nobody
// holds a key for and the village is stranded forever, because it cannot be deleted
// and no one can act for it.

import { describe, expect, test } from "bun:test";
import { getRegion } from "vouch-world/region";
import { MemoryAccountLog } from "../src/account-log";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { keypair, signCommand, signRegister } from "./helpers";

const ALICE = keypair(1);
const BOB = keypair(2);

/** alice owns umi; bob is a registered account with no region. */
function world(): VouchNode {
  const node = new VouchNode({ seed: "mk", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
  expect(node.register(signRegister("alice", 0, ALICE)).ok).toBe(true);
  expect(node.register(signRegister("bob", 0, BOB)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE)).ok).toBe(true);
  return node;
}

const as = (n: number, command: unknown) => signCommand("alice", n, command, ALICE);
const region = (node: VouchNode) => getRegion(node.world.getState(), "umi");

describe("lifecycle", () => {
  test("the owner hibernates and reactivates", () => {
    const node = world();
    expect(node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" })).ok).toBe(true);
    expect(region(node)?.lifecycle).toBe("dormant");

    expect(node.submit(as(3, { kind: "lifecycle", regionId: "umi", lifecycle: "active" })).ok).toBe(true);
    expect(region(node)?.lifecycle).toBe("active");
  });

  test("a non-owner cannot", () => {
    const node = world();
    const res = node.submit(signCommand("bob", 1, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" }, BOB));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-owner");
  });

  // A dormant region is shut down: its residents cannot transact. That is what makes
  // hibernation a real state and not just a label.
  test("residents of a dormant region cannot transact", () => {
    const node = world();
    node.submit(as(2, { kind: "admit", agentId: "ann@umi", region: "umi", role: "merchant", currency: 100 }));
    node.submit(as(3, { kind: "admit", agentId: "bo@umi", region: "umi", role: "broker" }));
    node.register(signRegister("ann@umi", 0, BOB));
    expect(node.submit(as(4, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" })).ok).toBe(true);

    const res = node.submit(signCommand("ann@umi", 1, { kind: "transfer", from: "ann@umi", to: "bo@umi", amount: 10 }, BOB));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("region-dormant");
  });

  test("setting the lifecycle it already has journals nothing", () => {
    const node = world();
    const before = node.world.log.length;
    expect(node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "active" })).ok).toBe(true);
    expect(node.world.log.length).toBe(before);
  });
});

describe("list", () => {
  test("an active region cannot be listed — hibernate it first", () => {
    const node = world();
    const res = node.submit(as(2, { kind: "list", regionId: "umi", salePrice: 500 }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-dormant");
  });

  test("a dormant region lists, and delists with null", () => {
    const node = world();
    expect(node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" })).ok).toBe(true);
    expect(node.submit(as(3, { kind: "list", regionId: "umi", salePrice: 500 })).ok).toBe(true);
    expect(region(node)?.salePrice).toBe(500);

    expect(node.submit(as(4, { kind: "list", regionId: "umi", salePrice: null })).ok).toBe(true);
    expect(region(node)?.salePrice).toBeNull();
  });

  // 0 is a listing, not a delisting — giving a village away is a real choice.
  test("a free listing is a listing", () => {
    const node = world();
    node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" }));
    expect(node.submit(as(3, { kind: "list", regionId: "umi", salePrice: 0 })).ok).toBe(true);
    expect(region(node)?.salePrice).toBe(0);
  });

  test("a non-owner cannot list", () => {
    const node = world();
    node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" }));
    const res = node.submit(signCommand("bob", 1, { kind: "list", regionId: "umi", salePrice: 1 }, BOB));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-owner");
  });

  test("an absurd price is refused by the schema", () => {
    const node = world();
    node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" }));
    const res = node.submit(as(3, { kind: "list", regionId: "umi", salePrice: Number.MAX_SAFE_INTEGER }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
  });
});

describe("handover", () => {
  /** Take umi all the way to listed. Returns the next nonce for alice. */
  function listed(node: VouchNode): number {
    expect(node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" })).ok).toBe(true);
    expect(node.submit(as(3, { kind: "list", regionId: "umi", salePrice: 500 })).ok).toBe(true);
    return 4;
  }

  test("ownership moves, and the region survives whole", () => {
    const node = world();
    node.submit(as(2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" }));
    node.submit(as(3, { kind: "list", regionId: "umi", salePrice: 500 }));

    const res = node.submit(as(4, { kind: "handover", regionId: "umi", to: "bob" }));
    expect(res.ok).toBe(true);
    // The asking price is read before the handover — it clears the listing, so a
    // region read back afterwards always reports null.
    if (!res.ok) throw new Error("unreachable");
    expect(res.detail?.price).toBe(500);

    const r = region(node);
    expect(r?.owner).toBe("bob");
    expect(r?.displayName).toBe("Umi"); // preserved, not recreated
    expect(r?.lifecycle).toBe("active"); // reactivates
    expect(r?.salePrice).toBeNull(); // and delists
  });

  test("the new owner can govern it, and the old one cannot", () => {
    const node = world();
    listed(node);
    expect(node.submit(as(4, { kind: "handover", regionId: "umi", to: "bob" })).ok).toBe(true);

    const change = { policy: "resource", value: { capacity: 5, regenPerTick: 1 } };
    const byOld = node.submit(as(5, { kind: "amend", regionId: "umi", change }));
    expect(byOld.ok).toBe(false);
    if (byOld.ok) throw new Error("unreachable");
    expect(byOld.reason).toBe("not-governor");

    expect(node.submit(signCommand("bob", 1, { kind: "amend", regionId: "umi", change }, BOB)).ok).toBe(true);
  });

  test("an unlisted region cannot be handed over", () => {
    const node = world();
    const res = node.submit(as(2, { kind: "handover", regionId: "umi", to: "bob" }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-listed");
  });

  // The guard the engine leaves to the node. An owner nobody holds a key for is
  // permanent: regions are never deleted and every governing act is owner-gated, so a
  // typo here would strand the village forever.
  test("handing a region to an unregistered account is refused", () => {
    const node = world();
    listed(node);
    const before = node.world.log.length;
    const res = node.submit(as(4, { kind: "handover", regionId: "umi", to: "nobody-registered-this" }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unregistered-recipient");
    expect(node.world.log.length).toBe(before);
    expect(region(node)?.owner).toBe("alice"); // untouched
  });

  test("handing it to yourself is refused", () => {
    const node = world();
    listed(node);
    const res = node.submit(as(4, { kind: "handover", regionId: "umi", to: "alice" }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("already-owner");
  });

  test("a handover survives a restart", () => {
    const journal = new MemoryJournal();
    const accountLog = new MemoryAccountLog();
    const first = new VouchNode({ seed: "mk", notary: keypair(7), journal, accountLog });
    first.register(signRegister("alice", 0, ALICE));
    first.register(signRegister("bob", 0, BOB));
    first.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE));
    first.submit(signCommand("alice", 2, { kind: "lifecycle", regionId: "umi", lifecycle: "dormant" }, ALICE));
    first.submit(signCommand("alice", 3, { kind: "list", regionId: "umi", salePrice: 500 }, ALICE));
    expect(first.submit(signCommand("alice", 4, { kind: "handover", regionId: "umi", to: "bob" }, ALICE)).ok).toBe(true);

    const rebooted = new VouchNode({ seed: "mk", notary: keypair(7), journal, accountLog });
    expect(getRegion(rebooted.world.getState(), "umi")?.owner).toBe("bob");
  });
});
